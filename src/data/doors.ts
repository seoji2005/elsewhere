import type { Pose } from '../sim/scenes';
export interface Door {
  readonly id: string;
  readonly placeId: string;
  readonly interiorId: string;
  readonly position: Pose;
  readonly spawn: Pose;
}
// Simulation coordinates; the renderer adapter must supply its collision-safe outside pose.
export const doors: readonly Door[] = [
  { id: 'cafe-front', placeId: 'cafe', interiorId: 'interior:cafe', position: { x: -9.86, z: -6, yaw: 0 }, spawn: { x: 0, z: 0, yaw: 0 } },
  { id: 'shop-front', placeId: 'shop', interiorId: 'interior:shop', position: { x: -19.1, z: -6, yaw: 0 }, spawn: { x: 0, z: 0, yaw: 0 } },
];
