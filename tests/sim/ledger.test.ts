import { describe, expect, it } from 'vitest';
import { createLedger, transfer, type Transaction } from '../../src/sim/ledger';

const payment = (): Transaction => ({
  id: 'pay-1', time: { day: 1, hour: 9, minute: 0 }, from: 'shop', to: 'player', amount: 30, reason: 'wage',
});
describe('ledger', () => {
  it('records money movement and ignores duplicate IDs, including changed payloads', () => {
    const ledger = createLedger({ shop: 100, player: 0 });
    const entry = payment();
    expect(transfer(ledger, entry)).toEqual({ ok: true, duplicate: false });
    entry.time.hour = 10;
    expect(ledger.transactions[0].time.hour).toBe(9);
    expect(transfer(ledger, { ...entry, amount: 70 })).toEqual({ ok: true, duplicate: true });
    expect(ledger.balances).toEqual({ shop: 70, player: 30 });
    expect(ledger.transactions).toHaveLength(1);
    expect(ledger.transactions[0]).toMatchObject({ id: 'pay-1', from: 'shop', to: 'player', amount: 30, reason: 'wage' });
  });
  it('rejects overdrafts atomically and allows retry with the same ID', () => {
    const ledger = createLedger({ shop: 10, player: 0 });
    const before = structuredClone(ledger);
    expect(transfer(ledger, payment()).ok).toBe(false);
    expect(ledger).toEqual(before);
    expect(transfer(ledger, { ...payment(), amount: 10 }).ok).toBe(true);
    expect(ledger.balances.shop).toBe(0);
  });
  it('rejects invalid amounts, missing accounts and balance overflow', () => {
    const ledger = createLedger({ shop: 100, player: Number.MAX_SAFE_INTEGER });
    const before = structuredClone(ledger);
    for (const amount of [-1, 0, 0.1, NaN, Infinity, 30]) {
      expect(transfer(ledger, { ...payment(), amount }).ok).toBe(false);
    }
    expect(transfer(ledger, { ...payment(), to: 'unknown' }).ok).toBe(false);
    expect(transfer(ledger, { ...payment(), time: { day: 0, hour: 0, minute: 0 } }).ok).toBe(false);
    expect(ledger).toEqual(before);
    expect(() => createLedger({ player: -1 })).toThrow();
  });
});
