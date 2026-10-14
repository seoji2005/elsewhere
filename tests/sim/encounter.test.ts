import { expect, it } from 'vitest';
import { npcs, type Npc } from '../../src/data/npcs';
import { createWorld } from '../../src/sim/world';
import { createMemoryState, recall } from '../../src/sim/memory';
import { createEncounterState, encounter, encounterCandidates, interestIn,
  type PlayerProfile } from '../../src/sim/encounter';
import { createShopState, inviteHomeTea, useItem } from '../../src/sim/shop';
import { rememberSharedEvent } from '../../src/sim/memory';
import { createBonds, edgeKey } from '../../src/sim/bonds';

const player: PlayerProfile = { id: 'player', traits: ['curious'], likes: ['빛씨'], dislikes: [], reputation: 0 };
const time = { day: 1, hour: 9, minute: 0 };
const aro = npcs[0];
it('finds first meetings at the current place/time and records a recallable memory once', () => {
  const world = createWorld(), state = createEncounterState();
  expect(encounter(state, world, player, [aro], 'park', time)).toBeNull();
  expect(encounter(state, world, player, [aro], 'office', time)?.id).toBe('aro');
  expect(encounter(state, world, player, [aro], 'office', time)).toBeNull();
  expect(recall(state.memories.aro, time, { subjectId: 'player' })[0].topic).toBe('첫 만남');
  expect(world.relationships).toEqual({});
  expect(state.memories.aro.entries).toHaveLength(1);
  const restored = JSON.parse(JSON.stringify(state));
  restored.memories.aro.entries = []; // Memory eviction must not make an old acquaintance new.
  expect(encounter(restored, world, player, [aro], 'office', { ...time, day: 22 })).toBeNull();
  expect(encounter(restored, world, { ...player, id: 'other' }, [aro], 'office', time)?.id).toBe('aro');
});
it('ranks personality, venue affinity and reputation without relying on hardcoded NPC identities', () => {
  const state = createEncounterState(), world = createWorld();
  const quiet: Npc = { ...aro, id: 'generated-quiet', traits: ['quiet'], likes: ['잔향 차'] };
  const social: Npc = { ...aro, id: 'generated-social', traits: ['social'], likes: [] };
  const pick = (reputation: number, topics: string[]) => encounterCandidates(state, world,
    { ...player, reputation }, [quiet, social], 'office', time, topics);
  expect(pick(0, [])[0].npc.id).toBe(social.id);
  expect(pick(0, ['잔향 차']).find(entry => entry.npc.id === quiet.id)?.score).toBe(2);
  expect(pick(-100, [])).toEqual([]);
  expect(pick(100, [])).toHaveLength(2);
  expect(encounter(state, world, player, [aro], 'park', { ...time, hour: 15 })?.id).toBe('aro');
});
it('excludes existing positive, negative, reverse relationships and prior memories', () => {
  const state = createEncounterState(), world = createWorld();
  for (const value of [10, -10]) {
    world.relationships.player = { aro: value };
    expect(encounter(state, world, player, [aro], 'office', time)).toBeNull();
  }
  world.relationships = { aro: { player: 1 } };
  expect(encounter(state, world, player, [aro], 'office', time)).toBeNull();
  world.relationships = {};
  state.memories.aro = createMemoryState('aro');
  encounter(state, world, player, [aro], 'office', time);
  state.met = [];
  expect(encounter(state, world, player, [aro], 'office', time)).toBeNull();
});
it('keeps attraction directional and rejects malformed input before mutation', () => {
  const npc = { ...aro, dislikes: ['빛씨'] };
  expect(interestIn(player, npc)).toBeGreaterThan(interestIn(npc, player));
  const state = createEncounterState(), world = createWorld();
  expect(() => encounter(state, world, { ...player, reputation: NaN }, [aro], 'office', time)).toThrow();
  expect(() => encounter(state, world, player, [aro], 'office', { ...time, day: 0 })).toThrow();
  expect(state).toEqual(createEncounterState());
});
it('uses worn clothing rather than inventory for directional encounter interest', () => {
  const shop = createShopState(), state = createEncounterState(), world = createWorld();
  shop.residents.player = { inventory: { coat: 1, scarf: 1 }, energy: 50, appearance: 0,
    atmosphere: 0, clothing: null, decorations: [] };
  const dressed = { ...player, lifestyle: shop.residents.player };
  const score = () => encounterCandidates(state, world, dressed, [aro], 'office', time)[0].score;
  const base = score();
  useItem(shop, 'player', 'coat');
  expect(score()).toBe(base + 2);
  expect(interestIn(dressed, aro)).toBe(interestIn(player, aro));
  useItem(shop, 'player', 'scarf');
  expect(score()).toBe(base + 1);
  expect(() => encounterCandidates(state, world,
    { ...player, lifestyle: { appearance: NaN } }, [aro], 'office', time)).toThrow();
});
it('opens a planned home tea meal only with decoration and friendship, then records completion', () => {
  const shop = createShopState(), world = createWorld(), memory = createMemoryState(aro.id);
  shop.residents.player = { inventory: { chime: 1, lamp: 1 }, energy: 50, appearance: 0,
    atmosphere: 0, clothing: null, decorations: [] };
  const invite = () => inviteHomeTea(shop, world, 'player', aro, 'tea-1', time);
  world.relationships.player = { aro: 30 };
  useItem(shop, 'player', 'chime');
  expect(invite()).toBeNull();
  useItem(shop, 'player', 'lamp');
  world.relationships.player.aro = 29;
  expect(invite()).toBeNull();
  world.relationships.player.aro = 30;
  const meal = invite()!;
  expect(meal).toMatchObject({ kind: 'meal', placeId: 'nest', participants: ['player', 'aro'] });
  expect(rememberSharedEvent(memory, meal)).toBe(false);
  expect(rememberSharedEvent(memory, { ...meal, status: 'completed' })).toBe(true);
  expect(rememberSharedEvent(memory, { ...meal, status: 'completed' })).toBe(false);
  const bonds = createBonds();
  expect(inviteHomeTea(shop, world, 'player', aro, 'tea-2', time, bonds)).toBeNull();
  bonds.edges[edgeKey('aro', 'player')] = { met: true, affection: 30, trust: 15, comfort: 10, respect: 0, romance: 0 };
  expect(inviteHomeTea(shop, world, 'player', aro, 'tea-2', time, bonds)?.status).toBe('planned');
});
