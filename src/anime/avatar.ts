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
function retarget(clip: T.AnimationClip, rig: T.Object3D, vrm: VRM, scale: number, hipsOffset = 0) {
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
      values.map((x, i) => x * scale * (i % 3 === 1 ? 1 : flip) + (i % 3 === 1 ? hipsOffset : 0)))];
  });
  return new T.AnimationClip(clip.name, clip.duration, tracks);
}

// SD proportions on the raw bones (R012), per ?sd= level: [body, head, limb length, limb girth, hands and feet].
// VRoid rest bones carry no rotation (arms run along X, legs along Y), so limbs shrink along the bone and thicken
// across it; hands and feet are counter-scaled to stay uniform. Collider and hit radii are world units, so they
// follow their bone's world scale; the model is lowered by what the shorter legs lifted the soles.
const SD = [[1, 1, 1, 1, 1], [0.8, 1.8, 0.78, 1.22, 1.15], [0.7, 2.1, 0.72, 1.35, 1.2]];
function proportion(vrm: VRM, sd: number) {
  const [body, head, length, girth, ends] = SD[sd], v = new T.Vector3();
  const raw = (name: VRMHumanBoneName) => vrm.humanoid.getRawBoneNode(name)!;
  vrm.scene.updateMatrixWorld(true);
  const ankle = raw('leftFoot').getWorldPosition(v).y;
  raw('hips').scale.setScalar(body);
  raw('head').scale.setScalar(head);
  for (const side of ['left', 'right'] as const) {
    raw(`${side}UpperArm`).scale.set(length, girth, girth);
    raw(`${side}Hand`).scale.set(ends / length, ends / girth, ends / girth);
    raw(`${side}UpperLeg`).scale.set(girth, length, girth);
    raw(`${side}Foot`).scale.set(ends / girth, ends / length, ends / girth);
  }
  vrm.scene.updateMatrixWorld(true);
  vrm.scene.position.y -= raw('leftFoot').getWorldPosition(v).y - ankle * body * ends;
  const springs = vrm.springBoneManager;
  for (const group of springs?.colliderGroups ?? []) for (const collider of group.colliders) {
    const shape = collider.shape as { radius?: number };
    if (shape.radius !== undefined) shape.radius *= collider.getWorldScale(v).x;
  }
  for (const joint of springs?.joints ?? []) joint.settings.hitRadius *= joint.bone.getWorldScale(v).x;
  vrm.scene.updateMatrixWorld(true);
  springs?.setInitState();
  return body;
}

// Anime hero: VRM (MToon toon shading + outlines, spring-bone hair and skirt), retargeted UAL idle / walk / jog,
// automatic blinks, an occasional smile and eyes that follow the camera.
let motions: ReturnType<typeof loadAssets> | undefined;
export async function loadAvatar(camera: T.Camera, sd = 1, outfit: Outfit = outfits[0], phase = 0) {
  const [vrm, motion] = await Promise.all([cloneModel(outfit), motions ??= loadAssets('people')]);
  // Precise bounds include skinned vertices; update skeleton matrices after each rest-pose scale change.
  const height = () => {
    vrm.scene.updateMatrixWorld(true);
    vrm.scene.traverse(object => { if (object instanceof T.SkinnedMesh) object.skeleton.update(); });
    return new T.Box3().setFromObject(vrm.scene, true).getSize(new T.Vector3()).y;
  };
  const originalHeight = sd ? height() : 1;
  // Scale the raw rig, including clothing/spring roots; normalized animation only transfers rotations and hips position.
  const bodyScale = proportion(vrm, sd);
  const focusHeight = 1.4 * (sd ? height() / originalHeight : 1);
  // Cache sole corners from the scaled foot geometry; foot/toe bone origins are above the soles.
  const contacts = sd === 2 ? (['left', 'right'] as const).flatMap(side => {
    const bone = vrm.humanoid.getRawBoneNode(`${side}Foot`)!, toes = vrm.humanoid.getRawBoneNode(`${side}Toes`), box = new T.Box3();
    vrm.scene.traverse(object => {
      if (!(object instanceof T.SkinnedMesh)) return;
      const indices = object.geometry.getAttribute('skinIndex'), weights = object.geometry.getAttribute('skinWeight');
      object.skeleton.update();
      for (let i = 0; i < indices.count; i++) {
        let weight = 0;
        for (let j = 0; j < 4; j++) {
          const joint = object.skeleton.bones[indices.getComponent(i, j)];
          if (joint === bone || joint === toes) weight += weights.getComponent(i, j);
        }
        if (weight > 0.5) box.expandByPoint(bone.worldToLocal(object.getVertexPosition(i, new T.Vector3()).applyMatrix4(object.matrixWorld)));
      }
    });
    return [box.min.x, box.max.x].flatMap(x => [box.min.z, box.max.z].map(z => ({ bone, point: new T.Vector3(x, box.min.y, z) })));
  }) : [];
  const rig = motion.scene.getObjectByName('UAL1_Standard')!;
  motion.scene.updateMatrixWorld(true);
  let pelvis = rig;
  rig.traverse(object => { if (object.userData.name === 'pelvis') pelvis = object; });
  const v = new T.Vector3(), hips = vrm.humanoid.getNormalizedBoneNode('hips')!;
  // Scene lowering must not shrink the hips track again; preserve its local rest height.
  const scale = bodyScale * (sd === 2 ? hips.position.y : hips.getWorldPosition(v).y) / pelvis.getWorldPosition(v).y;
  const hipsOffset = sd === 2 ? hips.position.y * (1 - bodyScale) : 0;
  const mixer = new T.AnimationMixer(vrm.scene);
  const [idle, walk, run] = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop'].map(name =>
    mixer.clipAction(retarget(motion.animations.find(clip => clip.name === name)!, rig, vrm, scale, hipsOffset)).play());
  idle.time = phase % idle.getClip().duration;
  if (vrm.lookAt) vrm.lookAt.target = camera;
  const group = new T.Group().add(vrm.scene), face = vrm.expressionManager;
  group.name = outfit.name;
  let time = phase, blinkAt = phase + 1.5 + phase * 0.3, smileAt = 3, first = true;
  return { group, focusHeight, update(speed: number, dt: number) {
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
    if (sd === 2) {
      vrm.humanoid.update(); group.updateMatrixWorld(true);
      vrm.scene.position.y += group.getWorldPosition(v).y - Math.min(...contacts.map(({ bone, point }) => bone.localToWorld(v.copy(point)).y));
    }
    if (first) { vrm.humanoid.update(); group.updateMatrixWorld(true); vrm.springBoneManager?.reset(); }
    first = false;
    vrm.update(dt);
  } };
}
