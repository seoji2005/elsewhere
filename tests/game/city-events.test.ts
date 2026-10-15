import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { gameTime } from '../../src/sim/clock';
import { isRecorded, transfer } from '../../src/sim/ledger';
import { tycoonSystems } from '../../src/game/tycoon/registry';
import { park, parkingSpaces, type PatronState } from '../../src/game/tycoon/patrons';
import { cityEvents, CITY, readNotice, respond } from '../../src/game/tycoon/cityEvents';
import { authorizeProblem, closure, validCauses, type CityState } from '../../src/sim/cityEvents';

const START = 3 * 1440 + 420, END = START + 14 * 1440; // ordered at day 1's close → day 4 07:00 for 14 days
const ad = { id: 'ad', create: () => ({}), validate: (raw: unknown) => raw as object, visitBonus: () => 40 };
function setup(data = new Map<string, string>(), systems = tycoonSystems, load = false) {
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const session = createSession(storage, 123, systems, undefined, true), { state } = session;
  const total = () => Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0), initial = total();
  if (!load) {
    for (const from of ['nuel', 'sori', 'velo', 'lise']) transfer(state.world.ledger, { id: `capital:${from}`, from, to: 'player',
      amount: 300, time: gameTime(state.world.clock), reason: 'Capital transfer' });
    session.rentStore('cafe-unit'); session.openShop('tea');
    for (const id of ['tea', 'bread']) session.orderStock('nuel', id, 30);
    state.player.placeId = 'cafe';
  }
  const to = (m: number) => session.tick((m - state.world.clock.totalMinutes) / state.world.clock.minutesPerSecond);
  const city = () => session.tycoon.state().systems.cityEvents as CityState, bal = (id: string) => state.world.ledger.balances[id];
  const cmd = <T>(fn: (c: ReturnType<typeof session.tycoon.ctx>, s: CityState) => T) => session.tycoon.command('cityEvents', fn);
  return { session, state, total, initial, to, city, bal, cmd, ctx: session.tycoon.ctx };
}

it('C100 1: no order without a repair request, tax revenue, city funds or free workers; then exactly 280 is escrowed', () => {
  const s = cityEvents.create(setup().ctx());
  expect(authorizeProblem(s, 360, 4)).toBe('No repair request');
  s.requests.push({ id: 'r', roadId: 'alley', minute: 0, resolvedAt: null });
  expect(authorizeProblem(s, 360, 4)).toBe('Budget pending'); // unpaid tax is no revenue
  s.revenue = 280; expect(authorizeProblem(s, 359, 4)).toBe('City funds low');
  expect(authorizeProblem(s, 360, 3)).toBe('Workers unavailable'); expect(authorizeProblem(s, 360, 4)).toBe('');
  const f = setup(); f.to(1439);
  expect(f.city().events).toHaveLength(0); expect(f.bal(CITY)).toBe(360);
  f.to(1441);
  expect(f.city().events).toHaveLength(1); expect(f.bal('escrow:roadworks:0')).toBe(280);
  expect(f.bal(CITY)).toBe(80 + f.city().revenue - 280); expect(f.total()).toBe(f.initial);
  expect(setup(undefined, tycoonSystems.filter(x => x !== cityEvents)).state.world.ledger.balances[CITY]).toBeUndefined();
});

it('C100 2: announced 2+ full days ahead; street parking until the start minute, none during, back at the end minute', () => {
  const f = setup(); f.to(1441);
  const e = f.city().events[0], hog = () => park(f.ctx(), { ...(f.state.tycoon.systems.patrons as PatronState), parking: [] }, 'x', 'bigSpender');
  expect([e.startAt, e.endAt, e.startAt - e.announcedAt >= 2 * 1440]).toEqual([START, END, true]);
  f.to(START - 1); expect(hog()).toBe(true); expect(e.stage).toBe('announced');
  f.to(START); expect(hog()).toBe(false); expect(f.city().events[0].stage).toBe('active');
  f.to(END - 1); expect(hog()).toBe(false);
  f.to(END); expect(hog()).toBe(true); expect(f.city().events[0].stage).toBe('ended'); expect(parkingSpaces).toBe(2);
});

