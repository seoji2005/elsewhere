import type { GameTime } from './clock';
import { transfer, type LedgerState, type TransferResult } from './ledger';

// FNV-1a 32-bit over the joined inputs, then a splitmix32-style finalizer.
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

function mix(seed: number): number {
  let z = (seed + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** Same inputs always give the same value in [0, 1), independent of call order or tick size. */
export function roll(seed: string | number, system: string, entityId: string, index: number): number {
  return mix(hash(`${seed}\u0000${system}\u0000${entityId}\u0000${index}`)) / 2 ** 32;
}

export function pick<T>(list: readonly T[], r: number): T {
  if (!list.length) throw Error('Empty list');
  return list[Math.min(list.length - 1, Math.floor(r * list.length))];
}

export function weighted<T>(entries: readonly (readonly [T, number])[], r: number): T {
  const total = entries.reduce((sum, [, weight]) => sum + Math.max(0, weight), 0);
  if (!(total > 0)) throw Error('No positive weight');
  let target = r * total;
  for (const [value, weight] of entries) if (weight > 0) { if (target < weight) return value; target -= weight; }
  return entries.filter(([, weight]) => weight > 0).at(-1)![0];
}

/** Integer in [min, max] inclusive. */
export function between(min: number, max: number, r: number): number {
  return min + Math.min(max - min, Math.floor(r * (max - min + 1)));
}

export interface Leg { from: string; to: string; amount: number; reason: string }

function retired(ledger: LedgerState, id: string): boolean {
  const cut = id.lastIndexOf(':') + 1, prefix = id.slice(0, cut), suffix = id.slice(cut);
  return !!ledger.history?.ids.includes(id) ||
    Object.values(ledger.history?.retired ?? {}).some(group => group[prefix]?.includes(suffix));
}

/** Applies every leg or none. Re-running the same batch is a no-op; reusing its id with other content is rejected. */
export function settle(ledger: LedgerState, batchId: string, legs: readonly Leg[], time: GameTime): TransferResult {
  if (!batchId || !legs.length) return { ok: false, error: 'Invalid batch' };
  const ids = legs.map((_, i) => `${batchId}:${i}`);
  const existing = ids.map(id => ledger.transactions.find(entry => entry.id === id));
  if (existing.some(Boolean) || retired(ledger, ids[0])) {
    // Compacted legs can only be matched by id; live legs are compared field by field.
    const same = !ledger.transactions.some(entry => entry.id === `${batchId}:${legs.length}`) &&
      existing.every((entry, i) => entry ? entry.from === legs[i].from && entry.to === legs[i].to &&
        entry.amount === legs[i].amount : retired(ledger, ids[i]));
    return same ? { ok: true, duplicate: true } : { ok: false, error: 'Batch conflict' };
  }
  const shadow: LedgerState = { balances: { ...ledger.balances }, transactions: [] };
  for (let i = 0; i < legs.length; i++) {
    const result = transfer(shadow, { ...legs[i], id: ids[i], time }); if (!result.ok) return result;
  }
  for (let i = 0; i < legs.length; i++) transfer(ledger, { ...legs[i], id: ids[i], time });
  return { ok: true, duplicate: false };
}

/** Saveable command ids: `${kind}:${seq}`, then seq advances. */
export function nextId(state: { seq: number }, kind: string): string {
  return `${kind}:${state.seq++}`;
}
