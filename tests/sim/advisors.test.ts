import { expect, it } from 'vitest';
import { advisorKinds, advisorLines, clauses, type AdvisorKind, type Tier } from '../../src/data/advisors';
import {
  advisorLine, audit, createTaxBook, embezzle, embezzleAmount, generateContract, investigate, mistakeRate, reviewContract,
  reviewDays, rng, settle, summarizeObligations, weeklyFee, weeklyTax, type Advisor,
} from '../../src/sim/advisors';
import { createLedger } from '../../src/sim/ledger';

const N = 100_000, TIERS: Tier[] = [1, 2, 3];
const acc = (tier: Tier, hiredWeek = 0, hasSpendingAuthority = true): Advisor =>
  ({ kind: 'accountant', tier, account: 'acc', hiredWeek, hasSpendingAuthority });
const mistakes = (a: Advisor | null, week: number, seed: number) => {
  const r = rng(seed), book = createTaxBook();
  for (let i = 0; i < N; i++) weeklyTax(1000, a, week, book, r);
  return book.errors / N;
};

it('is deterministic for the same seed', () => {
  expect(generateContract('lease', 7)).toEqual(generateContract('lease', 7));
  const run = () => { const r = rng(3), b = createTaxBook(); return [1, 2, 3].map(() => weeklyTax(5000, acc(1), 10, b, r)); };
  expect(run()).toEqual(run());
  const c = generateContract('supply', 11);
  expect(reviewContract(c, 2, rng(5))).toEqual(reviewContract(c, 2, rng(5)));
});

it('higher tiers make fewer mistakes, save more and miss fewer hidden clauses (100k samples)', () => {
  const rates = TIERS.map(t => mistakes(acc(t), 0, 1));
  expect(rates[0]).toBeGreaterThan(rates[1]); expect(rates[1]).toBeGreaterThan(rates[2]);
  expect(mistakes(null, 0, 1)).toBeGreaterThan(rates[0]);
  const saved = TIERS.map(t => weeklyTax(10_000, acc(t), 0, createTaxBook(), () => 0.99).saved);
  expect(saved[0]).toBeLessThan(saved[1]); expect(saved[1]).toBeLessThan(saved[2]);
  const contract = { ...generateContract('ad', 1), clauses: (['autoRenew', 'heavyPenalty', 'priceHike'] as const)
    .map((kind, i) => ({ kind, article: 4 + i, effect: {} })) };
  const missed = TIERS.map(t => {
    const r = rng(9); let miss = 0;
    for (let i = 0; i < N; i++) miss += 3 - reviewContract(contract, t, r).length;
    return miss / (3 * N);
  });
  expect(missed[0]).toBeGreaterThan(missed[1]); expect(missed[1]).toBeGreaterThan(missed[2]);
});

it('finds nothing without a lawyer and writes player-facing clause lines', () => {
  for (let seed = 0; seed < 200; seed++) {
    const c = generateContract((['lease', 'supply', 'employment', 'ad'] as const)[seed % 4], seed);
    expect(c.clauses.length).toBeLessThanOrEqual(3);
    expect(reviewContract(c, null, rng(seed))).toEqual([]);
  }
  expect(Object.keys(clauses).length).toBeGreaterThanOrEqual(8);
  const c = { ...generateContract('lease', 1), clauses: [{ kind: 'autoRenew' as const, article: 7, effect: { renewWeeks: 52 } }] };
  expect(reviewContract(c, 3, () => 0)[0].text).toBe('제7조: 3개월 전 통지 없으면 1년 자동 연장 — 빼 달라고 할까요?');
  expect(reviewContract({ ...c, clauses: [{ ...c.clauses[0], kind: 'farCourt' }] }, 2, () => 0)).toEqual([]);
});

