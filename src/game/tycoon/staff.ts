// C097 첫 직원 위임 (R3-gpt.md B): paid trial → hire on the existing employment, five policies, staff work while the boss is away.
import { applicantWages, recommendedPolicy, trialMinutes, type StaffPolicy } from '../../data/staffPolicies';
import { retailDemand } from '../../data/storefronts';
import { checkoutBusiness, hire, procure, producerJobs } from '../../sim/business';
import { dayCashflow, funds } from '../../sim/purse';
import { restock, visitStore } from '../../sim/store';
import { between } from '../../sim/tycoonCore';
import { BOSS_HAND, CHECKOUT_WORK, PATIENCE, STOCK_WORK, chooseTask, counterShare, closingReport, lateChance, lowestPrice, mistakeChance, orderProblem,
  quitChance, rate, skillAt, type Outcome, type Skill } from '../../sim/staffDelegation';
import { answerHaggle, type PatronState } from './patrons';
import { reportLines } from '../../data/staffPolicies';
import { unitCost } from './haul';
import type { TycoonCtx, TycoonSystem } from './system';
/** C110: a purchase intent at the counter, paid only when its checkout task ends. count > 1: a big spender's booked basket (B6). */
export interface Order { kind: 'checkout' | 'haggle'; ref: string; itemId: string; minute: number; npcId?: string; maxPrice?: number; count?: number }
interface Task { kind: Outcome['kind']; ref: string; itemId: string; qty: number; left: number; start: number; alone: boolean; order?: Order }
/** B13 payroll of a hired staff member: paid minutes worked, wages paid, wages that failed on the last payday. */
interface Pay { min: number; paid: number; owed: number }
interface Person { exp: Record<Skill, number>; morale: number; low: number; unpaid: number; lateUntil: number; notice: number | null; task: Task | null; pay?: Pay }
export interface Trial { npcId: string; wage: number; start: number; status: 'running' | 'done' | 'hired' | 'ended'; checkouts: number; stocked: number }
export interface StaffRequest { id: string; cause: string; kind: 'order' | 'haggle' | 'booking'; itemId: string; qty: number; amount: number;
  ref: string; until: number; status: 'open' | 'approved' | 'rejected' | 'expired' | 'resolved'; lines?: Line[]; npcId?: string }
