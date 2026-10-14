import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { startEmployeeShift, payCompletedShift, checkoutBusiness } from '../../src/sim/business';
import { payPerson } from '../../src/sim/purse';
import { restock, setPrice, visitStore } from '../../src/sim/store';
it('keeps completed wages in arrears, then pays once from customer revenue after reload', () => {
  const { state } = createSession({ getItem: () => null, setItem: () => {} });
  const { world: { people, ledger }, book, work, purses } = state, b = book.businesses[0];
  const time = { day: 1, hour: 0, minute: 0 }, end = { ...time, hour: 1 };
  payPerson(people, ledger, { id: 'empty-owner', from: b.ownerId, to: 'aro', amount: 1000, time, reason: 'Transfer' });
  const shift = startEmployeeShift(book, work, 'iri', 'cafe', time);
  expect(payCompletedShift(book, people, ledger, b.id, shift, time).ok).toBe(false);
  expect(payCompletedShift(book, people, ledger, b.id, shift, end).ok).toBe(false); expect(shift.paid).toBe(false);
  setPrice(b.store, 'tea', 30); restock(b.store, 'tea', 1);
  visitStore(b.store, ledger, 'customer', 'player', { itemId: 'tea', maxPrice: 30 }, 1, end);
  expect(checkoutBusiness(book, people, ledger, b.id, purses.player, 'customer', end).ok).toBe(true);
  expect(payCompletedShift(book, people, ledger, b.id, shift, end)).toEqual({ ok: true, duplicate: false });
  expect(checkoutBusiness(book, people, ledger, b.id, purses.player, 'customer', end)).toEqual({ ok: true, duplicate: true });
  expect(payCompletedShift(JSON.parse(JSON.stringify(book)), people, ledger, b.id, JSON.parse(JSON.stringify(shift)), end))
    .toEqual({ ok: true, duplicate: true });
  expect(ledger.balances).toMatchObject({ player: 70, nuel: 0, iri: 1030 });
  expect(Object.values(ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
});
