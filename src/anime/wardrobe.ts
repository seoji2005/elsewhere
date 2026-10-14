import * as T from 'three';
import { MToonMaterial } from '@pixiv/three-vrm';

// Palette order: top/dress, bottoms, accessory, shoes, hair, iris, skin.
export const outfits = [
  { name: '주인공', source: 'avatar', colors: ['#668da3', '#35465b', '#e1bd76', '#484456', '#655063', '#527f99', '#fff2e8'] },
  { name: '조율사', source: 'shino', colors: ['#466d79', '#304357', '#cfa15f', '#353b43', '#443931', '#8d7248', '#e3bca4'] },
  { name: '카페 점원', source: 'avatar', colors: ['#a16a51', '#efe0c5', '#f3dec1', '#594038', '#684431', '#9a793e', '#ffe5ce'] },
  { name: '사무직', source: 'shino', colors: ['#777e8b', '#383e50', '#ddd5ca', '#343440', '#38323e', '#656b8f', '#f4d7c6'] },
  { name: '학생', source: 'shino', colors: ['#b6aa87', '#5d7292', '#ad615b', '#f0e8d8', '#705345', '#6b8264', '#fce7da'] },
  { name: '사교형', source: 'avatar', colors: ['#d58e9e', '#f4d6b4', '#ecd18e', '#eee0cf', '#b89964', '#8a659c', '#ffead9'] },
] as const;
export type Outfit = typeof outfits[number];
const textures = new Map<string, T.Texture>(), materials = new Map<string, T.Material>();

// Repaint luminance, retaining authored folds, face details and alpha. Unchanged maps remain shared.
function recolor(map: T.Texture, color: string, pattern = '') {
  const key = `${map.uuid}:${color}:${pattern}`;
  if (textures.has(key)) return textures.get(key)!;
  const canvas = document.createElement('canvas'), source = map.image;
  canvas.width = Math.min(512, source.width); canvas.height = Math.round(source.height * canvas.width / source.width);
  const g = canvas.getContext('2d')!;
  g.drawImage(source, 0, 0, canvas.width, canvas.height);
  const pixels = g.getImageData(0, 0, canvas.width, canvas.height), rgb = new T.Color(color).getRGB(new T.Color(), T.SRGBColorSpace);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const x = (i / 4) % canvas.width, y = Math.floor(i / 4 / canvas.width), step = Math.max(8, canvas.width / 24);
    const line = x % step < step * 0.1 || (pattern === 'check' && y % step < step * 0.1);
    const light = (0.35 + 0.65 * Math.max(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]) / 255)
      * (pattern && line ? 0.72 : 1);
    pixels.data[i] = 255 * rgb.r * light; pixels.data[i + 1] = 255 * rgb.g * light; pixels.data[i + 2] = 255 * rgb.b * light;
  }
  g.putImageData(pixels, 0, 0);
  const texture = map.clone(); texture.source = new T.Source(canvas); texture.needsUpdate = true;
  textures.set(key, texture);
  return texture;
}

export function dress(scene: T.Object3D, outfit: Outfit) {
  scene.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const tint = (original: T.Material) => {
      if (!(original instanceof MToonMaterial)) return original;
      const name = original.name, index = /Tops|Onepice/.test(name) ? 0 : /Bottoms/.test(name) ? 1
        : /Accessory/.test(name) ? 2 : /Shoes/.test(name) ? 3 : /HAIR|FaceBrow/.test(name) ? 4
        : /EyeIris/.test(name) ? 5 : /SKIN/.test(name) ? 6 : -1;
      if (index === -1) return original;
      const pattern = index === 0 ? outfit.name === '사무직' ? 'stripe' : outfit.name === '학생' ? 'check' : '' : '';
      const color = outfit.colors[index], key = `${original.uuid}:${color}:${pattern}`;
      if (materials.has(key)) return materials.get(key)!;
      const material = original.clone();
      if (index === 6) { material.color.multiply(new T.Color(color)); material.shadeColorFactor.multiply(new T.Color(color)); }
      else {
        if (material.map) material.map = recolor(material.map, color, pattern);
        if (material.shadeMultiplyTexture) material.shadeMultiplyTexture = recolor(material.shadeMultiplyTexture, color, pattern);
        material.color.set('#ffffff'); material.shadeColorFactor.set('#b8b0c5');
      }
      materials.set(key, material);
      return material;
    };
    object.material = Array.isArray(object.material) ? object.material.map(tint) : tint(object.material);
  });
}
