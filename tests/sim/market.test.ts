import { describe, expect, it } from 'vitest';
import { advanceDay, applyEvent, createMarket, recordNpcRevenue, trade, type Trade } from '../../src/sim/market';
import { createLedger } from '../../src/sim/ledger';
const order = (overrides: Partial<Trade> = {}): Trade => ({ id: 'buy', time: { day: 1, hour: 9, minute: 0 },
  account: 'player', companyId: 'light', quantity: 2, side: 'buy', ...overrides });
describe('market', () => {
  it('reproduces seeded daily prices and varies with another seed', () => {
    const a = createMarket(42), b = createMarket(42), c = createMarket(43);
    for (let day = 0; day < 20; day++) { advanceDay(a); advanceDay(b); advanceDay(c); }
    expect(a).toEqual(b);
    expect(a.prices).not.toEqual(c.prices);
  });
  it('applies signed events for exactly their duration and consumes NPC revenue once', () => {
    const a = createMarket(42), b = createMarket(42);
    applyEvent(a, { companyId: 'light', size: 0.2, days: 2 });
    applyEvent(a, { companyId: 'tea', size: -0.2, days: 1 });
    recordNpcRevenue(a, 'sori', 1);
    advanceDay(a); advanceDay(b);
    expect(a.prices.light).toBeGreaterThan(b.prices.light);
    expect(a.prices.tea).toBeLessThan(b.prices.tea);
    expect(a.prices.cycle).toBeGreaterThan(b.prices.cycle);
    expect(a.events).toEqual([{ companyId: 'light', size: 0.2, days: 1 }]);
    expect(a.revenue).toEqual({});
    advanceDay(a); expect(a.events).toEqual([]);
  });
  it('settles buys and sells through the ledger with 1% fees and rejects duplicate IDs', () => {
    const market = createMarket(), ledger = createLedger({ player: 1000, market: 1000 });
    expect(trade(market, ledger, order()).ok).toBe(true);
    expect(ledger.balances).toEqual({ player: 798, market: 1202 });
    expect(trade(market, ledger, order()).ok).toBe(false);
    expect(market.holdings.player.light).toBe(2);
    expect(trade(market, ledger, order({ id: 'sell', side: 'sell' })).ok).toBe(true);
    expect(ledger.balances).toEqual({ player: 996, market: 1004 });
    expect(market.holdings.player.light).toBe(0);
    expect(ledger.transactions).toHaveLength(2);
  });
  it('rejects insufficient funds and excess sales without changing either state', () => {
    const market = createMarket(), ledger = createLedger({ player: 100, market: 1000 });
    const before = structuredClone({ market, ledger });
    expect(trade(market, ledger, order()).ok).toBe(false);
    expect(trade(market, ledger, order({ side: 'sell' })).ok).toBe(false);
    expect({ market, ledger }).toEqual(before);
  });
});
