// 전문가 고용 규칙: 회계사(세금·실수·세무조사·횡령)와 변호사(숨은 조항 발견). 돈은 모두 기존 계정 사이 이체.
import { advisorKinds, advisorLines, clauses, contractKinds, tax, tiers } from '../data/advisors';
import type { AdvisorKind, ClauseKind, ContractKind, Situation, Tier } from '../data/advisors';
import { transfer, type LedgerState, type TransferResult } from './ledger';
import type { GameTime } from './clock';

export type Sample = () => number; // [0, 1) 균등 난수
export interface Advisor { kind: AdvisorKind; tier: Tier; account: string; hiredWeek: number; hasSpendingAuthority: boolean }
export interface TaxBook { underpaid: number; auditRisk: number; errors: number }
export interface Clause { kind: ClauseKind; article: number; effect: Record<string, number> }
export interface Contract {
  kind: ContractKind; seed: number; title: string; weeklyAmount: number; weeks: number; clauses: Clause[];
}
export interface Finding { clause: Clause; text: string; negotiable: boolean; fix: string | null }

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

// 자금 집행 권한을 받은 1등급만 아주 드물게 잔액의 일부를 빼돌린다. 반환값은 빼돌리려는 금액(0이면 없음).
export function embezzleAmount(a: Advisor, week: number, ownerBalance: number, sample: Sample): number {
  if (!natural(ownerBalance)) throw Error('Invalid balance');
  if (!a.hasSpendingAuthority) return 0;
  return roll(sample) < embezzleRate(a, week) ? Math.floor(ownerBalance * tax.embezzleShare) : 0;
}
// 횡령은 증빙 없는 경비로 위장한 이체로 남는다. 나중에 investigate로 찾을 수 있다.
export const SUSPICIOUS = '경비(증빙 없음)';
export function embezzle(ledger: LedgerState, a: Advisor, owner: string, week: number, sample: Sample,
  time: GameTime, id: string): number {
  const amount = embezzleAmount(a, week, ledger.balances[owner] ?? 0, sample);
  return amount && settle(ledger, id, owner, a.account, amount, time, SUSPICIOUS).ok ? amount : 0;
}
export const investigate = (ledger: LedgerState, account: string) =>
  ledger.transactions.filter(t => t.to === account && t.reason === SUSPICIOUS);

// 회계사 주간 정리: 현금과 이익의 차이, 미지급 임금, 계약상 매주 지급 의무(장부에 적힌 수수료 포함).
export function summarizeObligations(cashChange: number, profit: number, unpaidWages: number, contracts: readonly Contract[]) {
  if (![cashChange, profit].every(Number.isSafeInteger) || !natural(unpaidWages)) throw Error('Invalid summary');
  const contractDue = contracts.reduce((sum, c) => sum + c.weeklyAmount +
    Math.floor(c.weeklyAmount * c.clauses.reduce((r, k) => r + (k.effect.feeRate ?? 0), 0)), 0);
  const gap = profit - cashChange;
  return { gap, unpaidWages, contractDue, total: unpaidWages + contractDue, lines: [
    `이번 주 이익은 ${profit}결인데 현금은 ${cashChange}결 움직였어요. 차이 ${gap}결은 외상·재고·선지급입니다.`,
    `아직 안 준 임금 ${unpaidWages}결, 계약상 매주 나갈 돈 ${contractDue}결이 있습니다.`,
  ] };
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

// 조항은 생성 때 확정되고 검토는 계약서를 바꾸지 않는다. 변호사 없으면 아무것도 못 본다.
// 등급마다 볼 줄 아는 범주가 다르고(범위 밖은 못 봄) 범위 안에서는 대체로 정확하다. 3등급은 수정안을 내고 빼기 어려운 조항도 협상한다.
export function reviewContract(contract: Readonly<Contract>, tier: Tier | null, sample: Sample): Finding[] {
  if (tier === null) return [];
  const t = tiers[tier];
  return contract.clauses.filter(c => t.scope.includes(c.kind) && roll(sample) < t.detect).map(clause => {
    const def = clauses[clause.kind], negotiable = def.negotiable || t.proposesFix;
    const ask = negotiable ? '빼 달라고 할까요?' : '이건 빼기 어렵습니다.';
    return { clause, negotiable, fix: t.proposesFix ? def.fix : null,
      text: `제${clause.article}조: ${def.text} — ${ask}` };
  });
}
export const reviewDays = (tier: Tier) => tiers[tier].reviewDays;

const SITUATIONS: Situation[] = ['hire', 'report', 'mistake', 'found', 'nothing'];
export const advisorLine = (kind: AdvisorKind, tier: Tier, situation: Situation) =>
  advisorLines[kind][tier][SITUATIONS.indexOf(situation)];
