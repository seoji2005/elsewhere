import { initialStock, type Stock } from '../data/stock';
import type { GameTime } from './clock';
import { decide, stillWaiting, type Complaint, type Need } from './customer';
import { transfer, type LedgerState, type TransferResult } from './ledger';
import { validateTime } from './npc';

export interface Visit {
  id: string; actorId: string; need: Need; joinedMinute: number; patienceMinutes: number;
  price: number; status: 'waiting' | 'paid' | 'left';
}
export interface StoreEvent {
  visitId: string; actorId: string; itemId: string; time: GameTime;
  reason: 'purchased' | Complaint; amount: number;
}
export interface StoreState { accountId: string; stock: Stock[]; visits: Visit[]; events: StoreEvent[] }
const natural = (n: number) => Number.isSafeInteger(n) && n >= 0;
function minutes(time: GameTime): number {
  validateTime(time);
  const value = (time.day - 1) * 1440 + time.hour * 60 + time.minute;
  if (!natural(value)) throw Error('Time overflow');
  return value;
}
function validateStock(stock: Stock): void {
  if (!stock.itemId || ![stock.backroom, stock.displayed, stock.capacity, stock.price].every(natural) ||
      stock.price === 0 || stock.displayed > stock.capacity ||
      !Number.isSafeInteger(stock.backroom + stock.displayed)) throw Error('Invalid stock');
}
export function createStore(accountId: string, stock: readonly Stock[] = initialStock): StoreState {
  if (!accountId || new Set(stock.map(s => s.itemId)).size !== stock.length) throw Error('Invalid store');
  stock.forEach(validateStock);
  return { accountId, stock: stock.map(s => ({ ...s })), visits: [], events: [] };
}
function shelf(store: StoreState, itemId: string): Stock | undefined {
  const stock = store.stock.find(s => s.itemId === itemId);
  if (stock) validateStock(stock);
  return stock;
}
export function restock(store: StoreState, itemId: string, requested: number): number {
  const stock = shelf(store, itemId);
  if (!stock || !natural(requested)) throw Error('Invalid restock');
  const moved = Math.min(requested, stock.backroom, stock.capacity - stock.displayed);
  stock.backroom -= moved;
  stock.displayed += moved;
  return moved;
}
export function setPrice(store: StoreState, itemId: string, price: number): void {
  const stock = shelf(store, itemId);
  if (!stock || !natural(price) || price === 0) throw Error('Invalid price');
  stock.price = price;
}
export function available(store: StoreState, itemId: string): number {
  const stock = shelf(store, itemId);
  const held = store.visits.filter(v => v.need.itemId === itemId && v.status === 'waiting').length;
  if (held > (stock?.displayed ?? 0)) throw Error('Lost reserved stock');
  return (stock?.displayed ?? 0) - held;
}
function record(store: StoreState, visit: Visit, time: GameTime, reason: StoreEvent['reason']): void {
  store.events.push({ visitId: visit.id, actorId: visit.actorId, itemId: visit.need.itemId,
    time: { ...time }, reason, amount: reason === 'purchased' ? visit.price : 0 });
}
export function visitStore(store: StoreState, ledger: LedgerState, id: string, actorId: string,
  need: Need, patienceMinutes: number, time: GameTime): Visit {
  const now = minutes(time);
  if (!id || !actorId || actorId === store.accountId || !natural(patienceMinutes) ||
      !Object.hasOwn(ledger.balances, actorId) || !Object.hasOwn(ledger.balances, store.accountId)) {
    throw Error('Invalid visit accounts or patience');
  }
  const prior = store.visits.find(v => v.id === id);
  if (prior) {
    if (prior.actorId !== actorId || prior.need.itemId !== need.itemId ||
        prior.need.maxPrice !== need.maxPrice || prior.patienceMinutes !== patienceMinutes) {
      throw Error('Visit ID conflict');
    }
    return prior;
  }
  expireVisits(store, time);
  const stock = shelf(store, need.itemId);
  const decision = decide(need, stock && { itemId: stock.itemId, price: stock.price,
    available: available(store, need.itemId) }, ledger.balances[actorId]);
  const visit: Visit = { id, actorId, need: { ...need }, joinedMinute: now, patienceMinutes,
    price: stock?.price ?? 0, status: decision === 'buy' ? 'waiting' : 'left' };
  store.visits.push(visit);
  if (decision !== 'buy') record(store, visit, time, decision);
  return visit;
}
// Call on simulation ticks; expiry releases stock even without a checkout attempt.
export function expireVisits(store: StoreState, time: GameTime): void {
  const now = minutes(time);
  for (const visit of store.visits) {
    if (visit.status === 'waiting' && !stillWaiting(visit.joinedMinute, visit.patienceMinutes, now)) {
      visit.status = 'left';
      record(store, visit, time, 'impatient');
    }
  }
}
export function checkout(store: StoreState, ledger: LedgerState, visitId: string,
  time: GameTime): TransferResult {
  expireVisits(store, time);
  const visit = store.visits.find(v => v.id === visitId);
  if (!visit || visit.status === 'left') return { ok: false, error: 'Visit unavailable' };
  if (visit.status === 'paid') return { ok: true, duplicate: true };
  if (store.visits.find(v => v.status === 'waiting') !== visit) return { ok: false, error: 'Not queue head' };
  const stock = shelf(store, visit.need.itemId);
  available(store, visit.need.itemId);
  if (!stock) throw Error('Lost reserved stock');
  const id = `store-sale:${JSON.stringify([store.accountId, visit.id])}`;
  const reason = `Store purchase: ${visit.need.itemId}`;
  const previous = ledger.transactions.find(t => t.id === id);
  if (previous && (previous.from !== visit.actorId || previous.to !== store.accountId ||
      previous.amount !== visit.price || previous.reason !== reason)) return { ok: false, error: 'Sale ID conflict' };
  const result = transfer(ledger, { id, from: visit.actorId, to: store.accountId,
    amount: visit.price, time, reason });
  if (result.ok) {
    stock.displayed--;
    visit.status = 'paid';
    record(store, visit, time, 'purchased');
  }
  return result;
}
export function dailySummary(store: StoreState, day: number) {
  if (!Number.isSafeInteger(day) || day < 1) throw Error('Invalid day');
  const events = store.events.filter(e => e.time.day === day);
  const complaints: Record<Complaint, number> = { missing: 0, expensive: 0, unaffordable: 0, impatient: 0 };
  for (const event of events) if (event.reason !== 'purchased') complaints[event.reason]++;
  return { day, visits: store.visits.filter(v => Math.floor(v.joinedMinute / 1440) + 1 === day).length,
    sales: events.filter(e => e.reason === 'purchased').length,
    revenue: events.reduce((sum, e) => sum + e.amount, 0), complaints };
}
