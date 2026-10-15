import { describe, expect, it } from 'vitest';
import { compactLedger, createLedger } from '../../src/sim/ledger';
import { between, nextId, pick, roll, settle, weighted, type Leg } from '../../src/sim/tycoonCore';

const time = { day: 1, hour: 9, minute: 0 };
const total = (balances: Record<string, number>) => Object.values(balances).reduce((a, b) => a + b, 0);

describe('roll', () => {
  it('is deterministic and changes when any single input changes', () => {
    const base = roll(42, 'ad', 'shop-1', 3);
    expect(roll(42, 'ad', 'shop-1', 3)).toBe(base);
    for (const value of [roll(43, 'ad', 'shop-1', 3), roll(42, 'rival', 'shop-1', 3),
      roll(42, 'ad', 'shop-2', 3), roll(42, 'ad', 'shop-1', 4)]) expect(value).not.toBe(base);
    expect(base >= 0 && base < 1).toBe(true);
  });
  it('is roughly uniform over 100k samples', () => {
    const bins = Array(10).fill(0), n = 100_000;
    for (let i = 0; i < n; i++) bins[Math.floor(roll('seed', 'event', 'town', i) * 10)]++;
    for (const count of bins) expect(Math.abs(count / n - 0.1)).toBeLessThan(0.01);
  });
  it('helpers map r into lists, weights and ranges', () => {
    expect([pick(['a', 'b', 'c'], 0), pick(['a', 'b', 'c'], 0.999)]).toEqual(['a', 'c']);
    expect(weighted([['x', 1], ['y', 0], ['z', 3]], 0.2)).toBe('x');
    expect(weighted([['x', 1], ['y', 0], ['z', 3]], 0.3)).toBe('z');
    expect([between(3, 5, 0), between(3, 5, 0.999)]).toEqual([3, 5]);
  });
});

describe('settle', () => {
  const legs: Leg[] = [
    { from: 'player', to: 'agency', amount: 30, reason: 'Ad fee' },
    { from: 'player', to: 'expert', amount: 50, reason: 'Consult' },
  ];
  it('applies all legs at once and conserves money', () => {
    const ledger = createLedger({ player: 100, agency: 0, expert: 0 });
    expect(settle(ledger, 'batch-1', legs, time)).toEqual({ ok: true, duplicate: false });
    expect(ledger.balances).toEqual({ player: 20, agency: 30, expert: 50 });
    expect(total(ledger.balances)).toBe(100);
    expect(ledger.transactions.map(t => t.id)).toEqual(['batch-1:0', 'batch-1:1']);
  });
  it('changes nothing when a middle leg lacks funds (withdrawals summed)', () => {
    const ledger = createLedger({ player: 60, agency: 0, expert: 0 });
    const before = structuredClone(ledger);
    expect(settle(ledger, 'b1', [...legs, { from: 'agency', to: 'expert', amount: 1, reason: 'x' }], time).ok).toBe(false);
    expect(ledger).toEqual(before);
    expect(settle(ledger, 'b2', [legs[0], { ...legs[1], to: 'nobody' }], time).ok).toBe(false);
    expect(settle(ledger, 'b3', [legs[0], { ...legs[1], amount: 1.5 }], time).ok).toBe(false);
    expect(ledger).toEqual(before);
  });
  it('treats a repeated batch as duplicate and rejects changed content', () => {
    const ledger = createLedger({ player: 200, agency: 0, expert: 0 });
    settle(ledger, 'batch-1', legs, time);
    const after = structuredClone(ledger);
    expect(settle(ledger, 'batch-1', legs, { ...time, hour: 10 })).toEqual({ ok: true, duplicate: true });
    expect(settle(ledger, 'batch-1', [legs[0], { ...legs[1], amount: 51 }], time).ok).toBe(false);
    expect(settle(ledger, 'batch-1', [{ ...legs[0], to: 'expert' }, legs[1]], time).ok).toBe(false);
    expect(settle(ledger, 'batch-1', [legs[0]], time).ok).toBe(false);
    expect(ledger).toEqual(after);
  });
  it('still detects duplicates after compaction', () => {
    const ledger = createLedger({ player: 200, agency: 0, expert: 0 });
    settle(ledger, 'batch-1', legs, time);
    compactLedger(ledger, 2);
    const after = structuredClone(ledger);
    expect(settle(ledger, 'batch-1', legs, { ...time, day: 3 })).toEqual({ ok: true, duplicate: true });
    expect(ledger).toEqual(after);
  });
});

describe('nextId', () => {
  it('produces sequential saveable ids', () => {
    const state = { seq: 7 };
    expect(nextId(state, 'ad')).toBe('ad:7');
    expect(nextId(state, 'hire')).toBe('hire:8');
    expect(state.seq).toBe(9);
  });
});