type Line = { itemId: string; qty: number };
export interface StaffState {
  policy: StaffPolicy; trial: Trial | null; people: Record<string, Person>; queue: Order[];
  day: number; spent: number; requests: StaffRequest[]; outcomes: Outcome[]; refilled: string[]; counter?: { hour: number; credit: number };
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
export function startTrial(ctx: TycoonCtx, s: StaffState, npcId: string): string {
  const offer = applicants(ctx).find(a => a.npc.id === npcId);
  if (!shopOf(ctx) || s.trial?.status === 'running' || !offer) return 'unavailable';
  if (!ctx.settle(ctx.nextId('staff'), [{ from: 'player', to: npcId, amount: offer.wage, reason: 'Wage: staff-trial' }]).ok) return 'funds';
  s.trial = { npcId, wage: offer.wage, start: now(ctx), status: 'running', checkouts: 0, stocked: 0 }; // paid up front, exactly once
  return '';
}
/** 이 조건으로 채용: the existing employment record (09–17, trial wage), paid by the staff payroll below (C110 ②). */
export function hireTrial(ctx: TycoonCtx, s: StaffState): boolean {
  const t = s.trial, b = shopOf(ctx), npc = ctx.residents.find(n => n.id === t?.npcId);
  if (!t || t.status !== 'done' || !b || !npc) return false;
  try { hire(ctx.book, ctx.world.people, ctx.world.ledger, b.id, npc.id, { id: `${b.id}:staff:${ctx.book.employment.length}`, name: npc.job,
    placeId: b.placeId, employerId: 'player', fromMinute: 540, toMinute: 1020, durationMinutes: 480, hourlyWage: t.wage }, ctx.time); } catch { return false; }
  person(s, npc.id).pay ??= { min: 0, paid: 0, owed: 0 }; // C110: paid by the minute through the staff payroll, not the 09:00 shift
  return !!(t.status = 'hired');
}
/** True when the staff payroll pays this resident (the session then starts no 09:00 shift for them). */
export const staffPaid = (s: StaffState | undefined, npcId: string) => !!s?.people[npcId]?.pay;
/** This visit is still waiting or being checked out. */
export const inLine = (s: StaffState, ref: string) => s.queue.some(q => q.ref === ref) || Object.values(s.people).some(p => p.task?.ref === ref);
/** C110 ①: with staff at the counter the session queues the purchase intent instead of paying at once. */
export function takeOrder(ctx: TycoonCtx, s: StaffState, o: Omit<Order, 'kind' | 'minute'>) {
  s.queue.push({ kind: 'checkout', minute: now(ctx), ...o });
  s.counter!.credit--;
}
/** C110 ①: can the counter take one more customer this hour? Credit from the on-duty hands' throughput, fractions carried over. */
export function counterOpen(ctx: TycoonCtx, s: StaffState): boolean {
  const b = shopOf(ctx), hour = Math.floor(now(ctx) / 60), c = s.counter ??= { hour: -1, credit: 0 };
  if (b && c.hour !== hour) s.counter = { hour, credit: Math.min(b.capacity + 1, c.credit + counterShare(b.capacity, onDuty(ctx, s).map(id => skillOf(ctx, s, id, 'hand')))) };
  return s.counter.credit >= 1;
}
/** B13: floor(paid minutes × wage / 60) less what was already paid; a failed transfer stays owed. */
function payOut(ctx: TycoonCtx, s: StaffState, id: string, wage: number): boolean {
  const pay = s.people[id].pay!, amount = Math.floor(pay.min * wage / 60) - pay.paid;
  if (amount <= 0) return true;
  const ok = ctx.settle(ctx.nextId('staff'), [{ from: 'player', to: id, amount, reason: `Wage: staff:${id}` }]).ok;
  if (ok) pay.paid += amount;
  pay.owed = ok ? 0 : amount;
  return ok;
}
const jobOf = (ctx: TycoonCtx, id: string) => ctx.book.employment.filter(e => e.actorId === id && e.businessId === shopOf(ctx)?.id).at(-1);
/** B12 원인 해결: pay what is owed now; a notice given over wages (not long low morale) is withdrawn. */
export function payWages(ctx: TycoonCtx, s: StaffState, npcId: string): boolean {
  const p = s.people[npcId], e = jobOf(ctx, npcId);
  if (!p?.pay || !e || !payOut(ctx, s, npcId, e.job.hourlyWage)) return false;
  if (p.low < 5) p.notice = null;
  p.unpaid = 0;
  return true;
}
export const setPolicy = (s: StaffState, patch: Partial<StaffPolicy>) => { s.policy = { ...s.policy, ...patch, version: s.policy.version + 1 }; };
function order(ctx: TycoonCtx, s: StaffState, itemId: string, qty: number, approved: boolean): boolean {
  const b = shopOf(ctx), producer = ctx.residents.find(n => n.job === producerJobs[itemId]);
  if (!b || !producer) return false;
  if (!procure(ctx.book, ctx.world.people, ctx.world.ledger, b.id, producer, itemId, qty, unitCost(itemId), ctx.nextId('staff'), ctx.time).ok) return false;
  s.spent += qty * unitCost(itemId); if (!approved) s.refilled.push(itemId);
  return true;
}
const linesOf = (r: StaffRequest): Line[] => r.lines ?? [{ itemId: r.itemId, qty: r.qty }];
const quote = (lines: Line[]) => lines.reduce((n, l) => n + l.qty * unitCost(l.itemId), 0);
const empty = (ctx: TycoonCtx, itemId: string) => !shopOf(ctx)?.store.stock.some(x => x.itemId === itemId && x.displayed + x.backroom > 0);
/** 이번만 승인 / 거절: valid once for this request; on approval the shortage and the quote are checked again (C110 ④). */
export function answer(ctx: TycoonCtx, s: StaffState, id: string, approve: boolean): boolean {
  const r = s.requests.find(r => r.id === id && r.status === 'open'), b = shopOf(ctx);
  if (!r || !b) return false;
  if (r.kind === 'order' && approve) {
    const lines = linesOf(r).filter(l => empty(ctx, l.itemId));
    if (!lines.length) return !(r.status = 'resolved'); // already refilled: nothing to buy
    if (quote(lines) !== r.amount) { r.lines = lines; r.amount = quote(lines); return false; } // changed terms: shown again
  }
  r.status = approve ? 'approved' : 'rejected';
  if (r.kind === 'haggle') return answerHaggle(ctx, ctx.systems.patrons as PatronState, r.ref, approve) && approve;
  if (r.kind === 'booking') return approve && sell(ctx, s, b, { kind: 'checkout', ref: r.ref, itemId: r.itemId, minute: now(ctx), npcId: r.npcId, maxPrice: r.amount, count: r.qty });
  return approve && linesOf(r).filter(l => order(ctx, s, l.itemId, l.qty, true)).length > 0;
}
function ask(ctx: TycoonCtx, s: StaffState, r: Omit<StaffRequest, 'id' | 'status'>) {
  const same = s.requests.find(x => x.cause === r.cause && Math.floor(x.until / 1440) === Math.floor(r.until / 1440));
  if (same) { if (same.status === 'open') same.amount = r.amount; return; } // one message per problem per day
  s.requests.push({ ...r, id: ctx.nextId('staff'), status: 'open' });
}
/** Stock of this item not booked by another big spender waiting, at the counter or asked about (B6: booked goods are never sold to others). */
const free = (s: StaffState, b: NonNullable<ReturnType<typeof shopOf>>, o: Order) => {
  const x = b.store.stock.find(x => x.itemId === o.itemId), line = [...s.queue, ...Object.values(s.people).map(p => p.task?.order)];
  const asked = s.requests.filter(r => r.kind === 'booking' && r.status === 'open' && r.itemId === o.itemId && r.ref !== o.ref); // held while the boss decides
  return (x ? x.displayed + x.backroom : 0) - line.reduce((n, q) => n + (q && q !== o && q.itemId === o.itemId && (q.count ?? 1) > 1 ? q.count! : 0), 0) -
    asked.reduce((n, r) => n + r.qty, 0);
};
/** C110 ①: the existing C087 payment, run once when the checkout task ends; the customer's price, wallet and the stock are checked now. */
function sell(ctx: TycoonCtx, s: StaffState, b: NonNullable<ReturnType<typeof shopOf>>, o: Order): boolean {
  const purse = o.npcId ? ctx.purses[o.npcId] : undefined, st = b.store.stock.find(x => x.itemId === o.itemId);
  if (!purse || !st || o.maxPrice === undefined) return false;
  let count = 0;
  for (; count < (o.count ?? 1); count++) {
    if (free(s, b, o) < 1 && st.displayed + st.backroom > 0 || count && (funds(ctx.world.ledger, purse).spendable < st.price ||
        dayCashflow(ctx.world.ledger, purse, ctx.time.day).consumption + st.price > retailDemand.dailyBudget)) break;
    const id = count ? `${o.ref}:${count}` : o.ref;
    restock(b.store, o.itemId, 5);
    visitStore(b.store, ctx.world.ledger, id, purse.personId, { itemId: o.itemId, maxPrice: o.maxPrice }, 1, ctx.time);
    if (!checkoutBusiness(ctx.book, ctx.world.people, ctx.world.ledger, b.id, purse, id, ctx.time).ok) break;
  }
  const last = b.store.events.at(-1), result = count ? 'purchased' : last?.visitId === o.ref && last.reason !== 'purchased' ? last.reason : 'missing';
  if (ctx.systems.patrons) ctx.shopEvent?.({ npcId: purse.personId, businessId: b.id, itemId: o.itemId, price: st.price, count: Math.max(1, count), result });
  return count > 0;
}
const available = (ctx: TycoonCtx) => (ctx.world.ledger.balances.player ?? 0) - ctx.book.employment
  .filter(e => e.leftAt === null && e.job.employerId === 'player').reduce((n, e) => n + e.job.hourlyWage * e.job.durationMinutes / 60, 0);
function work(ctx: TycoonCtx, s: StaffState, id: string, m: number, away: boolean) {
  const boss = id === 'player', p = person(s, id), b = shopOf(ctx)!, touched = new Set<Skill>(); // B11: the boss uses the same work model
  const speed = rate(boss ? BOSS_HAND : skillOf(ctx, s, id, 'hand'));
  let budget = speed;
  for (let guard = 0; budget > 0 && guard < 8; guard++) {
    if (!p.task) {
      const shelf = b.store.stock.find(x => x.displayed < 3 && x.backroom > 0 && !Object.values(s.people).some(o => o.task?.itemId === x.itemId));
      const next = chooseTask(s.policy, s.queue.length, s.queue.length ? m - s.queue[0].minute : 0, !!shelf);
      if (next === 'rest') break;
      // B6 약속 시각 우선: a booked big spender (they come at their time) is the next checkout; nobody mid-checkout is interrupted.
      const at = next === 'checkout' && s.policy.reservationPriority === 'appointment' ? Math.max(0, s.queue.findIndex(q => (q.count ?? 1) > 1)) : 0;
      const q = next === 'checkout' ? s.queue.splice(at, 1)[0] : null, qty = shelf ? Math.min(5, shelf.backroom) : 0;
      if (q && (q.count ?? 1) > 1 && free(s, b, q) < q.count!) { // fewer goods than booked: changing a booking is the boss's call
        ask(ctx, s, { cause: `booking:${q.ref}`, kind: 'booking', itemId: q.itemId, qty: Math.max(0, free(s, b, q)), amount: q.maxPrice ?? 0,
          ref: q.ref, npcId: q.npcId, until: m + 30 });
        continue;
      }
      p.task = q ? { kind: q.kind, ref: q.ref, itemId: q.itemId, qty: 1, left: CHECKOUT_WORK, start: m, alone: away, order: q }
        : { kind: 'stock', ref: `${shelf!.itemId}:${m}`, itemId: shelf!.itemId, qty, left: qty * STOCK_WORK, start: m, alone: away };
      if (ctx.roll('staff', `mistake:${id}:${p.task.ref}`, m) < mistakeChance(boss ? BOSS_HAND : skillOf(ctx, s, id, 'eye'), 0, 0)) p.task.left += 2 * speed; // B11: two more minutes to recheck
    }
    const t = p.task, use = Math.min(budget, t.left);
    t.left -= use; budget -= use; t.alone &&= away;
    for (const k of t.kind === 'stock' ? ['eye'] as const : t.kind === 'haggle' ? ['hand', 'speech'] as const : ['hand', 'eye'] as const) touched.add(k);
    if (t.left > 0) break;
    p.task = null;
    if (t.kind === 'stock') restock(b.store, t.itemId, t.qty);
    else if (!(t.kind === 'haggle' ? answerHaggle(ctx, ctx.systems.patrons as PatronState, t.ref, true) : t.order && sell(ctx, s, b, t.order))) continue;
    if (boss) continue; // the boss's own work is not a staff record
    const kind = t.kind === 'checkout' && s.refilled.includes(t.itemId) && t.alone ? 'restock' : t.kind;
    if (kind === 'restock') s.refilled.splice(s.refilled.indexOf(t.itemId), 1);
    s.outcomes.push({ id: ctx.nextId('staff'), npcId: id, kind, start: t.start, end: m, policy: s.policy.version, alone: t.alone, ref: t.ref });
    if (s.trial?.status === 'running' && s.trial.npcId === id) t.kind === 'stock' ? s.trial.stocked += t.qty : s.trial.checkouts++;
  }
  if (!boss) for (const k of touched) p.exp[k]++; // experience only for minutes actually worked, once per skill
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
    for (const id of ids) if (s.people[id]?.pay) s.people[id].pay!.min++; // B10·B13: paid minutes are minutes actually on duty, late ones not
    for (const [id, p] of Object.entries(s.people)) { // payday at clock-out; minutes from a hire after the shift start join the next one
      const e = p.pay && jobOf(ctx, id);
      if (e && m % 1440 === e.job.toMinute && (e.leftAt !== null || e.hiredAt <= m - e.job.toMinute + e.job.fromMinute)) payOut(ctx, s, id, e.job.hourlyWage);
    }
    // B13: on duty, the staff work the same rules wherever the boss is (fastest hand first); after hours the boss, if here, finishes the queue.
    const workers = ids.length ? [...ids].sort((x, y) => skillOf(ctx, s, y, 'hand') - skillOf(ctx, s, x, 'hand')) : !away && s.queue.length ? ['player'] : [];
    for (const [id, p] of Object.entries(s.people)) if (p.task && !workers.includes(id)) { // off the counter mid-task: the customer waits again
      if (p.task.order) s.queue.unshift(p.task.order);
      p.task = null;
    }
    s.queue = s.queue.filter(q => workers.length && m - q.minute < PATIENCE);
    for (const id of workers) work(ctx, s, id, m, away);
    if (!ids.length || s.trial?.status === 'running' || s.policy.version < 2) return; // orders only once the boss has set the policies
    const groups = new Map<string, Line[]>();
    for (const x of b.store.stock) if (x.displayed + x.backroom === 0) groups.set(producerJobs[x.itemId], [...groups.get(producerJobs[x.itemId]) ?? [], { itemId: x.itemId, qty: 5 }]);
    for (const lines of groups.values()) { // B5 C110 ③: one refill decision per supplier, limits checked on its total
      const amount = quote(lines), problem = orderProblem(s.policy, amount, s.spent, available(ctx));
      if (problem) ask(ctx, s, { cause: `order:${lines.map(l => l.itemId).join('+')}`, kind: 'order', itemId: lines[0].itemId,
        qty: lines.reduce((n, l) => n + l.qty, 0), amount, ref: problem, until: m + 15, lines });
      else for (const l of lines) if (order(ctx, s, l.itemId, l.qty, false)) for (const r of s.requests) // C110 ④: done within the policy, so the request is settled
        if (r.status === 'open' && r.kind === 'order' && linesOf(r).some(x => x.itemId === l.itemId)) r.status = 'resolved';
    }
  },
  onShopEvent(ctx, s, e) {
    const b = shopOf(ctx), m = now(ctx);
    if (!b || e.businessId !== b.id || e.result !== 'haggle' || ctx.player.placeId === b.placeId || !onDuty(ctx, s).length) return;
    const visitId = `${e.businessId}:haggle:${e.npcId}:${ctx.time.day}`, list = b.store.stock.find(x => x.itemId === e.itemId)?.price ?? 0;
    const low = lowestPrice(list, s.policy.maxDiscountPercent, unitCost(e.itemId));
    if (low !== null && e.price >= low) s.queue.push({ kind: 'haggle', ref: visitId, itemId: e.itemId, minute: m }); // sold when the task ends
    else ask(ctx, s, { cause: `haggle:${e.npcId}`, kind: 'haggle', itemId: e.itemId, qty: 1, amount: e.price, ref: visitId, until: m + 60 });
  },
  onDay(ctx, s, day) {
    const b = shopOf(ctx), end = day * 1440 - 1;
    for (const e of ctx.book.employment) if (e.businessId === b?.id && e.leftAt === null && e.hiredAt <= end) {
      const p = person(s, e.actorId), unpaid = (p.pay?.owed ?? 0) > 0; // C110 ⑤: this person's own unpaid wages, not the shop's rent
      if (p.notice !== null && day >= p.notice) { e.leftAt = end; p.notice = null; continue; } // notice served: leaves, keeps experience
      p.morale = Math.max(0, Math.min(100, p.morale + (unpaid ? -5 : 1)));
      p.low = p.morale < 30 ? p.low + 1 : 0; p.unpaid = unpaid ? p.unpaid + 1 : 0;
      if (p.notice === null && ctx.roll('staff', `quit:${e.actorId}`, day) < quitChance(p.low >= 5, p.unpaid >= 2, false)) p.notice = day + 2;
    }
    s.outcomes = s.outcomes.filter(o => o.end >= (day - 2) * 1440);
    s.requests = s.requests.filter(r => r.status === 'open' || r.until >= (day - 1) * 1440);
  },
};
export function report(s: StaffState, day: number) {
  const r = closingReport(s.outcomes.filter(o => Math.floor(o.end / 1440) === day - 1)), p = Object.values(s.people).find(p => p.notice !== null);
  return p ? { ...r, text: `${reportLines.notice(p.notice!, p.pay?.owed ?? 0)} · ${r.text}` } : r; // C110 ⑤: a notice is shown first
}
