import * as T from 'three';
import { MToonMaterial } from '@pixiv/three-vrm';
import { tone } from '../render/style';

// Modern everyday clothes on the CC0 VRoid samples (assets/manifest.json). Every sample's top is a light shirt under a
// dark vest (or a hoodie with dark trim) in the same UV layout, so one palette per person:
// [shirt, vest/hoodie, bottoms, accessory (tie/ribbon), shoes, hair, iris]. Source = VRM key in model.ts.
export const outfits = [
  { name: '주인공', source: 'shino', colors: ['#fbfaf6', '#7fb7a8', '#3b4a6b', '#d9646f', '#4a4046', '#2d2a3a', '#8d6a4c'] },
  { name: '조율사', source: 'basemale', colors: ['#c9cfc9', '#5c6b5a', '#3e4248', '#3b3f45', '#2f2a28', '#3a2f2a', '#5a6b7a'] },
  { name: '카페 점원', source: 'shibu', colors: ['#fff6ea', '#7a4b36', '#3a2f2b', '#c9a46a', '#5a4034', '#4c3326', '#7a5a3a'] },
  { name: '사무직', source: 'fumiriya', colors: ['#f4f6fa', '#5b6270', '#2f3340', '#334a7a', '#262426', '#6b5a52', '#4e5e72'] },
  { name: '학생', source: 'hoodie', colors: ['#8fb3e0', '#5e7fae', '#34405a', '#ffffff', '#e8e6df', '#26242e', '#5a4a3a'] },
  { name: '사교형', source: 'shino', colors: ['#fff4f0', '#e59aae', '#6c4f73', '#f0d08a', '#d8c4b4', '#a87a55', '#7a9a6a'] },
  { name: '여학생', source: 'shibu', colors: ['#f8f8f4', '#2f3f6b', '#4e5a73', '#b23a48', '#3a3030', '#1f2230', '#5a4a40'] },
] as const;
// ?model=lise-c (C063): Lise built in Blender on the VRoid sample (tools/blender/lise_vroid.py). Her colours are baked
// into flat cloth materials and renamed hair/iris maps, so no slot is repainted.
export const LISE_C = { name: '리세', source: 'lisec', colors: [] } as const;
export type Outfit = typeof outfits[number] | typeof LISE_C;
const textures = new Map<string, T.Texture>(), materials = new Map<string, T.Material>();

// Repaint an authored map as flat colour with soft shading: opaque pixels split into a light and a dark half (shirt vs
// vest) when two colours are given; brightness then only varies by (luminance / half's mean)^soft, so folds stay
// subtle and the original pattern never bleeds through. Unchanged maps remain shared.
function recolor(map: T.Texture, colors: readonly string[], soft: number) {
  const key = `${map.uuid}:${colors}:${soft}`;
  if (textures.has(key)) return textures.get(key)!;
  const canvas = document.createElement('canvas'), source = map.image;
  canvas.width = Math.min(512, source.width); canvas.height = Math.round(source.height * canvas.width / source.width);
  const g = canvas.getContext('2d')!;
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = g.getImageData(0, 0, canvas.width, canvas.height), { data } = pixels;
  const lum = new Float32Array(data.length / 4), half = new Uint8Array(lum.length), sum = [0, 0], count = [0, 0];
  for (let i = 0; i < lum.length; i++) {
    lum[i] = (0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2]) / 255;
    if (data[i * 4 + 3] < 8) continue;
    half[i] = colors.length > 1 && lum[i] < 0.5 ? 1 : 0;
    sum[half[i]] += lum[i]; count[half[i]]++;
  }
  const rgb = colors.map(color => new T.Color(color).getRGB(new T.Color(), T.SRGBColorSpace));
  for (let i = 0; i < lum.length; i++) {
    const h = half[i], light = T.MathUtils.clamp(Math.pow(lum[i] / Math.max(sum[h] / (count[h] || 1), 0.02), soft), 0.6, 1.2);
    data[i * 4] = 255 * rgb[h].r * light; data[i * 4 + 1] = 255 * rgb[h].g * light; data[i * 4 + 2] = 255 * rgb[h].b * light;
  }
  g.putImageData(pixels, 0, 0);
  const texture = map.clone(); texture.source = new T.Source(canvas); texture.needsUpdate = true;
  textures.set(key, texture);
  return texture;
}

// STYLE §4: MToon gets the city's two-step cel. Its sky fill lights the full colour even on the shade side, so the fill is
// mixed by the same shading factor as the sun: shade/lit is then the time's multiplier exactly, as on the buildings.
function cel(material: MToonMaterial) {
  const defines = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    defines(shader, renderer);
    shader.fragmentShader = shader.fragmentShader.replace('float getShading(', 'float celLit = 0.;\nfloat getShading(')
      .replaceAll('float shading = getShading( dotNL, shadow, material.shadingShift );', '$&\n    celLit = max(celLit, shading);')
      .replaceAll('irradiance * BRDF_Lambert( material.diffuseColor )',
        'irradiance * BRDF_Lambert( mix( material.shadeColor, material.diffuseColor, celLit ) )');
  };
}

export function dress(scene: T.Object3D, outfit: Outfit) {
  const slots = (name: string) => /Tops/.test(name) ? [0, 1] : /Bottoms/.test(name) ? [2] : /Accessory/.test(name) ? [3]
    : /Shoes/.test(name) ? [4] : /HAIR|FaceBrow/.test(name) ? [5] : /EyeIris/.test(name) ? [6] : undefined;
  scene.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const tint = (original: T.Material) => {
      if (!(original instanceof MToonMaterial)) return original;
      const key = `${original.uuid}:${outfit.name}`, paint = slots(original.name);
      if (materials.has(key)) return materials.get(key)!;
      const material = original.clone();
      if (paint && material.map) {
        material.map = recolor(material.map, paint.map(i => outfit.colors[i]), paint[0] === 5 ? 0.8 : 0.35);
        material.color.set('#ffffff');
      }
      // Shade = lit colour x the time's multiplier, terminator at N·L ≈ 0.13 like the city, no rim or matcap. Faces and
      // eyes never shade (no blot under the nose). Lines come from the city's ToonEdges pass: hull outlines are hidden.
      material.shadeMultiplyTexture = material.map;
      material.shadeColorFactor.copy(material.color);
      if (!/Face|Eye/.test(original.name)) material.shadeColorFactor.multiply(tone.shade);
      Object.assign(material, { shadingToonyFactor: 0.95, shadingShiftFactor: -0.13, shadingShiftTexture: null,
        matcapTexture: null, rimMultiplyTexture: null, visible: !original.isOutline });
      material.parametricRimColorFactor.setRGB(0, 0, 0);
      cel(material);
      materials.set(key, material);
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(tint) : tint(object.material);
  });
}
