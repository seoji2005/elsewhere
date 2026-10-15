import { expect, it } from 'vitest';
import { createSession, SESSION_KEY } from '../../src/game/session';
import { gameTime } from '../../src/sim/clock';
import { transfer } from '../../src/sim/ledger';
import { CARRY_LIMIT, dropAtShop, pickupOrder, type HaulState } from '../../src/game/tycoon/haul';

function setup(seed = 123, fees?: boolean, data = new Map<string, string>()) {
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const session = createSession(storage, seed, undefined, fees), { state } = session;
  const total = () => Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0);
  transfer(state.world.ledger, { id: 'capital', from: 'nuel', to: 'player', amount: 200, time: gameTime(state.world.clock), reason: 'Capital transfer' });
  session.rentStore('shop-unit'); const b = session.openShop('tea');
  session.tick(600 / state.world.clock.minutesPerSecond); // day 1, 10:00
  const tea = () => b.store.stock.find(s => s.itemId === 'tea')!;
  const haul = () => state.tycoon.systems.haul as HaulState;
  const pickup = (qty: number, item = 'tea', producer = 'nuel') => session.tycoon.command('haul', (ctx, s: HaulState) => pickupOrder(ctx, s, producer, item, qty));
  const drop = () => session.tycoon.command('haul', (ctx, s: HaulState) => dropAtShop(ctx, s));
  const goTo = (placeId: string) => { state.player.placeId = placeId; };
  const atProducer = () => goTo(session.tycoon.ctx().placeOf('nuel'));
  return { session, state, storage, data, b, tea, haul, pickup, drop, goTo, atProducer, total };
}

it('C096: pickup then drop puts the exact boxes in the backroom; repeats never duplicate stock', () => {
  const f = setup(), start = f.total(), cash = f.state.world.ledger.balances.player;
  f.atProducer(); expect(f.pickup(5).ok).toBe(true);
  expect(f.haul().load).toEqual({ tea: 5 }); expect(f.session.moveSpeed()).toBe(0.8);
  expect(f.state.world.ledger.balances.player).toBe(cash - 5 * 2); // producer's cost, no delivery fee
  expect(f.drop()).toBe(0); expect(f.tea().backroom).toBe(0); // not inside the shop yet
  f.goTo('shop'); expect(f.drop()).toBe(5); expect(f.drop()).toBe(0);
  expect(f.tea().backroom).toBe(5); expect(f.haul().load).toEqual({}); expect(f.session.moveSpeed()).toBe(1);
  const id = f.state.world.ledger.transactions.find(t => t.reason.startsWith('Procurement: shop:lease:0:tea:5'))!.id.replace(/:0$/, '');
  expect(f.session.tycoon.ctx().settle(id, [{ from: 'player', to: 'nuel', amount: 10, reason: 'again' }])).toEqual({ ok: true, duplicate: true });
  expect(f.tea().backroom).toBe(5); expect(f.total()).toBe(start);
  expect(f.state.leases[0].reports).toHaveLength(0);
});

it('C096: refused away from the producer, outside 07–19, above the carry limit or for a wrong producer', () => {
  const f = setup(), cash = f.state.world.ledger.balances.player;
  f.goTo(f.session.tycoon.ctx().placeOf('nuel') === 'park' ? 'office' : 'park');
  expect(f.pickup(1)).toEqual({ ok: false, error: 'Producer elsewhere' });
  f.atProducer();
  expect(f.pickup(CARRY_LIMIT + 1)).toEqual({ ok: false, error: 'Too much to carry' });
  expect(f.pickup(0).ok).toBe(false); expect(f.pickup(1, 'tea', 'aro').ok).toBe(false); expect(f.pickup(1, 'lamp', 'aro').ok).toBe(false);
  expect(f.pickup(8).ok).toBe(true); expect(f.pickup(5)).toEqual({ ok: false, error: 'Too much to carry' });
  expect(f.pickup(4).ok).toBe(true); expect(f.haul().load).toEqual({ tea: 12 });
  expect(f.state.world.ledger.balances.player).toBe(cash - 12 * 2);
  f.goTo('shop'); expect(f.drop()).toBe(12);
  f.session.tick((1200 - 600) / f.state.world.clock.minutesPerSecond); // 20:00
  f.atProducer(); expect(f.pickup(1, 'bread')).toEqual({ ok: false, error: 'Producer closed' });
  expect(f.state.world.ledger.transactions.filter(t => t.reason.startsWith('Procurement: shop:lease:0:')).map(t => t.amount)).toEqual([16, 8]);
});

it('C096: delivery fee goes producer → courier only in a new game; money is conserved', () => {
  for (const fees of [false, true]) {
    const f = setup(123, fees), start = f.total(), cash = f.state.world.ledger.balances.player, sori = f.state.world.ledger.balances.sori;
    expect(f.session.deliveryCost('tea', 5)).toBe(fees ? 2 : 0); expect(f.session.deliveryCost('tea', 30)).toBe(fees ? 6 : 0);
    expect(f.session.orderStock('nuel', 'tea', 30).ok).toBe(true);
    expect(f.state.world.ledger.balances.player).toBe(cash - 60 - (fees ? 6 : 0));
    expect(f.state.world.ledger.balances.sori).toBe(sori + (fees ? 6 : 0));
    expect(f.state.world.ledger.transactions.some(t => t.reason.startsWith('Delivery: ') && t.from === 'nuel' && t.to === 'sori')).toBe(fees);
    expect(f.total()).toBe(start);
    f.session.tick(1440 / f.state.world.clock.minutesPerSecond); expect(f.tea().backroom + f.tea().displayed).toBe(30);
  }
  const loaded = setup(123, true), again = createSession(loaded.storage, undefined, undefined, true);
  expect((again.state.tycoon.systems.haul as HaulState).fee).toBe(true);
  const old = setup(123, false), reopened = createSession(old.storage);
  expect(reopened.deliveryCost('tea', 5)).toBe(0); // an existing game stays without fees
});

it('C096: carried boxes survive save/load; one long tick equals minute ticks', () => {
  const f = setup(); f.atProducer(); f.pickup(3); f.session.saveNow();
  expect(JSON.parse(f.data.get(SESSION_KEY)!).version).toBe(6);
  const restored = createSession(f.storage); expect(restored.loadResult.ok).toBe(true);
  expect((restored.state.tycoon.systems.haul as HaulState).load).toEqual({ tea: 3 }); expect(restored.moveSpeed()).toBe(0.8);
  const whole = setup(7), split = setup(7);
  for (const g of [whole, split]) { g.atProducer(); expect(g.pickup(4).ok).toBe(true); g.goTo('shop'); g.drop(); }
  whole.session.tick(1440 / whole.state.world.clock.minutesPerSecond);
  for (let i = 0; i < 1440; i++) split.session.tick(1 / split.state.world.clock.minutesPerSecond);
  expect(split.state.world.ledger.balances).toEqual(whole.state.world.ledger.balances);
  expect(split.state.book).toEqual(whole.state.book); expect(split.state.tycoon).toEqual(whole.state.tycoon);
});
