import { expect, it } from 'vitest';
import { npcs, type Npc } from '../../src/data/npcs';
import { createWorld } from '../../src/sim/world';
import { createMemoryState, recall } from '../../src/sim/memory';
import { createEncounterState, encounter, encounterCandidates, interestIn,
  type PlayerProfile } from '../../src/sim/encounter';

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
