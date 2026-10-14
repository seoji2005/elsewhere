import { expect, it } from 'vitest';
import { npcs, type Npc } from '../../src/data/npcs';
import { createWorld } from '../../src/sim/world';
import { applyBondEvent, createBonds, readBond } from '../../src/sim/bonds';
import { createEncounterState, type PlayerProfile } from '../../src/sim/encounter';
import { cancelMatch, createMatchmakingState, noShowEffects, requestMatch, resolveMatch, respondToMatch,
  type MatchRequest } from '../../src/sim/matchmaking';

function setup(candidate: Npc = npcs[0]) {
  const world = createWorld(), state = createMatchmakingState(), encounters = createEncounterState();
  world.relationships = { player: { nuel: 30 }, nuel: { [candidate.id]: 10 } };
  const player: PlayerProfile = { id: 'player', traits: ['curious'], likes: ['빛씨'], dislikes: [], reputation: 0 };
  const request: MatchRequest = { id: 'date-1', player, introducerId: 'nuel', npcs: [npcs[1], candidate],
    now: { day: 1, hour: 8, minute: 0 }, slot: { placeId: 'office', time: { day: 2, hour: 9, minute: 0 } },
    appearances: { [candidate.id]: { hairColor: 'silver', height: 168 } } };
  const offer = () => requestMatch(state, encounters, world, request);
  return { world, state, encounters, request, offer, candidate };
}
it('a friend introduces a compatible acquaintance with appearance, personality and a real appointment', () => {
  const { offer, request, state, encounters, candidate, world } = setup();
  const date = offer()!;
  expect(date.impression).toEqual({ name: candidate.name,
    appearance: { hairColor: 'silver', height: 168 }, keywords: ['curious', 'quiet'],
    note: '아로 님과 이야기하면 재미있을 거예요!' });
  expect(date.time).toEqual(request.slot.time);
  expect(date.time).not.toBe(request.slot.time);
  expect(date.impression.appearance).not.toBe(request.appearances[candidate.id]);
  expect(encounters.met).toEqual([]);
  expect(respondToMatch(date, true, request.now)).toBe('scheduled');
  expect(() => respondToMatch(date, true, request.now)).toThrow();
  const restored = JSON.parse(JSON.stringify(state)).appointments[0];
  expect(resolveMatch(restored, encounters, candidate, restored.time,
    { playerPlaceId: 'office', npcPlaceId: 'office' })).toBe('met');
  expect(resolveMatch(restored, encounters, candidate, restored.time,
    { playerPlaceId: 'office', npcPlaceId: 'office' })).toBe('met');
  expect(encounters.memories.aro.entries).toHaveLength(1);
  expect(world.relationships.player.aro).toBeUndefined();
});
it('requires friendship, an actual acquaintance, compatibility, an available slot and a new person', () => {
  const { offer, world, request } = setup();
  world.relationships.player.nuel = 29;
  expect(offer()).toBeNull();
  world.relationships.player.nuel = 30;
  world.relationships.nuel.aro = 9;
  expect(offer()).toBeNull();
  world.relationships.nuel.aro = 10;
  request.slot.placeId = 'park';
  expect(offer()).toBeNull();
  request.slot.placeId = 'office';
  request.player = { ...request.player, traits: [], likes: [] };
  expect(offer()).toBeNull();
  request.player.likes = ['빛씨'];
  world.relationships.player.aro = 10;
  expect(offer()).toBeNull();
});
it('lets the player decline the first impression and blocks repeat offers on the same date', () => {
  const { offer, request, encounters } = setup();
  expect(respondToMatch(offer()!, false, request.now)).toBe('declined');
  request.id = 'date-2';
  expect(offer()).toBeNull();
  request.slot.time.day = 3;
  expect(offer()?.status).toBe('offered');
  expect(encounters.met).toEqual([]);
});
it('adds clothing to NPC interest and uses the introducer speech for the note', () => {
  const { offer, request } = setup({ ...npcs[0], dislikes: ['빛씨'] });
  request.player.reputation = -25; // Base interest 0; the worn coat raises it to the acceptance threshold.
  request.player.lifestyle = { appearance: 7 };
  request.npcs = [{ ...npcs[1], speech: { politeEndings: ['입니다'] } } as Npc, request.npcs[1]];
  const date = offer()!;
  expect(date.npcInterest).toBe(2);
  expect(respondToMatch(date, true, request.now)).toBe('scheduled');
  expect(date.impression.note).toBe('아로 님은 빛씨에 관심이 있는 분입니다.');
});
it.each(['player', 'aro'])('returns directional trust losses only for player no-shows (%s missing)', personId => {
  const { offer, request, candidate, encounters } = setup();
  const date = offer()!;
  expect(noShowEffects(date)).toEqual([]);
  respondToMatch(date, true, request.now);
  resolveMatch(date, encounters, candidate, { ...date.time, hour: 10 },
    { playerPlaceId: personId === 'player' ? null : 'office', npcPlaceId: personId === 'aro' ? null : 'office' });
  expect(noShowEffects(date)).toEqual(personId === 'aro' ? [] : [
    { fromId: 'nuel', toId: 'player', delta: { trust: -5 } },
    { fromId: 'aro', toId: 'player', delta: { trust: -10 } },
  ]);
  const bonds = createBonds(), id = `match-no-show:${date.id}`;
  expect(applyBondEvent(bonds, id, date.time, noShowEffects(date))).toBe(true);
  expect(applyBondEvent(bonds, id, date.time, noShowEffects(date))).toBe(false);
  expect(readBond(bonds, 'nuel', 'player').trust).toBe(personId === 'player' ? -5 : 0);
  expect(readBond(bonds, 'aro', 'player').trust).toBe(personId === 'player' ? -10 : 0);
  expect(readBond(bonds, 'player', 'aro').trust).toBe(0);
});
it('evaluates NPC interest separately: player acceptance does not force reciprocation', () => {
  const { offer, request, encounters } = setup({ ...npcs[0], dislikes: ['빛씨'] });
  request.player.reputation = -50;
  const date = offer()!;
  expect(date.playerInterest).toBeGreaterThanOrEqual(2);
  expect(date.npcInterest).toBeLessThan(2);
  expect(respondToMatch(date, true, request.now)).toBe('rejected');
  expect(encounters.met).toEqual([]);
});
it.each(['player', 'aro'])('%s can cancel or fail to attend without creating a memory', personId => {
  const { offer, request, encounters, candidate } = setup();
  const date = offer()!;
  respondToMatch(date, true, request.now);
  const cancelled = structuredClone(date);
  cancelMatch(cancelled, personId);
  expect(cancelled.status).toBe(personId === 'player' ? 'declined' : 'rejected');
  const presence = { playerPlaceId: personId === 'player' ? null : 'office',
    npcPlaceId: personId === 'aro' ? null : 'office' };
  expect(resolveMatch(date, encounters, candidate, date.time, presence)).toBe('scheduled');
  expect(resolveMatch(date, encounters, candidate, { ...date.time, hour: 10 }, presence)).toBe('no-show');
  expect(date.noShowBy).toEqual([personId]);
  expect(encounters.met).toEqual([]);
});
it('expires unanswered offers, rejects duplicate IDs and validates time before modifying state', () => {
  const { offer, request, encounters, candidate, state } = setup();
  request.slot.time = { ...request.now };
  expect(offer).toThrow();
  expect(state.appointments).toEqual([]);
  request.slot.time.day = 2;
  const date = offer()!;
  expect(offer).toThrow();
  expect(() => respondToMatch(date, true, date.time)).toThrow();
  expect(resolveMatch(date, encounters, candidate, date.time,
    { playerPlaceId: 'office', npcPlaceId: 'office' })).toBe('declined');
  expect(encounters.met).toEqual([]);
});
