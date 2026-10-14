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
  slab(360, 0.15, 360, 0, -0.16, 0, asphalt, 'asphalt');
  // Continuous sidewalks border two ten-metre streets; façades abut the paving.
  for (const x of [-54, 54]) for (const z of [-54, 54])
    slab(98, 0.22, 98, x, 0, z, paving, 'curb');
  place(city.scene, 'Building_Small_1', -10.5, -11, 8, 0, 0.11);
  place(city.scene, 'Building_Medium_2_001', -19.1, -11, 9, 0, 0.11);
  place(city.scene, 'Building_Large_2', -10, -22, 8, Math.PI / 2, 0.11);
  const types = ['Building_Small_1', 'Building_Medium_2_001', 'Building_Large_2'];
  const background = new T.Group();
  scene.add(background);
  for (const [i, x, z, rotation] of [
    [0, -29, -11, 0], [1, -39, -11, 0], [2, -10, -34, Math.PI / 2],
    [0, -21, -27, 0], [1, -32, -27, 0], [2, -44, -28, 0],
    [0, 11, -18, -Math.PI / 2], [1, 11, -29, -Math.PI / 2],
    [2, 11, -41, -Math.PI / 2], [0, 22, -32, Math.PI],
    [1, -29, 11, Math.PI], [0, -40, 11, Math.PI],
    [2, -52, -11, 0], [0, -10, -47, Math.PI / 2],
  ]) {
    const building = place(city.scene, types[i], x, z, 9, rotation, 0.11);
    building.traverse(child => {
      if (!(child instanceof T.Mesh)) return;
      const vary = (material: T.Material) => {
        if (!(material instanceof T.MeshStandardMaterial) || !/brick/i.test(material.name)) return material;
        const tint = material.clone();
        tint.color.multiply(new T.Color(['#d2bbb0', '#b0b9c7', '#e4ceb2'][i]));
        return tint;
      };
      child.material = Array.isArray(child.material) ? child.material.map(vary) : vary(child.material);
    });
    background.add(building);
  }
  for (const z of [-6.6, 6.6]) for (let i = 0; i < 7; i++)
    slab(0.65, 0.025, 2.5, -3.3 + i * 1.1, 0.025, z, paint, 'crosswalk');
  for (const x of [-6.6, 6.6]) for (let i = 0; i < 7; i++)
    slab(2.5, 0.025, 0.65, x, 0.025, -3.3 + i * 1.1, paint, 'crosswalk');
  for (let z = -93; z <= 93; z += 5) {
    if (Math.abs(z) < 10) continue;
    slab(0.12, 0.025, 2.5, 0, 0.025, z, paint, 'lane paint');
  }
  for (const [x, z] of [[-6, -7.5], [-15, -5.9], [-25, -5.9]]) {
    place(city.scene, 'Prop_Planter_Single', x, z, 1.2, 0, 0.11);
    place(nature.scene, 'CommonTree_1', x, z, 3.2, 0, 0.65);
  }
  for (const x of [-8, -11, -18, -21])
    place(city.scene, 'Prop_Bollard', x, -5.4, undefined, 0, 0.11);
  place(cars.scene, 'sedan', -11, -3.4, 1.8, Math.PI / 2);
  place(cars.scene, 'van', -20, -3.4, 1.9, Math.PI / 2);
  scene.traverse(object => {
    if (object instanceof T.Mesh) {
      object.castShadow = !/asphalt|crosswalk|lane paint/.test(object.name);
      object.receiveShadow = true;
    }
  });
}
