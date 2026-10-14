// Independent TS design inspired by Neighborly Business/Occupation and LeaveJob/BusinessClosedEvent.
// Neighborly @ 1303cee0, MIT; no upstream code copied. Cash rules are new (see report).
import type { Job } from '../data/jobs';
import type { Npc } from '../data/npcs';
import type { Stock } from '../data/stock';
import type { GameTime } from './clock';
import type { LedgerState, TransferResult } from './ledger';
import type { Shift, WorkState } from './work';
import { validateTime } from './npc';
import { createStore, checkout, dailySummary, type StoreState } from './store';
import { funds, payPerson, personAccount, type People, type Purse } from './purse';

export interface Business {
  id: string; ownerId: string; placeId: string; capacity: number; openedAt: number;
  closedAt: number | null; store: StoreState;
}
export interface Employment {
  actorId: string; businessId: string; job: Job; hiredAt: number; leftAt: number | null;
}
export interface BusinessBook { businesses: Business[]; employment: Employment[] }
const natural = (n: number) => Number.isSafeInteger(n) && n >= 0;
function minute(time: GameTime): number {
  validateTime(time);
  const n = (time.day - 1) * 1440 + time.hour * 60 + time.minute;
  if (!natural(n)) throw Error('Time overflow');
  return n;
}
function business(book: BusinessBook, id: string): Business {
  const found = book.businesses.find(b => b.id === id);
  if (!found) throw Error('Unknown business');
  return found;
}
function occupied(book: BusinessBook, actorId: string): boolean {
  return book.employment.some(e => e.actorId === actorId && e.leftAt === null) ||
    book.businesses.some(b => b.ownerId === actorId && b.closedAt === null);
}
export function openBusiness(book: BusinessBook, people: People, ledger: LedgerState,
  id: string, ownerId: string, placeId: string, capacity: number, stock: readonly Stock[], time: GameTime): Business {
  const openedAt = minute(time);
  if (!id || !placeId || !natural(capacity) || book.businesses.some(b => b.id === id) ||
      occupied(book, ownerId) || !personAccount(people, ledger, ownerId)) throw Error('Invalid opening');
  // Explicit already-owned inventory; no free restock or opening money is generated here.
  const b: Business = { id, ownerId, placeId, capacity, openedAt, closedAt: null, store: createStore(ownerId, stock) };
  book.businesses.push(b);
  return b;
}
export function hire(book: BusinessBook, people: People, ledger: LedgerState,
  businessId: string, actorId: string, job: Job, time: GameTime): Employment {
  const b = business(book, businessId), hiredAt = minute(time);
  const wage = job.hourlyWage * job.durationMinutes / 60;
  if (b.closedAt !== null || hiredAt < b.openedAt || occupied(book, actorId) ||
      !personAccount(people, ledger, actorId) || !job.id || job.placeId !== b.placeId ||
      ![job.fromMinute, job.toMinute, job.durationMinutes, job.hourlyWage, wage].every(natural) ||
      job.durationMinutes === 0 || wage === 0 || job.fromMinute >= job.toMinute || job.toMinute > 1440 ||
      job.durationMinutes > job.toMinute - job.fromMinute ||
      book.employment.filter(e => e.businessId === b.id && e.leftAt === null).length >= b.capacity) {
    throw Error('Invalid employment');
  }
  const e: Employment = { actorId, businessId, job: { ...job, employerId: b.ownerId }, hiredAt, leftAt: null };
  book.employment.push(e);
  return e;
}
// Dynamic counterpart of our sim/work.startWork; caller supplies the actor's actual place.
export function startEmployeeShift(book: BusinessBook, work: WorkState,
  actorId: string, placeId: string, time: GameTime): Shift {
  const now = minute(time), local = now % 1440;
  const e = book.employment.find(x => x.actorId === actorId && x.leftAt === null);
  if (!e) throw Error('Not employed');
  const b = business(book, e.businessId), job = e.job;
  if (b.closedAt !== null || now < e.hiredAt || placeId !== b.placeId ||
      local < job.fromMinute || local + job.durationMinutes > job.toMinute ||
      work.shifts.some(s => s.actorId === actorId && (!s.paid || s.endsAt > now))) throw Error('Shift unavailable');
  const shift: Shift = { id: `work:${JSON.stringify([actorId, job.id, now])}`, actorId,
    jobId: job.id, employerId: b.ownerId, startedAt: now, endsAt: now + job.durationMinutes,
    wage: job.hourlyWage * job.durationMinutes / 60, paid: false };
  if (!natural(shift.endsAt)) throw Error('Time overflow');
  work.shifts.push(shift);
  return shift;
}
// Pass a stored Shift, after completion. Keep unpaid shifts after dismissal/closure.
export function payCompletedShift(book: BusinessBook, people: People, ledger: LedgerState,
  businessId: string, shift: Shift, time: GameTime): TransferResult {
  const b = business(book, businessId), now = minute(time);
  const e = book.employment.find(x => x.businessId === b.id && x.actorId === shift.actorId &&
    x.job.id === shift.jobId && x.hiredAt <= shift.startedAt && (x.leftAt === null || shift.startedAt < x.leftAt));
  if (!e || shift.id !== `work:${JSON.stringify([shift.actorId, shift.jobId, shift.startedAt])}` ||
      ![shift.startedAt, shift.endsAt].every(natural) || now < shift.endsAt ||
      shift.employerId !== b.ownerId || shift.endsAt - shift.startedAt !== e.job.durationMinutes ||
      shift.startedAt % 1440 < e.job.fromMinute ||
      shift.startedAt % 1440 + e.job.durationMinutes > e.job.toMinute ||
      shift.wage !== e.job.hourlyWage * e.job.durationMinutes / 60) return { ok: false, error: 'Invalid shift' };
  const result = payPerson(people, ledger, { id: shift.id, from: b.ownerId, to: shift.actorId,
    amount: shift.wage, time, reason: `Wage: ${shift.jobId}` });
  if (result.ok) shift.paid = true;
  return result;
}
// visitStore reserves goods first; this adapter enforces personal wallets and savings at payment.
export function checkoutBusiness(book: BusinessBook, people: People, ledger: LedgerState,
  businessId: string, purse: Purse, visitId: string, time: GameTime): TransferResult {
  const b = business(book, businessId), now = minute(time), visit = b.store.visits.find(v => v.id === visitId);
  if (!visit || visit.actorId !== purse.personId || purse.personId === b.ownerId ||
      b.store.accountId !== b.ownerId || !personAccount(people, ledger, purse.personId) ||
      !personAccount(people, ledger, b.ownerId)) return { ok: false, error: 'Invalid customer' };
  if (visit.status === 'paid') return { ok: true, duplicate: true };
  if (b.closedAt !== null || now < b.openedAt) return { ok: false, error: 'Business closed' };
  if (funds(ledger, purse).spendable < visit.price) return { ok: false, error: 'Savings reserved' };
  return checkout(b.store, ledger, visitId, time);
}
export const producerJobs: Readonly<Record<string, string>> = {
  tea: '잔향 차 배합사', scarf: '공유물 순환지기', soup: '떠오름 뜰 돌봄사',
};
// Goods are produced on a paid order; retries never manufacture a second batch.
export function procure(book: BusinessBook, people: People, ledger: LedgerState, businessId: string,
  producer: Pick<Npc, 'id' | 'job'>, itemId: string, quantity: number, unitCost: number,
  orderId: string, time: GameTime): TransferResult {
  const b = business(book, businessId), stock = b.store.stock.find(s => s.itemId === itemId);
  if (!stock || b.closedAt !== null || minute(time) < b.openedAt || producer.job !== producerJobs[itemId] ||
      !natural(quantity) || quantity === 0 || !natural(unitCost) || unitCost === 0 ||
      !natural(quantity * unitCost) || !natural(stock.backroom + stock.displayed + quantity))
    return { ok: false, error: 'Invalid procurement' };
  const result = payPerson(people, ledger, { id: orderId, from: b.ownerId, to: producer.id,
    amount: quantity * unitCost, time, reason: `Procurement: ${b.id}:${itemId}:${quantity}:${unitCost}` });
  if (result.ok && !result.duplicate) stock.backroom += quantity;
  return result;
}
// No first-day growth fiction. Signed fraction for recordNpcRevenue, never a cash deposit.
export function revenueChange(b: Business, day: number): number {
  const today = dailySummary(b.store, day).revenue;
  if (day <= 1) return 0;
  const previous = dailySummary(b.store, day - 1).revenue;
  return previous === 0 ? 0 : Math.max(-1, Math.min(1, (today - previous) / previous));
}
