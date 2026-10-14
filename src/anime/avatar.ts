import * as T from 'three';
import { type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { cloneModel } from './model';
import { outfits, type Outfit } from './wardrobe';
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
let motions: ReturnType<typeof loadAssets> | undefined;
export async function loadAvatar(camera: T.Camera, sd = 1, outfit: Outfit = outfits[0], phase = 0) {
  const [vrm, motion] = await Promise.all([cloneModel(outfit), motions ??= loadAssets('people')]);
  const bodyScale = sd === 2 ? 0.64 : sd === 1 ? 0.82 : 1;
  // Scale the raw rig, including clothing/spring roots; normalized animation only transfers rotations and hips position.
  vrm.humanoid.getRawBoneNode('hips')!.scale.setScalar(bodyScale);
  vrm.humanoid.getRawBoneNode('head')!.scale.setScalar(sd === 2 ? 2.9 : sd === 1 ? 1.8 : 1);
  vrm.scene.updateMatrixWorld(true);
  const rig = motion.scene.getObjectByName('UAL1_Standard')!;
  motion.scene.updateMatrixWorld(true);
  let pelvis = rig;
  rig.traverse(object => { if (object.userData.name === 'pelvis') pelvis = object; });
  const v = new T.Vector3(), scale = bodyScale * vrm.humanoid.getNormalizedBoneNode('hips')!.getWorldPosition(v).y / pelvis.getWorldPosition(v).y;
  const mixer = new T.AnimationMixer(vrm.scene);
  const [idle, walk, run] = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop'].map(name =>
    mixer.clipAction(retarget(motion.animations.find(clip => clip.name === name)!, rig, vrm, scale)).play());
  idle.time = phase % idle.getClip().duration;
  if (vrm.lookAt) vrm.lookAt.target = camera;
  const group = new T.Group().add(vrm.scene), face = vrm.expressionManager;
  group.name = outfit.name;
  let time = phase, blinkAt = phase + 1.5 + phase * 0.3, smileAt = 3, first = true;
  return { group, update(speed: number, dt: number) {
    const moving = Math.min(speed / 0.6, 1), running = T.MathUtils.clamp((speed - WALK) / (RUN - WALK), 0, 1);
    idle.weight = 1 - moving;
    walk.weight = moving * (1 - running);
    run.weight = moving * running;
    walk.timeScale = T.MathUtils.clamp(speed / 1.4, 0.6, 1.5) / bodyScale;
    run.timeScale = T.MathUtils.clamp(speed / 3.8, 0.8, 1.2) / bodyScale;
    mixer.update(dt);
    time += dt;
    if (time > blinkAt + 0.16) blinkAt = time + 1.5 + Math.random() * 3.5;
    if (time > smileAt + 2.6) smileAt = time + 5 + Math.random() * 7;
    const smile = T.MathUtils.smoothstep(time, smileAt, smileAt + 0.4) * (1 - T.MathUtils.smoothstep(time, smileAt + 2.2, smileAt + 2.6));
    face?.setValue('happy', 0.65 * smile);
    face?.setValue('blink', Math.max(0, 1 - Math.abs(time - blinkAt - 0.08) / 0.08) * (1 - smile));
    if (first) { vrm.humanoid.update(); group.updateMatrixWorld(true); vrm.springBoneManager?.reset(); }
    first = false;
    vrm.update(dt);
  } };
}
