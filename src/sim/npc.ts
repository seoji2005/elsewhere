import type { Npc } from '../data/npcs';
import type { GameTime } from './clock';

export function validateTime(time: GameTime): void {
  if (!Number.isSafeInteger(time.day) || time.day < 1 ||
      !Number.isInteger(time.hour) || time.hour < 0 || time.hour > 23 ||
      !Number.isInteger(time.minute) || time.minute < 0 || time.minute > 59) {
    throw Error('Invalid game time');
  }
}

export function whereIs(npc: Npc, time: GameTime): string {
  validateTime(time);
  const slots = npc.schedule[(time.day - 1) % 7];
  const minute = time.hour * 60 + time.minute;
  if (!slots?.length || slots[0].fromMinute !== 0) throw Error('Missing midnight schedule');
  let place = slots[0].placeId;
  for (const slot of slots) {
    if (slot.fromMinute > minute) break;
    place = slot.placeId;
  }
  return place;
}
