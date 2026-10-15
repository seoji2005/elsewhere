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
// ?town=1 (C077, scene/town.ts): each place's door on the town block; the pose stands on the sidewalk in front of it,
// facing the street (south row yaw 0, north row yaw π). Brownstone doors: at the foot of the stoop.
export const townDoors: readonly Door[] = [
  { id: 'town-office', placeId: 'office', interiorId: 'interior:office', position: { x: -19.95, z: -8.2, yaw: 0 }, spawn: { x: 0, z: 0, yaw: 0 } },
  { id: 'town-shop', placeId: 'shop', interiorId: 'interior:shop', position: { x: -31.2, z: -8.2, yaw: 0 }, spawn: { x: 0, z: 0, yaw: 0 } },
  { id: 'town-cafe', placeId: 'cafe', interiorId: 'interior:cafe', position: { x: -39.05, z: -8.2, yaw: 0 }, spawn: { x: 0, z: 0, yaw: 0 } },
  { id: 'town-park', placeId: 'park', interiorId: 'interior:park', position: { x: -17, z: 8.4, yaw: Math.PI }, spawn: { x: 0, z: 0, yaw: 0 } },
  { id: 'town-nest', placeId: 'nest', interiorId: 'interior:nest', position: { x: -25.45, z: 8.2, yaw: Math.PI }, spawn: { x: 0, z: 0, yaw: 0 } },
  { id: 'town-quiet', placeId: 'quiet', interiorId: 'interior:quiet', position: { x: -33.68, z: 7.5, yaw: Math.PI }, spawn: { x: 0, z: 0, yaw: 0 } },
  { id: 'town-high', placeId: 'high', interiorId: 'interior:high', position: { x: -40.18, z: 7.5, yaw: Math.PI }, spawn: { x: 0, z: 0, yaw: 0 } },
];
