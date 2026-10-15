import * as T from 'three';
import { WALK, RUN } from './character';

type World = { solids: T.Box3[]; walls: T.Box3[]; doors: T.Vector3[] };
const BODY = 0.3; // collision radius in metres

// Push a circle at p (XZ) out of every box; the sidewalk kerb sets the foot height.
function collide(p: T.Vector3, boxes: T.Box3[]) {
  for (const box of boxes) {
    const dx = p.x - T.MathUtils.clamp(p.x, box.min.x, box.max.x);
    const dz = p.z - T.MathUtils.clamp(p.z, box.min.z, box.max.z);
    const d = Math.hypot(dx, dz);
    if (d >= BODY) continue;
    if (d > 1e-6) { p.x += dx / d * (BODY - d); p.z += dz / d * (BODY - d); continue; }
    const exits = [box.min.x - BODY - p.x, box.max.x + BODY - p.x, box.min.z - BODY - p.z, box.max.z + BODY - p.z];
    const i = exits.reduce((best, v, j) => Math.abs(v) < Math.abs(exits[best]) ? j : best, 0);
    if (i < 2) p.x += exits[i]; else p.z += exits[i];
  }
  p.x = T.MathUtils.clamp(p.x, -46, 46); p.z = T.MathUtils.clamp(p.z, -46, 46);
  p.y = Math.abs(p.x) > 5 && Math.abs(p.z) > 5 ? 0.11 : 0;
}

// Joystick length → target speed: a light push walks, the outer ring runs.
function targetSpeed(length: number) {
  if (length < 0.12) return 0;
  return length >= 0.85 ? RUN : WALK * (0.35 + 0.65 * Math.min(1, (length - 0.12) / 0.6));
}

export function followPlayer(body: T.Object3D, camera: T.PerspectiveCamera, world: World, focusHeight = 1.4) {
  const velocity = new T.Vector3(), focus = new T.Vector3(), ray = new T.Ray(), hit = new T.Vector3();
  let yaw = 0, pitch = 0, distance = 0, first = true;
  collide(body.position, world.solids);
  return function update(dt: number, input: { x: number; y: number }, view: { yaw: number; pitch: number; dist: number }) {
    const length = Math.min(1, Math.hypot(input.x, input.y)), speed = targetSpeed(length);
    const forward = new T.Vector3(-Math.sin(view.yaw), 0, -Math.cos(view.yaw));
    const right = new T.Vector3(-forward.z, 0, forward.x);
    const wish = right.multiplyScalar(input.x).addScaledVector(forward, input.y);
    if (length > 0) wish.multiplyScalar(speed / length);
    velocity.lerp(wish, 1 - Math.exp(-dt * 9));
    for (let left = dt; left > 0; left -= 0.05) {
      body.position.addScaledVector(velocity, Math.min(left, 0.05));
      collide(body.position, world.solids);
    }
    if (velocity.lengthSq() > 0.04) {
      const turn = Math.atan2(velocity.x, velocity.z) - body.rotation.y;
      body.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * (1 - Math.exp(-dt * 12));
    }
    // Third-person orbit: smooth follow, and pull in in front of any wall between player and camera.
    const smooth = first ? 1 : 1 - Math.exp(-dt * 10);
    yaw += (view.yaw - yaw) * smooth; pitch += (view.pitch - pitch) * smooth;
    focus.lerp(hit.copy(body.position).setY(body.position.y + focusHeight), first ? 1 : 1 - Math.exp(-dt * 8));
    ray.set(focus, new T.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)));
    let allowed = view.dist;
    for (const wall of world.walls)
      if (ray.intersectBox(wall, hit)) allowed = Math.min(allowed, Math.max(1, hit.distanceTo(focus) - 0.4));
    distance = allowed < distance || first ? allowed : distance + (allowed - distance) * (1 - Math.exp(-dt * 4));
    camera.position.copy(focus).addScaledVector(ray.direction, distance);
    camera.lookAt(focus);
    first = false;
    const near = world.doors.some(door => Math.hypot(door.x - body.position.x, door.z - body.position.z) < 2);
    return { speed: velocity.length(), near };
  };
}
