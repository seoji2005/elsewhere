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

// SD proportions: [body, head, arm length, limb girth, hands/feet, thigh length, torso length, calf length].
// VRoid rest bones carry no rotation (arms run along X, legs along Y), so limbs shrink along the bone and thicken
// across it; hands and feet are counter-scaled to stay uniform. Collider and hit radii are world units, so they
// follow their bone's world scale; the model is lowered by what the shorter legs lifted the soles.
const SD = [[1, 1, 1, 1, 1, 1, 1, 1], [0.8, 1.8, 0.78, 1.22, 1.15, 0.68, 0.88, 1], [0.7, 1.85, 0.72, 1.35, 1.2, 0.31, 0.63, 0.7]];
function proportion(vrm: VRM, sd: number) {
  const [body, head, length, girth, ends, legs, torso, calf] = SD[sd], v = new T.Vector3();
  const raw = (name: VRMHumanBoneName) => vrm.humanoid.getRawBoneNode(name)!;
  vrm.scene.updateMatrixWorld(true);
  const ankle = raw('leftFoot').getWorldPosition(v).y;
  raw('hips').scale.setScalar(body);
  // Round the SD face vertically; X/Z stay wider, so the existing X-based spring radii still enclose the head.
  raw('head').scale.set(head, head * (sd ? 0.9 : 1), head);
  // Shorten torso offsets without shrinking the head or inheriting another scale into the arms.
  for (const name of ['spine', 'chest', 'upperChest', 'neck', 'head'] as const) raw(name).position.y *= torso;
  for (const side of ['left', 'right'] as const) {
    raw(`${side}UpperArm`).scale.set(length, girth, girth);
    raw(`${side}Hand`).scale.set(ends / length, ends / girth, ends / girth);
    raw(`${side}UpperLeg`).scale.set(girth, legs, girth);
    raw(`${side}LowerLeg`).scale.y = calf;
    raw(`${side}Foot`).scale.set(ends / girth, ends / (legs * calf), ends / girth);
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
  // Frustum culling with one fixed sphere (model.ts switches it off): skinned bounds are never recomputed per frame
  // and the sphere covers every SD proportion, so people behind the camera cost no draw calls.
  const bounds = new T.Sphere(new T.Vector3(0, 0.8, 0), 1.4);
  vrm.scene.traverse(object => {
    if (!(object instanceof T.Mesh)) return;
    object.frustumCulled = true;
    if (object instanceof T.SkinnedMesh) object.boundingSphere = bounds; else object.geometry.boundingSphere = bounds;
  });
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
  // Cache real sole vertices near the foot bounds; box corners outside the shoe can over-lift a shortened rig.
  const contacts = sd ? (['left', 'right'] as const).flatMap(side => {
    const bone = vrm.humanoid.getRawBoneNode(`${side}Foot`)!, toes = vrm.humanoid.getRawBoneNode(`${side}Toes`), box = new T.Box3(), points: T.Vector3[] = [];
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
        if (weight > 0.5) {
          const point = bone.worldToLocal(object.getVertexPosition(i, new T.Vector3()).applyMatrix4(object.matrixWorld));
          box.expandByPoint(point); points.push(point);
        }
      }
    });
    return [box.min.x, box.max.x].flatMap(x => [box.min.z, box.max.z].map(z => {
      const corner = new T.Vector3(x, box.min.y, z);
      return { bone, point: points.reduce((a, b) => a.distanceToSquared(corner) < b.distanceToSquared(corner) ? a : b) };
    }));
  }) : [];
  const rig = motion.scene.getObjectByName('UAL1_Standard')!;
  motion.scene.updateMatrixWorld(true);
  let pelvis = rig;
  rig.traverse(object => { if (object.userData.name === 'pelvis') pelvis = object; });
  const v = new T.Vector3(), hips = vrm.humanoid.getNormalizedBoneNode('hips')!;
  // Scene lowering must not shrink the hips track again; preserve its local rest height.
  const scale = bodyScale * (sd ? hips.position.y : hips.getWorldPosition(v).y) / pelvis.getWorldPosition(v).y;
  const hipsOffset = sd ? hips.position.y * (1 - bodyScale) : 0;
  const mixer = new T.AnimationMixer(vrm.scene);
  const [idle, walk, run] = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop'].map(name =>
    mixer.clipAction(retarget(motion.animations.find(clip => clip.name === name)!, rig, vrm, scale, hipsOffset)).play());
  idle.time = phase % idle.getClip().duration;
  // Life actions (C083): sit on a bench, buy at a counter, chat standing. The UAL clips are used when the people bundle
  // has them; until tools/assets.mjs re-embeds them, Idle_Loop-based stand-ins (TEMPORARY) pose the same states.
  const flip = vrm.meta.metaVersion === '0' ? -1 : 1, base = idle.getClip(), q = new T.Quaternion();
  const role = new Map(Object.keys(vrm.humanoid.humanBones).map(name =>
    [vrm.humanoid.getNormalizedBoneNode(name as VRMHumanBoneName)?.name, name]));
  const turn = (x: number) => q.setFromEuler(new T.Euler(x * flip, 0, 0)); // negative x swings a limb forward
  const named = (name: string) => motion.animations.find(clip => clip.name === name);
  const standIn = (name: string, pose: Record<string, (q: T.Quaternion, t: number) => void>, seat?: [y: number, ahead: number]) =>
    new T.AnimationClip(name, base.duration, base.tracks.map(track => {
      const [bone, property] = track.name.split('.'), edit = pose[role.get(bone) ?? ''], values = track.values.slice();
      if (property === 'position' && seat)
        for (let i = 0; i < values.length; i += 3) values.set([track.values[0], seat[0], track.values[2] + seat[1] * flip], i);
      if (property === 'quaternion' && edit) for (let i = 0; i < values.length; i += 4) {
        const rest = new T.Quaternion().fromArray(values, i);
        edit(rest, track.times[i / 4] / base.duration); rest.toArray(values, i);
      }
      return new (track.constructor as typeof T.KeyframeTrack)(track.name, track.times, values);
    }));
  const action = (clip: T.AnimationClip, once = false) => {
    const next = mixer.clipAction(clip);
    next.setLoop(once ? T.LoopOnce : T.LoopRepeat, Infinity).clampWhenFinished = once;
    next.weight = 0; next.play(); life.add(next);
    return next;
  };
  const clip = (name: string, fallback?: () => T.AnimationClip, once = false) => {
    const source = named(name), made = source ? retarget(source, rig, vrm, scale, hipsOffset) : fallback?.();
    return made && action(made, once);
  };
  const life = new Set<T.AnimationAction>(), arms = (a: number) => (r: T.Quaternion) => r.premultiply(turn(-a));
  // Seated stand-in: hip joints over the seat, thighs from there toward rest knee height (at most 30° down), shins upright,
  // feet flat; short SD thighs slide forward so the knees still clear the seat's front edge (16 cm ahead of the spot).
  const y = (name: VRMHumanBoneName) => vrm.humanoid.getRawBoneNode(name)!.getWorldPosition(v).y;
  vrm.humanoid.update(); vrm.scene.updateMatrixWorld(true);
  const hipY = y('leftUpperLeg'), kneeY = y('leftLowerLeg'), restHips = hips.position.y, restY = vrm.scene.position.y;
  hips.position.y += 0.1; vrm.humanoid.update(); vrm.scene.updateMatrixWorld(true);
  const lift = (y('leftUpperLeg') - hipY) / 0.1; // world metres per normalized hips unit
  hips.position.y = restHips; vrm.humanoid.update();
  // The UAL clips sit back ~25 cm onto a chair scaled to the legs: act('sit') steps the group forward by that much, and
  // the seated hips are raised or lowered to this seat's height (standing frames keep theirs).
  const hipsOf = (clip: T.AnimationClip) => clip.tracks.find(track => track.name.endsWith('.position'))!.values;
  const sitSource = named('Sitting_Idle_Loop'), [standY, standZ] = hipsOf(base).slice(1, 3);
  const [sitY, sitZ] = sitSource ? hipsOf(retarget(sitSource, rig, vrm, scale, hipsOffset)).slice(1, 3) : [standY, standZ];
  const seats = new Map<number, (T.AnimationAction | undefined)[]>(), seated = (seat: number) => {
    if (!seats.has(seat)) {
      const length = hipY - kneeY, joint = seat + 0.09 * bodyScale, down = Math.asin(T.MathUtils.clamp((joint - kneeY) / length, -0.3, 0.5));
      const bend = Math.PI / 2 - down, ahead = Math.max(0, 0.16 - length * Math.cos(down)), target = restHips + (joint - hipY) / lift;
      const thigh = (r: T.Quaternion) => r.copy(turn(-bend)), shin = (r: T.Quaternion) => r.copy(turn(bend));
      const fit = (name: string, once = false) => {
        const source = named(name), made = source && retarget(source, rig, vrm, scale, hipsOffset);
        if (!made) return;
        const values = hipsOf(made);
        for (let i = 0; i < values.length; i += 3) {
          values[i + 1] += (target - sitY) * T.MathUtils.clamp((standY - values[i + 1]) / (standY - sitY), 0, 1);
        }
        return action(made, once);
      };
      seats.set(seat, [fit('Sitting_Enter', true), fit('Sitting_Idle_Loop') ?? action(standIn('Sitting_Idle_Loop', {
        leftUpperLeg: thigh, rightUpperLeg: thigh, leftLowerLeg: shin, rightLowerLeg: shin, leftFoot: r => r.identity(),
        rightFoot: r => r.identity(), leftUpperArm: arms(0.5), rightUpperArm: arms(0.5) }, [target, ahead / lift])),
      fit('Sitting_Exit', true)]);
    }
    return seats.get(seat)!;
  };
  const buy = clip('Interact', () => standIn('Interact', {
    rightUpperArm: (r, t) => r.premultiply(turn(-1.2 * Math.sin(Math.PI * t) ** 2)) }));
  const talk = clip('Idle_Talking_Loop', () => standIn('Idle_Talking_Loop', { leftUpperArm: arms(0.15),
    rightUpperArm: (r, t) => r.premultiply(turn(-0.45 - 0.2 * Math.sin(4 * Math.PI * t))),
    neck: (r, t) => r.premultiply(turn(0.06 * Math.sin(2 * Math.PI * t))) }));
  type Activity = 'stand' | 'sit' | 'talk' | 'buy';
  const FADE = 0.6; // s, between activities and into a following clip
  let activity: Activity = 'stand', steps: T.AnimationAction[] = [], leave: T.AnimationAction | undefined, mouth = 0;
  const begin = () => { if (steps[0] && steps[0].weight < 0.01) steps[0].reset(); };
  if (vrm.lookAt) vrm.lookAt.target = camera;
  const group = new T.Group().add(vrm.scene), face = vrm.expressionManager;
  group.name = outfit.name;
  let time = phase, blinkAt = phase + 1.5 + phase * 0.3, smileAt = 3, first = true;
  return { group, focusHeight, activity: () => activity,
    // sit: the group stands on the seat spot; seat is the seat top above the feet' ground (m). Leaving a seat plays
    // Sitting_Exit first when present and ends standing in front of it.
    act(next: Activity, seat = 0.43) {
      if (next === activity) return;
      const [enter, loop, exit] = next === 'sit' ? seated(seat) : [];
      steps = [leave, enter, loop, next === 'talk' && talk, next === 'buy' && buy].filter((step): step is T.AnimationAction => !!step);
      leave = exit;
      if (next === 'sit') group.translateZ(Math.abs(sitZ - standZ) * lift);
      if (first && (steps = steps.slice(-1))[0]) { // placed at load: already there, each at its own point of the loop
        steps[0].weight = 1; steps[0].time = phase % steps[0].getClip().duration;
      }
      activity = next; begin();
    },
    update(speed: number, dt: number) {
    if (steps[0]?.loop === T.LoopOnce && steps[0].time > steps[0].getClip().duration - FADE) { steps.shift(); begin(); }
    let share = 0; // activity weights fade over FADE; walking and idling fill the rest
    for (const step of life) share += step.weight = T.MathUtils.clamp(step.weight + (step === steps[0] ? dt : -dt) / FADE, 0, 1);
    const stand = 1 - Math.min(share, 1);
    const moving = Math.min(speed / 0.6, 1), running = T.MathUtils.clamp((speed - WALK) / (RUN - WALK), 0, 1);
    idle.weight = (1 - moving) * stand;
    walk.weight = moving * (1 - running) * stand;
    run.weight = moving * running * stand;
    walk.timeScale = T.MathUtils.clamp(speed / 1.4, 0.6, 1.5) / bodyScale;
    run.timeScale = T.MathUtils.clamp(speed / 3.8, 0.8, 1.2) / bodyScale;
    mixer.update(dt);
    time += dt;
    if (time > blinkAt + 0.16) blinkAt = time + 1.5 + Math.random() * 3.5;
    if (time > smileAt + 2.6) smileAt = time + 5 + Math.random() * 7;
    const smile = T.MathUtils.smoothstep(time, smileAt, smileAt + 0.4) * (1 - T.MathUtils.smoothstep(time, smileAt + 2.2, smileAt + 2.6));
    face?.setValue('happy', 0.65 * smile);
    face?.setValue('blink', Math.max(0, 1 - Math.abs(time - blinkAt - 0.08) / 0.08) * (1 - smile));
    mouth = T.MathUtils.clamp(mouth + (activity === 'talk' ? dt : -dt) / 0.4, 0, 1);
    face?.setValue('aa', mouth * 0.5 * Math.max(0, Math.sin(time * 9) * Math.sin(time * 2.3 + phase))); // chatting lips
    if (sd) { // feet stay on the ground while standing; a seated body keeps its rest height on the seat instead
      vrm.humanoid.update(); group.updateMatrixWorld(true);
      const ground = vrm.scene.position.y + group.getWorldPosition(v).y - Math.min(...contacts.map(({ bone, point }) => bone.localToWorld(v.copy(point)).y));
      vrm.scene.position.y = T.MathUtils.lerp(restY, ground, stand);
    }
    if (first) { vrm.humanoid.update(); group.updateMatrixWorld(true); vrm.springBoneManager?.reset(); }
    first = false;
    vrm.update(dt);
  } };
}
