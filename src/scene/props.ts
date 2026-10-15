import * as T from 'three';
import { loadAssets } from '../render/assets';

type Spot = [x: number, z: number, rotation: number, y?: number];
const up = new T.Vector3(0, 1, 0);
const matrix = (x: number, y: number, z: number, rotation: number, scale: T.Vector3) =>
  new T.Matrix4().compose(new T.Vector3(x, y, z), new T.Quaternion().setFromAxisAngle(up, rotation), scale);

// One InstancedMesh per source mesh, so every lamp, awning or bench of a kind is one draw call.
function instances(scene: T.Scene, source: T.Object3D, scale: T.Vector3, spots: Spot[]) {
  source.updateMatrixWorld(true);
  const bounds = new T.Box3().setFromObject(source);
  source.traverse(child => {
    if (!(child instanceof T.Mesh)) return;
    const mesh = new T.InstancedMesh(child.geometry, child.material, spots.length);
    spots.forEach(([x, z, r, y = 0.11], i) => mesh.setMatrixAt(i, matrix(x, y, z, r, scale).multiply(child.matrixWorld)));
    mesh.computeBoundingSphere();
    scene.add(mesh);
  });
  return spots.map(([x, z, r, y = 0.11]) => bounds.clone().applyMatrix4(matrix(x, y, z, r, scale)));
}

export function paint(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  draw(canvas.getContext('2d')!);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return texture;
}

// Blade sign: warm lettering on a dark board, unlit so it reads at dusk and feeds the bloom.
// Vertical columns of letters, one per space-separated word, read right to left like a Korean hanging sign.
function sign(scene: T.Scene, text: string, x: number, y: number, z: number) {
  const columns = text.split(' ').reverse(), rows = Math.max(...columns.map(word => word.length));
  const w = 16 + 80 * columns.length, h = Math.max(256, 60 + 76 * rows);
  const texture = paint(w, h, g => {
    g.fillStyle = '#23343a'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d9b77a'; g.lineWidth = 6; g.strokeRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#ffe2a8'; g.font = 'bold 64px sans-serif'; g.textAlign = 'center';
    columns.forEach((word, c) => [...word].forEach((letter, i) => g.fillText(letter, 48 + 80 * c, 96 + i * 76)));
  });
  const box = new T.BoxGeometry(0.08, 1.5 * h / 256, 0.75 * w / 128); // faces ±x carry the lettering: two groups = two draw calls
  box.clearGroups(); box.addGroup(0, 12, 0); box.addGroup(12, 24, 1);
  const board = new T.Mesh(box, [new T.MeshBasicMaterial({ map: texture, color: new T.Color(1.6, 1.6, 1.6) }),
    new T.MeshLambertMaterial({ color: '#2a2622' })]);
  board.position.set(x, y, z); scene.add(board);
}

