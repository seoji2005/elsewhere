import { expect, it } from 'vitest';
import { companionEvents } from '../../src/data/companions';
import { createSession } from '../../src/game/session';
import { edgeKey, emptyBond, readBond } from '../../src/sim/bonds';

function setup() {
  const values = new Map<string, string>(), storage = { getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => { values.set(k, v); } };
  return { session: createSession(storage, 123), storage };
}
it.each([
  [1, 1319, 'park', undefined], [1, 1320, 'park', 'lantern-round'],
  [1, 1379, 'park', 'lantern-round'], [1, 1380, 'park', undefined],
  [1, 1320, 'office', undefined], [1, 0, 'office', 'night-record'],
  [1, 239, 'office', 'night-record'], [1, 240, 'office', undefined],
  [4, 60, 'office', undefined], [5, 60, 'office', 'night-record'],
] as const)('gates day %i minute %i at %s', (day, minute, place, id) => {
  const { session } = setup();
  session.state.world.clock.totalMinutes = (day - 1) * 1440 + minute;
  session.state.player.placeId = place;
  expect(session.availableCompanions().map(e => e.id)).toEqual(id ? [id] : []);
  if (!id) expect(session.joinCompanion('night-record')).toBe(false);
});
it.each(companionEvents)('records $id once per date and recalls on the next date even at work', event => {
  const { session, storage } = setup(), { state } = session;
  session.tick(event.untilMinute - 1); state.player.placeId = event.placeId;
  state.bonds.edges[edgeKey(event.npcId, 'player')] = { ...emptyBond(), affection: 30, trust: 12, comfort: 7 };
  expect(session.joinCompanion(event.id)).toBe(true);
  expect(readBond(state.bonds, event.npcId, 'player')).toMatchObject({ trust: 15, respect: 2, comfort: 10, met: true });
  expect(session.stageFor(event.npcId)).toBe('친구');
  const memory = state.dialogue.memories[event.npcId].entries[0];
  expect(memory).toMatchObject({ kind: 'shared-work', topic: event.activityName,
    placeId: event.placeId, participants: ['player', event.npcId] });
  expect(session.buildDialogue(event.npcId).line).not.toContain(event.recallLine);
  const before = structuredClone(state);
  expect(session.joinCompanion(event.id)).toBe(false); expect(state).toEqual(before);
  expect(session.availableCompanions()).toEqual([]);
  expect(session.saveNow().ok).toBe(true);
  const loaded = createSession(storage);
  expect(loaded.loadResult.ok).toBe(true); expect(loaded.joinCompanion(event.id)).toBe(false);
  loaded.tick(1440 + 60 - loaded.state.world.clock.totalMinutes);
  loaded.state.player.placeId = event.npcId === 'velo' ? 'office' : 'quiet';
  expect(session.state.world.clock.totalMinutes).toBeLessThan(1440);
  expect(loaded.buildDialogue(event.npcId).line).toContain(event.recallLine);
  expect(loaded.buildDialogue(event.npcId).line).not.toContain(event.recallLine);
  loaded.saveNow(); const again = createSession(storage);
  expect(again.loadResult.ok).toBe(true);
  expect(again.buildDialogue(event.npcId).line).not.toContain(event.recallLine);
  again.tick(Math.max(0, 1440 + event.fromMinute - again.state.world.clock.totalMinutes));
  again.state.player.placeId = event.placeId;
  expect(again.joinCompanion(event.id)).toBe(true);
});
it('rejects unknown events, absent residents and legacy mode without changes', () => {
  const { session } = setup(), before = structuredClone(session.state);
  expect(session.joinCompanion('unknown')).toBe(false);
  expect(session.joinCompanion('lantern-round')).toBe(false); expect(session.state).toEqual(before);
  session.state.world.clock.totalMinutes = 1320; session.state.player.placeId = 'park';
  session.state.relationMode = 'legacy'; expect(session.availableCompanions()).toEqual([]);
  expect(session.joinCompanion('lantern-round')).toBe(false);
});
