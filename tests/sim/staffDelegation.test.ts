import { expect, it } from 'vitest';
import { roll } from '../../src/sim/tycoonCore';
import { BOSS_HAND, CHECKOUT_WORK, chooseTask, closingReport, lateChance, lowestPrice, mistakeChance, orderProblem, quitChance, rate, skillAt,
  type Outcome } from '../../src/sim/staffDelegation';

it('C097 B5·B6·B7: two limits and real funds, discount floor at cost, task choice with the 70% rule', () => {
  const p = { orderApprovalLimit: 20, dailyBudget: 80 };
  expect([orderProblem(p, 18, 30, 30), orderProblem(p, 24, 0, 99), orderProblem(p, 18, 70, 99), orderProblem(p, 18, 0, 10)]).toEqual(['', 'limit', 'budget', 'funds']);
  expect([lowestPrice(10, 5, 2), lowestPrice(8, 10, 8), lowestPrice(10, 0, 2)]).toEqual([null, null, null]); // rounded up, never below cost
  expect(lowestPrice(30, 5, 7)).toBe(29); expect(lowestPrice(20, 10, 19)).toBe(19);
  expect(chooseTask({ taskPriority: 'balanced' }, 1, 0, true)).toBe('stock'); expect(chooseTask({ taskPriority: 'balanced' }, 2, 0, true)).toBe('checkout');
  expect(chooseTask({ taskPriority: 'stocking' }, 3, 6, true)).toBe('stock'); expect(chooseTask({ taskPriority: 'stocking' }, 3, 7, true)).toBe('checkout');
  expect(chooseTask({ taskPriority: 'checkout' }, 0, 0, false)).toBe('rest');
});

it('C097 B9: hand 42 after 12 related hours checks out faster than the boss; work carries over exactly', () => {
  expect(rate(skillAt(42, 12 * 60))).toBeGreaterThan(rate(BOSS_HAND)); expect(skillAt(42, 0)).toBe(42);
  expect(CHECKOUT_WORK / rate(skillAt(42, 0))).toBeCloseTo(3.53, 2); expect(CHECKOUT_WORK / rate(skillAt(42, 40 * 60))).toBeCloseTo(2.62, 2);
  let left = 0, done = 0; // minute-by-minute with carry equals the formula over a long run
  for (let m = 0; m < 6000; m++) for (left += rate(42); left >= CHECKOUT_WORK; left -= CHECKOUT_WORK) done++;
  expect(done).toBe(Math.floor(6000 * rate(42) / CHECKOUT_WORK));
});

it('C097 B10–12: fixed-seed rates match the formulas, causes raise them, no cause means no quitting', () => {
  const n = 200000, freq = (p: number, k: string) => Array.from({ length: n }, (_, i) => roll(7, 'staff', k, i) < p).filter(Boolean).length / n;
  const late = lateChance(80, 0, 0, 0), tired = lateChance(80, 1, 1, 0), slip = mistakeChance(60, 0, 0);
  expect(late).toBeCloseTo(0.0026, 6); expect(slip).toBeCloseTo(0.00026, 6);
  expect(Math.abs(freq(late, 'late') - late)).toBeLessThan(0.0006); expect(Math.abs(freq(slip, 'slip') - slip)).toBeLessThan(0.0002);
  expect(freq(tired, 'late')).toBeGreaterThan(freq(late, 'late') * 5); expect(roll(7, 'staff', 'a', 3)).toBe(roll(7, 'staff', 'a', 3));
  expect(quitChance(false, false, false)).toBe(0); expect(quitChance(true, true, true)).toBe(0.05);
});

it('C097 B14: the report comes only from solo, completed records; approved or shared work is not "alone"', () => {
  const o = (kind: Outcome['kind'], alone: boolean, i: number): Outcome => ({ id: `o${i}`, npcId: 'aro', kind, start: i, end: i + 3, policy: 2, alone, ref: `r${i}` });
  expect(closingReport([])).toEqual({ text: '혼자 처리할 주문은 없었어요', evidence: [] });
  expect(closingReport([o('checkout', false, 0), o('restock', false, 1)]).text).toBe('오늘은 함께 근무했어요');
  const r = closingReport([o('checkout', true, 0), o('haggle', true, 1), o('checkout', true, 2), o('haggle', true, 3), o('stock', true, 4)]);
  expect(r.text).toContain('흥정 손님 2명'); expect(r.evidence.map(e => e.id)).toEqual(['o1', 'o3']);
});
