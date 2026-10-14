import * as T from 'three';
import { loadAssets } from '../render/assets';

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
  const asphalt = new T.MeshStandardMaterial({ color: '#414750', roughness: 0.96 });
  const paving = new T.MeshStandardMaterial({ color: '#b8b2a4', roughness: 0.9 });
  const paint = new T.MeshStandardMaterial({ color: '#e1d8be', roughness: 0.85 });
  function slab(w: number, h: number, d: number, x: number, y: number, z: number,
    material: T.Material, name: string) {
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, d), material);
    mesh.name = name; mesh.position.set(x, y, z); scene.add(mesh);
  }
  slab(70, 0.15, 70, 0, -0.16, 0, asphalt, 'asphalt');
  // The two perpendicular carriageways meet at (0, 0); the hero block is northwest.
  slab(24, 0.22, 19, -16, 0, -13.5, paving, 'curb');
  place(city.scene, 'Building_Small_1', -9, -9.5, 8, 0, 0.11);
  place(city.scene, 'Building_Medium_2_001', -18, -10, 9, 0, 0.11);
  place(city.scene, 'Building_Large_2', -23, -18, 8, Math.PI / 2, 0.11);
  place(city.scene, 'Street_4WayIntersection', 0, 0, 16);
  for (const z of [-9, 9]) for (let i = 0; i < 7; i++)
    slab(0.65, 0.025, 2.5, -3.3 + i * 1.1, 0.025, z, paint, 'crosswalk');
  for (const x of [-9, 9]) for (let i = 0; i < 7; i++)
    slab(2.5, 0.025, 0.65, x, 0.025, -3.3 + i * 1.1, paint, 'crosswalk');
  for (let z = 13; z <= 28; z += 5)
    slab(0.12, 0.025, 2.5, 0, 0.025, z, paint, 'lane paint');
  for (const [x, z] of [[-6, -5.5], [-15, -5.5], [-25, -6]]) {
    place(city.scene, 'Prop_Planter_Single', x, z, 1.2, 0, 0.11);
    place(nature.scene, 'CommonTree_1', x, z, 3.2, 0, 0.65);
  }
  for (const x of [-8, -11, -18, -21])
    place(city.scene, 'Prop_Bollard', x, -4.4, undefined, 0, 0.11);
  place(cars.scene, 'sedan', -11, -2.8, 1.8, Math.PI / 2);
  place(cars.scene, 'van', -20, -2.8, 1.9, Math.PI / 2);
  scene.traverse(object => {
    if (object instanceof T.Mesh) {
      object.castShadow = !/asphalt|crosswalk|lane paint/.test(object.name);
      object.receiveShadow = true;
    }
  });
}
