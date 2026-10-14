// Independent design: Neighborly @ 1303cee0 (MIT) has employment, not cash accounting.
// No upstream code copied. See R015/report.md and research/PROVENANCE.md.
import type { GameTime } from './clock';
import type { Person, WorldState } from './world';
import { transfer, type LedgerState, type Transaction, type TransferResult } from './ledger';
import { validateTime } from './npc';

export interface Purse { personId: Person['id']; reserve: number }
export type People = WorldState['people'];
const natural = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function personAccount(people: People, ledger: LedgerState, id: string): boolean {
  return Object.hasOwn(people, id) && people[id].id === id &&
    (people[id].role === 'npc' || people[id].role === 'player') &&
    Object.hasOwn(ledger.balances, id) && natural(ledger.balances[id]);
}
// Accounts must be funded once during world creation, never when creating a purse.
export function createPurse(people: People, ledger: LedgerState, personId: string, reserve = 0): Purse {
  if (!personAccount(people, ledger, personId) || !natural(reserve)) throw Error('Invalid purse');
  return { personId, reserve };
}
// Savings is earmarked existing cash, not a second balance or interest source.
export function funds(ledger: LedgerState, purse: Purse) {
  if (!Object.hasOwn(ledger.balances, purse.personId) || !natural(ledger.balances[purse.personId]) ||
      !natural(purse.reserve)) throw Error('Invalid purse');
  const cash = ledger.balances[purse.personId], savings = Math.min(cash, purse.reserve);
  return { cash, savings, spendable: cash - savings };
}
// Exact economic payload must match on retry; original payment time is retained.
export function payPerson(people: People, ledger: LedgerState, tx: Transaction): TransferResult {
  validateTime(tx.time);
  if (tx.from === tx.to || !personAccount(people, ledger, tx.from) ||
      !personAccount(people, ledger, tx.to)) return { ok: false, error: 'Person accounts required' };
  const prior = ledger.transactions.find(t => t.id === tx.id);
  if (prior && (prior.from !== tx.from || prior.to !== tx.to || prior.amount !== tx.amount ||
      prior.reason !== tx.reason)) return { ok: false, error: 'Payment ID conflict' };
  return transfer(ledger, tx);
}
export function dayCashflow(ledger: LedgerState, purse: Purse, day: GameTime['day']) {
  if (!Number.isSafeInteger(day) || day < 1) throw Error('Invalid day');
  let income = 0, expense = 0, wages = 0, consumption = 0;
  for (const t of ledger.transactions) {
    if (t.time.day !== day || t.from === t.to) continue;
    if (t.to === purse.personId) { income += t.amount; if (t.reason.startsWith('Wage: ')) wages += t.amount; }
    if (t.from === purse.personId) {
      expense += t.amount;
      if (t.reason.startsWith('Store purchase: ') || t.reason.startsWith('Purchase: ')) consumption += t.amount;
    }
  }
  if (![income, expense, wages, consumption].every(natural)) throw Error('Daily totals overflow');
  return { day, income, expense, wages, consumption, net: income - expense };
}
