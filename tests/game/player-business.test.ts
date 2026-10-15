import { expect, it } from 'vitest';
import { createSession, SESSION_KEY } from '../../src/game/session';
import { emptyBond, edgeKey, readBond } from '../../src/sim/bonds';
import { gameTime } from '../../src/sim/clock';
import { transfer } from '../../src/sim/ledger';
import { dayCashflow } from '../../src/sim/purse';
function setup(seed = 123) {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const session = createSession(storage, seed), { state } = session;
  const total = () => Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0);
  const initial = total();
  for (const from of ['nuel', 'sori', 'aro', 'iri', 'velo', 'lise']) expect(transfer(state.world.ledger, { id: `capital:${from}`, from, to: 'player', amount: 300,
    time: gameTime(state.world.clock), reason: 'Capital transfer' }).ok).toBe(true);
  const advance = (minutes: number) => session.tick(minutes / state.world.clock.minutesPerSecond);
  const friend = (id = 'velo') => { state.bonds.edges[edgeKey(id, 'player')] = { ...emptyBond(), trust: 30, respect: 20, met: true }; };
  return { session, state, storage, total, initial, advance, friend };
}
it('C085: 30-day shared customer loop, cash reports, payroll, delivery and conservation', () => {
  const f = setup(), { session: s, state, advance } = f;
  const lease = s.rentStore('cafe-unit'), b = s.openShop('tea');
  expect(b.store.stock.every(x => x.backroom === 0 && x.displayed === 0)).toBe(true);
  expect(s.offerJob('velo', 4)).toEqual({ accepted: false, reason: 'job.refuse.trust' });
  f.friend(); expect(s.offerJob('velo', 3).reason).toBe('job.refuse.wage');
  expect(s.offerJob('velo', 4).accepted).toBe(true);
  expect(s.orderStock('sori', 'tea', 5).ok).toBe(false);
  expect(s.orderStock('nuel', 'tea', 24).ok).toBe(true);
  expect(b.store.stock[0].backroom).toBe(0);
  s.setShopPrice('tea', 8);
  let revenue = 0, cost = 0, rent = 0, wages = 0, net = 0, visits = 0;
  for (let day = 1; day <= 30; day++) {
    const before = state.world.ledger.balances.player;
    advance(1440);
    expect(f.total()).toBe(f.initial);
    const report = lease.reports.at(-1)!;
    expect(report.day).toBe(day);
    expect(report.net).toBe(report.revenue - report.cost - report.rent - report.wages);
    expect(report.net).toBe(dayCashflow(state.world.ledger, state.purses.player, day).net - (day === 1 ? 1760 : 0));
    expect(state.world.ledger.balances.player - before).toBe(report.net + (day === 1 ? 48 : 0));
    revenue += report.revenue; cost += report.cost; rent += report.rent; wages += report.wages; net += report.net; visits += report.visits;
    if (day === 1) expect(b.store.stock[0].backroom).toBe(24);
    if (day === 2) expect(report.sales).toBeGreaterThan(0);
  }
  expect(state.player.placeId).toBe('nest');
  expect(revenue).toBeGreaterThan(0); expect(wages).toBe(30 * 8 * 4); expect(rent).toBe(120);
  expect(lease.reports).toHaveLength(7); expect(lease.ended).toBe(false);
  expect(b.store.stock[0].backroom + b.store.stock[0].displayed).toBe(24 - revenue / 8);
  expect(lease.reports.some(r => r.complaints.missing > 0)).toBe(true);
  console.log('C085 30 days', { revenue, cost, rent, wages, net, visits, total: f.total() });
}, 120000);
it('C085: staffing hours, dismissal, price complaints and retained unpaid wages', () => {
  const { session: s, state, advance, friend } = setup();
  const l = s.rentStore('cafe-unit'), b = s.openShop('tea');
  s.orderStock('nuel', 'tea', 5); advance(1440 + 480);
  expect(b.store.events).toHaveLength(0); // No staff, even with delivered inventory.
  friend(); s.offerJob('velo', 4); advance(60);
  expect(state.world.people.velo.placeId).toBe('cafe'); state.player.placeId = 'cafe';
  expect(() => s.expressFeelings('velo')).not.toThrow(); state.player.placeId = 'nest'; advance(1380);
  expect(b.store.events.some(e => e.reason === 'purchased')).toBe(true);
  s.setShopPrice('tea', 1000); advance(1440);
  expect(l.reports.some(r => r.complaints.expensive > 0)).toBe(true);
  expect(state.reputation.player).toBeLessThan(0);
  s.fireEmployee('velo');
  expect(readBond(state.bonds, 'velo', 'player').trust).toBe(20);
  const count = b.store.events.length; advance(1440);
  expect(b.store.events).toHaveLength(count);
  expect(state.work.shifts.filter(x => x.employerId === 'player').every(x => x.paid)).toBe(true);
}, 30000);
it('C085: rent and wages warn, close on third unpaid day, preserve debt and refund only escrow', () => {
  const { session: s, state, advance, friend, total, initial } = setup();
  const l = s.rentStore('shop-unit'), b = s.openShop('general'); friend(); s.offerJob('velo', 4);
  expect(s.orderStock('aro', 'lamp', 2).ok).toBe(true);
  expect(s.orderStock('aro', 'chime', 2).ok).toBe(true);
  s.setShopPrice('lamp', 1000); s.setShopPrice('chime', 1000);
  transfer(state.world.ledger, { id: 'spend', from: 'player', to: 'sori', amount: state.world.ledger.balances.player,
    time: gameTime(state.world.clock), reason: 'Other spending' });
  advance(1440); expect(l.warning).toBe('shop.unpaid'); expect(l.arrears).toBe(1);
  advance(2880); expect(l.ended).toBe(true); expect(b.closedAt).not.toBeNull();
  expect(l.warning).toBe('shop.closed.arrears'); expect(l.rentDue).toHaveLength(3);
  expect(state.world.ledger.balances.player).toBe(48); expect(total()).toBe(initial);
  expect(state.work.shifts.some(x => x.employerId === 'player' && !x.paid)).toBe(true);
  advance(1440); expect(total()).toBe(initial); // Debt can be paid after closure; no wages erased.
  const f = setup(); f.session.rentStore('cafe-unit'); const cash = f.state.world.ledger.balances.player;
  f.session.terminateStore(); expect(f.state.world.ledger.balances.player).toBe(cash + 32); expect(f.total()).toBe(f.initial);
}, 30000);
it('C085: pending delivery restores exactly, old saves default, same seed reproduces', () => {
  const a = setup(), b = setup();
  for (const f of [a, b]) {
    f.session.rentStore('shop-unit'); f.session.openShop('tea'); f.friend(); f.session.offerJob('velo', 4);
    f.session.orderStock('nuel', 'bread', 8); f.advance(600); f.session.saveNow();
  }
  const restored = createSession(a.storage); expect(restored.loadResult.ok).toBe(true);
  expect(restored.state.world.people.velo.placeId).toBe('shop');
  restored.tick(3000); b.advance(3000);
  expect(restored.state.book).toEqual(b.state.book); expect(restored.state.leases).toEqual(b.state.leases);
  expect(restored.state.world.ledger).toEqual(b.state.world.ledger);
  expect(createSession(a.storage).loadResult.ok).toBe(true);
  const old = setup(); old.session.saveNow();
  const parsed = JSON.parse(old.storage.getItem(SESSION_KEY)!); delete parsed.state.leases;
  old.storage.setItem(SESSION_KEY, JSON.stringify(parsed));
  const legacy = createSession(old.storage); expect(legacy.loadResult.ok).toBe(true); expect(legacy.state.leases).toEqual([]);
}, 30000);
