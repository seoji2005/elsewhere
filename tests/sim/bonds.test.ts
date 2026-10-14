import { expect, it } from 'vitest';
import { applyBondEvent, axes, canStartDating, createBonds, datingPair, edgeKey, emptyBond,
  readBond, seedLegacy, stageOf, type Bond } from '../../src/sim/bonds';
import { createEncounterState } from '../../src/sim/encounter';
import { relationshipStage } from '../../src/sim/relationship';
const time = { day: 1, hour: 9, minute: 0 };
const ready: Bond = { affection: 40, trust: 25, respect: 0, comfort: 20, romance: 60, met: true };
it('keeps one-sided attraction and all stage thresholds separate', () => {
  const state = createBonds();
  expect(stageOf(state, 'a', 'b')).toBe('낯섦');
  state.edges[edgeKey('a', 'b')] = { ...ready, affection: 30, trust: 15, comfort: 10, romance: 40 };
  state.edges[edgeKey('b', 'a')] = { ...emptyBond(), met: true };
  expect(stageOf(state, 'a', 'b')).toBe('호감'); expect(stageOf(state, 'b', 'a')).toBe('아는 사이');
  const bond = state.edges[edgeKey('a', 'b')];
  for (const axis of axes) {
    const value = bond[axis]; bond[axis]--;
    expect(stageOf(state, 'a', 'b')).toBe(axis === 'romance' ? '친구' : '아는 사이'); bond[axis] = value;
  }
  bond.met = false; expect(stageOf(state, 'a', 'b')).toBe('낯섦');
});
it('requires both directional thresholds and both consents, then preserves established dating', () => {
  const yes = { playerWantsDating: true, npcWantsDating: true };
  expect(canStartDating(ready, ready, yes)).toBe(true);
  for (const side of ['playerWantsDating', 'npcWantsDating']) {
    expect(canStartDating(ready, ready, { ...yes, [side]: false })).toBe(false);
  }
  for (const axis of axes) for (const reverse of [false, true]) {
    const low = { ...ready, [axis]: ready[axis] - 1 };
    expect(canStartDating(reverse ? ready : low, reverse ? low : ready, yes)).toBe(false);
  }
  expect(canStartDating({ ...ready, met: false }, ready, yes)).toBe(false);
  const dating = { dating: [{ actorId: 'a', npcId: 'b' }] };
  expect(datingPair(dating, 'b', 'a')).toBe(true); expect(datingPair(dating, 'a', 'c')).toBe(false);
  expect(stageOf(createBonds(), 'b', 'a', dating)).toBe('연인 첫 단계');
});
it('caps actual positive gains proportionally per direction/day and persists deduplication', () => {
  let state = createBonds();
  const effect = { fromId: 'a', toId: 'b', delta: { affection: 20, trust: 20 }, met: true as const };
  expect(() => applyBondEvent(state, 'invalid', time, [effect, { ...effect, delta: { trust: NaN } }])).toThrow();
  expect(state).toEqual(createBonds());
  expect(applyBondEvent(state, 'one', time, [effect])).toBe(true);
  expect(readBond(state, 'a', 'b')).toMatchObject({ affection: 5, trust: 5, met: true });
  state = JSON.parse(JSON.stringify(state));
  expect(applyBondEvent(state, 'one', { ...time, day: 2 }, [effect])).toBe(false);
  applyBondEvent(state, 'loss', time, [{ ...effect, delta: { affection: -1000, romance: -1000 } }]);
  applyBondEvent(state, 'blocked', time, [effect]);
  expect(readBond(state, 'a', 'b')).toMatchObject({ affection: -100, trust: 5, romance: 0 });
  applyBondEvent(state, 'next', { ...time, day: 2 }, [effect]);
  applyBondEvent(state, 'reverse', time, [{ ...effect, fromId: 'b', toId: 'a' }]);
  expect(readBond(state, 'a', 'b').affection).toBe(-95); expect(readBond(state, 'b', 'a').trust).toBe(5);
  state.edges[edgeKey('c', 'd')] = { ...ready, affection: 99, trust: 99, romance: 99 };
  applyBondEvent(state, 'clamp', time, [{ fromId: 'c', toId: 'd', delta: { affection: 1000, trust: 1000, romance: 1000, comfort: 7 } }]);
  expect(readBond(state, 'c', 'd')).toMatchObject({ affection: 100, trust: 100, romance: 100, comfort: 27 });
});
it('seeds exact legacy scores and hasMet facts without changing old friends or inferring feelings', () => {
  const world = { relationships: { a: { b: 30, c: 0, d: -5 } } }, encounters = createEncounterState();
  encounters.met.push({ actorId: 'a', npcId: 'c', day: 1 }, { actorId: 'a', npcId: 'e', day: 1 });
  const before = JSON.stringify({ world, encounters }), state = seedLegacy(world, encounters);
  expect(readBond(state, 'a', 'b')).toEqual({ ...emptyBond(), met: true, legacyScore: 30 });
  expect(relationshipStage(readBond(state, 'a', 'b').legacyScore!)).toBe('친구');
  expect(readBond(state, 'a', 'c').met).toBe(true); expect(readBond(state, 'a', 'e').met).toBe(true);
  expect(readBond(state, 'a', 'd').legacyScore).toBe(-5); expect(state.edges[edgeKey('b', 'a')]).toBeUndefined();
  expect(JSON.stringify({ world, encounters })).toBe(before);
});
