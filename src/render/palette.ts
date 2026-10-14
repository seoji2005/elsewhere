// from research R001
import { MeshLambertMaterial } from 'three';

// Shared matte materials; own colours, no copied LUT, texture or node shader.
export function cornerPalette() {
  const colors = { plaster: '#d8ccb7', asphalt: '#525d68',
    curb: '#a1aaa8', brick: '#ab7761', foliage: '#648873', metal: '#6f7d86' };
  const materials = {
    plaster: new MeshLambertMaterial({ color: colors.plaster }),
    asphalt: new MeshLambertMaterial({ color: colors.asphalt }),
    curb: new MeshLambertMaterial({ color: colors.curb }),
    brick: new MeshLambertMaterial({ color: colors.brick }),
    foliage: new MeshLambertMaterial({ color: colors.foliage }),
    metal: new MeshLambertMaterial({ color: colors.metal }),
  };
  return { materials, dispose() {
    Object.values(materials).forEach(material => material.dispose());
  } };
}
