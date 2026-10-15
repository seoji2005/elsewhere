import { Color, DataTexture, LinearFilter, Material, Mesh, MeshStandardMaterial, MeshToonMaterial, NearestFilter,
  RedFormat, Scene, SRGBColorSpace, Texture } from 'three';
import { cornerPalette } from '../render/palette';

// Look B: darken the first metre above the pavement (contact occlusion) and lift upper floors
// slightly so façades stand on the ground; lit windows vary by floor and mesh (dark / warm / bright).
function grounded(material: Material, windows: boolean) {
  if (windows) material.defines = { ...material.defines, WINDOWS: '' };
  material.onBeforeCompile = shader => {
    // Window pattern seed: per source mesh, baked as the seed attribute when corner.ts merges meshes.
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        varying vec2 vGround;
        #ifdef WINDOWS
        attribute float seed;
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 ground = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
        ground = instanceMatrix * ground;
        #endif
        vGround = vec2((modelMatrix * ground).y, modelMatrix[3].x + 1.7 * modelMatrix[3].z);
        #ifdef WINDOWS
        vGround.y = seed;
        #endif`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb *= mix(.4, 1., smoothstep(.12, 1.4, vGround.x)) * (1. + .16 * smoothstep(3., 15., vGround.x));`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef WINDOWS
        float level = vGround.x < 3. ? .9 : fract(sin(floor(vGround.x / 3.1) * 12.99 + vGround.y * 4.13) * 43758.55);
        totalEmissiveRadiance *= level < .3 ? .12 : level < .75 ? 1. : 2.2;
        #endif`);
  };
}

