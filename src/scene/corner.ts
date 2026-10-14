import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadAssets } from '../render/assets';
import { streetProps } from './props';

// Bake static meshes into one mesh per material and 24 m cell: the city costs a few dozen draw calls
// instead of hundreds, while cells out of view are still culled. Positions are baked in world space,
// so each source mesh keeps its window pattern through a per-vertex seed (looks.ts).
function mergeStatic(scene: T.Scene) {
  scene.updateMatrixWorld(true);
  const buckets = new Map<string, { mesh: T.Mesh; parts: T.BufferGeometry[] }>(), center = new T.Vector3();
  const sources: T.Mesh[] = [];
  scene.traverse(object => {
    if (!(object instanceof T.Mesh) || object instanceof T.InstancedMesh || Array.isArray(object.material)) return;
    const source: T.BufferGeometry = object.geometry, geometry = new T.BufferGeometry();
    for (const [name, attribute] of Object.entries(source.attributes)) { // quantized glTF data -> float
      const { count, itemSize } = attribute, array = new Float32Array(count * itemSize);
      for (let i = 0; i < count; i++) for (let c = 0; c < itemSize; c++) array[i * itemSize + c] = attribute.getComponent(i, c);
      geometry.setAttribute(name, new T.BufferAttribute(array, itemSize));
    }
    if (source.index) geometry.setIndex(source.index);
    geometry.applyMatrix4(object.matrixWorld);
    const e = object.matrixWorld.elements, count = geometry.attributes.position.count;
    geometry.setAttribute('seed', new T.BufferAttribute(new Float32Array(count).fill(e[12] + 1.7 * e[14]), 1));
    geometry.computeBoundingBox();
    geometry.boundingBox!.getCenter(center);
    const key = [object.material.uuid, object.castShadow, object.receiveShadow, !!source.index,
      Object.keys(source.attributes).sort(), Math.floor(center.x / 24), Math.floor(center.z / 24)].join();
    if (!buckets.has(key)) buckets.set(key, { mesh: object, parts: [] });
    buckets.get(key)!.parts.push(geometry);
    sources.push(object);
  });
  sources.forEach(mesh => mesh.removeFromParent());
  for (const { mesh, parts } of buckets.values()) {
    const merged = new T.Mesh(mergeGeometries(parts), mesh.material);
    merged.name = mesh.name; merged.castShadow = mesh.castShadow; merged.receiveShadow = mesh.receiveShadow;
    scene.add(merged);
  }
}

// Soft contact shade around every footprint so buildings and props sit on the ground;
// one vertex-alpha mesh (a single draw call), darkest at the base and fading outwards.
function contactShade(scene: T.Scene, boxes: T.Box3[]) {
  const position: number[] = [], color: number[] = [], index: number[] = [];
  for (const { min, max } of boxes) {
    const y = Math.max(min.y, 0) + 0.012, reach = T.MathUtils.clamp((max.y - min.y) * 0.3, 0.3, 1.6);
    const base = position.length / 3, corners = [[min.x, min.z, -1, -1], [max.x, min.z, 1, -1],
      [max.x, max.z, 1, 1], [min.x, max.z, -1, 1]];
    for (const [x, z] of corners) { position.push(x, y, z); color.push(0, 0, 0, 0.65); }
    for (const [x, z, sx, sz] of corners) { position.push(x + sx * reach, y, z + sz * reach); color.push(0, 0, 0, 0); }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      index.push(base + i, base + 4 + i, base + 4 + j, base + i, base + 4 + j, base + j);
    }
  }
  const geometry = new T.BufferGeometry().setIndex(index);
  geometry.setAttribute('position', new T.Float32BufferAttribute(position, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(color, 4));
  const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial({ color: '#000', vertexColors: true,
    transparent: true, depthWrite: false, side: T.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1 }));
  mesh.name = 'contact shade';
  scene.add(mesh);
}

