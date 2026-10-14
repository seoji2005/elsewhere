import { doors } from '../data/doors';
export interface Pose { readonly x: number; readonly z: number; readonly yaw: number }
export interface Location {
  readonly kind: 'street' | 'interior';
  readonly sceneId: string;
  readonly placeId: string | null;
  readonly doorId: string | null;
  readonly pose: Pose;
  readonly returnPose: Pose | null;
}
export interface SceneState {
  readonly location: Location;
  readonly pending: { readonly token: number; readonly destination: Location } | null;
  readonly revision: number;
}
export type SceneEvent = { type: 'enter'; doorId: string; outside?: Pose } | { type: 'exit' }
  | { type: 'ready' | 'failed'; token: number };
const valid = (p: Pose) => [p.x, p.z, p.yaw].every(Number.isFinite);
export function createSceneState(pose: Pose): SceneState {
  if (!valid(pose)) throw Error('Invalid pose');
  return { location: { kind: 'street', sceneId: 'street', placeId: null, doorId: null,
    pose: { ...pose }, returnPose: null }, pending: null, revision: 0 };
}
export function reduceScene(state: SceneState, event: SceneEvent): SceneState {
  if (event.type === 'ready' || event.type === 'failed') {
    if (state.pending?.token !== event.token) return state;
    return { ...state, pending: null, location: event.type === 'ready' ? state.pending.destination : state.location };
  }
  if (state.pending) return state;
  let destination: Location;
  if (event.type === 'enter') {
    const door = doors.find(entry => entry.id === event.doorId);
    if (state.location.kind !== 'street' || !door) return state;
    const outside = event.outside ?? door.position;
    if (!valid(outside)) return state;
    destination = { kind: 'interior', sceneId: door.interiorId, placeId: door.placeId,
      doorId: door.id, pose: { ...door.spawn }, returnPose: { ...outside } };
  } else {
    if (state.location.kind !== 'interior' || !state.location.returnPose) return state;
    destination = { kind: 'street', sceneId: 'street', placeId: null, doorId: null,
      pose: { ...state.location.returnPose }, returnPose: null };
  }
  const revision = state.revision + 1;
  return { ...state, revision, pending: { token: revision, destination } };
}
export const movementLocked = (state: SceneState): boolean => state.pending !== null;
