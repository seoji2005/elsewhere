import type { Npc, Trait } from '../data/npcs';
import type { GameTime } from './clock';
import { minuteOf } from './memory';
import { whereIs } from './npc';
import { hasMet, interestIn, recordMeeting, validatePlayer,
  type EncounterState, type PlayerProfile, type SocialWorld } from './encounter';

// C021 can supply appearance variables without extending the shared Npc type.
export type Appearance = Readonly<Record<string, string | number>>;
export interface Appointment {
  id: string; actorId: string; introducerId: string; npcId: string;
  placeId: string; time: GameTime;
  impression: { name: string; appearance: Appearance; keywords: readonly Trait[] };
  playerInterest: number; npcInterest: number;
  status: 'offered' | 'scheduled' | 'declined' | 'rejected' | 'no-show' | 'met';
  noShowBy: string[];
}
export interface MatchmakingState { appointments: Appointment[] }
export function createMatchmakingState(): MatchmakingState { return { appointments: [] }; }
export interface MatchRequest {
  id: string; player: PlayerProfile; introducerId: string; npcs: readonly Npc[];
  now: GameTime; slot: { placeId: string; time: GameTime };
  appearances: Readonly<Record<string, Appearance>>;
}
// The caller proposes a place/time; only acquaintances whose schedule fits are introduced.
export function requestMatch(state: MatchmakingState, encounters: EncounterState,
  world: SocialWorld, request: MatchRequest): Appointment | null {
  const { player, introducerId, npcs, now, slot, appearances } = request;
  validatePlayer(player);
  if (!request.id || state.appointments.some(entry => entry.id === request.id)
    || !slot.placeId || minuteOf(slot.time) <= minuteOf(now)) throw Error('Invalid match request');
  if (introducerId === player.id || !npcs.some(npc => npc.id === introducerId)
    || (world.relationships[player.id]?.[introducerId] ?? 0) < 30) return null;
  const candidates = npcs.filter(npc => npc.id !== player.id && npc.id !== introducerId
    && (world.relationships[introducerId]?.[npc.id] ?? 0) >= 10
    && !hasMet(encounters, world, player.id, npc.id)
    && whereIs(npc, slot.time) === slot.placeId
    && !state.appointments.some(entry => entry.actorId === player.id && entry.npcId === npc.id
      && (entry.status === 'offered' || entry.status === 'scheduled'
        || entry.time.day === slot.time.day)))
    .map(npc => ({ npc, playerInterest: interestIn(player, npc),
      npcInterest: interestIn(npc, player, player.reputation) }))
    .filter(candidate => candidate.playerInterest >= 2)
    .sort((a, b) => b.playerInterest - a.playerInterest || a.npc.id.localeCompare(b.npc.id));
  const candidate = candidates[0];
  if (!candidate) return null;
  const { npc, playerInterest, npcInterest } = candidate;
  const appearance = appearances[npc.id];
  if (!appearance || !Object.keys(appearance).length) throw Error('Missing first impression appearance');
  const appointment: Appointment = { id: request.id, actorId: player.id, introducerId, npcId: npc.id,
    placeId: slot.placeId, time: { ...slot.time }, playerInterest, npcInterest,
    impression: { name: npc.name, appearance: { ...appearance }, keywords: [...npc.traits] },
    status: 'offered', noShowBy: [] };
  state.appointments.push(appointment);
  return appointment;
}
export function respondToMatch(appointment: Appointment, accept: boolean, now: GameTime): Appointment['status'] {
  if (appointment.status !== 'offered' || minuteOf(now) >= minuteOf(appointment.time)) {
    throw Error('Offer is no longer available');
  }
  appointment.status = !accept ? 'declined' : appointment.npcInterest >= 2 ? 'scheduled' : 'rejected';
  return appointment.status;
}
// Either participant may withdraw before the date without establishing a relationship.
export function cancelMatch(appointment: Appointment, personId: string): void {
  if (!['offered', 'scheduled'].includes(appointment.status)
    || ![appointment.actorId, appointment.npcId].includes(personId)) throw Error('Invalid cancellation');
  appointment.status = personId === appointment.actorId ? 'declined' : 'rejected';
}
// Attendance is actual presence from the caller, not a prediction from the original schedule.
export function resolveMatch(appointment: Appointment, encounters: EncounterState, npc: Npc,
  now: GameTime, presence: { playerPlaceId: string | null; npcPlaceId: string | null }): Appointment['status'] {
  const elapsed = minuteOf(now) - minuteOf(appointment.time);
  if (npc.id !== appointment.npcId || elapsed < 0) throw Error('Invalid appointment resolution');
  if (appointment.status !== 'scheduled' && appointment.status !== 'offered') return appointment.status;
  if (appointment.status === 'offered') return appointment.status = 'declined';
  // A date has a 60-minute arrival window. Unresolved dates expire without fabricating a meeting.
  const missing = [
    ...(presence.playerPlaceId === appointment.placeId ? [] : [appointment.actorId]),
    ...(presence.npcPlaceId === appointment.placeId ? [] : [appointment.npcId]),
  ];
  if (elapsed >= 60) {
    appointment.noShowBy = missing.length ? missing : [appointment.actorId, appointment.npcId];
    return appointment.status = 'no-show';
  }
  if (missing.length) return appointment.status;
  recordMeeting(encounters, appointment.actorId, npc, now);
  return appointment.status = 'met';
}
