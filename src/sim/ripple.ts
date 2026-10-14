import { applyBondEvent, datingPair, friendly, readBond, type Bonds } from './bonds';
import type { GameTime } from './clock';
import type { DialogueState } from './dialogue';
import { minuteOf } from './memory';
import type { WorldState } from './world';

export interface SocialEvent {
  id: string; actorId: string; targetId: string; time: GameTime;
  placeId: string; topic: string; kind: 'help' | 'hurt' | 'dating';
}
export interface Notice {
  eventId: string; observerId: string; sourceId: string; created: number; learned: number;
  hops: number; mode: 'witness' | 'rumor'; kind: SocialEvent['kind'];
  actorId: string; targetId: string; topic: string;
}
export interface RippleState { notices: Notice[] }
export const createRippleState = (): RippleState => ({ notices: [] });
const lifetime = 14 * 1440;

// Supply an immutable, committed public event and actual people positions at `now`.
export function deliverRipple(state: RippleState, bonds: Bonds, world: Pick<WorldState, 'people'>,
  dating: Pick<DialogueState, 'dating'>, event: SocialEvent, observerId: string,
  now: GameTime, sourceId?: string): Notice | null {
  const at = minuteOf(now), created = minuteOf(event.time);
  if (!event.id || !event.placeId || !event.topic || !event.actorId || !event.targetId
    || event.actorId === event.targetId || !['help', 'hurt', 'dating'].includes(event.kind)) {
    throw Error('Invalid social event');
  }
  const receipt = JSON.stringify(['ripple', event.id, observerId]);
  const person = world.people[observerId];
  if (at < created || at - created >= lifetime || !person || person.role !== 'npc'
    || [event.actorId, event.targetId].includes(observerId) || bonds.applied.includes(receipt)
    || state.notices.some(n => n.eventId === event.id && n.observerId === observerId)) return null;
  let hops = 0;
  if (sourceId === undefined) {
    if (at !== created || [observerId, event.actorId, event.targetId]
      .some(id => world.people[id]?.placeId !== event.placeId)) return null;
  } else {
    const source = state.notices.find(n => n.eventId === event.id && n.observerId === sourceId);
    if (!source || sourceId === observerId || at < source.learned + 60 || source.hops >= 2
      || !person.placeId || world.people[sourceId]?.placeId !== person.placeId
      || readBond(bonds, observerId, sourceId).trust < 15) return null;
    hops = source.hops + 1;
  }
  if (event.kind === 'dating' && !datingPair(dating, event.actorId, event.targetId)) return null;
  const affected = friendly(readBond(bonds, observerId, event.targetId))
    || datingPair(dating, observerId, event.targetId);
  const strength = (event.kind === 'help' ? 1 : -1) * 0.5 ** hops;
  if (!applyBondEvent(bonds, receipt, now, event.kind !== 'dating' && affected
    ? [{ fromId: observerId, toId: event.actorId, delta: { affection: strength, trust: strength } }]
    : [])) return null;
  const notice: Notice = { eventId: event.id, observerId, sourceId: sourceId ?? observerId,
    created, learned: at, hops, mode: sourceId === undefined ? 'witness' : 'rumor',
    kind: event.kind, actorId: event.actorId, targetId: event.targetId, topic: event.topic };
  state.notices.push(notice);
  return { ...notice };
}

export function noticeLine(npcId: string, state: RippleState, now: GameTime,
  names: Record<string, string> = {}): string | null {
  const at = minuteOf(now);
  const notice = state.notices.find(n => n.observerId === npcId && n.learned <= at
    && at - n.created < lifetime);
  if (!notice) return null;
  const a = names[notice.actorId] ?? notice.actorId, b = names[notice.targetId] ?? notice.targetId;
  if (notice.kind === 'dating') return notice.mode === 'rumor'
    ? `${a} 님과 ${b} 님이 사귄다고 들었어요.` : `${a} 님과 ${b} 님이 교제를 시작하는 걸 봤어요.`;
  return notice.mode === 'rumor' ? `${a} 님과 ${b} 님의 ${notice.topic} 이야기를 들었어요.`
    : `${a} 님과 ${b} 님의 ${notice.topic}, 저도 봤어요.`;
}
