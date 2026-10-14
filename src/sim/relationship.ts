import type { Npc, Trait } from '../data/npcs';
import type { GameTime } from './clock';
import type { WorldState } from './world';
import { validateTime } from './npc';

export const relationshipStages = [
  { name: '낯섦', threshold: 0 },
  { name: '아는 사이', threshold: 10 },
  { name: '친구', threshold: 30 },
  { name: '호감', threshold: 60 },
  { name: '연인 첫 단계', threshold: 90 },
] as const;
export const DAILY_GAIN_LIMIT = 10;
export interface DialogueChoice { id: string; topic: string; tone: Trait }
export interface Interaction {
  actorId: string;
  npcId: string;
  time: GameTime;
  choice: DialogueChoice;
  requestedChange: number;
  change: number;
  value: number;
}
export interface RelationshipState { interactions: Interaction[] }
export function createRelationshipState(): RelationshipState { return { interactions: [] }; }

export function relationshipStage(value: number): typeof relationshipStages[number]['name'] {
  if (!Number.isFinite(value)) throw Error('Invalid relationship value');
  let stage: typeof relationshipStages[number]['name'] = relationshipStages[0].name;
  for (const entry of relationshipStages) if (value >= entry.threshold) stage = entry.name;
  return stage;
}

export function dialogueReaction(npc: Npc, choice: DialogueChoice): number {
  return 1 + (npc.traits.includes(choice.tone) ? 2 : -1)
    + (npc.likes.includes(choice.topic) ? 4 : 0)
    - (npc.dislikes.includes(choice.topic) ? 5 : 0);
}

// The world owns directional numeric values; keep this log alongside it when saving.
export function interact(world: Pick<WorldState, 'relationships'>, state: RelationshipState,
  actorId: string, npc: Npc, time: GameTime, choice: DialogueChoice): Interaction {
  validateTime(time);
  if (!actorId || actorId === npc.id || !choice.id) throw Error('Invalid interaction');
  const previous = world.relationships[actorId]?.[npc.id] ?? 0;
  if (!Number.isFinite(previous)) throw Error('Invalid relationship value');
  const gained = state.interactions.reduce((sum, entry) =>
    entry.actorId === actorId && entry.npcId === npc.id && entry.time.day === time.day
      ? sum + Math.max(0, entry.change) : sum, 0);
  const requestedChange = dialogueReaction(npc, choice);
  const change = requestedChange > 0
    ? Math.min(requestedChange, Math.max(0, DAILY_GAIN_LIMIT - gained)) : requestedChange;
  const value = previous + change;
  const entry = { actorId, npcId: npc.id, time: { ...time }, choice: { ...choice },
    requestedChange, change, value };
  world.relationships[actorId] ??= {};
  world.relationships[actorId][npc.id] = value;
  state.interactions.push(entry);
  return entry;
}
