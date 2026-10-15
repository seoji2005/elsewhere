import { expect, it } from 'vitest';
import { createSession, SESSION_KEY } from '../../src/game/session';
import { emptyBond, edgeKey } from '../../src/sim/bonds';
import { gameTime } from '../../src/sim/clock';
import { transfer } from '../../src/sim/ledger';
// C094 (GDD §2): skipping runs every minute through tick, and stops at the next thing worth waking for.
function shop() {
  const data = new Map<string, string>();
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const session = createSession(storage, 123), { state } = session;
  for (const from of ['nuel', 'sori', 'aro', 'iri', 'velo', 'lise']) transfer(state.world.ledger, { id: `capital:${from}`, from, to: 'player',
    amount: 300, time: gameTime(state.world.clock), reason: 'Capital transfer' });
  session.rentStore('cafe-unit'); session.openShop('tea');
  state.bonds.edges[edgeKey('velo', 'player')] = { ...emptyBond(), trust: 30, respect: 20, met: true };
  expect(session.offerJob('velo', 4).accepted).toBe(true);
  expect(session.orderStock('nuel', 'tea', 24).ok).toBe(true);
  return { session, state, data };
}
it('skipTo matches ticking the same minutes: ledger, shop, delivery, payroll', () => {
  const a = shop(), b = shop(), to = 3 * 1440 + 125;
  expect(a.session.skipTo(to).ok).toBe(true);
  b.session.tick(to - b.state.world.clock.totalMinutes);
  expect(a.state.world.clock.totalMinutes).toBe(to);
  for (const key of ['world', 'book', 'leases', 'work', 'economyMinute', 'purses', 'store'] as const) expect(a.state[key]).toEqual(b.state[key]);
  expect(JSON.parse(a.data.get(SESSION_KEY)!).state.economyMinute).toBe(to); // saved at the end
});
it('nextEvent picks the earliest candidate, and night skips to 07:00', () => {
  const { session, state } = shop();
  expect(session.nextEvent()).toEqual({ minute: 420, reason: '07:00 아침까지' });
  session.skipTo(420); expect(session.nextEvent()).toEqual({ minute: 540, reason: '09:00 영업 시작까지' });
  session.skipTo(540); expect(session.nextEvent()).toEqual({ minute: 1440, reason: '내일 00:00 상자 도착까지' });
  state.leases[0].orders[0].arrival = 840; // the box now comes before midnight
  expect(session.nextEvent()).toEqual({ minute: 840, reason: '14:00 상자 도착까지' });
  session.skipTo(840); expect(session.nextEvent()).toEqual({ minute: 1440 + 540, reason: '내일 09:00 직원 출근까지' });
  session.skipTo(21 * 60 + 30); expect(session.nextEvent()).toEqual({ minute: 1440 + 420, reason: '내일 07:00 아침까지' });
  session.skipTo(1440 + 600); state.book.employment.length = 0;
  expect(session.nextEvent()).toEqual({ minute: 1440 + 660, reason: '11:00까지' }); // nothing pending: one hour
});
it('a skip across arrival and payday delivers and pays exactly once', () => {
  const { session, state } = shop(), store = state.book.businesses.find(b => b.ownerId === 'player')!.store, order = state.leases[0].orders[0];
  const tea = () => store.stock.find(s => s.itemId === 'tea')!.backroom + store.stock.find(s => s.itemId === 'tea')!.displayed
    + store.events.filter(e => e.reason === 'purchased' && e.itemId === 'tea').length; // one unit per sale
  order.arrival = 840; session.skipTo(600);
  const before = tea(); session.skipTo(session.nextEvent().minute);
  expect(state.world.clock.totalMinutes).toBe(840); expect(order.delivered).toBe(true); expect(tea() - before).toBe(24);
  const wages = () => state.world.ledger.transactions.filter(t => state.work.shifts.some(s => s.actorId === 'velo' && s.id === t.id));
  expect(wages()).toHaveLength(0);
  for (let n = 0; n < 6; n++) session.skipTo(session.nextEvent().minute); // staff start, the next mornings
  expect(state.world.clock.totalMinutes).toBeGreaterThan(2 * 1440);
  const shifts = state.work.shifts.filter(s => s.actorId === 'velo' && s.paid);
  expect(shifts.length).toBeGreaterThan(0); expect(wages()).toHaveLength(shifts.length);
});
