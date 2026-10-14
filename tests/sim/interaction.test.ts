import { expect, it } from 'vitest';
import { resolveTap, selectTarget, type Target } from '../../src/sim/interaction';
const player = { x: 0, z: 0 };
const target = (id: string, x: number, priority = 0): Target => ({ id, sceneId: 'street', action: 'enter', position: { x, z: 0 }, radius: 2, priority, enabled: true, visible: true });
it('selects one target by priority, distance and stable ID, retaining nearby previous targets', () => {
  const near = target('a', 1), far = target('b', 1.2);
  expect(selectTarget(player, 'street', [far, near])?.target.id).toBe('a');
  expect(selectTarget(player, 'street', [near, far], 'b')?.target.id).toBe('b');
  expect(selectTarget(player, 'street', [near, target('b', 1.3)], 'b')?.target.id).toBe('a');
  expect(selectTarget(player, 'street', [near, target('b', 2, 1)])?.target.id).toBe('b');
  expect(selectTarget(player, 'street', [target('b', 1), near])?.target.id).toBe('a');
});
it('filters ineligible targets and revalidates taps after movement or locking', () => {
  const near = target('a', 1);
  for (const patch of [{ sceneId: 'other' }, { enabled: false }, { visible: false }, { radius: -1 }, { radius: NaN }, { priority: Infinity }, { position: { x: NaN, z: 0 } }])
    expect(selectTarget(player, 'street', [{ ...near, ...patch }])).toBeNull();
  expect(selectTarget({ x: NaN, z: 0 }, 'street', [near])).toBeNull();
  expect(selectTarget(player, 'street', [target('b', 3)])).toBeNull();
  expect(resolveTap('a', player, 'street', [near])).toBe(near);
  expect(resolveTap('a', { x: 4, z: 0 }, 'street', [near])).toBeNull();
  expect(resolveTap('a', player, 'street', [near], true)).toBeNull();
  expect(resolveTap('a', player, 'street', [near, target('b', 2, 1)])).toBeNull();
});
