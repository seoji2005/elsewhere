// C097 R3-gpt.md B: policy checks, task choice, growth curve, cause-based odds and the closing report. Pure functions.
import type { StaffPolicy } from '../data/staffPolicies';
import { reportLines } from '../data/staffPolicies';

export type Skill = 'hand' | 'eye' | 'speech';
export const CHECKOUT_WORK = 360, STOCK_WORK = 60, BOSS_HAND = 60, PATIENCE = 10;
/** B9: E = related work hours, B = starting skill. */
export const skillAt = (base: number, minutes: number) => {
  const e = minutes / 60;
  return Math.min(95, base + 10 * Math.min(1, e / 4) + 40 * (1 - Math.exp(-e / 40)));
};
/** Work units per minute. */
export const rate = (hand: number) => 60 + hand;

/** B7: one task at a time; the longest wait at 70% of patience always means checkout next. */
export function chooseTask(p: Pick<StaffPolicy, 'taskPriority'>, queue: number, oldestWait: number, emptyShelf: boolean):
  'checkout' | 'stock' | 'rest' {
  if (queue && (oldestWait >= 0.7 * PATIENCE || p.taskPriority === 'checkout' || !emptyShelf ||
    p.taskPriority === 'balanced' && queue >= 2)) return 'checkout';
  return emptyShelf ? 'stock' : queue ? 'checkout' : 'rest';
}

/** B5: an order goes ahead only within the per-order limit, today's budget left and the money actually available. */
export function orderProblem(p: Pick<StaffPolicy, 'orderApprovalLimit' | 'dailyBudget'>, amount: number, spentToday: number, available: number):
  '' | 'limit' | 'budget' | 'funds' {
  return amount > p.orderApprovalLimit ? 'limit' : spentToday + amount > p.dailyBudget ? 'budget' : amount > available ? 'funds' : '';
}
/** B6: lowest price the staff may agree to (rounded up), never below cost; null when no discount is allowed at all. */
export function lowestPrice(list: number, percent: number, cost: number): number | null {
  const floor = Math.max(cost, Math.ceil(list * (100 - percent) / 100));
  return floor < list ? floor : null;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
/** B10 per shift. T: commute disruption, F: overworked last shift, M: morale under 40. */
export const lateChance = (diligence: number, T: 0 | 1, F: 0 | 1, M: 0 | 1) =>
  clamp(0.001 + 0.008 * (1 - diligence / 100) + 0.012 * T + 0.01 * F + 0.008 * M, 0, 0.05);
/** B11 per task. F: overwork 0–1, A: confusable labels. */
export const mistakeChance = (eye: number, F: number, A: 0 | 1) => Math.min(0.005, 0.0001 + 0.001 * (1 - eye / 100) ** 2 + 0.0015 * F + 0.001 * A);
/** B12 per day: zero unless long low morale, unpaid wages or a real rival offer. */
export const quitChance = (L: boolean, W: boolean, R: boolean) => L || W || R ? Math.min(0.05, 0.005 + 0.015 * +L + 0.02 * +W + 0.015 * +R) : 0;

export interface Outcome { id: string; npcId: string; kind: 'checkout' | 'stock' | 'restock' | 'haggle'; start: number; end: number;
  policy: number; alone: boolean; ref: string }
/** B14: only work done entirely while the boss was away and without case approval counts. */
export function closingReport(outcomes: readonly Outcome[]): { text: string; evidence: Outcome[] } {
  const alone = outcomes.filter(o => o.alone && o.kind !== 'stock');
  for (const kind of ['restock', 'haggle', 'checkout'] as const) {
    const found = alone.filter(o => o.kind === kind);
    if (found.length) return { text: reportLines[kind](found.length), evidence: found.slice(0, 3) };
  }
  return { text: outcomes.length ? reportLines.together : reportLines.none, evidence: [] };
}
