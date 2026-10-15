import { expect, it } from 'vitest';
import { createSession, SESSION_KEY } from '../../src/game/session';
import { gameTime } from '../../src/sim/clock';
import { transfer } from '../../src/sim/ledger';
import { patrons, type PatronState } from '../../src/game/tycoon/patrons';
import { crowdOf, guessUsual, scene, type SceneState } from '../../src/game/tycoon/scene';
import type { ShopEvent, TycoonCtx } from '../../src/game/tycoon/system';

// As patrons.test: the owner stays in the cafe with stock delivered on day 2.
function setup(values = new Map<string, string>()) {
  const session = createSession({ getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); } }, 123), { state } = session;
  for (const from of ['nuel', 'sori', 'aro', 'iri', 'velo', 'lise']) transfer(state.world.ledger, { id: `capital:${from}`, from,
    to: 'player', amount: 300, time: gameTime(state.world.clock), reason: 'Capital transfer' });
  session.rentStore('cafe-unit'); const b = session.openShop('tea');
  for (const id of ['tea', 'bread', 'soup']) session.orderStock(id === 'soup' ? 'iri' : 'nuel', id, 20);
  state.player.placeId = 'cafe';
  const advance = (minutes: number) => session.tick(minutes / state.world.clock.minutesPerSecond);
  const sc = () => session.tycoon.state().systems.scene as SceneState;
  return { session, state, b, advance, sc, values };
}
// A hand-made floor: own scene and patrons states, any hour.
function floor() {
  const f = setup(), pat = patrons.create(f.session.tycoon.ctx()), s = scene.create(f.session.tycoon.ctx());
  const at = (hour: number): TycoonCtx => ({ ...f.session.tycoon.ctx(), time: { day: 3, hour, minute: 0 }, systems: { patrons: pat, scene: s } });
  const ids = f.session.tycoon.ctx().residents.map(n => n.id);
  const ev = (ctx: TycoonCtx, npcId: string, result: ShopEvent['result'] = 'purchased', itemId = 'tea') => {
    const e: ShopEvent = { npcId, businessId: f.b.id, itemId, price: 8, count: 1, result };
    patrons.onShopEvent!(ctx, pat, e); scene.onShopEvent!(ctx, s, e);
  };
  return { ...f, pat, s, at, ids, ev };
}

it('C095b: crowd level follows the customers in the shop this hour; drivers who could not park do not count', () => {
  const { s, at, ids, ev } = floor(), ctx = at(10), names: string[] = [];
  names.push(crowdOf(s).name);
  for (let i = 0; i < 8; i++) { ev(ctx, ids[i], i % 2 ? 'purchased' : 'expensive'); names.push(crowdOf(s).name); }
  expect(names).toEqual(['한산', '한산', '보통', '보통', '북적', '북적', '북적', '아수라장', '아수라장']);
  ev(ctx, ids[9], 'parkingFull'); ev(ctx, ids[0]);
  expect(s.present).toHaveLength(8);
  scene.onMinute!(at(11), s, (2 * 1440) + 11 * 60);
  expect(crowdOf(s).name).toBe('한산');
});

it('C095b: customers chat at most once an hour and only about a real record', () => {
  const { s, pat, at, ids, ev, b } = floor();
  const bread = b.store.stock.find(st => st.itemId === 'bread')!;
  bread.backroom = bread.displayed = 0;
  for (let i = 0; i < 4; i++) ev(at(1), ids[0]); // ids[0] is a regular
  for (let hour = 2; hour < 24; hour++) for (let i = 0; i < 8; i++) ev(at(hour), ids[i]);
  const talks = s.feed.filter(l => l.kind === 'talk');
  expect(talks.length).toBeGreaterThan(3);
  for (let hour = 2; hour < 24; hour++) expect(talks.filter(l => Math.floor(l.minute / 60) % 24 === hour).length).toBeLessThanOrEqual(2);
  for (const l of talks) {
    const [kind, a, c] = l.fact!.split(':');
    if (kind === 'price') expect(b.store.stock.find(st => st.itemId === a)?.price).toBe(Number(c));
    else if (kind === 'soldout') expect(b.store.stock.filter(st => st.backroom + st.displayed === 0).map(st => st.itemId)).toContain(a);
    else if (kind === 'regular') expect(pat.visits[a]).toBeGreaterThanOrEqual(3);
    else throw Error(`Unexpected fact ${l.fact}`); // nobody parked in this floor
  }
});

it('C095b: regulars show their name on the second visit, then ask for the usual; guessing moves no money', () => {
  const { s, at, ids, ev, state } = floor(), ctx = at(9), [mina, other] = ids, cash = { ...state.world.ledger.balances };
  ev(ctx, mina); expect(s.regulars[mina]).toBeUndefined();
  ev(ctx, mina, 'purchased', 'bread'); expect(s.regulars[mina]).toBe(1);
  expect(s.feed.at(-1)).toMatchObject({ npcId: mina, kind: 'again' });
  ev(ctx, mina, 'purchased', 'bread'); expect(s.regulars[mina]).toBe(2);
  expect(s.asks).toEqual([expect.objectContaining({ npcId: mina, itemId: 'bread' })]);
  expect(guessUsual(ctx, s, mina, 'bread')).toBe(true);
  expect(guessUsual(ctx, s, mina, 'bread')).toBe(false); // asked once
  for (let i = 0; i < 3; i++) ev(ctx, other, 'purchased', 'soup');
  expect(guessUsual(ctx, s, other, 'tea')).toBe(false);
  expect(s.feed.at(-1)!.text).toContain('수프');
  expect(s.guessed).toEqual({ [mina]: true, [other]: false });
  expect(state.world.ledger.balances).toEqual(cash);
});

it('C095b: three checkouts with the owner present get one "fast hands" line', () => {
  const { s, at, ids, ev, state } = floor();
  for (let i = 0; i < 5; i++) ev(at(14), ids[i]);
  expect(s.feed.filter(l => l.kind === 'fast')).toHaveLength(1);
  state.player.placeId = 'home';
  for (let i = 0; i < 5; i++) ev(at(15), ids[i]);
  expect(s.feed.filter(l => l.kind === 'fast')).toHaveLength(1);
});

it('C095b: the first sale is recorded once and never replays after a reload; split ticks agree', () => {
  const a = setup(), c = setup();
  a.advance(1440 * 3);
  for (let i = 0; i < 72; i++) c.advance(60);
  expect(c.sc()).toEqual(a.sc());
  const first = a.sc().first!;
  expect(first).toBeTruthy();
  expect(a.b.store.events.find(e => e.reason === 'purchased')).toMatchObject({ actorId: first.npcId, itemId: first.itemId, amount: first.price });
  expect(a.sc().feed.filter(l => l.kind === 'first')).toEqual([expect.objectContaining({ npcId: first.npcId, minute: first.minute })]);
  a.session.saveNow();
  expect(a.values.get(SESSION_KEY)).toBeTruthy();
  const again = createSession({ getItem: k => a.values.get(k) ?? null, setItem: () => {} }, 123);
  again.tick(1440 * 2 / again.state.world.clock.minutesPerSecond);
  const s = again.tycoon.state().systems.scene as SceneState;
  expect(s.first).toEqual(first);
  expect(s.feed.filter(l => l.kind === 'first' && l.minute !== first.minute)).toHaveLength(0);
});
