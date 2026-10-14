import { Material, Mesh, Scene } from 'three';
import { cornerPalette } from '../render/palette';

export function applyLook(scene: Scene, look: 'a' | 'b') {
  if (look === 'a') return;
  const { materials: p } = cornerPalette();
  function matte(material: Material, mesh: Mesh) {
    const name = `${material.name} ${mesh.name}`.toLowerCase();
    if (/leaves|tree|bush/.test(name)) return p.foliage;
    if (/brick|dirt|bark/.test(name)) return p.brick;
    if (/asphalt/.test(name)) return p.asphalt;
    if (/glass|interior|metal|colormap|bollard/.test(name)) return p.metal;
    if (/concrete|curb/.test(name)) return p.curb;
    return p.plaster;
  }
  scene.traverse(object => {
    if (object instanceof Mesh) object.material = Array.isArray(object.material)
      ? object.material.map(material => matte(material, object)) : matte(object.material, object);
  });
}
