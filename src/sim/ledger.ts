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
  history?: { retired?: Record<string, Record<string, string[]>>; ids: string[]; days: Record<string, Record<string, [number, number, number?, number?]>>;
    through?: number }; // C108: every dated ID (below) of this day or earlier counts as recorded
}
export type TransferResult = { ok: true; duplicate: boolean } | { ok: false; error: string };
const owns = (object: object, key: string) => Object.hasOwn(object, key);

export function createLedger(balances: Record<string, number> = {}): LedgerState {
  if (Object.values(balances).some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw Error('Invalid initial balance');
  }
  return { balances: { ...balances }, transactions: [] };
}

// Wage retries hit transfer every minute; index retired IDs by prefix. compactLedger is the only writer and resets it.
const retiredIndex = new WeakMap<object, Map<string, Set<string>>>();
function retiredSuffixes(retired: Record<string, Record<string, string[]>>): Map<string, Set<string>> {
  let index = retiredIndex.get(retired);
  if (!index) {
    index = new Map();
    for (const group of Object.values(retired)) for (const [prefix, suffixes] of Object.entries(group)) {
      const set = index.get(prefix) ?? new Set();
      for (const suffix of suffixes) set.add(suffix);
      index.set(prefix, set);
    }
    retiredIndex.set(retired, index);
  }
  return index;
}

// Same answer as transactions.find by id; the list is only appended to or replaced, so index the new tail.
const txIndex = new WeakMap<Transaction[], { size: number; ids: Map<string, Transaction> }>();
export function findTransaction(ledger: LedgerState, id: string): Transaction | undefined {
  const list = ledger.transactions;
  let index = txIndex.get(list);
  if (!index || index.size > list.length) txIndex.set(list, index = { size: 0, ids: new Map() });
  for (; index.size < list.length; index.size++) {
    const entry = list[index.size];
    if (!index.ids.has(entry.id)) index.ids.set(entry.id, entry);
  }
  return index.ids.get(id);
}

// C108: IDs that carry their own day and are only ever tried on that day (a visit's sale and supply, daily supply,
// the production bonus). Once their day is over 30 days old they are closed whether or not they were recorded.
const dated = [/^store-sale:\["[^"]*","(?:shop:lease:\d+|[\w-]+):(\d+):/, /^supply:[\w-]+:(\d+):/,
  /^daily-supply:[\w-]+:[\w-]+:(\d+):/, /^production:(\d+):/];
export function datedDay(id: string): number | null {
  for (const pattern of dated) { const match = pattern.exec(id); if (match) return Number(match[1]); }
  return null;
}
const closed = (ledger: LedgerState, id: string) => {
  const through = ledger.history?.through, day = through === undefined ? null : datedDay(id);
  return day !== null && day <= through!;
};

// True when transfer would report this ID as a duplicate.
export function isRecorded(ledger: LedgerState, id: string): boolean {
  const cut = id.lastIndexOf(':') + 1, prefix = id.slice(0, cut), suffix = id.slice(cut);
  return !!(ledger.history?.ids.includes(id) || closed(ledger, id) ||
      (ledger.history?.retired !== undefined && retiredSuffixes(ledger.history.retired).get(prefix)?.has(suffix)) ||
      findTransaction(ledger, id));
}

export function transfer(ledger: LedgerState, transaction: Transaction): TransferResult {
  if (isRecorded(ledger, transaction.id)) return { ok: true, duplicate: true };
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
// C108: past 30 days (beforeDay is 14 days back), dated IDs become one 'through' mark and daily totals merge into weeks.
export function compactLedger(ledger: LedgerState, beforeDay: number): void {
  const history = ledger.history ??= { ids: [], days: {} }, old = beforeDay - 17;
  if (old > (history.through ?? 0)) history.through = old;
  const retire = (id: string, day: number) => {
    if (id.startsWith('initial:')) { if (!history.ids.includes(id)) history.ids.push(id); return; }
    if (closed(ledger, id)) return;
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
  for (const [day, group] of Object.entries(history.retired ?? {})) { // older saves listed dated IDs one by one
    for (const [prefix, suffixes] of Object.entries(group)) {
      const open = suffixes.filter(suffix => !closed(ledger, prefix + suffix));
      if (open.length) group[prefix] = open; else delete group[prefix];
    }
    if (!Object.keys(group).length) delete history.retired![day];
  }
  for (const [key, accounts] of Object.entries(history.days)) {
    const day = Number(key), week = day - (day - 1) % 7; // days 1-7 → 1, 8-14 → 8, ...
    if (day > old || week === day) continue;
    const into = history.days[week] ??= {};
    for (const [id, totals] of Object.entries(accounts)) {
      const sum = into[id] ??= [0, 0];
      totals.forEach((n, i) => { sum[i] = (sum[i] ?? 0) + (n ?? 0); });
    }
    delete history.days[key];
  }
  if (history.retired) retiredIndex.delete(history.retired);
}