export async function buildCorner(scene: T.Scene) {
  const [city, nature, cars] = await Promise.all(['city', 'nature', 'cars'].map(
    name => loadAssets(name as 'city' | 'nature' | 'cars')));
  function place(bundle: T.Group, name: string, x: number, z: number,
    width?: number, rotation = 0, y = 0) {
    const source = bundle.children.find(child => child.name === name);
    if (!source) throw new Error(`Missing asset: ${name}`);
    const object = source.clone(true);
    object.position.set(0, 0, 0);
    const box = new T.Box3().setFromObject(object);
    const size = box.getSize(new T.Vector3());
    const scale = width ? width / size.x : 1;
    object.scale.multiplyScalar(scale);
    const center = box.getCenter(new T.Vector3()).multiplyScalar(scale);
    const wrapper = new T.Group();
    object.position.set(-center.x, -box.min.y * scale, -center.z);
    wrapper.add(object);
    wrapper.rotation.y = rotation;
    wrapper.position.set(x, y, z);
    scene.add(wrapper);
    return wrapper;
  }
  // Movement colliders (XZ boxes), camera blockers and door trigger points.
  const solids: T.Box3[] = [], walls: T.Box3[] = [], doors: T.Vector3[] = [];
  const doorShift: Record<string, number> = { Building_Small_1: 0.08 }; // door centre, fraction of façade width
  function building(wrapper: T.Group, type: string) {
    const box = new T.Box3().setFromObject(wrapper), size = box.getSize(new T.Vector3());
    const r = wrapper.rotation.y, front = new T.Vector3(Math.sin(r), 0, Math.cos(r));
    const right = new T.Vector3(front.z, 0, -front.x), extent = (axis: T.Vector3) =>
      Math.abs(axis.x) * size.x + Math.abs(axis.z) * size.z;
    doors.push(box.getCenter(new T.Vector3()).setY(0).addScaledVector(front, extent(front) / 2 + 0.5)
      .addScaledVector(right, extent(right) * (doorShift[type] ?? 0)));
    walls.push(box); solids.push(box);
    return wrapper;
  }
  const asphalt = new T.MeshStandardMaterial({ color: '#414750', roughness: 0.96 });
  const paving = new T.MeshStandardMaterial({ color: '#b8b2a4', roughness: 0.9 });
  const paint = new T.MeshStandardMaterial({ color: '#e1d8be', roughness: 0.85 });
  function slab(w: number, h: number, d: number, x: number, y: number, z: number,
    material: T.Material, name: string) {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material);
    mesh.name = name; mesh.position.set(x, y, z); scene.add(mesh);
  }
  slab(360, 0.15, 360, 0, -0.075, 0, asphalt, 'asphalt'); // road surface at y=0, where cars and the player stand
  // Continuous sidewalks border two ten-metre streets; façades abut the paving.
  for (const x of [-54, 54]) for (const z of [-54, 54])
    slab(98, 0.22, 98, x, 0, z, paving, 'curb');
  const heroes = [building(place(city.scene, 'Building_Small_1', -10.5, -11, 8, 0, 0.11), 'Building_Small_1'),
    building(place(city.scene, 'Building_Medium_2_001', -19.1, -11, 9, 0, 0.11), 'Building_Medium_2_001')];
  building(place(city.scene, 'Building_Large_2', -10, -22, 8, Math.PI / 2, 0.11), 'Building_Large_2');
  const types = ['Building_Small_1', 'Building_Medium_2_001', 'Building_Large_2'];
  const background = new T.Group();
  scene.add(background);
  const tints = new Map<string, T.MeshStandardMaterial>(); // one tinted brick per building type, so merging can share it
  for (const [i, x, z, rotation] of [
    [0, -29, -11, 0], [1, -39, -11, 0], [2, -10, -34, Math.PI / 2],
    [0, -21, -27, 0], [1, -32, -27, 0], [2, -44, -28, 0],
    [0, 11, -18, -Math.PI / 2], [1, 11, -29, -Math.PI / 2],
    [2, 11, -41, -Math.PI / 2], [0, 22, -32, Math.PI],
    [1, -29, 11, Math.PI], [0, -40, 11, Math.PI],
    [2, -52, -11, 0], [0, -10, -47, Math.PI / 2],
  ]) {
    const tinted = building(place(city.scene, types[i], x, z, 9, rotation, 0.11), types[i]);
    tinted.traverse(child => {
      if (!(child instanceof T.Mesh)) return;
      const vary = (material: T.Material) => {
        if (!(material instanceof T.MeshStandardMaterial) || !/brick/i.test(material.name)) return material;
        const key = material.uuid + i, tint = tints.get(key) ?? material.clone();
        if (!tints.has(key)) tint.color.multiply(new T.Color(['#d2bbb0', '#b0b9c7', '#e4ceb2'][i]));
        tints.set(key, tint);
        return tint;
      };
      child.material = Array.isArray(child.material) ? child.material.map(vary) : vary(child.material);
    });
    background.add(tinted);
  }
  for (const z of [-6.6, 6.6]) for (let i = 0; i < 7; i++)
    slab(0.65, 0.02, 2.5, -3.3 + i * 1.1, 0.008, z, paint, 'crosswalk');
  for (const x of [-6.6, 6.6]) for (let i = 0; i < 7; i++)
    slab(2.5, 0.02, 0.65, x, 0.008, -3.3 + i * 1.1, paint, 'crosswalk');
  for (let z = -93; z <= 93; z += 5) {
    if (Math.abs(z) < 10) continue;
    slab(0.12, 0.02, 2.5, 0, 0.008, z, paint, 'lane paint');
  }
  const grounded = [...walls];
  for (const [x, z] of [[-6, -7.5], [-15, -5.9], [-25, -5.9]]) {
    solids.push(new T.Box3().setFromObject(place(city.scene, 'Prop_Planter_Single', x, z, 1.2, 0, 0.11)));
    grounded.push(solids[solids.length - 1]);
    place(nature.scene, 'CommonTree_1', x, z, 3.2, 0, 0.65);
  }
  for (const x of [-8, -11, -18, -21])
    solids.push(new T.Box3().setFromObject(place(city.scene, 'Prop_Bollard', x, -5.4, undefined, 0, 0.11)));
  solids.push(new T.Box3().setFromObject(place(cars.scene, 'sedan', -11, -3.4, 1.8, Math.PI / 2)),
    new T.Box3().setFromObject(place(cars.scene, 'van', -20, -3.4, 1.9, Math.PI / 2)));
  grounded.push(...solids.slice(-2));
  const props = await streetProps(scene, city.scene, heroes);
  solids.push(...props.solids);
  contactShade(scene, [...grounded, ...props.grounded]);
  scene.traverse(object => {
    if (object instanceof T.Mesh) {
      object.castShadow = !/asphalt|crosswalk|lane paint|shade|glow/.test(object.name);
      object.receiveShadow = true;
    }
  });
  mergeStatic(scene);
  return { solids, walls, doors };
}
