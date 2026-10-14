import { expect, it } from 'vitest';
import { items } from '../../src/data/items';
import { chooseNeed, decide, stillWaiting } from '../../src/sim/customer';

it('chooses preferred topics deterministically and applies individual price tolerance', () => {
  const customer = { likes: ['잔향 차'], priceTolerance: 1.5, patienceMinutes: 5 };
  expect(chooseNeed(customer, items, 0.9)).toEqual({ itemId: 'tea', maxPrice: 12 });
  expect(chooseNeed({ ...customer, likes: [] }, items, 0)?.itemId).toBe('tea');
  expect(chooseNeed(customer, [], 0)).toBeUndefined();
  expect(() => chooseNeed(customer, items, 1)).toThrow();
  expect(() => chooseNeed({ ...customer, priceTolerance: Infinity }, items, 0)).toThrow();
});

it('distinguishes missing stock, excessive price and insufficient budget at exact boundaries', () => {
  const need = { itemId: 'tea', maxPrice: 10 };
  const offer = { itemId: 'tea', price: 10, available: 1 };
  expect(decide(need, offer, 10)).toBe('buy');
  expect(decide(need, undefined, 10)).toBe('missing');
  expect(decide(need, { ...offer, available: 0 }, 10)).toBe('missing');
  expect(decide(need, { ...offer, price: 11 }, 20)).toBe('expensive');
  expect(decide(need, offer, 9)).toBe('unaffordable');
  expect(() => decide(need, { ...offer, price: 0 }, 10)).toThrow();
});

it('expires at the patience deadline across midnight and rejects reversed time', () => {
  expect(stillWaiting(1439, 2, 1440)).toBe(true);
  expect(stillWaiting(1439, 2, 1441)).toBe(false);
  expect(stillWaiting(0, 0, 0)).toBe(false);
  expect(() => stillWaiting(5, 2, 4)).toThrow();
  expect(() => stillWaiting(0, -1, 0)).toThrow();
});
