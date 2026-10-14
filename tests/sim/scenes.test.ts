import { expect, it } from 'vitest';
import { doors } from '../../src/data/doors';
import { places } from '../../src/data/places';
import { createSceneState, movementLocked, reduceScene } from '../../src/sim/scenes';
it('maps unique doors to places and returns to the original door after locked transitions', () => {
  expect(new Set(doors.map(d => d.id)).size).toBe(doors.length);
  for (const door of doors) {
    expect(places.some(p => p.id === door.placeId)).toBe(true);
    const street = createSceneState({ x: 0, z: 2, yaw: 1 });
    const entering = reduceScene(street, { type: 'enter', doorId: door.id });
    expect(movementLocked(entering)).toBe(true);
    expect(reduceScene(entering, { type: 'enter', doorId: doors[0].id })).toBe(entering);
    expect(reduceScene(entering, { type: 'exit' })).toBe(entering);
    const inside = reduceScene(entering, { type: 'ready', token: 1 });
    expect(inside.location).toMatchObject({ sceneId: door.interiorId, placeId: door.placeId, doorId: door.id, pose: door.spawn });
    const exiting = reduceScene(inside, { type: 'exit' });
    expect(reduceScene(exiting, { type: 'ready', token: 1 })).toBe(exiting);
    expect(reduceScene(exiting, { type: 'failed', token: 2 }).location).toBe(inside.location);
    expect(reduceScene(exiting, { type: 'ready', token: 2 }).location.pose).toEqual(door.position);
  }
});
it('rejects invalid entries, preserves failed scenes and snapshots the outside pose', () => {
  const state = createSceneState({ x: 0, z: 0, yaw: 0 }), outside = { x: 2, z: 3, yaw: 1 };
  expect(() => createSceneState({ ...outside, x: NaN })).toThrow();
  expect(reduceScene(state, { type: 'enter', doorId: 'missing' })).toBe(state);
  expect(reduceScene(state, { type: 'enter', doorId: doors[0].id, outside: { ...outside, z: Infinity } })).toBe(state);
  const pending = reduceScene(state, { type: 'enter', doorId: doors[0].id, outside });
  outside.x = 99;
  expect(reduceScene(pending, { type: 'failed', token: 1 }).location).toBe(state.location);
  const inside = reduceScene(pending, { type: 'ready', token: 1 });
  expect(movementLocked(inside)).toBe(false);
  expect(reduceScene(reduceScene(inside, { type: 'exit' }), { type: 'ready', token: 2 }).location.pose.x).toBe(2);
});
