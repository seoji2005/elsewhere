// C097 첫 직원 위임 (R3-gpt.md B): paid trial → hire on the existing employment, five policies, staff work while the boss is away.
import { applicantWages, recommendedPolicy, trialMinutes, type StaffPolicy } from '../../data/staffPolicies';
import { hire, procure, producerJobs } from '../../sim/business';
import { restock } from '../../sim/store';
import { between } from '../../sim/tycoonCore';
import { CHECKOUT_WORK, STOCK_WORK, chooseTask, closingReport, lateChance, lowestPrice, mistakeChance, orderProblem,
  quitChance, rate, skillAt, type Outcome, type Skill } from '../../sim/staffDelegation';
import { answerHaggle, type PatronState } from './patrons';
import { unitCost } from './haul';
import type { TycoonCtx, TycoonSystem } from './system';
interface Task { kind: Outcome['kind']; ref: string; itemId: string; qty: number; left: number; start: number; alone: boolean }
interface Person { exp: Record<Skill, number>; morale: number; low: number; unpaid: number; lateUntil: number; notice: number | null; task: Task | null }
export interface Trial { npcId: string; wage: number; start: number; status: 'running' | 'done' | 'hired' | 'ended'; checkouts: number; stocked: number }
export interface StaffRequest { id: string; cause: string; kind: 'order' | 'haggle'; itemId: string; qty: number; amount: number;
  ref: string; until: number; status: 'open' | 'approved' | 'rejected' | 'expired' }
export interface StaffState {
  policy: StaffPolicy; trial: Trial | null; people: Record<string, Person>; queue: { kind: 'checkout' | 'haggle'; ref: string; itemId: string; minute: number }[];
  day: number; spent: number; requests: StaffRequest[]; outcomes: Outcome[]; refilled: string[];
}
const now = (ctx: TycoonCtx) => (ctx.time.day - 1) * 1440 + ctx.time.hour * 60 + ctx.time.minute;
const shopOf = (ctx: TycoonCtx) => ctx.book.businesses.find(b => b.closedAt === null && b.id === ctx.leases.find(l => !l.ended && l.businessId)?.businessId);
const employed = (ctx: TycoonCtx, id: string) => ctx.book.employment.some(e => e.actorId === id && e.leftAt === null);
/** Starting skills and diligence, fixed by resident id. */
export const baseOf = (ctx: TycoonCtx, id: string) => ({ hand: between(30, 55, ctx.roll('staff', id, 0)), eye: between(30, 60, ctx.roll('staff', id, 1)),
  speech: between(30, 60, ctx.roll('staff', id, 2)), diligence: between(60, 90, ctx.roll('staff', id, 3)) });
const person = (s: StaffState, id: string) =>
  s.people[id] ??= { exp: { hand: 0, eye: 0, speech: 0 }, morale: 60, low: 0, unpaid: 0, lateUntil: 0, notice: null, task: null };
export const skillOf = (ctx: TycoonCtx, s: StaffState, id: string, k: Skill) => skillAt(baseOf(ctx, id)[k], s.people[id]?.exp[k] ?? 0);
/** Two residents free to work today, with their asking wage (12·15). */
export const applicants = (ctx: TycoonCtx) => ctx.residents
  .filter(n => !employed(ctx, n.id) && !ctx.book.businesses.some(b => b.ownerId === n.id && b.closedAt === null))
  .sort((a, b) => ctx.roll('staff', a.id, ctx.time.day + 9) - ctx.roll('staff', b.id, ctx.time.day + 9))
  .slice(0, 2).map((npc, i) => ({ npc, wage: applicantWages[i] }));
