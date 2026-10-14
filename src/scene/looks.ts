import { Material, Mesh, MeshStandardMaterial, Scene } from 'three';
import { cornerPalette } from '../render/palette';

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
    }
    if (/fakeinterior_1|glass/.test(name)) {
      result.emissive.set('#ffc178');
      result.emissiveIntensity = /glass/.test(name) ? 0.12 : 0.65;
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
