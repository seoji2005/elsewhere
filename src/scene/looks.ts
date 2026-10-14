import { Material, Mesh, MeshStandardMaterial, Scene } from 'three';
import { cornerPalette } from '../render/palette';

// Look B: darken the first metre above the pavement (contact occlusion) and lift upper floors
// slightly so façades stand on the ground; lit windows vary by floor and mesh (dark / warm / bright).
function grounded(material: MeshStandardMaterial, windows: boolean) {
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

export function applyLook(scene: Scene, look: 'a' | 'b') {
  const { materials: p } = cornerPalette();
  const variants = new Map<Material, Material>();
  function shade(material: Material) {
    if (!(material instanceof MeshStandardMaterial)) return material;
    const cached = variants.get(material);
    if (cached) return cached;
    const result = material.clone();
    const name = material.name.toLowerCase();
    // Preserve the imported maps and decal alpha; never infer roles from mesh names.
    if (look === 'b') {
      result.roughness = Math.max(result.roughness, 0.85);
      if (/brick/.test(name)) result.color.multiply(p.brick.color);
      if (/asphalt/.test(name)) result.color.copy(p.asphalt.color);
      // ORM red channel is the baked occlusion (mortar, trim recesses); Dirt leaves it empty.
      if (result.roughnessMap && !/dirt/.test(name)) result.aoMap = result.roughnessMap;
      if (name) grounded(result, /fakeinterior_1/.test(name));
    }
    if (/fakeinterior_1|glass/.test(name)) {
      result.emissive.set('#ffc178');
      result.emissiveIntensity = /glass/.test(name) ? 0.12 : look === 'b' ? 1.6 : 0.65;
      result.emissiveMap = result.map;
    }
    variants.set(material, result);
    return result;
  }
  scene.traverse(object => {
    if (object instanceof Mesh) object.material = Array.isArray(object.material)
      ? object.material.map(shade) : shade(object.material);
  });
  // Dispose the temporary colour swatches after cloning the asset materials.
  Object.values(p).forEach(material => material.dispose());
}