/** Who works the counter this minute: hired staff present and not late, plus a running trial. */
export function onDuty(ctx: TycoonCtx, s: StaffState): string[] {
  const b = shopOf(ctx), m = now(ctx), ids = !b ? [] : ctx.book.employment.filter(e => e.businessId === b.id && e.leftAt === null &&
    ctx.placeOf(e.actorId) === b.placeId && m >= (s.people[e.actorId]?.lateUntil ?? 0)).map(e => e.actorId);
  return b && s.trial?.status === 'running' && m < s.trial.start + trialMinutes ? [...ids, s.trial.npcId] : ids;
}
/** Customers the staff can still check out this hour while the boss is away (Infinity: no staff limit). */
export function counterSlots(ctx: TycoonCtx, s: StaffState): number {
  const ids = onDuty(ctx, s), backlog = s.queue.length * CHECKOUT_WORK;
  if (!ids.length) return ctx.book.employment.some(e => e.businessId === shopOf(ctx)?.id && e.leftAt === null) ? 0 : Infinity;
  return Math.max(0, Math.floor((ids.reduce((n, id) => n + 60 * rate(skillOf(ctx, s, id, 'hand')), 0) - backlog) / CHECKOUT_WORK));
}
export function startTrial(ctx: TycoonCtx, s: StaffState, npcId: string): string {
  const offer = applicants(ctx).find(a => a.npc.id === npcId);
  if (!shopOf(ctx) || s.trial?.status === 'running' || !offer) return 'unavailable';
  if (!ctx.settle(ctx.nextId('staff'), [{ from: 'player', to: npcId, amount: offer.wage, reason: 'Wage: staff-trial' }]).ok) return 'funds';
  s.trial = { npcId, wage: offer.wage, start: now(ctx), status: 'running', checkouts: 0, stocked: 0 }; // paid up front, exactly once
  return '';
}
/** 이 조건으로 채용: the existing employment record (09–17, trial wage); its shifts are paid by the session as before. */
export function hireTrial(ctx: TycoonCtx, s: StaffState): boolean {
  const t = s.trial, b = shopOf(ctx), npc = ctx.residents.find(n => n.id === t?.npcId);
  if (!t || t.status !== 'done' || !b || !npc) return false;
  try { hire(ctx.book, ctx.world.people, ctx.world.ledger, b.id, npc.id, { id: `${b.id}:staff:${ctx.book.employment.length}`, name: npc.job,
    placeId: b.placeId, employerId: 'player', fromMinute: 540, toMinute: 1020, durationMinutes: 480, hourlyWage: t.wage }, ctx.time); } catch { return false; }
  return !!(t.status = 'hired');
}
export const setPolicy = (s: StaffState, patch: Partial<StaffPolicy>) => { s.policy = { ...s.policy, ...patch, version: s.policy.version + 1 }; };
function order(ctx: TycoonCtx, s: StaffState, itemId: string, qty: number, approved: boolean): boolean {
  const b = shopOf(ctx), producer = ctx.residents.find(n => n.job === producerJobs[itemId]);
  if (!b || !producer) return false;
  if (!procure(ctx.book, ctx.world.people, ctx.world.ledger, b.id, producer, itemId, qty, unitCost(itemId), ctx.nextId('staff'), ctx.time).ok) return false;
  s.spent += qty * unitCost(itemId); if (!approved) s.refilled.push(itemId);
  return true;
}
/** 이번만 승인 / 거절: valid once for this request's amount and quantity; the price is checked again. */
export function answer(ctx: TycoonCtx, s: StaffState, id: string, approve: boolean): boolean {
  const r = s.requests.find(r => r.id === id && r.status === 'open');
  if (!r || !(r.status = approve ? 'approved' : 'rejected')) return false;
  if (r.kind === 'haggle') return answerHaggle(ctx, ctx.systems.patrons as PatronState, r.ref, approve) && approve;
  return approve && r.amount === r.qty * unitCost(r.itemId) && order(ctx, s, r.itemId, r.qty, true);
}
function ask(ctx: TycoonCtx, s: StaffState, r: Omit<StaffRequest, 'id' | 'status'>) {
  const same = s.requests.find(x => x.cause === r.cause && Math.floor(x.until / 1440) === Math.floor(r.until / 1440));
  if (same) { if (same.status === 'open') same.amount = r.amount; return; } // one message per problem per day
  s.requests.push({ ...r, id: ctx.nextId('staff'), status: 'open' });
}
const available = (ctx: TycoonCtx) => (ctx.world.ledger.balances.player ?? 0) - ctx.book.employment
  .filter(e => e.leftAt === null && e.job.employerId === 'player').reduce((n, e) => n + e.job.hourlyWage * e.job.durationMinutes / 60, 0);
