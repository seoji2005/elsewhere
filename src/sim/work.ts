import { jobs } from '../data/jobs';
import type { GameTime } from './clock';
import { transfer, type LedgerState, type TransferResult } from './ledger';
import { validateTime } from './npc';

export interface Shift {
  id: string; actorId: string; jobId: string; employerId: string;
  startedAt: number; endsAt: number; wage: number; paid: boolean;
}
export interface WorkState { shifts: Shift[] }
export function createWorkState(): WorkState { return { shifts: [] }; }
function minutes(time: GameTime): number {
  validateTime(time);
  const value = (time.day - 1) * 1440 + time.hour * 60 + time.minute;
  if (!Number.isSafeInteger(value)) throw Error('Time overflow');
  return value;
}

export function startWork(state: WorkState, actorId: string, jobId: string,
  placeId: string, time: GameTime): Shift {
  const now = minutes(time);
  const job = jobs.find(entry => entry.id === jobId);
  if (!actorId || !job || actorId === job.employerId) throw Error('Invalid worker or job');
  if (job.placeId !== placeId) throw Error('Wrong workplace');
  const localMinute = time.hour * 60 + time.minute;
  if (localMinute < job.fromMinute || localMinute + job.durationMinutes > job.toMinute) {
    throw Error('Outside work hours');
  }
  if (state.shifts.some(shift => shift.actorId === actorId && shift.endsAt > now)) {
    throw Error('Overlapping shift');
  }
  const shift: Shift = { id: `work:${JSON.stringify([actorId, jobId, now])}`, actorId,
    jobId, employerId: job.employerId, startedAt: now, endsAt: now + job.durationMinutes,
    wage: job.hourlyWage * job.durationMinutes / 60, paid: false };
  state.shifts.push(shift);
  return shift;
}

export function finishWork(state: WorkState, ledger: LedgerState, shiftId: string,
  time: GameTime): TransferResult {
  const now = minutes(time);
  const shift = state.shifts.find(entry => entry.id === shiftId);
  if (!shift) return { ok: false, error: 'Unknown shift' };
  if (now < shift.endsAt) return { ok: false, error: 'Shift still in progress' };
  if (shift.paid) return { ok: true, duplicate: true };
  const result = transfer(ledger, { id: shift.id, time, from: shift.employerId,
    to: shift.actorId, amount: shift.wage, reason: `Wage: ${shift.jobId}` });
  if (result.ok) shift.paid = true;
  return result;
}
