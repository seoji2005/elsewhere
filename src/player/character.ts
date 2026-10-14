import * as T from 'three';
import { loadAssets } from '../render/assets';

export const WALK = 1.5, RUN = 4.2; // metres per second

// Universal Base Character in underwear; shirt, jeans and sneakers are painted by bind-pose height.
function dress(body: T.SkinnedMesh) {
  const material = body.material as T.MeshStandardMaterial;
  const rgb = (hex: string) => { const c = new T.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };
  // Positions are quantized; normalize to fractions of body height (feet 0, crown 1, T-pose).
  body.geometry.computeBoundingBox();
  const { min, max } = body.geometry.boundingBox!, height = max.y - min.y;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vBind = vec3(position.x - ${((min.x + max.x) / 2).toFixed(5)}, position.y - ${min.y.toFixed(5)}, 0.) / ${height.toFixed(5)};`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vBind;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float fold = 0.75 + 0.5 * dot(diffuseColor.rgb, vec3(0.3, 0.6, 0.1));
        float shirt = step(0.53, vBind.y) * step(vBind.y, abs(vBind.x) > 0.09 ? 0.89 : 0.84) * step(abs(vBind.x), 0.27);
        float jeans = step(0.055, vBind.y) * step(vBind.y, 0.53);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${rgb('#3f8088')} * fold, shirt);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${rgb('#2e3a4f')} * fold, jeans);
        diffuseColor.rgb = mix(diffuseColor.rgb, ${rgb('#e6e1d6')}, step(vBind.y, 0.055));`);
  };
}

export async function loadCharacter() {
  const gltf = await loadAssets('people');
  // Body and animations share bone names; GLTFLoader suffixes duplicates, so bind by original name.
  for (const clip of gltf.animations) for (const track of clip.tracks) {
    const [node, property] = track.name.split('.');
    track.name = `${gltf.scene.getObjectByName(node)?.userData.name ?? node}.${property}`;
  }
  const root = gltf.scene.getObjectByName('Superhero_Male_FullBody')!;
  let body: T.SkinnedMesh | undefined;
  root.traverse(object => {
    object.name = object.userData.name ?? object.name;
    if (object instanceof T.SkinnedMesh) {
      object.castShadow = true;
      object.frustumCulled = false;
      if (/Superhero/.test((object.material as T.Material).name)) body = object;
    }
  });
  if (!body) throw new Error('Missing character body');
  dress(body);
  // The hair is authored in bind space and the rig rests in bind pose: parent it rigidly to the head bone.
  const hair = gltf.scene.getObjectByName('Hair_SimpleParted')!.getObjectByProperty('isMesh', true)!;
  const head = body.skeleton.getBoneByName('Head')!;
  root.updateMatrixWorld(true);
  hair.applyMatrix4(head.matrixWorld.clone().invert());
  hair.castShadow = true;
  ((hair as T.Mesh).material as T.MeshStandardMaterial).color.set('#4a3426'); // greyscale hair map
  head.add(hair);
  const group = new T.Group();
  group.add(root);
  const mixer = new T.AnimationMixer(root);
  const action = (name: string) => {
    const clip = gltf.animations.find(item => item.name === name);
    if (!clip) throw new Error(`Missing clip: ${name}`);
    return mixer.clipAction(clip).play();
  };
  const [idle, walk, run] = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop'].map(action);
  return { group, update(speed: number, dt: number) {
    const moving = Math.min(speed / 0.6, 1), running = T.MathUtils.clamp((speed - WALK) / (RUN - WALK), 0, 1);
    idle.weight = 1 - moving;
    walk.weight = moving * (1 - running);
    run.weight = moving * running;
    walk.timeScale = T.MathUtils.clamp(speed / 1.4, 0.6, 1.5);
    run.timeScale = T.MathUtils.clamp(speed / 3.8, 0.8, 1.2);
    mixer.update(dt);
  } };
}