// Anime city, two plans (?toon=a|b). Shared: brick tint from the per-mesh seed (one brick material for every
// building), contact occlusion, lit-window pattern. A "cel": two-step hard light with the cast-shadow edge
// quantized too, lavender shade, a thin warm band on the lit side of the terminator, a few mortar lines,
// windows as flat two-tone light panels. B "soft illustration": soft ramp (below), luma-based lavender shade,
// apricot band, top rim light and view-parallax room interiors behind the windows (MASTER_FEEDBACK 2장 ②).
function toonCity(material: Material, toon: 'a' | 'b', flags: Record<string, boolean>, sunPower: number) {
  material.defines = { ...material.defines, ...(toon === 'a' ? { TOON_A: '' } : { TOON_B: '' }),
    ...Object.fromEntries(Object.entries(flags).filter(([, on]) => on).map(([key]) => [key, ''])) };
  material.onBeforeCompile = shader => {
    shader.uniforms.sunPower = { value: sunPower };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        varying vec3 vWorld; varying float vSeed; varying vec2 vPane; attribute float seed;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
        wp = instanceMatrix * wp;
        #endif
        vWorld = (modelMatrix * wp).xyz; vSeed = seed; vPane = uv;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWorld; varying float vSeed; varying vec2 vPane; uniform float sunPower;
        float toonLit = 0., toonBand = 0.;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef FLAT_TEX
        diffuseColor.rgb = diffuse; // the texture keeps only its alpha (leaf cut-outs)
        #endif
        #ifdef BRICK
        float pick = fract(abs(vSeed) * .3183);
        diffuseColor.rgb *= pick < .33 ? vec3(.92, .82, .78) : pick < .66 ? vec3(.78, .83, .9) : vec3(.95, .88, .78);
        #ifdef TOON_A
        float course = fract(vWorld.y * 1.25), joint = fract((vWorld.x + vWorld.z) * .625 + .5 * step(.5, fract(vWorld.y * .625)));
        float lines = max(1. - smoothstep(.04, .08, course), .8 * (1. - smoothstep(.03, .06, joint)));
        diffuseColor.rgb *= 1. - .14 * lines * (1. - smoothstep(12., 30., distance(vWorld, cameraPosition)));
        #endif
        #endif
        #ifdef GROUND
        diffuseColor.rgb *= mix(.4, 1., smoothstep(.12, 1.4, vWorld.y)) * (1. + .16 * smoothstep(3., 15., vWorld.y));
        #endif`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef WINDOWS
        float level = vWorld.y < 3. ? .9 : fract(sin(floor(vWorld.y / 3.1) * 12.99 + vSeed * 4.13 + floor((vWorld.x + vWorld.z) * .85) * 2.17) * 43758.55);
        #ifdef TOON_A
        vec2 edge = min(vPane, 1. - vPane); float frame = 1. - smoothstep(.05, .09, min(edge.x, edge.y)), on = step(.45, level);
        totalEmissiveRadiance = emissive * mix(.05, 1.6, on) * (1. - frame);
        diffuseColor.rgb = mix(mix(vec3(.2, .25, .34), vec3(.32, .27, .2), on), vec3(.13, .13, .16), frame);
        #else
        vec3 viewRay = normalize(vWorld - cameraPosition);
        vec2 roomUv = fract(vec2((vWorld.x + vWorld.z) * .7, vWorld.y * .45) + viewRay.xz * .28);
        float curtain = smoothstep(.08, .22, roomUv.x) * smoothstep(.92, .78, roomUv.x), ceiling = smoothstep(.88, .55, roomUv.y);
        totalEmissiveRadiance *= mix(vec3(1., .68, .42), vec3(1., .92, .76), ceiling) * (.65 + .35 * curtain)
          * (level < .28 ? .14 : level < .72 ? 1.05 : 2.35);
        #endif
        #endif`)
      .replace('#include <opaque_fragment>', `
        #ifdef TOON_A
        outgoingLight = mix(outgoingLight * vec3(.78, .82, 1.04), outgoingLight, toonLit) * mix(vec3(1.), vec3(1.14, .98, .84), toonBand);
        #else
        float luma = dot(outgoingLight, vec3(.299, .587, .114));
        float bandMix = smoothstep(.28, .42, luma) * (1. - smoothstep(.42, .58, luma));
        outgoingLight = mix(outgoingLight * vec3(.78, .82, 1.04), outgoingLight, smoothstep(.18, .48, luma)) * (1. + vec3(.13, -.07, -.14) * bandMix);
        float rim = pow(1. - max(dot(normalize(vNormal), vec3(0., .35, .94)), 0.), 3.2);
        outgoingLight += vec3(.95, .88, 1.) * rim * .09 * smoothstep(1.2, 8., vWorld.y);
        #endif
        #include <opaque_fragment>`);
    // A: the sun's direct term becomes a hard step in both the terminator and the (PCF) cast shadow; the shade
    // side keeps only the sky fill, tinted lavender above. directLight.color carries the shadow factor, so its
    // strength relative to the unshadowed sun (sunPower) is the shadow.
    if (toon === 'a') shader.fragmentShader = shader.fragmentShader.replace('#include <lights_toon_pars_fragment>', `
        varying vec3 vViewPosition;
        struct ToonMaterial { vec3 diffuseColor; };
        void RE_Direct_Toon(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal,
          const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight) {
          float d = dot(geometryNormal, directLight.direction);
          float m = max(directLight.color.r, max(directLight.color.g, directLight.color.b)) / sunPower, open = smoothstep(.4, .6, m);
          float lit = smoothstep(.1, .16, d) * open;
          toonBand = max(toonBand, smoothstep(.16, .22, d) * (1. - smoothstep(.26, .36, d)) * open);
          toonLit = max(toonLit, lit);
          reflectedLight.directDiffuse += lit * directLight.color / max(m, 1e-3) * BRDF_Lambert(material.diffuseColor);
        }
        void RE_IndirectDiffuse_Toon(const in vec3 irradiance, const in vec3 geometryPosition, const in vec3 geometryNormal,
          const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in ToonMaterial material, inout ReflectedLight reflectedLight) {
          reflectedLight.indirectDiffuse += irradiance * BRDF_Lambert(material.diffuseColor);
        }
        #define RE_Direct RE_Direct_Toon
        #define RE_IndirectDiffuse RE_IndirectDiffuse_Toon`);
  };
}

