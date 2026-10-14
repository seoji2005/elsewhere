import { DataTexture, Material, Mesh, MeshStandardMaterial, MeshToonMaterial, NearestFilter, RedFormat, Scene } from 'three';
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

// Anime: one shared toon ramp (shade / half-lit / lit) for every surface, so the whole city shares one program.
const ramp = new DataTexture(new Uint8Array([97, 97, 204, 255]), 4, 1, RedFormat);
ramp.minFilter = ramp.magFilter = NearestFilter;
ramp.needsUpdate = true;

export function applyLook(scene: Scene, look: 'a' | 'b' | 'anime', windowGlow = 1.6) {
  const { materials: p } = cornerPalette();
  const variants = new Map<Material, Material>();
  function shade(material: Material) {
    if (!(material instanceof MeshStandardMaterial)) return material;
    const cached = variants.get(material);
    if (cached) return cached;
    const result = material.clone();
    const name = material.name.toLowerCase();
    // Preserve the imported maps and decal alpha; never infer roles from mesh names.
    if (look !== 'a') {
      result.roughness = Math.max(result.roughness, 0.85);
      if (/brick/.test(name) && look === 'b') result.color.multiply(p.brick.color);
      if (/asphalt/.test(name)) result.color.copy(p.asphalt.color);
      // ORM red channel is the baked occlusion (mortar, trim recesses); Dirt leaves it empty.
      if (result.roughnessMap && !/dirt/.test(name)) result.aoMap = result.roughnessMap;
    }
    if (/fakeinterior_1|glass/.test(name)) {
      result.emissive.set('#ffc178');
      result.emissiveIntensity = /glass/.test(name) ? 0.12 : look === 'a' ? 0.65 : windowGlow;
      result.emissiveMap = result.map;
    }
    // MeshToonMaterial.copy reads the same colour, map, AO, emissive and normal fields from the standard material.
    const final = look === 'anime' ? Object.assign(new MeshToonMaterial().copy(result as never), { gradientMap: ramp }) : result;
    if (look === 'anime') final.color.offsetHSL(0, 0.05, name ? 0 : 0.12).multiplyScalar(1.1); // brighter; unnamed = road slabs
    if (look !== 'a' && name) grounded(final, /fakeinterior_1/.test(name));
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
