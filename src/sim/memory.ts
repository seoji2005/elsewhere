import type { GameTime } from './clock';
import { validateTime } from './npc';
import type { Interaction } from './relationship';

export interface Memory {
  id: string; subjectId: string; topic: string; choiceId: string; kind: 'gift' | 'chat';
  created: number; lastAccessed: number; importance: number; change: number;
}
// One state per recipient NPC; keep it alongside relationship history when saving.
export interface MemoryState { npcId: string; entries: Memory[] }
export const MEMORY_LIMIT = 64;
export function createMemoryState(npcId: string): MemoryState {
  if (!npcId) throw Error('Invalid NPC');
  return { npcId, entries: [] };
}
export function minuteOf(time: GameTime): number {
  validateTime(time);
  const minute = (time.day - 1) * 1440 + time.hour * 60 + time.minute;
  if (!Number.isSafeInteger(minute)) throw Error('Time overflow');
  return minute;
}
// eventId identifies a committed interaction, not its reusable choice ID.
export function remember(state: MemoryState, eventId: string, entry: Interaction): boolean {
  const created = minuteOf(entry.time);
  if (!eventId || !entry.actorId || entry.npcId !== state.npcId ||
      !Number.isFinite(entry.change)) throw Error('Invalid memory');
  if (state.entries.some(memory => memory.id === eventId)) return false;
  const kind = entry.choice.id.startsWith('gift:') ? 'gift' : 'chat';
  state.entries.push({ id: eventId, subjectId: entry.actorId, topic: entry.choice.topic,
    choiceId: entry.choice.id, kind, created, lastAccessed: created, change: entry.change,
    importance: Math.min(10, 1 + (kind === 'gift' ? 3 : 0) + Math.abs(entry.change)) });
  if (state.entries.length > MEMORY_LIMIT) state.entries.splice(0, state.entries.length - MEMORY_LIMIT);
  return true;
}
export function recall(state: MemoryState, time: GameTime,
  query: { subjectId: string; topic?: string }, count = 3): Memory[] {
  const now = minuteOf(time);
  if (!Number.isInteger(count) || count < 0 || count > MEMORY_LIMIT) throw Error('Invalid count');
  const score = (memory: Memory) => 0.5 * Math.pow(0.5,
    Math.max(0, now - memory.lastAccessed) / 1440)
    + (query.topic === memory.topic ? 3 : 0) + 2 * memory.importance / 10;
  const result = state.entries.filter(memory => memory.subjectId === query.subjectId
    && memory.created <= now && now - memory.created < 14 * 1440)
    .sort((a, b) => score(b) - score(a) || b.created - a.created || a.id.localeCompare(b.id))
    .slice(0, count);
  for (const memory of result) memory.lastAccessed = Math.max(memory.lastAccessed, now);
  return result.map(memory => ({ ...memory }));
}
export function memoryLine(memory: Memory): string {
  return memory.kind === 'gift' ? `전에 준 ${memory.topic}, 기억하고 있어요.`
    : `지난번 ${memory.topic} 이야기가 생각났어요.`;
}