// A: the photo textures become one painted colour each, the texture's alpha-weighted mean, read once per map.
const means = new Map<Texture, Color>();
function meanColor(map: Texture) {
  if (!means.has(map)) {
    const canvas = document.createElement('canvas'), color = new Color(0.5, 0.5, 0.5);
    canvas.width = canvas.height = 8;
    try {
      const g = canvas.getContext('2d')!;
      g.drawImage(map.image as CanvasImageSource, 0, 0, 8, 8);
      const px = g.getImageData(0, 0, 8, 8).data, sum = [0, 0, 0, 0];
      for (let i = 0; i < px.length; i += 4) for (let c = 0; c < 3; c++) sum[c] += px[i + c] * px[i + 3];
      for (let i = 3; i < px.length; i += 4) sum[3] += px[i];
      if (sum[3]) color.setRGB(sum[0] / sum[3] / 255, sum[1] / sum[3] / 255, sum[2] / sum[3] / 255, SRGBColorSpace);
    } catch { /* unreadable image: keep grey */ }
    means.set(map, color);
  }
  return means.get(map)!;
}

// Anime: one shared toon ramp (shade / half-lit / lit) for every surface, so the whole city shares one program.
const ramp = new DataTexture(new Uint8Array([97, 97, 204, 255]), 4, 1, RedFormat);
ramp.minFilter = ramp.magFilter = NearestFilter;
ramp.needsUpdate = true;
// Toon B: three levels with soft transitions (linear filtering between the texels).
const soft = new DataTexture(new Uint8Array([95, 95, 95, 95, 165, 165, 255, 255]), 8, 1, RedFormat);
soft.minFilter = soft.magFilter = LinearFilter;
soft.needsUpdate = true;

export function applyLook(scene: Scene, look: 'a' | 'b' | 'anime', windowGlow = 1.6, toon: 'a' | 'b' = 'b', sunPower = 3.2) {
  const { materials: p } = cornerPalette();
  const variants = new Map<Material, Material>();
  function shade(material: Material) {
    if (!(material instanceof MeshStandardMaterial)) return material;
    const cached = variants.get(material);
    if (cached) return cached;
    const result = material.clone();
    const name = material.name.toLowerCase();
    const windows = look === 'anime' && toon === 'a' ? /fakeinterior/.test(name) : /fakeinterior_1/.test(name);
    // Preserve the imported maps and decal alpha; never infer roles from mesh names.
    if (look !== 'a') {
      result.roughness = Math.max(result.roughness, 0.85);
      if (/brick/.test(name) && look === 'b') result.color.multiply(p.brick.color);
      if (/asphalt/.test(name)) result.color.copy(p.asphalt.color);
      // ORM red channel is the baked occlusion (mortar, trim recesses); Dirt leaves it empty.
      if (result.roughnessMap && !/dirt/.test(name)) result.aoMap = result.roughnessMap;
    }
    if (windows || /glass/.test(name)) {
      result.emissive.set('#ffc178');
      result.emissiveIntensity = /glass/.test(name) ? 0.12 : look === 'a' ? 0.65 : windowGlow;
      result.emissiveMap = result.map;
    }
    // Toon A: flat painted colour per photo texture (the palette atlases of the cars and street kit are flat already).
    const flat = look === 'anime' && toon === 'a' && !!result.map && !/colormap/.test(name);
    if (flat) {
      result.color.multiply(meanColor(result.map!)).offsetHSL(0, 0.12, 0.03);
      if (!(result.alphaTest > 0 || result.transparent)) result.map = null;
      result.emissiveMap = result.normalMap = result.aoMap = null;
    }
    // MeshToonMaterial.copy reads the same colour, map, AO, emissive and normal fields from the standard material.
    const final = look === 'anime' ? Object.assign(new MeshToonMaterial().copy(result as never), { gradientMap: toon === 'a' ? ramp : soft }) : result;
    if (look === 'anime') final.color.offsetHSL(0, 0.05, name ? 0 : 0.12).multiplyScalar(1.1); // brighter; unnamed = road slabs
    if (look === 'anime') toonCity(final, toon, { WINDOWS: windows, BRICK: /brick/.test(name), FLAT_TEX: flat && !!result.map, GROUND: !!name }, sunPower);
    else if (look !== 'a' && name) grounded(final, windows);
    variants.set(material, final);
    return final;
  }
  scene.traverse(object => {
    if (object instanceof Mesh) object.material = Array.isArray(object.material)
      ? object.material.map(shade) : shade(object.material);
  });
  // Dispose the temporary colour swatches after cloning the asset materials.
  Object.values(p).forEach(material => material.dispose());
}