// Street life for look B's dusk corner: lamps with lit heads and light pools, awnings, signs,
// benches, potted plants and road furniture. Returns walk blockers and contact-shadow boxes.
export async function streetProps(scene: T.Scene, city: T.Group, heroes: T.Object3D[]) {
  const street = (await loadAssets('street')).scene, find = (bundle: T.Object3D, name: string) => {
    const object = bundle.getObjectByName(name);
    if (!object) throw new Error(`Missing asset: ${name}`);
    return object;
  };
  // Façade plane of the hero row at x, found by a ray from the street at shopfront height.
  const ray = new T.Raycaster(), facade = (x: number) => {
    ray.set(new T.Vector3(x, 3, 0), new T.Vector3(0, 0, -1));
    return ray.intersectObjects(heroes)[0]?.point.z ?? -9;
  };
  const lamps: Spot[] = [[-13, -5.45, Math.PI], [-23, -5.45, Math.PI], [-33, -5.45, Math.PI],
    [-5.45, -14, -Math.PI / 2], [-5.45, -26, -Math.PI / 2], [5.45, -12, Math.PI / 2],
    [5.45, -27, Math.PI / 2], [-15, 5.45, 0], [-30, 5.45, 0]];
  const lampScale = 6.8, lamp = find(street, 'light-curved');
  lamp.traverse(o => { if (o instanceof T.Mesh) o.material.color.set('#7a7478'); }); // kit lilac -> dark iron
  instances(scene, lamp, new T.Vector3(1, 1, 1).multiplyScalar(lampScale), lamps);
  // Bulb under the end of the curved arm (model units, measured from the kit's bounds).
  const head = new T.Box3().setFromObject(lamp), bulb = new T.Vector3(0, head.max.y - 0.035, head.min.z + 0.03)
    .multiplyScalar(lampScale);
  const heads = new T.InstancedMesh(new T.SphereGeometry(0.16, 12, 6),
    new T.MeshBasicMaterial({ color: new T.Color('#ffd49a').multiplyScalar(6) }), lamps.length);
  const pools = new T.InstancedMesh(new T.PlaneGeometry(4.6, 4.6).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({
    map: paint(64, 64, g => {
      const fade = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      fade.addColorStop(0, '#fff'); fade.addColorStop(0.45, 'rgba(255,255,255,.35)'); fade.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = fade; g.fillRect(0, 0, 64, 64);
    }), color: '#ffb35c', transparent: true, opacity: 0.16, blending: T.AdditiveBlending,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }), lamps.length);
  lamps.forEach(([x, z, r], i) => {
    const at = bulb.clone().applyAxisAngle(up, r).add(new T.Vector3(x, 0.11, z));
    heads.setMatrixAt(i, matrix(at.x, at.y, at.z, 0, new T.Vector3(1, 0.6, 1)));
    pools.setMatrixAt(i, matrix(at.x, 0.13, at.z, 0, new T.Vector3(1, 1, 1)));
  });
  heads.computeBoundingSphere(); pools.computeBoundingSphere();
  heads.name = pools.name = 'glow';
  scene.add(heads, pools);
  // Striped canvas awnings over the shopfront: a tilted slab hinged at the wall, instanced.
  const stripes = paint(64, 4, g => {
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#efe3cc' : '#2f6b66'; g.fillRect(i * 8, 0, 8, 4); }
  });
  const awnings = new T.InstancedMesh(new T.BoxGeometry(3.2, 0.05, 1.3).translate(0, 0, 0.65).rotateX(0.4),
    new T.MeshLambertMaterial({ map: stripes }), 2);
  [-21.4, -17.6].forEach((x, i) => awnings.setMatrixAt(i, matrix(x, 3.1, facade(x), 0, new T.Vector3(1, 1, 1))));
  awnings.computeBoundingSphere();
  scene.add(awnings);
  sign(scene, '카페', -19.5, 4.4, facade(-19.5) + 0.42);
  sign(scene, '잔물결 찻방', -12.6, 3.4, facade(-12.6) + 0.42); // the tea house behind the cafe door (data/places)
  const seats = instances(scene, find(street, 'bench'), new T.Vector3(3.6, 1.8, 1.8),
    [[-20.94, facade(-19.5) + 0.75, 0], [-28.6, facade(-28.6) + 0.75, Math.PI]]);
  const pots = instances(scene, find(street, 'pottedPlant'), new T.Vector3(1.7, 1.7, 1.7),
    [[-23.3, facade(-23.3) + 0.35, 0], [-15.8, facade(-15.8) + 0.35, 0], [-11.8, facade(-11.8) + 0.35, 0]]);
  instances(scene, find(city, 'Prop_ManholeCover'), new T.Vector3(1, 1, 1), [[2.2, -14, 0, 0], [-15, 2, 0, 0]]);
  instances(scene, find(city, 'Prop_Drain'), new T.Vector3(1, 1, 1), [[-16.5, -4.7, 0, 0], [-4.7, -18, 0, 0]]);
  const posts = lamps.map(([x, z]) => new T.Box3(new T.Vector3(x - 0.15, 0, z - 0.15), new T.Vector3(x + 0.15, 2, z + 0.15)));
  return { solids: [...seats, ...pots, ...posts], grounded: [...seats, ...pots] };
}
