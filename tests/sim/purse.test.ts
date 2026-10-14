import { expect, it } from 'vitest';
import { createPurse, funds, payPerson, dayCashflow } from '../../src/sim/purse';
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
