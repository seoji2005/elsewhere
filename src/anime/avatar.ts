import * as T from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import avatar from '../assets/avatar.vrm?url';
import { loadAssets } from '../render/assets';
import { WALK, RUN } from '../player/character';

// Quaternius UAL (Unreal-style) bone names -> VRM humanoid bones.
const BONES: Record<string, string> = { pelvis: 'hips', spine_01: 'spine', spine_02: 'chest', spine_03: 'upperChest',
  neck_01: 'neck', Head: 'head' };
for (const [s, side] of [['l', 'left'], ['r', 'right']]) {
  Object.entries({ clavicle: 'Shoulder', upperarm: 'UpperArm', lowerarm: 'LowerArm', hand: 'Hand', thigh: 'UpperLeg',
    calf: 'LowerLeg', foot: 'Foot', ball: 'Toes' }).forEach(([ual, vrm]) => BONES[`${ual}_${s}`] = side + vrm);
  for (const [ual, vrm] of [['thumb', 'Thumb'], ['index', 'Index'], ['middle', 'Middle'], ['ring', 'Ring'], ['pinky', 'Little']])
    (ual === 'thumb' ? ['Metacarpal', 'Proximal', 'Distal'] : ['Proximal', 'Intermediate', 'Distal'])
      .forEach((joint, i) => BONES[`${ual}_0${i + 1}_${s}`] = side + vrm + joint);
}

// Mirrors three-vrm's Mixamo example (MIT): both rigs rest in a T-pose, so rest-pose world rotations carry each
// UAL rotation into VRM normalized bone space; the hips track is moved to world space and scaled to the VRM's legs.
function retarget(clip: T.AnimationClip, rig: T.Object3D, vrm: VRM, scale: number) {
  const rest = new T.Quaternion(), parent = new T.Quaternion(), q = new T.Quaternion(), v = new T.Vector3();
  const flip = vrm.meta.metaVersion === '0' ? -1 : 1; // VRM 0.x faces -Z: mirror x and z
  const tracks = clip.tracks.flatMap(track => {
    const [name, property] = track.name.split('.'), node = rig.getObjectByName(name);
    const bone = node && vrm.humanoid.getNormalizedBoneNode(BONES[node.userData.name] as VRMHumanBoneName);
    if (!node?.parent || !bone) return [];
    const values = track.values.slice();
    if (property === 'quaternion') {
      node.getWorldQuaternion(rest).invert(); node.parent.getWorldQuaternion(parent);
      for (let i = 0; i < values.length; i += 4) q.fromArray(values, i).premultiply(parent).multiply(rest).toArray(values, i);
      return [new T.QuaternionKeyframeTrack(`${bone.name}.quaternion`, track.times, values.map((x, i) => i % 2 ? x : x * flip))];
    }
    if (property !== 'position' || BONES[node.userData.name] !== 'hips') return [];
    for (let i = 0; i < values.length; i += 3) v.fromArray(values, i).applyMatrix4(node.parent.matrixWorld).toArray(values, i);
    return [new T.VectorKeyframeTrack(`${bone.name}.position`, track.times,
      values.map((x, i) => x * scale * (i % 3 === 1 ? 1 : flip)))];
  });
  return new T.AnimationClip(clip.name, clip.duration, tracks);
}

// Anime hero: VRM (MToon toon shading + outlines, spring-bone hair and skirt), retargeted UAL idle / walk / jog,
// automatic blinks, an occasional smile and eyes that follow the camera.
export async function loadAvatar(camera: T.Camera) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).register(parser => new VRMLoaderPlugin(parser));
  const [gltf, motion] = await Promise.all([loader.loadAsync(avatar), loadAssets('people')]);
  const vrm: VRM = gltf.userData.vrm;
  VRMUtils.removeUnnecessaryVertices(vrm.scene);
  VRMUtils.combineSkeletons(vrm.scene);
  VRMUtils.combineMorphs(vrm);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse(object => { object.frustumCulled = false; });
  vrm.scene.updateMatrixWorld(true);
  const rig = motion.scene.getObjectByName('UAL1_Standard')!;
  motion.scene.updateMatrixWorld(true);
  let pelvis = rig;
  rig.traverse(object => { if (object.userData.name === 'pelvis') pelvis = object; });
  const v = new T.Vector3(), scale = vrm.humanoid.getNormalizedBoneNode('hips')!.getWorldPosition(v).y / pelvis.getWorldPosition(v).y;
  const mixer = new T.AnimationMixer(vrm.scene);
  const [idle, walk, run] = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop'].map(name =>
    mixer.clipAction(retarget(motion.animations.find(clip => clip.name === name)!, rig, vrm, scale)).play());
  if (vrm.lookAt) vrm.lookAt.target = camera;
  const group = new T.Group().add(vrm.scene), face = vrm.expressionManager;
  let time = 0, blinkAt = 1.5, smileAt = 3, first = true;
  return { group, update(speed: number, dt: number) {
    const moving = Math.min(speed / 0.6, 1), running = T.MathUtils.clamp((speed - WALK) / (RUN - WALK), 0, 1);
    idle.weight = 1 - moving;
    walk.weight = moving * (1 - running);
    run.weight = moving * running;
    walk.timeScale = T.MathUtils.clamp(speed / 1.4, 0.6, 1.5);
    run.timeScale = T.MathUtils.clamp(speed / 3.8, 0.8, 1.2);
    mixer.update(dt);
    time += dt;
    if (time > blinkAt + 0.16) blinkAt = time + 1.5 + Math.random() * 3.5;
    if (time > smileAt + 2.6) smileAt = time + 5 + Math.random() * 7;
    const smile = T.MathUtils.smoothstep(time, smileAt, smileAt + 0.4) * (1 - T.MathUtils.smoothstep(time, smileAt + 2.2, smileAt + 2.6));
    face?.setValue('happy', 0.65 * smile);
    face?.setValue('blink', Math.max(0, 1 - Math.abs(time - blinkAt - 0.08) / 0.08) * (1 - smile));
    if (first) { group.updateMatrixWorld(true); vrm.springBoneManager?.reset(); } // spawned away from the origin
    first = false;
    vrm.update(dt);
  } };
}
