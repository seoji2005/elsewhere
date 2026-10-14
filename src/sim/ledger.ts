import type { GameTime } from './clock';

export interface Transaction {
  id: string;
  time: GameTime;
  from: string;
  to: string;
  amount: number;
  reason: string;
}
export interface LedgerState {
  balances: Record<string, number>; transactions: Transaction[];
  history?: { retired?: Record<string, Record<string, string[]>>; ids: string[]; days: Record<string, Record<string, [number, number, number?, number?]>> };
}
export type TransferResult = { ok: true; duplicate: boolean } | { ok: false; error: string };
const owns = (object: object, key: string) => Object.hasOwn(object, key);

export function createLedger(balances: Record<string, number> = {}): LedgerState {
  if (Object.values(balances).some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw Error('Invalid initial balance');
  }
  return { balances: { ...balances }, transactions: [] };
}

export function transfer(ledger: LedgerState, transaction: Transaction): TransferResult {
  const cut = transaction.id.lastIndexOf(':') + 1, prefix = transaction.id.slice(0, cut), suffix = transaction.id.slice(cut);
  if (ledger.history?.ids.includes(transaction.id) ||
      Object.values(ledger.history?.retired ?? {}).some(group => group[prefix]?.includes(suffix)) ||
      ledger.transactions.some(entry => entry.id === transaction.id))
    return { ok: true, duplicate: true };
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

// Group exact IDs by original day and shared prefix; retry dates do not affect lookup.
export function compactLedger(ledger: LedgerState, beforeDay: number): void {
  const history = ledger.history ??= { ids: [], days: {} };
  const retire = (id: string, day: number) => {
    if (id.startsWith('initial:')) { if (!history.ids.includes(id)) history.ids.push(id); return; }
    const cut = id.lastIndexOf(':') + 1, group = (history.retired ??= {})[day] ??= {};
    const suffixes = group[id.slice(0, cut)] ??= [];
    if (!suffixes.includes(id.slice(cut))) suffixes.push(id.slice(cut));
  };
  const legacy = history.ids; history.ids = [];
  for (const id of legacy) retire(id, 1);
  ledger.transactions = ledger.transactions.filter(t => {
    if (t.time.day >= beforeDay) return true;
    retire(t.id, t.time.day);
    const day = history.days[t.time.day] ??= {};
    if (t.from !== t.to) {
      (day[t.from] ??= [0, 0])[1] += t.amount;
      (day[t.to] ??= [0, 0])[0] += t.amount;
      if (t.reason.startsWith('Wage: ') || t.reason.startsWith('Store purchase: ') || t.reason.startsWith('Purchase: '))
        for (const id of [t.from, t.to]) { day[id][2] ??= 0; day[id][3] ??= 0; }
      if (t.reason.startsWith('Wage: ')) day[t.to][2] = (day[t.to][2] ?? 0) + t.amount;
      if (t.reason.startsWith('Store purchase: ') || t.reason.startsWith('Purchase: '))
        day[t.from][3] = (day[t.from][3] ?? 0) + t.amount;
    }
    return false;
  });
}
