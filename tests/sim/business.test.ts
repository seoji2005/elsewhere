import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { startEmployeeShift, payCompletedShift, checkoutBusiness, hire, procure, producerJobs } from '../../src/sim/business';
import { jobs } from '../../src/data/jobs';
import { generate } from '../../src/sim/npcgen';
import { npcs } from '../../src/data/npcs';
import { payPerson } from '../../src/sim/purse';
import { restock, setPrice, visitStore } from '../../src/sim/store';
it('keeps completed wages in arrears, then pays once from customer revenue after reload', () => {
  const { state } = createSession({ getItem: () => null, setItem: () => {} });
  const { world: { people, ledger }, book, work, purses } = state, b = book.businesses[0];
  const time = { day: 1, hour: 0, minute: 0 }, end = { ...time, hour: 1 };
  for (const id of Object.keys(ledger.balances)) ledger.balances[id] = id.startsWith('generated-') ? 0 : id === 'player' ? 100 : 1000;
  book.businesses = [b]; book.employment = []; b.store.stock[0].backroom = 300;
  hire(book, people, ledger, b.id, 'iri', jobs[0], time);
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
  // C114: 찻방 시급 30→2결. 손님 30결 중 임금 2결만 한 번 지급되고 나머지는 사장에게 남는다.
  expect(ledger.balances).toMatchObject({ player: 70, nuel: 28, iri: 1002 });
  expect(Object.values(ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
});

it('requires paid producer orders and preserves goods and money on failures and retries', () => {
  const { state } = createSession({ getItem: () => null, setItem: () => {} }, 123);
  const { book, world: { people, ledger } } = state, b = book.businesses[0], stock = b.store.stock[0];
  const initialBackroom = stock.backroom;
  const producer = generate(123, 50).find(n => n.job === producerJobs.tea)!;
  const time = { day: 1, hour: 0, minute: 0 }, owner = ledger.balances[b.ownerId], supplier = ledger.balances[producer.id];
  const order = (id: string, quantity = 5) => procure(book, people, ledger, b.id, producer, 'tea', quantity, 2, id, time);
  expect(procure(book, people, ledger, b.id, npcs[0], 'tea', 5, 2, 'wrong-job', time).ok).toBe(false);
  expect(procure(book, people, ledger, b.id, npcs[1], 'tea', 5, 2, 'self', time).ok).toBe(false);
  expect(order('too-large', 100000).ok).toBe(false); expect(stock.backroom).toBe(initialBackroom);
  expect(order('batch')).toEqual({ ok: true, duplicate: false });
  expect(order('batch')).toEqual({ ok: true, duplicate: true });
  expect(order('batch', 6).ok).toBe(false); expect(stock.backroom).toBe(initialBackroom + 5);
  expect(ledger.balances[b.ownerId]).toBe(owner - 10); expect(ledger.balances[producer.id]).toBe(supplier + 10);
  const restored = JSON.parse(JSON.stringify(book));
  expect(procure(restored, people, ledger, b.id, producer, 'tea', 5, 2, 'batch', time)).toEqual({ ok: true, duplicate: true });
  expect(restored.businesses[0].store.stock[0].backroom).toBe(initialBackroom + 5);
  b.closedAt = 0; expect(order('closed').ok).toBe(false);
  expect(Object.values(ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
});
it('allows an employee to work after an ended unpaid shift while preventing overlap', () => {
  const { state } = createSession({ getItem: () => null, setItem: () => {} }, 123);
  const { book, work, world: { people, ledger } } = state, time = { day: 1, hour: 0, minute: 0 };
  book.employment = []; hire(book, people, ledger, 'tea-counter', 'player', jobs[0], time);
  const old = startEmployeeShift(book, work, 'player', 'cafe', time);
  expect(() => startEmployeeShift(book, work, 'player', 'cafe', time)).toThrow();
  expect(startEmployeeShift(book, work, 'player', 'cafe', { ...time, hour: 1 }).startedAt).toBe(old.endsAt);
  expect(old.paid).toBe(false); expect(work.shifts).toContain(old);
});
