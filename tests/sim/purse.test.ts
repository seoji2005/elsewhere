import { expect, it } from 'vitest';
import { createPurse, funds, payPerson, dayCashflow } from '../../src/sim/purse';
import { compactLedger, transfer } from '../../src/sim/ledger';
import { createWorld } from '../../src/sim/world';
it('reserves existing cash and transfers only between people, once per exact payment', () => {
  const { people, ledger } = createWorld();
  for (const id of ['a', 'b']) { people[id] = { id, name: id, role: 'npc', placeId: 'cafe' }; ledger.balances[id] = 100; }
  ledger.balances.cafe = 100;
  const purse = createPurse(people, ledger, 'a', 70), time = { day: 1, hour: 1, minute: 0 };
  expect(funds(ledger, purse)).toEqual({ cash: 100, savings: 70, spendable: 30 });
  const tx = { id: 'wage', from: 'a', to: 'b', amount: 40, time, reason: 'Wage: tea' };
  expect(payPerson(people, ledger, tx)).toEqual({ ok: true, duplicate: false });
  expect(payPerson(people, ledger, { ...tx, time: { ...time, day: 2 } })).toEqual({ ok: true, duplicate: true });
  expect(payPerson(people, ledger, { ...tx, amount: 41 }).ok).toBe(false);
  expect(payPerson(people, ledger, { ...tx, id: 'bad', to: 'cafe' }).ok).toBe(false);
  expect(funds(ledger, purse)).toEqual({ cash: 60, savings: 60, spendable: 0 });
  expect(dayCashflow(ledger, createPurse(people, ledger, 'b'), 1)).toMatchObject({ income: 40, wages: 40, net: 40 });
  expect(Object.values(ledger.balances).reduce((a, b) => a + b, 0)).toBe(300);
});

it('returns the same income, expenses, wages and consumption after compaction and reload', () => {
  const { people, ledger } = createWorld();
  people.player = { id: 'player', name: 'player', role: 'player', placeId: 'cafe' };
  ledger.balances.player = 0; ledger.balances.cafe = 100;
  const purse = createPurse(people, ledger, 'player');
  const time = { day: 1, hour: 10, minute: 0 };
  transfer(ledger, { id: 'old-wage', from: 'cafe', to: 'player', amount: 40, reason: 'Wage: tea', time });
  transfer(ledger, { id: 'old-purchase', from: 'player', to: 'cafe', amount: 8, reason: 'Purchase: tea', time });
  const expected = dayCashflow(ledger, purse, 1); compactLedger(ledger, 2);
  expect(expected).toEqual({ day: 1, income: 40, expense: 8, wages: 40, consumption: 8, net: 32 });
  expect(dayCashflow(JSON.parse(JSON.stringify(ledger)), purse, 1)).toEqual(expected);
  expect(dayCashflow(ledger, purse, 2).net).toBe(0);
});