function work(ctx: TycoonCtx, s: StaffState, id: string, m: number, away: boolean) {
  const p = person(s, id), b = shopOf(ctx)!, touched = new Set<Skill>();
  const speed = rate(skillOf(ctx, s, id, 'hand'));
  let budget = speed;
  for (let guard = 0; budget > 0 && guard < 8; guard++) {
    if (!p.task) {
      const shelf = b.store.stock.find(x => x.displayed < 3 && x.backroom > 0 && !Object.values(s.people).some(o => o.task?.itemId === x.itemId));
      const next = chooseTask(s.policy, s.queue.length, s.queue.length ? m - s.queue[0].minute : 0, !!shelf);
      if (next === 'rest') break;
      const q = next === 'checkout' ? s.queue.shift()! : null, qty = shelf ? Math.min(5, shelf.backroom) : 0;
      p.task = q ? { kind: q.kind, ref: q.ref, itemId: q.itemId, qty: 1, left: CHECKOUT_WORK, start: m, alone: away }
        : { kind: 'stock', ref: `${shelf!.itemId}:${m}`, itemId: shelf!.itemId, qty, left: qty * STOCK_WORK, start: m, alone: away };
      if (ctx.roll('staff', `mistake:${id}:${p.task.ref}`, m) < mistakeChance(skillOf(ctx, s, id, 'eye'), 0, 0)) p.task.left += 2 * speed; // B11: two more minutes to recheck
    }
    const t = p.task, use = Math.min(budget, t.left);
    t.left -= use; budget -= use; t.alone &&= away;
    for (const k of t.kind === 'stock' ? ['eye'] as const : t.kind === 'haggle' ? ['hand', 'speech'] as const : ['hand', 'eye'] as const) touched.add(k);
    if (t.left > 0) break;
    p.task = null;
    if (t.kind === 'stock') restock(b.store, t.itemId, t.qty);
    const kind = t.kind === 'checkout' && s.refilled.includes(t.itemId) && t.alone ? 'restock' : t.kind;
    if (kind === 'restock') s.refilled.splice(s.refilled.indexOf(t.itemId), 1);
    s.outcomes.push({ id: ctx.nextId('staff'), npcId: id, kind, start: t.start, end: m, policy: s.policy.version, alone: t.alone, ref: t.ref });
    if (s.trial?.status === 'running' && s.trial.npcId === id) t.kind === 'stock' ? s.trial.stocked += t.qty : s.trial.checkouts++;
  }
  for (const k of touched) p.exp[k]++; // experience only for minutes actually worked, once per skill
}
export const staff: TycoonSystem<StaffState> = {
  id: 'staff',
  create: ctx => ({ policy: { ...recommendedPolicy }, trial: null, people: {}, queue: [], day: ctx.time.day, spent: 0, requests: [], outcomes: [], refilled: [] }),
  validate(raw) {
    const s = raw as StaffState, lists = [s?.queue, s?.requests, s?.outcomes, s?.refilled];
    if (!Number.isSafeInteger(s?.policy?.version) || !Number.isSafeInteger(s.spent) || !lists.every(Array.isArray) || typeof s.people !== 'object') throw Error('Invalid staff');
    return s;
  },
  onMinute(ctx, s, m) {
    const b = shopOf(ctx);
    if (s.day !== ctx.time.day) { s.day = ctx.time.day; s.spent = 0; } // new day's budget; earlier orders stay paid
    for (const r of s.requests) if (r.status === 'open' && m >= r.until) r.status = 'expired'; // unanswered: not done
    if (s.trial?.status === 'running' && m >= s.trial.start + trialMinutes) s.trial.status = 'done';
    if (!b) return;
    for (const e of ctx.book.employment) if (e.businessId === b.id && e.leftAt === null && m % 1440 === e.job.fromMinute) {
      const p = person(s, e.actorId); // B10: lateness rolled once per shift
      if (ctx.roll('staff', `late:${e.actorId}`, ctx.time.day) < lateChance(baseOf(ctx, e.actorId).diligence, 0, 0, p.morale < 40 ? 1 : 0))
        p.lateUntil = m + between(5, 20, ctx.roll('staff', `lateBy:${e.actorId}`, ctx.time.day));
    }
    const ids = onDuty(ctx, s), away = ctx.player.placeId !== b.placeId;
    if (!ids.length) { s.queue = []; return; }
    for (const id of ids) work(ctx, s, id, m, away);
    if (s.trial?.status === 'running' || s.policy.version < 2) return; // orders only once the boss has set the policies
    for (const x of b.store.stock) if (x.displayed + x.backroom === 0) {
      const amount = 5 * unitCost(x.itemId), problem = orderProblem(s.policy, amount, s.spent, available(ctx));
      if (!problem) order(ctx, s, x.itemId, 5, false);
      else ask(ctx, s, { cause: `order:${x.itemId}`, kind: 'order', itemId: x.itemId, qty: 5, amount, ref: problem, until: m + 15 });
    }
  },
  onShopEvent(ctx, s, e) {
    const b = shopOf(ctx), m = now(ctx);
    if (!b || e.businessId !== b.id || !onDuty(ctx, s).length) return;
    if (e.result === 'purchased') s.queue.push({ kind: 'checkout', ref: `${e.npcId}:${m}`, itemId: e.itemId, minute: m });
    if (e.result !== 'haggle' || ctx.player.placeId === b.placeId) return;
    const visitId = `${e.businessId}:haggle:${e.npcId}:${ctx.time.day}`, list = b.store.stock.find(x => x.itemId === e.itemId)?.price ?? 0;
    const low = lowestPrice(list, s.policy.maxDiscountPercent, unitCost(e.itemId));
    if (low !== null && e.price >= low && answerHaggle(ctx, ctx.systems.patrons as PatronState, visitId, true))
      s.queue.push({ kind: 'haggle', ref: visitId, itemId: e.itemId, minute: m });
    else if (low === null || e.price < low) ask(ctx, s, { cause: `haggle:${e.npcId}`, kind: 'haggle', itemId: e.itemId, qty: 1, amount: e.price, ref: visitId, until: m + 60 });
  },
  onDay(ctx, s, day) {
    const b = shopOf(ctx), end = day * 1440 - 1;
    for (const e of ctx.book.employment) if (e.businessId === b?.id && e.leftAt === null && e.hiredAt <= end) {
      const p = person(s, e.actorId), unpaid = ctx.leases.some(l => l.businessId === b.id && l.warning === 'shop.unpaid');
      if (p.notice !== null && day >= p.notice) { e.leftAt = end; continue; } // notice served: leaves, keeps experience
      p.morale = Math.max(0, Math.min(100, p.morale + (unpaid ? -5 : 1)));
      p.low = p.morale < 30 ? p.low + 1 : 0; p.unpaid = unpaid ? p.unpaid + 1 : 0;
      if (p.notice === null && ctx.roll('staff', `quit:${e.actorId}`, day) < quitChance(p.low >= 5, p.unpaid >= 2, false)) p.notice = day + 2;
    }
    s.outcomes = s.outcomes.filter(o => o.end >= (day - 2) * 1440);
    s.requests = s.requests.filter(r => r.status === 'open' || r.until >= (day - 1) * 1440);
  },
};
export const report = (s: StaffState, day: number) => closingReport(s.outcomes.filter(o => Math.floor(o.end / 1440) === day - 1));
