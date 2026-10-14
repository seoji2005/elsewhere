import { expect, it } from 'vitest';
import { initialStock } from '../../src/data/stock';
import { createLedger } from '../../src/sim/ledger';
import { available, checkout, createStore, dailySummary, expireVisits, restock,
  setPrice, visitStore } from '../../src/sim/store';

const time = { day: 1, hour: 8, minute: 0 };
const need = { itemId: 'tea', maxPrice: 20 };
function setup() {
  const store = createStore('player');
  const ledger = createLedger({ player: 0, alice: 100, bob: 100 });
  restock(store, 'tea', 1);
  return { store, ledger };
}

it('bounds replenishment by capacity and backroom stock without sharing the template', () => {
  const store = createStore('player');
  expect(restock(store, 'tea', 100)).toBe(3);
  expect(restock(store, 'tea', 100)).toBe(0);
  expect(store.stock[0]).toMatchObject({ backroom: 3, displayed: 3 });
  expect(initialStock[0].displayed).toBe(0);
  expect(() => restock(store, 'tea', -1)).toThrow();
  expect(() => createStore('player', [{ ...initialStock[0], displayed: 4 }])).toThrow();
  expect(() => createStore('player', [initialStock[0], initialStock[0]])).toThrow();
});

it('reserves the last unit, locks its price and charges once after save/reload', () => {
  const { store, ledger } = setup();
  visitStore(store, ledger, 'a', 'alice', need, 10, time);
  expect(available(store, 'tea')).toBe(0);
  expect(visitStore(store, ledger, 'b', 'bob', need, 10, time).status).toBe('left');
  setPrice(store, 'tea', 20);
  expect(checkout(store, ledger, 'a', time)).toEqual({ ok: true, duplicate: false });
  const loaded = JSON.parse(JSON.stringify({ store, ledger }));
  expect(checkout(loaded.store, loaded.ledger, 'a', time)).toEqual({ ok: true, duplicate: true });
  expect(loaded.ledger.balances).toEqual({ player: 8, alice: 92, bob: 100 });
  expect(loaded.ledger.transactions).toHaveLength(1);
  expect(loaded.store.stock[0].displayed).toBe(0);
  expect(dailySummary(loaded.store, 1)).toEqual({ day: 1, visits: 2, sales: 1, revenue: 8,
    complaints: { missing: 1, expensive: 0, unaffordable: 0, impatient: 0 } });
  expect(() => visitStore(store, ledger, 'a', 'bob', need, 10, time)).toThrow('conflict');
});

it('records price and budget complaints once without reserving or paying', () => {
  const { store, ledger } = setup();
  visitStore(store, ledger, 'price', 'alice', { ...need, maxPrice: 7 }, 5, time);
  ledger.balances.bob = 7;
  visitStore(store, ledger, 'budget', 'bob', need, 5, time);
  visitStore(store, ledger, 'budget', 'bob', need, 5, time);
  expect(store.events.map(e => e.reason)).toEqual(['expensive', 'unaffordable']);
  expect(available(store, 'tea')).toBe(1);
  expect(ledger.transactions).toHaveLength(0);
  expect(store.events[0]).toMatchObject({ visitId: 'price', actorId: 'alice', itemId: 'tea', time });
});

it('uses one FIFO queue and releases expired reservations across midnight exactly once', () => {
  const { store, ledger } = setup();
  restock(store, 'tea', 1);
  const night = { day: 1, hour: 23, minute: 59 };
  visitStore(store, ledger, 'a', 'alice', need, 2, night);
  visitStore(store, ledger, 'b', 'bob', need, 5, night);
  expect(checkout(store, ledger, 'b', night)).toEqual({ ok: false, error: 'Not queue head' });
  const morning = { day: 2, hour: 0, minute: 1 };
  expireVisits(store, morning);
  expireVisits(store, morning);
  expect(available(store, 'tea')).toBe(1);
  expect(checkout(store, ledger, 'a', morning).ok).toBe(false);
  expect(checkout(store, ledger, 'b', morning).ok).toBe(true);
  expect(dailySummary(store, 1).revenue).toBe(0);
  expect(dailySummary(store, 2)).toMatchObject({ sales: 1, revenue: 8, complaints: { impatient: 1 } });
});

it('keeps failed payment retryable and prevents conflicting ledger IDs from consuming stock', () => {
  const { store, ledger } = setup();
  visitStore(store, ledger, 'a', 'alice', need, 10, time);
  ledger.balances.alice = 0;
  expect(checkout(store, ledger, 'a', time).ok).toBe(false);
  expect(store.visits[0].status).toBe('waiting');
  expect(store.stock[0].displayed).toBe(1);
  expect(store.events).toHaveLength(0);
  ledger.balances.alice = 100;
  ledger.transactions.push({ id: 'store-sale:["player","a"]', from: 'bob', to: 'player',
    amount: 8, time, reason: 'Store purchase: tea' });
  expect(checkout(store, ledger, 'a', time)).toEqual({ ok: false, error: 'Sale ID conflict' });
  expect(store.stock[0].displayed).toBe(1);
  const retry = setup();
  visitStore(retry.store, retry.ledger, 'a', 'alice', need, 10, time);
  retry.ledger.balances.alice = 0;
  expect(checkout(retry.store, retry.ledger, 'a', time).ok).toBe(false);
  retry.ledger.balances.alice = 100;
  expect(checkout(retry.store, retry.ledger, 'a', time).ok).toBe(true);
});
