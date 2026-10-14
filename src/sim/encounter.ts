import type { Npc, Trait } from '../data/npcs';
import type { GameTime } from './clock';
import { createMemoryState, minuteOf, remember, type MemoryState } from './memory';
import { whereIs } from './npc';
import type { WorldState } from './world';
import type { Lifestyle } from './shop';

export type SocialWorld = Pick<WorldState, 'relationships'>;
export interface PlayerProfile {
  id: string; traits: readonly Trait[]; likes: readonly string[];
  dislikes: readonly string[]; reputation: number; // -100..100
  lifestyle?: Pick<Lifestyle, 'appearance'>;
}
export interface EncounterState {
  memories: Record<string, MemoryState>;
  met: { actorId: string; npcId: string; day: number }[];
}
export function createEncounterState(): EncounterState { return { memories: {}, met: [] }; }
export function validatePlayer(player: PlayerProfile): void {
  const appearance = player.lifestyle?.appearance ?? 0;
  if (!player.id || !Number.isFinite(player.reputation) || Math.abs(player.reputation) > 100
    || !Number.isFinite(appearance) || appearance < 0) {
    throw Error('Invalid player profile');
  }
}
// Directional: the viewer's dislikes and the other's reputation affect only this score.
export function interestIn(viewer: Pick<Npc, 'traits' | 'likes' | 'dislikes'>,
  other: Pick<Npc, 'traits' | 'likes'> & Pick<PlayerProfile, 'lifestyle'>, reputation = 0): number {
  return 1 + viewer.traits.filter(trait => other.traits.includes(trait)).length
    + 2 * viewer.likes.filter(topic => other.likes.includes(topic)).length
    - 3 * viewer.dislikes.filter(topic => other.likes.includes(topic)).length + reputation / 25
    + Math.floor((other.lifestyle?.appearance ?? 0) / 3);
}
export function hasMet(state: EncounterState, world: SocialWorld, actorId: string, npcId: string): boolean {
  return state.met.some(entry => entry.actorId === actorId && entry.npcId === npcId)
    || (world.relationships[actorId]?.[npcId] ?? 0) !== 0
    || (world.relationships[npcId]?.[actorId] ?? 0) !== 0
    || !!state.memories[npcId]?.entries.some(entry => entry.subjectId === actorId);
}
// Shared by chance encounters and fulfilled introductions; no relationship points or dating implied.
export function recordMeeting(state: EncounterState, actorId: string, npc: Npc, time: GameTime): boolean {
  minuteOf(time);
  if (!actorId || actorId === npc.id) throw Error('Invalid meeting');
  if (state.met.some(entry => entry.actorId === actorId && entry.npcId === npc.id)) return false;
  const memory = state.memories[npc.id] ?? createMemoryState(npc.id);
  remember(memory, JSON.stringify(['first-meeting', actorId, npc.id]), {
    actorId, npcId: npc.id, time: { ...time },
    choice: { id: 'first-meeting', topic: '첫 만남', tone: npc.traits[0] ?? 'quiet' },
    requestedChange: 0, change: 0, value: 0,
  });
  state.memories[npc.id] = memory;
  state.met.push({ actorId, npcId: npc.id, day: time.day });
  return true;
}
export function encounterCandidates(state: EncounterState, world: SocialWorld, player: PlayerProfile,
  npcs: readonly Npc[], placeId: string, time: GameTime, placeTopics: readonly string[] = []) {
  validatePlayer(player);
  minuteOf(time);
  if (!placeId) throw Error('Invalid place');
  return npcs.filter(npc => npc.id !== player.id && !hasMet(state, world, player.id, npc.id)
    && whereIs(npc, time) === placeId).map(npc => ({ npc,
    score: interestIn(npc, player, player.reputation)
      + (npc.traits.includes('social') ? 2 : 0) - (npc.traits.includes('quiet') ? 1 : 0)
      + 2 * npc.likes.filter(topic => [placeId, ...placeTopics].includes(topic)).length
      - 2 * npc.dislikes.filter(topic => [placeId, ...placeTopics].includes(topic)).length,
  })).filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.npc.id.localeCompare(b.npc.id));
}
export function encounter(state: EncounterState, world: SocialWorld, player: PlayerProfile,
  npcs: readonly Npc[], placeId: string, time: GameTime, placeTopics: readonly string[] = []): Npc | null {
  const candidate = encounterCandidates(state, world, player, npcs, placeId, time, placeTopics)[0];
  if (!candidate) return null;
  recordMeeting(state, player.id, candidate.npc, time);
  return candidate.npc;
}
