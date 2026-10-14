import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import shino from '../assets/shino.vrm?url';
import shibu from '../assets/shibu.vrm?url';
import basemale from '../assets/basemale.vrm?url';
import hoodie from '../assets/hoodie.vrm?url';
import fumiriya from '../assets/fumiriya.vrm?url';
import { dress, type Outfit } from './wardrobe';

const urls = { shino, shibu, basemale, hoodie, fumiriya };
const originals = new Map<string, Promise<GLTF>>(), geometry = new Map<string, T.BufferGeometry>();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(parser => {
  const plugin = new VRMLoaderPlugin(parser);
  // Keep the template free of mutable VRM controllers; initialize those against each cloned skeleton.
  plugin.afterRoot = async () => {};
  return plugin;
});

// tools/assets.mjs stores positions as int16 over +-2 m, normals int8, UVs and weights uint16 (morph deltas at half
// scale): expand them to floats once per template, before three-vrm rebuilds the geometry.
const floats = new Map<T.BufferAttribute, T.BufferAttribute>();
function inflate(attribute: T.BufferAttribute, scale: number) {
  if (!attribute.normalized) return attribute;
  if (!floats.has(attribute)) {
    const { count, itemSize } = attribute, array = new Float32Array(count * itemSize);
    for (let i = 0; i < array.length; i++) array[i] = attribute.getComponent(Math.floor(i / itemSize), i % itemSize) * scale;
    floats.set(attribute, new T.BufferAttribute(array, itemSize));
  }
  return floats.get(attribute)!;
}

export async function cloneModel(outfit: Outfit): Promise<VRM> {
  const url = urls[outfit.source];
  if (!originals.has(url)) originals.set(url, loader.loadAsync(url).then(gltf => {
    gltf.scene.traverse(object => {
      if (!(object instanceof T.Mesh)) return;
      const shape: T.BufferGeometry = object.geometry;
      for (const [name, attribute] of Object.entries(shape.attributes))
        shape.setAttribute(name, inflate(attribute as T.BufferAttribute, name === 'position' ? 2 : 1));
      for (const [name, list] of Object.entries(shape.morphAttributes))
        shape.morphAttributes[name as 'position'] = list.map(attribute => inflate(attribute as T.BufferAttribute, 2));
    });
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.combineSkeletons(gltf.scene);
    return gltf;
  }));
  const source = await originals.get(url)!, scene = clone(source.scene) as T.Group;
  const nodes = new Map<T.Object3D, T.Object3D>();
  const pair = (a: T.Object3D, b: T.Object3D) => { nodes.set(a, b); a.children.forEach((child, i) => pair(child, b.children[i])); };
  pair(source.scene, scene);
  dress(scene, outfit);
  // VRM loader uses glTF node indices for expressions, look-at, colliders and springs.
  // Redirect those dependencies to the clone while retaining shared decoded buffers/textures.
  const parser = Object.create(source.parser) as GLTF['parser'];
  parser.getDependency = async (type, index) => {
    const value = await source.parser.getDependency(type, index);
    return type === 'node' ? nodes.get(value) : value;
  };
  parser.getDependencies = async type => {
    const values = await source.parser.getDependencies(type);
    return type === 'node' ? values.map((node: T.Object3D) => nodes.get(node)) : values;
  };
  const gltf = { ...source, scene, scenes: [scene], parser, userData: {} };
  await new VRMLoaderPlugin(parser).afterRoot(gltf);
  const vrm = (gltf.userData as { vrm: VRM }).vrm;
  // combineMorphs clears its input geometry's morph attributes; never let it mutate the template.
  const temporary: T.BufferGeometry[] = [];
  scene.traverse(object => {
    if (object instanceof T.Mesh && object.geometry.morphAttributes.position) {
      object.geometry = object.geometry.clone(); temporary.push(object.geometry);
    }
  });
  VRMUtils.combineMorphs(vrm);
  temporary.forEach(item => item.dispose());
  scene.traverse(object => {
    object.frustumCulled = false;
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material])
      if (!vrm.materials!.includes(material)) vrm.materials!.push(material);
    const key = `${url}:${object.name}`;
    const shared = geometry.get(key);
    if (shared) { if (object.geometry !== shared) object.geometry.dispose(); object.geometry = shared; }
    else geometry.set(key, object.geometry);
  });
  VRMUtils.rotateVRM0(vrm);
  return vrm;
}
