import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { gameTime } from '../../src/sim/clock';
import { transfer } from '../../src/sim/ledger';
import { answer, applicants, hireTrial, report, setPolicy, startTrial, type StaffState } from '../../src/game/tycoon/staff';
function setup(data = new Map<string, string>()) {
  const session = createSession({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }, 123), { state } = session;
  const total = () => Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0);
  for (const from of ['nuel', 'sori', 'aro', 'velo']) transfer(state.world.ledger, { id: `capital:${from}`, from, to: 'player', amount: 300,
    time: gameTime(state.world.clock), reason: 'Capital transfer' });
  session.rentStore('shop-unit'); const b = session.openShop('tea');
  for (const id of ['tea', 'bread', 'soup']) session.orderStock(id === 'soup' ? 'iri' : 'nuel', id, 20);
  state.player.placeId = 'shop'; const advance = (minutes: number) => session.tick(minutes / state.world.clock.minutesPerSecond);
  const staff = () => session.tycoon.state().systems.staff as StaffState; const cmd = <T>(fn: (c: ReturnType<typeof session.tycoon.ctx>, s: StaffState) => T) => session.tycoon.command('staff', fn);
  return { session, state, b, total, advance, staff, cmd, data };
}
// Day 2 10:30: stock arrived; a one-hour paid trial beside the boss, then hire on the trial's terms with the recommended policies.
function hired(f = setup()) {
  f.advance(1440 + 630);
  const [a] = applicants(f.session.tycoon.ctx()), cash = f.state.world.ledger.balances.player;
  expect(f.cmd((c, s) => startTrial(c, s, a.npc.id))).toBe(''); expect(f.cmd((c, s) => startTrial(c, s, a.npc.id))).toBe('unavailable');
  expect(f.state.world.ledger.balances.player).toBe(cash - a.wage); f.advance(60); expect(f.staff().trial!.status).toBe('done');
  expect(f.cmd(hireTrial)).toBe(true); expect(f.cmd(hireTrial)).toBe(false); f.cmd((_, s) => setPolicy(s, {}));
  return { ...f, id: a.npc.id, wage: a.wage };
}
it('C097 ①⑧: the trial wage is paid exactly once; experience stays; hire uses the existing employment and payroll', () => {
  const f = hired(), start = f.total();
  expect(f.state.world.ledger.transactions.filter(t => t.reason === 'Wage: staff-trial').map(t => [t.to, t.amount])).toEqual([[f.id, f.wage]]);
  const e = f.state.book.employment.find(e => e.actorId === f.id && e.leftAt === null)!; expect([e.job.hourlyWage, e.job.fromMinute, e.job.toMinute]).toEqual([f.wage, 540, 1020]);
  const t = f.staff().trial!, exp = f.staff().people[f.id].exp;
  expect(t.checkouts + t.stocked).toBeGreaterThan(0); expect(exp.hand + exp.eye).toBeGreaterThan(0); // stays if not hired too
  const idle = setup(); idle.advance(600); const [a] = applicants(idle.session.tycoon.ctx()); // day 1: no stock, no customers yet
  idle.cmd((c, s) => startTrial(c, s, a.npc.id)); idle.advance(60);
  expect([idle.staff().trial!.checkouts, idle.staff().trial!.stocked, idle.staff().people[a.npc.id].exp, idle.staff().outcomes]).toEqual([0, 0, { hand: 0, eye: 0, speech: 0 }, []]);
  f.state.player.placeId = 'park'; f.advance(1440 * 2); // boss away: sales go on, payroll by the session as before
  expect(f.state.world.ledger.transactions.filter(t => t.reason.startsWith('Wage: ') && t.to === f.id).length).toBe(3);
  expect(f.staff().outcomes.some(o => o.alone && o.npcId === f.id)).toBe(true); expect(f.total()).toBe(start);
  const r = report(f.staff(), f.state.world.clock.totalMinutes / 1440 | 0);
  expect(r.evidence.every(o => o.alone && f.staff().outcomes.includes(o))).toBe(true); expect(r.text).not.toBe('');
});
it('C097 ②③④: over the limit asks once, unanswered keeps selling, approval runs once, policy change keeps paid orders', () => {
  const f = hired(), tea = f.b.store.stock.find(s => s.itemId === 'tea')!;
  f.cmd((_, s) => setPolicy(s, { orderApprovalLimit: 0 })); f.state.player.placeId = 'park';
  f.advance(840 - (f.state.world.clock.totalMinutes % 1440)); tea.backroom = tea.displayed = 0; f.advance(5); f.advance(5);
  const asks = () => f.staff().requests.filter(r => r.cause === 'order:tea'); expect(asks()).toHaveLength(1); expect(asks()[0].status).toBe('open');
  const sold = f.b.store.events.filter(e => e.reason === 'purchased').length, paid = () => f.state.world.ledger.transactions.filter(t => t.reason.startsWith('Procurement: shop:lease:0:tea:5')).length;
  expect([f.cmd((c, s) => answer(c, s, asks()[0].id, true)), f.cmd((c, s) => answer(c, s, asks()[0].id, true))]).toEqual([true, false]);
  expect(paid()).toBe(1); expect(asks()[0].status).toBe('approved'); expect(f.staff().refilled).not.toContain('tea'); // approved: not solo
  f.advance(120); expect(f.b.store.events.filter(e => e.reason === 'purchased').length).toBeGreaterThan(sold); expect(asks()).toHaveLength(1);
  f.cmd((_, s) => setPolicy(s, { dailyBudget: 0 })); expect(paid()).toBe(1);
});
it('C097 ⑧: split ticks and save/restore give the same staff state and money', () => {
  const a = hired(), b = hired(setup());
  a.state.player.placeId = b.state.player.placeId = 'park'; a.advance(1440); for (let i = 0; i < 24; i++) b.advance(60);
  expect(b.staff()).toEqual(a.staff()); expect(b.state.world.ledger.balances).toEqual(a.state.world.ledger.balances);
  a.session.saveNow(); const c = createSession({ getItem: k => a.data.get(k) ?? null, setItem: () => {} }, 123);
  expect(c.tycoon.state().systems.staff).toEqual(a.staff());
});
