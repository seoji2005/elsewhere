import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import kitUrl from '../assets/buildings.glb?url';
import { paint } from './props';
import { townDoors } from '../data/doors';

// ?town=1 (C077): one block of the C067 building kit holding the seven places of data/places, each door at its
// data/doors townDoors pose. Same street frame as block.ts (a 10 m street along x, a cross street along z, 4.5 m
// sidewalks), so player.ts kerbs and bounds hold. Kit numbers per type: ground storey, floor height, width, depth.
const kit: Record<string, number[]> = { walkup: [4, 3.2, 8, 13], brownstone: [5.5, 3, 6.5, 13], limestone: [4.2, 3.2, 9, 13],
  office: [4.6, 3.6, 14, 15], theater: [5.2, 3.6, 11, 16], laundry: [4.2, 3.1, 7, 12] };
// Lot: type, mid floors, centre x, façade z, facing (+1 looks at +z, -1 at -z), flip (door side swapped), another
// kit wall (neighbours of one type apart, STYLE §2). Unflipped, a corner building shows its side façade to the cross
// street (as block.ts).
const lots: [string, number, number, number, number, boolean?, string?][] = [
  // South row: 빛고리 조율실 (office on the corner), 모아결 교환소 (limestone shop), 잔물결 찻방 (walk-up tea room).
  ['office', 4, -16.5, -9.5, 1], ['limestone', 3, -28, -9.5, 1, true], ['walkup', 3, -36.5, -9.5, 1, true],
  ['laundry', 3, -44, -9.5, 1], ['brownstone', 2, -50.75, -9.5, 1],
  // North row: 떠오름 뜰 (pocket square, x -24..-9.5), 겹빛 공동집 (walk-up), 고요결 집 and 높은울 집 (brownstones).
  ['walkup', 5, -28, 9.5, -1], ['brownstone', 2, -35.25, 9.5, -1], ['brownstone', 4, -41.75, 9.5, -1, false, 'wall_tanbrick'], ['walkup', 3, -49, 9.5, -1],
  ['brownstone', 3, -12.75, 24.5, -1], ['walkup', 4, -20, 24.5, -1, false, 'wall_brownstone'], // the square's back wall
  // East of the crossing: the rest of the neighbourhood.
  ['limestone', 4, 14, -9.5, 1], ['brownstone', 2, 21.75, -9.5, 1], ['walkup', 5, 29, -9.5, 1], ['laundry', 4, 36.5, -9.5, 1],
  ['walkup', 3, 44, -9.5, 1], ['limestone', 3, 14, 9.5, -1], ['theater', 2, 24, 9.5, -1], ['walkup', 4, 33.5, 9.5, -1],
  ['brownstone', 3, 40.75, 9.5, -1],
];
const square = { x0: -24, x1: -9.5, z0: 9.5, z1: 24.5 }, sx = (square.x0 + square.x1) / 2, sz = (square.z0 + square.z1) / 2;
// Curb furniture every 3 m (block.ts rhythm), none in front of a door.
const furniture = ['lamp', 'bin', '', 'tree', 'newsbox', 'hydrant', 'lamp', '', 'bench', 'tree', '', ''];

// Painted signboard (STYLE §5: fictional English names, flat lettering on a framed board, 6 cm off the wall).
function sign(scene: T.Scene, frame: T.Material, text: string, w: number, h: number, x: number, y: number, z: number,
  yaw: number, colors = ['#2f4a3e', '#f1e2c2'], font = 'bold', sub = '') {
  const pw = Math.round(w * 128), ph = Math.round(h * 128);
  const face = new T.MeshBasicMaterial({ color: new T.Color(0.92, 0.92, 0.92), map: paint(pw, ph, g => {
    g.fillStyle = colors[0]; g.fillRect(0, 0, pw, ph);
    g.strokeStyle = colors[1]; g.lineWidth = Math.max(2, ph * 0.04); g.strokeRect(ph * 0.08, ph * 0.08, pw - ph * 0.16, ph - ph * 0.16);
    g.fillStyle = colors[1]; g.textAlign = 'center'; g.textBaseline = 'middle';
    const fit = (line: string, size: number) => {
      g.font = `${font} ${size}px ${/italic/.test(font) ? 'Georgia, serif' : 'Arial, sans-serif'}`;
      const scale = Math.min(1, pw * 0.86 / g.measureText(line).width);
      g.font = `${font} ${Math.floor(size * scale)}px ${/italic/.test(font) ? 'Georgia, serif' : 'Arial, sans-serif'}`;
    };
    fit(text, ph * (sub ? 0.44 : 0.62)); g.fillText(text, pw / 2, ph * (sub ? 0.4 : 0.54));
    if (sub) { fit(sub, ph * 0.2); g.fillText(sub, pw / 2, ph * 0.75); }
  }) });
  const board = new T.Mesh(new T.BoxGeometry(w, h, 0.06), [frame, frame, frame, frame, face, frame]);
  board.position.set(x, y, z); board.rotation.y = yaw; scene.add(board);
}

