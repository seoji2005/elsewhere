// 전문가 고용 규칙: 회계사(세금·실수·세무조사·횡령)와 변호사(숨은 조항 발견). 돈은 모두 기존 계정 사이 이체.
import { advisorKinds, advisorLines, clauses, contractKinds, tax, tiers } from '../data/advisors';
import type { AdvisorKind, ClauseKind, ContractKind, Situation, Tier } from '../data/advisors';
import { transfer, type LedgerState, type TransferResult } from './ledger';
import type { GameTime } from './clock';

export type Sample = () => number; // [0, 1) 균등 난수
export interface Advisor { kind: AdvisorKind; tier: Tier; account: string; hiredWeek: number }
export interface TaxBook { underpaid: number; auditRisk: number; errors: number }
export interface Clause { kind: ClauseKind; article: number; effect: Record<string, number> }
export interface Contract {
  kind: ContractKind; seed: number; title: string; weeklyAmount: number; weeks: number; clauses: Clause[];
}
export interface Finding { clause: Clause; text: string; negotiable: boolean }

// mulberry32: 같은 seed면 같은 수열.
export function rng(seed: number): Sample {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const roll = (sample: Sample) => {
  const v = sample();
  if (!Number.isFinite(v) || v < 0 || v >= 1) throw Error('Invalid sample');
  return v;
};
const natural = (n: number) => Number.isSafeInteger(n) && n >= 0;

export const createTaxBook = (): TaxBook => ({ underpaid: 0, auditRisk: 0, errors: 0 });
export const weeklyFee = (a: Advisor) => advisorKinds[a.kind].weeklyFee[a.tier];
// 근속 0주 → 0, loyaltyWeeks 이상 → 1.
export function loyalty(a: Advisor, week: number): number {
  if (!natural(week) || week < a.hiredWeek) throw Error('Invalid week');
  return Math.min(1, (week - a.hiredWeek) / tax.loyaltyWeeks);
}
export const mistakeRate = (a: Advisor | null, week: number) =>
  a ? tiers[a.tier].mistake * (1 - tax.loyaltyCut * loyalty(a, week)) : tax.selfMistake;
export const embezzleRate = (a: Advisor, week: number) =>
  tiers[a.tier].embezzle * (1 - tax.embezzleCut * loyalty(a, week));

// 이번 주 세금 계산. 실수하면 일부를 덜 신고하고(나중에 추징) 세무조사 위험이 쌓인다.
export function weeklyTax(profit: number, accountant: Advisor | null, week: number, book: TaxBook, sample: Sample) {
  if (!natural(profit)) throw Error('Invalid profit');
  if (accountant && accountant.kind !== 'accountant') throw Error('Not an accountant');
  const full = Math.floor(profit * tax.rate);
  const saved = accountant ? Math.floor(full * tiers[accountant.tier].saving) : 0;
  const mistake = roll(sample) < mistakeRate(accountant, week);
  const missing = mistake ? Math.floor((full - saved) * tax.underreport) : 0;
  book.auditRisk = Math.min(1, book.auditRisk + tax.riskPerWeek + (mistake ? tax.riskPerError : 0));
  book.underpaid += missing;
  if (mistake) book.errors++;
  return { due: full - saved - missing, saved, mistake };
}

// 세무조사. 걸리면 덜 낸 세금 + 가산금을 추징하고 장부 위험을 초기화한다.
export function audit(book: TaxBook, sample: Sample) {
  if (roll(sample) >= book.auditRisk) return { audited: false, charge: 0 };
  const charge = book.underpaid + Math.floor(book.underpaid * tax.penalty);
  Object.assign(book, createTaxBook());
  return { audited: true, charge };
}

// 1등급만 아주 드물게 사장 계정에서 잔액의 일부를 빼돌린다. 반환값은 훔치려는 금액(0이면 없음).
export function embezzleAmount(a: Advisor, week: number, ownerBalance: number, sample: Sample): number {
  if (!natural(ownerBalance)) throw Error('Invalid balance');
  return roll(sample) < embezzleRate(a, week) ? Math.floor(ownerBalance * tax.embezzleShare) : 0;
}

// 세금(→ 시청 등 주어진 계정)·수수료·횡령·추징 모두 이 이체 하나로. 0원이면 아무것도 하지 않는다.
export function settle(ledger: LedgerState, id: string, from: string, to: string, amount: number,
  time: GameTime, reason: string): TransferResult {
  if (amount === 0) return { ok: true, duplicate: false };
  return transfer(ledger, { id, from, to, amount, time, reason });
}

const KINDS = Object.keys(clauses) as ClauseKind[];
// 겉 조건 + 숨은 조항 0~3개. 같은 kind·seed면 같은 계약서.
export function generateContract(kind: ContractKind, seed: number): Contract {
  const def = contractKinds[kind], r = rng(seed ^ (kind.length * 0x9e3779b1));
  const between = ([lo, hi]: [number, number]) => lo + Math.floor(r() * (hi - lo + 1));
  const pool = [...KINDS], picked: Clause[] = [];
  const count = Math.floor(r() * 4);
  let article = 3;
  for (let i = 0; i < count; i++) {
    const k = pool.splice(Math.floor(r() * pool.length), 1)[0];
    article += 1 + Math.floor(r() * 3);
    picked.push({ kind: k, article, effect: { ...clauses[k].effect } });
  }
  return { kind, seed, title: def.name, weeklyAmount: between(def.amount), weeks: between(def.weeks), clauses: picked };
}

// 변호사 없으면 아무것도 못 본다. 조항마다 등급별 확률로 발견. 3등급은 빼기 어려운 조항도 협상 시도 가능.
export function reviewContract(contract: Contract, tier: Tier | null, sample: Sample): Finding[] {
  if (tier === null) return [];
  return contract.clauses.filter(() => roll(sample) < tiers[tier].detect).map(clause => {
    const negotiable = clauses[clause.kind].negotiable || tier === 3;
    const ask = negotiable ? '빼 달라고 할까요?' : '이건 빼기 어렵습니다.';
    return { clause, negotiable, text: `제${clause.article}조: ${clauses[clause.kind].text} — ${ask}` };
  });
}

const SITUATIONS: Situation[] = ['hire', 'report', 'mistake', 'found', 'nothing'];
export const advisorLine = (kind: AdvisorKind, tier: Tier, situation: Situation) =>
  advisorLines[kind][tier][SITUATIONS.indexOf(situation)];
