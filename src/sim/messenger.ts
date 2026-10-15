import { places } from '../data/places';
import type { Npc } from '../data/npcs';
import type { GameTime } from './clock';
import { minuteOf } from './memory';
import { whereIs } from './npc';

export type MessageKind = 'hello' | 'topic' | 'meet';
export interface Message {
  id: string; npcId: string; from: 'player' | 'npc'; kind: MessageKind; stage: string;
  at: number; text: string; delivered: boolean; // a reply is written and shown once its minute arrives
}
export interface MessengerState { messages: Message[] }
export const createMessengerState = (): MessengerState => ({ messages: [] });
export const DAILY_LIMIT = 3; // messages to one resident per game day
const homes = ['nest', 'quiet', 'high'];
// Closer residents answer sooner (minutes) and more casually.
const delays: Record<string, number> = { 낯섦: 180, '아는 사이': 60, 친구: 10, 호감: 5, '연인 첫 단계': 2 };
const replies: Record<string, { hello: string; topic: string; no: string; yes?: string }> = {
  낯섦: { hello: '네, 안녕하세요. 연락 주셔서 감사합니다.', topic: '{topic} 말씀이시군요. 다음에 들려주세요.',
    no: '죄송하지만 아직은 만나기 어렵습니다.' },
  '아는 사이': { hello: '안녕하세요! 저는 잘 지내요.', topic: '{topic} 이야기라니 반가워요.', no: '조금 더 친해지면 만나요.' },
  친구: { hello: '응, 잘 지내! 너는?', topic: '{topic}? 좋지, 할 얘기 많아.', yes: '좋아! {when}에 {place}에서 봐.',
    no: '이번엔 어렵겠어. 다음에 보자.' },
  호감: { hello: '마침 네 생각 하고 있었어.', topic: '{topic} 얘기면 밤새 할 수 있어 :)', yes: '{when}, {place}! 벌써 기다려져.',
    no: '아쉽다… 다음엔 꼭 보자.' },
  '연인 첫 단계': { hello: '보고 싶었어. 오늘 어땠어?', topic: '{topic} 얘기 해 줘, 다 듣고 싶어.',
    yes: '{when}, {place}에서 만나. 일찍 갈게.', no: '오늘은 안 돼서 속상해… 곧 보자.' },
};
export const timeOf = (minute: number): GameTime =>
  ({ day: Math.floor(minute / 1440) + 1, hour: Math.floor(minute % 1440 / 60), minute: minute % 60 });
export const asleep = (npc: Npc, minute: number) => {
  const time = timeOf(minute);
  return (time.hour >= 23 || time.hour < 7) && homes.includes(whereIs(npc, time));
};
export const sentToday = (state: MessengerState, npcId: string, minute: number) => state.messages.filter(m =>
  m.npcId === npcId && m.from === 'player' && Math.floor(m.at / 1440) === Math.floor(minute / 1440)).length;
export const waiting = (state: MessengerState, npcId: string) => state.messages.find(m => m.npcId === npcId && !m.delivered);
export const due = (state: MessengerState, minute: number) => state.messages.filter(m => !m.delivered && m.at <= minute);

// One message at a time; a sleeping resident reads it at 07:00 and answers after their usual pause.
export function send(state: MessengerState, npc: Npc, kind: MessageKind, stage: string, now: GameTime, id: string) {
  const minute = minuteOf(now);
  if (!id || sentToday(state, npc.id, minute) >= DAILY_LIMIT || waiting(state, npc.id)) return false;
  const read = asleep(npc, minute) ? Math.floor((minute + 60) / 1440) * 1440 + 420 : minute;
  const text = { hello: '잘 지내요?', topic: `${npc.likes[0] ?? '요즘'} 이야기 하고 싶어요`, meet: '우리 만날래요?' }[kind];
  state.messages.push({ id, npcId: npc.id, from: 'player', kind, stage, at: minute, text, delivered: true },
    { id: `${id}:reply`, npcId: npc.id, from: 'npc', kind, stage, at: read + (delays[stage] ?? 60), text: '', delivered: false });
  return true;
}
// The first hour, 2–26 hours ahead, when the resident is out at a public place between 09 and 21.
export function meetSlot(npc: Npc, minute: number) {
  for (let hour = Math.ceil(minute / 60) + 2; hour <= Math.ceil(minute / 60) + 26; hour++) {
    const time = timeOf(hour * 60), placeId = whereIs(npc, time);
    if (time.hour >= 9 && time.hour <= 21 && !homes.includes(placeId) && places.some(p => p.id === placeId)) return { placeId, time };
  }
}
export function replyLine(npc: Npc, reply: Message, slot?: { placeId: string; time: GameTime }) {
  const tone = replies[reply.stage] ?? replies['아는 사이'];
  const line = reply.kind !== 'meet' ? tone[reply.kind] : slot ? tone.yes ?? tone.no : tone.no;
  return line.replace('{topic}', npc.likes[0] ?? '요즘').replace('{place}', places.find(p => p.id === slot?.placeId)?.name ?? '')
    .replace('{when}', slot ? `${slot.time.day > timeOf(reply.at).day ? '내일' : '오늘'} ${slot.time.hour}시` : '');
}