it('C100 3, 8: materials 56 and wages 224 move exactly; one long tick, split ticks and save/resume agree; no re-order', () => {
  const a = setup(); a.to(20 * 1440);
  const e = a.city().events[0];
  expect(a.bal(e.escrowId)).toBe(0); expect(a.total()).toBe(a.initial);
  expect(isRecorded(a.state.world.ledger, `${e.id}:materials:0`)).toBe(true); // 280 − 56 − 14 days × 4 crew × 4 = 0
  expect(Array.from({ length: 16 }, (_, d) => e.workers.every((_, i) => isRecorded(a.state.world.ledger, `${e.id}:wage:${d + 1}:${i}`))))
    .toEqual([false, false, ...Array(14).fill(true)]);
  expect(a.city().events).toHaveLength(1); expect(a.city().requests[0].resolvedAt).toBe(END);
  const b = setup(); for (let m = 0; m < 20 * 1440; m += 480) b.to(m + 480);
  const data = new Map<string, string>(); let c = setup(data);
  for (const m of [1441, START - 1, START + 3000, END - 1, 20 * 1440]) { c.to(m); c.session.saveNow(); c = setup(data, tycoonSystems, true); }
  for (const x of [b, c]) {
    expect(x.session.tycoon.state()).toEqual(a.session.tycoon.state());
    expect(x.state.world.ledger.balances).toEqual(a.state.world.ledger.balances);
  }
});

it('C100 4: every roadworks record has a valid parent chain; depth 3 and cycles are refused; repeated notices change nothing', () => {
  const f = setup(); f.to(START + 1440);
  const causes = f.city().causes; expect(validCauses(causes)).toBe(true);
  expect(causes.map(c => [c.kind, c.depth])).toEqual([['maintenanceAuthorization', 0], ['roadworks', 1], ['shopImpact', 2]]);
  expect(validCauses([...causes, { id: 'x', kind: 'shopImpact', parentId: causes[2].id, depth: 2, sourceIds: [], minute: 0 }])).toBe(false);
  expect(validCauses([{ ...causes[0], parentId: 'b', depth: 1 }, { ...causes[1], id: 'b', parentId: causes[0].id, depth: 1 }])).toBe(false);
  const before = JSON.stringify([f.city().events.length, f.state.world.ledger.balances]);
  f.cmd((c, s) => { readNotice(c, s); readNotice(c, s); });
  expect(JSON.stringify([f.city().events.length, f.state.world.ledger.balances])).toBe(before);
  expect(new Set(f.city().notices.map(n => `${n.eventId}:${n.observerId}`)).size).toBe(f.city().notices.length);
});

it('C100 5, 7: +40 ads cannot get a car past the closure; walkers still come; the paid lot never seats a third car', () => {
  const f = setup(new Map(), [...tycoonSystems, ad]); f.to(START + 60);
  const pat = { ...(f.session.tycoon.state().systems.patrons as PatronState), parking: [] as number[] };
  expect(park(f.ctx(), pat, 'x', 'bigSpender')).toBe(false); expect(park(f.ctx(), pat, 'x', 'regular')).toBe(true);
  const cash = f.bal('player'), iri = f.bal('iri');
  expect([1, 2].map(() => f.cmd((c, s) => respond(c, s, 'parking')))).toEqual([true, false]);
  expect([f.bal('player'), f.bal('iri')]).toEqual([cash - 28, iri + 28]); // 14 days × 2
  expect([1, 2, 3].map(() => park(f.ctx(), pat, 'x', 'bigSpender'))).toEqual([true, true, false]);
  expect(f.cmd((c, s) => respond(c, s, 'none'))).toBe(true); expect(f.bal('player')).toBe(cash - 28); // ignoring costs nothing
  f.to(END); expect(closure(f.city(), END)).toBeUndefined(); expect(park(f.ctx(), { ...pat, parking: [] }, 'x', 'bigSpender')).toBe(true);
  expect(f.total()).toBe(f.initial);
});

it('C100 6, 7: only crew members get +15 at 09:00, a displayed menu adds +10, and a fed worker is not sold breakfast again', () => {
  const f = setup(); f.to(START + 60);
  const e = f.city().events[0], [w] = e.workers, other = f.ctx().residents.find(n => !e.workers.includes(n.id))!.id;
  const bonus = (npcId: string, hour = 9) => cityEvents.visitBonus!(f.ctx(), f.city(), { npcId, businessId: 'shop:lease:0', hour });
  expect(bonus(w, 8)).toBe(-100); // on the road, not a customer
  expect([bonus(w), bonus(other)]).toEqual([15, 0]);
  expect(['scarf', 'bread'].map(id => f.cmd((c, s) => respond(c, s, 'breakfast', id)))).toEqual([false, true]);
  const bread = f.state.book.businesses.find(b => b.id === 'shop:lease:0')!.store.stock.find(st => st.itemId === 'bread')!;
  expect(bonus(w)).toBe(bread.displayed > 0 ? 25 : 15);
  f.to(START + 120); expect(f.ctx().placeOf(w)).toBe('cafe');
  f.to(START + 1440 + 120);
  const ate = e.workers.find(id => f.state.book.businesses.some(b => b.store.events.some(x => x.actorId === id && x.time.day === 5 && x.reason === 'purchased')));
  if (ate) expect(bonus(ate)).toBe(-100);
  f.to(END + 1440);
  expect(e.workers.map(bonus)).toEqual([0, 0, 0, 0]); expect(f.city().events[0].responses.at(-1)?.itemId).toBe('bread');
});
