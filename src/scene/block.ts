import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import kitUrl from '../assets/buildings.glb?url';

// ?block=1 (C067): an ~85 m test street of the Blender building kit (tools/blender/buildings.py: six types, each a stack
// of base + n mid floors + top). A 10 m street (|z| < 5) and a cross street (|x| < 5) like the corner, 4.5 m sidewalks.
// Per type: ground storey, floor height, width, depth (as in buildings.py).
const kit: Record<string, number[]> = { walkup: [4, 3.2, 8, 13], brownstone: [5.5, 3, 6.5, 13], limestone: [4.2, 3.2, 9, 13],
  office: [4.6, 3.6, 14, 15], theater: [5.2, 3.6, 11, 16], laundry: [4.2, 3.1, 7, 12] };
// Quadrant [x sign, z sign, buildings from the crossing outwards: type, mid floors, width scale]. The corner building
// shows its side facade to the cross street; quadrants where that side would face away are mirrored.
const rows: [number, number, [string, number, number][]][] = [
  [-1, -1, [['office', 3, 1], ['walkup', 4, 1], ['brownstone', 3, 1], ['laundry', 3, .95], ['theater', 1, 1]]],
  [1, -1, [['limestone', 4, 1], ['brownstone', 2, 1.05], ['walkup', 5, .92], ['laundry', 4, 1.1], ['walkup', 3, 1.08]]],
  [1, 1, [['limestone', 3, 1.05], ['theater', 2, 1], ['walkup', 4, 1], ['brownstone', 3, .95], ['laundry', 3, 1]]],
  [-1, 1, [['office', 2, 1], ['laundry', 3, 1], ['walkup', 5, 1.05], ['brownstone', 2, 1], ['walkup', 3, .95]]],
];
// Curb furniture every 3 m: lamps and trees every 18 m, a hydrant every 36 m (STYLE §5).
const furniture = ['lamp', 'bin', '', 'tree', 'newsbox', 'hydrant', 'lamp', '', 'bench', 'tree', '', ''];

export async function buildBlock(scene: T.Scene) {
  const kitScene = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(kitUrl)).scene;
  const city = new T.Group(), solids: T.Box3[] = [], walls: T.Box3[] = [];
  // Pieces keep their own node transform (meshopt quantization), so each one sits in a wrapper.
  function put(parent: T.Object3D, name: string, x: number, y: number, z: number, yaw = 0) {
    const wrapper = new T.Group();
    wrapper.add(kitScene.getObjectByName(name)!.clone());
    wrapper.position.set(x, y, z); wrapper.rotation.y = yaw;
    parent.add(wrapper);
    return wrapper;
  }
  const local = (o: T.Object3D, x0: number, x1: number, z0: number, z1: number, h: number) =>
    new T.Box3().setFromPoints([new T.Vector3(x0, 0, z0), new T.Vector3(x1, h, z1)].map(p => p.applyMatrix4(o.matrixWorld)));
  for (const [sx, sz, row] of rows) {
    let at = 9.5;
    for (const [type, mids, scale] of row) {
      const [G, FH, W, D] = kit[type], holder = new T.Group();
      holder.position.set(sx * (at + W * scale / 2), 0.11, sz * (type === 'brownstone' ? 10.7 : 9.5)); // brownstones: areaway
      holder.rotation.y = sz > 0 ? Math.PI : 0;
      holder.scale.set(sx * sz < 0 ? -scale : scale, 1, 1);
      ['base', ...Array<string>(mids).fill('mid'), 'top'].forEach((piece, i) => put(holder, `${type}_${piece}`, 0, i ? G + (i - 1) * FH : 0, 0));
      city.add(holder);
      holder.updateMatrixWorld(true);
      holder.traverse(o => { o.userData.seed = holder.position.x + 1.7 * holder.position.z; }); // looks.ts brick tint
      const footprint = local(holder, -W / 2, W / 2, -D, 0, G + mids * FH + 1.3);
      solids.push(footprint); walls.push(footprint);
      if (type === 'brownstone') solids.push(local(holder, 0.45, 2.7, 0, 2.6, 2)); // stoop
      at += W * scale;
    }
  }
  for (const sz of [-1, 1]) for (let i = 0; i <= 31; i++) {
    const x = -46.5 + i * 3, kind = furniture[(i + (sz > 0 ? 5 : 0)) % furniture.length], r = kind === 'bench' ? 0.95 : 0.3;
    if (!kind || Math.abs(x) < 9) continue;
    put(city, `prop_${kind}`, x, 0.11, sz * 5.8, sz > 0 ? Math.PI : 0);
    solids.push(new T.Box3(new T.Vector3(x - r, 0, sz * 5.8 - 0.3), new T.Vector3(x + r, 2, sz * 5.8 + 0.3)));
  }
  // Bake to world space and merge one mesh per material (~27 draw calls); mirrored pieces get their winding flipped.
  city.updateMatrixWorld(true);
  const buckets = new Map<T.Material, T.BufferGeometry[]>();
  city.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    const source: T.BufferGeometry = object.geometry, geometry = new T.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) { // quantized glTF data -> float
      const { count, itemSize } = attribute, array = new Float32Array(count * itemSize);
      for (let i = 0; i < count * itemSize; i++) array[i] = attribute.getComponent(Math.floor(i / itemSize), i % itemSize);
      geometry.setAttribute(name, new T.BufferAttribute(array, itemSize));
    }
    const index = Array.from(source.index!.array);
    if (object.matrixWorld.determinant() < 0) for (let i = 0; i < index.length; i += 3) [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    geometry.setIndex(index).applyMatrix4(object.matrixWorld);
    geometry.setAttribute('seed', new T.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(object.userData.seed ?? 0), 1));
    const material = object.material as T.Material;
    buckets.set(material, [...buckets.get(material) ?? [], geometry]);
  });
  for (const [material, parts] of buckets) {
    const mesh = new T.Mesh(mergeGeometries(parts), material);
    mesh.name = material.name; mesh.castShadow = !/glass|bulb/.test(material.name); mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // Ground as in corner.ts: asphalt at y=0, 0.11 m kerbs (player.ts lifts the feet where |x| > 5 and |z| > 5), zebras.
  const asphalt = new T.MeshStandardMaterial({ color: '#414750', roughness: 0.96 });
  const paving = new T.MeshStandardMaterial({ color: '#b8b2a4', roughness: 0.9 });
  const paint = new T.MeshStandardMaterial({ color: '#e1d8be', roughness: 0.85 });
  function slab(w: number, h: number, d: number, x: number, y: number, z: number, material: T.Material, name: string) {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material);
    mesh.name = name; mesh.position.set(x, y, z); mesh.receiveShadow = true; scene.add(mesh);
  }
  slab(360, 0.15, 360, 0, -0.075, 0, asphalt, 'asphalt');
  for (const x of [-54, 54]) for (const z of [-54, 54]) slab(98, 0.22, 98, x, 0, z, paving, 'curb');
  for (const s of [-6.6, 6.6]) for (let i = 0; i < 7; i++) {
    slab(0.65, 0.02, 2.5, -3.3 + i * 1.1, 0.008, s, paint, 'crosswalk');
    slab(2.5, 0.02, 0.65, s, 0.008, -3.3 + i * 1.1, paint, 'crosswalk');
  }
  for (let x = -93; x <= 93; x += 5) if (Math.abs(x) > 10) slab(2.5, 0.02, 0.12, x, 0.008, 0, paint, 'lane paint');
  return { solids, walls, doors: [] as T.Vector3[] };
}
