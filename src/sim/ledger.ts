import type { GameTime } from './clock';

export interface Transaction {
  id: string;
  time: GameTime;
  from: string;
  to: string;
  amount: number;
  reason: string;
}
export interface LedgerState { balances: Record<string, number>; transactions: Transaction[] }
export type TransferResult = { ok: true; duplicate: boolean } | { ok: false; error: string };
const owns = (object: object, key: string) => Object.hasOwn(object, key);

export function createLedger(balances: Record<string, number> = {}): LedgerState {
  if (Object.values(balances).some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw Error('Invalid initial balance');
  }
  return { balances: { ...balances }, transactions: [] };
}

export function transfer(ledger: LedgerState, transaction: Transaction): TransferResult {
  if (ledger.transactions.some(entry => entry.id === transaction.id)) return { ok: true, duplicate: true };
  const { id, from, to, amount, time } = transaction;
  if (!id || !Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: 'Invalid transaction' };
  if (!Number.isSafeInteger(time.day) || time.day < 1 || !Number.isInteger(time.hour) ||
      time.hour < 0 || time.hour > 23 || !Number.isInteger(time.minute) || time.minute < 0 || time.minute > 59) {
    return { ok: false, error: 'Invalid time' };
  }
  if (!owns(ledger.balances, from) || !owns(ledger.balances, to)) return { ok: false, error: 'Unknown account' };
  if (ledger.balances[from] < amount) return { ok: false, error: 'Insufficient funds' };
  if (from !== to && !Number.isSafeInteger(ledger.balances[to] + amount)) return { ok: false, error: 'Balance overflow' };
  ledger.balances[from] -= amount;
  ledger.balances[to] += amount;
  ledger.transactions.push({ ...transaction, time: { ...time } });
  return { ok: true, duplicate: false };
}