export async function buildTown(scene: T.Scene) {
  const kitScene = (await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(kitUrl)).scene;
  const kitMaterial: Record<string, T.Material> = {}, material: Record<string, T.Material> = {};
  kitScene.traverse(o => { // kit materials by name, and plain copies for primitives without baked AO colours
    if (!(o instanceof T.Mesh)) return;
    kitMaterial[o.material.name] = o.material;
    material[o.material.name] = Object.assign(o.material.clone(), { vertexColors: false });
  });
  const city = new T.Group(), solids: T.Box3[] = [], walls: T.Box3[] = [];
  function put(parent: T.Object3D, name: string, x: number, y: number, z: number, yaw = 0) {
    const wrapper = new T.Group(); // pieces keep their own node transform (meshopt quantization)
    wrapper.add(kitScene.getObjectByName(name)!.clone());
    wrapper.position.set(x, y, z); wrapper.rotation.y = yaw;
    parent.add(wrapper);
    return wrapper;
  }
  const local = (o: T.Object3D, x0: number, x1: number, z0: number, z1: number, h: number) =>
    new T.Box3().setFromPoints([new T.Vector3(x0, 0, z0), new T.Vector3(x1, h, z1)].map(p => p.applyMatrix4(o.matrixWorld)));
  for (const [type, mids, x, z, facing, flip, wall] of lots) {
    const [G, FH, W, D] = kit[type], holder = new T.Group();
    holder.position.set(x, 0.11, z - (type === 'brownstone' ? facing * 1.2 : 0)); // brownstones: areaway
    holder.rotation.y = facing > 0 ? 0 : Math.PI;
    holder.scale.x = (Math.sign(x) * facing > 0) !== !!flip ? -1 : 1;
    ['base', ...Array<string>(mids).fill('mid'), 'top'].forEach((piece, i) => put(holder, `${type}_${piece}`, 0, i ? G + (i - 1) * FH : 0, 0));
    city.add(holder);
    holder.updateMatrixWorld(true);
    holder.traverse(o => {
      o.userData.seed = x + 1.7 * z; // looks.ts brick tint
      if (wall && o instanceof T.Mesh && /^wall_/.test(o.material.name)) o.material = kitMaterial[wall];
    });
    const footprint = local(holder, -W / 2, W / 2, -D, 0, G + mids * FH + 1.3);
    solids.push(footprint); walls.push(footprint);
    if (type === 'brownstone') solids.push(local(holder, 0.45, 2.7, 0, 2.6, 2)); // stoop
  }
  const block = (x: number, z: number, r: number) =>
    solids.push(new T.Box3(new T.Vector3(x - r, 0, z - r), new T.Vector3(x + r, 2, z + r)));
  for (const side of [-1, 1]) for (let i = 0; i <= 31; i++) {
    const x = -46.5 + i * 3, z = side * 5.8, kind = furniture[(i + (side > 0 ? 5 : 0)) % furniture.length];
    if (!kind || Math.abs(x) < 9 || townDoors.some(d => Math.sign(d.position.z) === side && Math.abs(d.position.x - x) < 2.2)) continue;
    put(city, `prop_${kind}`, x, 0.11, z, side > 0 ? Math.PI : 0);
    block(x, z, kind === 'bench' ? 0.95 : 0.3);
  }
  // 떠오름 뜰: a pocket square of pale paving, a raised round bed with a tree, benches facing it, a tree in each
  // corner, two lamps and a gate sign on the street side.
  for (const [x, z] of [[-12.3, 12.3], [-21.2, 12.3], [-12.3, 21.7], [-21.2, 21.7], [sx, sz]]) {
    put(city, 'prop_tree', x, x === sx ? 0.6 : 0.12, z);
    block(x, z, x === sx ? 2.2 : 0.4);
  }
  for (const [dx, dz, yaw] of [[0, -3.6, Math.PI], [0, 3.6, 0], [-3.6, 0, -Math.PI / 2], [3.6, 0, Math.PI / 2]]) {
    put(city, 'prop_bench', sx + dx, 0.12, sz + dz, yaw); block(sx + dx, sz + dz, 0.95);
  }
  for (const [x, z] of [[-22.9, 10.6], [-10.6, 23.4]]) { put(city, 'prop_lamp', x, 0.12, z); block(x, z, 0.3); }
  for (const [kind, x] of [['bin', -13.2], ['newsbox', -20.6]] as const) { put(city, `prop_${kind}`, x, 0.12, 10.4); block(x, 10.4, 0.3); }
  // Bake to world space and merge one mesh per material; mirrored pieces get their winding flipped.
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
    buckets.set(object.material as T.Material, [...buckets.get(object.material as T.Material) ?? [], geometry]);
  });
  for (const [mat, parts] of buckets) {
    const mesh = new T.Mesh(mergeGeometries(parts), mat);
    mesh.name = mat.name; mesh.castShadow = !/glass|bulb/.test(mat.name); mesh.receiveShadow = true;
    scene.add(mesh);
  }
  // Ground as in block.ts: asphalt at y=0, 0.11 m kerbs, zebras, lane paint; the square paved a shade paler.
  const asphalt = new T.MeshStandardMaterial({ color: '#414750', roughness: 0.96 });
  const paving = new T.MeshStandardMaterial({ color: '#b8b2a4', roughness: 0.9 });
  const paint_ = new T.MeshStandardMaterial({ color: '#e1d8be', roughness: 0.85 });
  const pavers = new T.MeshStandardMaterial({ name: 'square', color: '#cdbfa6', roughness: 0.9 });
  function slab(w: number, h: number, d: number, x: number, y: number, z: number, mat: T.Material, name: string) {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
    mesh.name = name; mesh.position.set(x, y, z); mesh.receiveShadow = true; scene.add(mesh);
    return mesh;
  }
  slab(360, 0.15, 360, 0, -0.075, 0, asphalt, 'asphalt');
  for (const x of [-54, 54]) for (const z of [-54, 54]) slab(98, 0.22, 98, x, 0, z, paving, 'curb');
  for (const s of [-6.6, 6.6]) for (let i = 0; i < 7; i++) {
    slab(0.65, 0.02, 2.5, -3.3 + i * 1.1, 0.008, s, paint_, 'crosswalk');
    slab(2.5, 0.02, 0.65, s, 0.008, -3.3 + i * 1.1, paint_, 'crosswalk');
  }
  for (let x = -93; x <= 93; x += 5) if (Math.abs(x) > 10) slab(2.5, 0.02, 0.12, x, 0.008, 0, paint_, 'lane paint');
  slab(square.x1 - square.x0, 0.02, square.z1 - square.z0, sx, 0.115, sz, pavers, 'square');
  slab(0.4, 0.04, square.z1 - square.z0, square.x1 - 0.2, 0.125, sz, material.base_stone, 'square edge');
  slab(square.x1 - square.x0, 0.04, 0.4, sx, 0.125, square.z0 + 0.2, material.base_stone, 'square edge');
  const bed = new T.Mesh(new T.CylinderGeometry(2, 2.1, 0.5, 16), material.base_stone);
  bed.position.set(sx, 0.35, sz); bed.castShadow = bed.receiveShadow = true; scene.add(bed);
  const soil = new T.Mesh(new T.CylinderGeometry(1.85, 1.85, 0.04, 16), material.trunk);
  soil.position.set(sx, 0.6, sz); scene.add(soil);
  // 잔물결 찻방: two café tables under the awning (top and foot in wood and iron, one mesh each).
  const tops: T.BufferGeometry[] = [], feet: T.BufferGeometry[] = [];
  for (const x of [-35.2, -37.6]) {
    tops.push(new T.CylinderGeometry(0.42, 0.42, 0.05, 12).translate(x, 0.85, -8.4));
    feet.push(new T.CylinderGeometry(0.05, 0.05, 0.74, 6).translate(x, 0.48, -8.4),
      new T.CylinderGeometry(0.28, 0.32, 0.04, 10).translate(x, 0.13, -8.4));
    block(x, -8.4, 0.45);
  }
  for (const [parts, mat] of [[tops, material.wood], [feet, material.metal_dark]] as const) {
    const mesh = new T.Mesh(mergeGeometries(parts), mat);
    mesh.castShadow = mesh.receiveShadow = true; scene.add(mesh);
  }
  // Signs: the shops on their fascias and awning valances, the homes on the areaway rail, the square on a gate.
  const frame = new T.MeshStandardMaterial({ name: 'sign frame', color: '#3a3430', roughness: 0.9 });
  const south = -9.5, north = 9.5;
  sign(scene, frame, 'LUMEN RING', 6, 0.66, -19.95, 4.05, south + 0.12, 0, ['#2c3550', '#f1e2c2'], 'bold', 'TUNING OFFICE · 2F–5F');
  sign(scene, frame, 'MOA EXCHANGE', 7.6, 0.5, -28, 3.73, south + 0.12, 0, ['#2f4a3e', '#f1e2c2']);
  sign(scene, frame, 'TRADE · SWAP · GOODS', 7.4, 0.28, -28, 2.75, south + 1.56, 0, ['#2f4a3e', '#f1e2c2']);
  sign(scene, frame, 'Ripple Tea Room', 6.6, 0.56, -36.5, 3.52, south + 0.12, 0, ['#6e2f36', '#f1e2c2'], 'italic bold');
  sign(scene, frame, 'TEA', 0.6, 1.5, -32.95, 5.2, south + 0.75, Math.PI / 2, ['#6e2f36', '#f1e2c2'], 'bold'); // blade
  sign(scene, frame, 'TEA', 0.6, 1.5, -32.95, 5.2, south + 0.75, -Math.PI / 2, ['#6e2f36', '#f1e2c2'], 'bold');
  sign(scene, frame, 'MOA', 0.6, 1.5, -23.95, 5.4, south + 0.75, Math.PI / 2, ['#2f4a3e', '#f1e2c2'], 'bold');
  sign(scene, frame, 'MOA', 0.6, 1.5, -23.95, 5.4, south + 0.75, -Math.PI / 2, ['#2f4a3e', '#f1e2c2'], 'bold');
  sign(scene, frame, 'TEA · CAKES · SINCE 1928', 6.8, 0.28, -36.5, 2.55, south + 1.56, 0, ['#a8503f', '#f1e2c2']);
  sign(scene, frame, 'LAYERLIGHT HOUSE', 6.6, 0.5, -28, 3.45, north - 0.12, Math.PI, ['#2c3550', '#f1e2c2'], 'bold', 'SHARED ROOMS');
  sign(scene, frame, 'STILLWAVE', 3.2, 0.62, -36.8, 0.9, north - 0.05, Math.PI, ['#3f4a44', '#f1e2c2'], 'italic bold', 'No. 12 · HOUSE');
  sign(scene, frame, 'HIGHFENCE', 3.2, 0.62, -43.3, 0.9, north - 0.05, Math.PI, ['#6e2f36', '#f1e2c2'], 'italic bold', 'No. 16 · HOUSE');
  for (const x of [-14.4, -19.6]) { slab(0.12, 3.2, 0.12, x, 1.71, square.z0 + 0.3, material.metal_dark, 'gate post'); block(x, square.z0 + 0.3, 0.1); }
  sign(scene, frame, 'RISING SQUARE', 5.4, 0.6, -17, 3.05, square.z0 + 0.3, Math.PI, ['#3f6b52', '#f1e2c2'], 'bold', 'PUBLIC GARDEN');
  // A faded painted ad on the walk-up's blank side wall above the square.
  sign(scene, frame, 'LAYERLIGHT', 9, 2.4, -23.94, 11, 16, Math.PI / 2, ['#8a5a48', '#e2d6bf'], 'bold', 'ROOMS BY THE WEEK');
  return { solids, walls, doors: townDoors.map(d => new T.Vector3(d.position.x, 0, d.position.z)) };
}