it('fixes hidden clauses at generation; cheap lawyers see a narrow scope slowly, expensive ones propose fixes', () => {
  const c = { ...generateContract('lease', 2), clauses: (['autoRenew', 'liabilityShift', 'noEarlyExit'] as const)
    .map((kind, i) => ({ kind, article: 5 + i, effect: { ...clauses[kind].effect } })) };
  const before = JSON.parse(JSON.stringify(c));
  for (const t of TIERS) reviewContract(c, t, rng(t));
  expect(c).toEqual(before);
  expect(reviewContract(c, 1, () => 0).map(f => f.clause.kind)).toEqual(['autoRenew']);
  expect(reviewContract(c, 2, () => 0).map(f => f.clause.kind)).toEqual(['autoRenew', 'noEarlyExit']);
  const best = reviewContract(c, 3, () => 0);
  expect(best).toHaveLength(3); expect(best.every(f => f.fix && f.negotiable)).toBe(true);
  expect(reviewContract(c, 2, () => 0).every(f => f.fix === null)).toBe(true);
  expect(reviewDays(1)).toBeGreaterThan(reviewDays(2)); expect(reviewDays(2)).toBeGreaterThan(reviewDays(3));
});

it('summarizes the cash/profit gap, unpaid wages and contract obligations', () => {
  const c = { ...generateContract('supply', 3), weeklyAmount: 200,
    clauses: [{ kind: 'hiddenFee' as const, article: 4, effect: { feeRate: 0.08 } }] };
  const s = summarizeObligations(300, 500, 120, [c]);
  expect(s).toMatchObject({ gap: 200, unpaidWages: 120, contractDue: 216, total: 336 });
  expect(s.lines.join()).toMatch(/216결/);
});

it('long tenure lowers the mistake rate', () => {
  for (const t of TIERS) expect(mistakeRate(acc(t), 52)).toBeLessThan(mistakeRate(acc(t), 0));
  expect(mistakes(acc(1), 52, 2)).toBeLessThan(mistakes(acc(1), 0, 2));
});

it('only tier 1 embezzles, rarely, and less when loyal', () => {
  const count = (a: Advisor, week: number) => {
    const r = rng(4); let n = 0;
    for (let i = 0; i < N; i++) if (embezzleAmount(a, week, 1000, r) > 0) n++;
    return n / N;
  };
  expect(count(acc(2), 0)).toBe(0); expect(count(acc(3), 0)).toBe(0);
  const fresh = count(acc(1), 0);
  expect(fresh).toBeGreaterThan(0.003); expect(fresh).toBeLessThan(0.007);
  expect(count(acc(1), 52)).toBeLessThan(fresh);
  expect(count(acc(1, 0, false), 0)).toBe(0);
});

it('keeps the total balance constant across tax, fee, audit and embezzlement transfers', () => {
  const ledger = createLedger({ player: 50_000, city: 1000, acc: 0 }), time = { day: 1, hour: 9, minute: 0 };
  const total = () => Object.values(ledger.balances).reduce((a, b) => a + b, 0), before = total();
  const a = acc(1), book = createTaxBook(), r = rng(8);
  let stolen = 0;
  for (let w = 0; w < 200; w++) {
    const t = { ...time, day: w + 1 };
    expect(settle(ledger, `tax:${w}`, 'player', 'city', weeklyTax(800, a, w, book, r).due, t, '세금').ok).toBe(true);
    expect(settle(ledger, `fee:${w}`, 'player', 'acc', weeklyFee(a), t, '수수료').ok).toBe(true);
    stolen += embezzle(ledger, a, 'player', w, r, t, `steal:${w}`);
    const { charge } = audit(book, r);
    if (charge) settle(ledger, `audit:${w}`, 'player', 'city', Math.min(charge, ledger.balances.player), t, '추징');
  }
  expect(total()).toBe(before);
  expect(investigate(ledger, 'acc').reduce((n, t) => n + t.amount, 0)).toBe(stolen);
  expect(ledger.balances.city).toBeGreaterThan(1000);
});

it('has a line for every kind, tier and situation in plain modern Korean', () => {
  for (const kind of Object.keys(advisorKinds) as AdvisorKind[]) for (const t of TIERS) {
    expect(advisorLines[kind][t]).toHaveLength(5);
    for (const s of ['hire', 'report', 'mistake', 'found', 'nothing'] as const)
      expect(advisorLine(kind, t, s)).toMatch(/[가-힣]/);
  }
  expect(JSON.stringify(advisorLines)).not.toMatch(/마법|마나|길드|영주|금화|골드|원\b/);
});
