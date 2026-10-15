import { expect, it } from 'vitest';
import { createSession, SESSION_KEY } from '../../src/game/session';
import { gameTime } from '../../src/sim/clock';
import { isRecorded, transfer } from '../../src/sim/ledger';
import { tycoonSystems } from '../../src/game/tycoon/registry';
import { rival, rivalBonus, rivalView, type RivalState } from '../../src/game/tycoon/rival';
import { planDay, type RivalView } from '../../src/sim/rival';
import { segments } from '../../src/data/ads';
import { basePersona, customerOf } from '../../src/game/tycoon/patrons';

const DOREN = 'rival:doren';
function setup(data = new Map<string, string>(), systems = tycoonSystems) {
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); } };
  const session = createSession(storage, 123, systems, undefined, true), { state } = session;
  const total = () => Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0), initial = total();
  const move = (from: string, to: string, amount = state.world.ledger.balances[from]) => amount > 0 && transfer(state.world.ledger,
    { id: `move:${from}:${state.world.clock.totalMinutes}`, from, to, amount, time: gameTime(state.world.clock), reason: 'Test transfer' });
  for (const from of ['nuel', 'sori', 'velo', 'lise']) move(from, 'player', 300);
  session.rentStore('cafe-unit'); session.openShop('tea');
  for (const id of ['tea', 'bread']) session.orderStock('nuel', id, 30);
  state.player.placeId = 'cafe';
  const to = (m: number) => session.tick((m - state.world.clock.totalMinutes) / state.world.clock.minutesPerSecond);
  const rv = () => session.tycoon.state().systems.rival as RivalState, bal = (id: string) => state.world.ledger.balances[id];
  const shop = (id: string) => state.book.businesses.find(b => id === 'player' ? b.ownerId === 'player' : b.id === id)!;
  return { session, state, storage, total, initial, to, rv, bal, shop, move, ctx: session.tycoon.ctx };
}
const view = (o: Partial<RivalView> = {}): RivalView => ({ day: 5, minute: 5 * 1440 - 1, available: 100, discount: null, revenue7: 300, adRunning: false,
  items: [{ itemId: 'tea', price: 8, cost: 2, stock: 3, sold: [4, 5, 6] }, { itemId: 'bread', price: 10, cost: 2, stock: 30, sold: [1, 1, 1] }],
  observations: [{ kind: 'price', minute: 5 * 1440 - 100, itemId: 'tea', value: 8, source: 'look', via: 'doren' },
    { kind: 'queue', minute: 5 * 1440 - 100, itemId: '', value: 4, source: 'look', via: 'doren' }], ...o });

it('C099 1: the plan reads only Doren\'s books and saved observations', () => {
  const f = setup(); f.to(1440 + 60);
  const s = f.rv(), before = rivalView(f.ctx(), s, 2);
  f.move('player', 'aro', 100); f.shop('player').store.stock[0].backroom += 50; f.shop('player').store.stock[0].price = 3;
  expect(rivalView(f.ctx(), s, 2)).toEqual(before); expect(planDay(rivalView(f.ctx(), s, 2))).toEqual(planDay(before));
  const seen = { ...before, discount: null, observations: view().observations.map(o => ({ ...o, minute: before.minute - 10 })) };
  expect(planDay(seen).discount?.price).toBe(7); expect(planDay({ ...seen, observations: [] }).discount).toBeNull();
});

it('C099 2: a new world allocates 600 by transfers and pays 40 deposit + 20×2 stock; older saves stay without Doren', () => {
  const f = setup(); f.to(f.state.world.clock.totalMinutes + 1);
  expect([f.bal('doren'), f.rv().status, f.total()]).toEqual([520, 'operating', f.initial]);
  expect(isRecorded(f.state.world.ledger, 'rival:deposit:0') && isRecorded(f.state.world.ledger, 'rival:stock:tea')).toBe(true);
  const data = new Map<string, string>(), old = setup(data, tycoonSystems.filter(x => x !== rival)); old.to(1440 + 60); old.session.saveNow();
  const balances = { ...old.state.world.ledger.balances }, loaded = createSession({ getItem: k => data.get(k) ?? null, setItem: () => {} });
  expect([loaded.loadResult.ok, (loaded.tycoon.state().systems.rival as RivalState).status]).toEqual([true, 'unavailable']);
  expect(loaded.state.world.ledger.balances).toEqual(balances);
  loaded.tick(2 * 1440); expect(Object.hasOwn(loaded.state.world.ledger.balances, 'doren')).toBe(false);
});

it('C099 3: one intent is paid at one shop — no resident pays both shops in the same hour, Doren once a day', () => {
  const f = setup(); f.to(6 * 1440);
  const key = (e: { actorId: string; time: { day: number; hour: number } }) => `${e.actorId}:${e.time.day}:${e.time.hour}`;
  const ours = f.shop(DOREN).store.events.filter(e => e.reason === 'purchased'), theirs = f.shop('player').store.events.filter(e => e.reason === 'purchased');
  expect(ours.length).toBeGreaterThan(20); expect(theirs.length).toBeGreaterThan(5);
  expect(theirs.filter(e => ours.some(o => key(o) === key(e)))).toEqual([]);
  expect(new Set(ours.map(e => `${e.actorId}:${e.time.day}`)).size).toBe(ours.length);
});

it('C099 4: seen 8 with cost 2 → 7 from the day after the poster; cost stays; 3-day review, 21-day cap, cash defense, order caps', () => {
  const p = planDay(view());
  expect(p.discount).toMatchObject({ price: 7, originalPrice: 8, startedDay: 7, reviewDay: 10, hardEndDay: 28 });
  expect([p.prices.tea, p.orders.tea, p.orders.bread]).toEqual([8, 7, 0]); // ceil(2×5) − 3; bread has stock
  expect(planDay(view({ day: 6, discount: p.discount })).prices.tea).toBe(7);
  const late = (day: number, fresh: boolean) => planDay(view({ day, minute: day * 1440 - 1, discount: p.discount,
    observations: fresh ? view().observations.map(o => ({ ...o, minute: day * 1440 - 50 })) : view().observations }));
  expect([late(9, false).discount, late(9, false).prices.tea, late(27, true).discount]).toEqual([null, 8, null]);
  expect(late(9, true).discount).toMatchObject({ reviewDay: 13, hardEndDay: 28 });
  expect(planDay(view({ available: 0, discount: p.discount }))).toMatchObject({ discount: null, defend: true, prices: { tea: 8 }, orders: { tea: 2 } });
  expect(planDay(view({ items: [{ itemId: 'tea', price: 8, cost: 2, stock: 0, sold: [30, 30, 30] }] })).orders.tea).toBe(20);
  expect(planDay(view({ items: [{ itemId: 'tea', price: 8, cost: 2, stock: 1, sold: [] }] })).orders.tea).toBe(7);
  const f = setup(); f.to(12 * 1440); const orders = f.state.world.ledger.transactions.filter(t => t.id.startsWith('rival:order:'));
  expect(orders.length).toBeGreaterThan(0); expect(orders.every(t => t.amount === 2 * Number(t.reason.split(':').at(-2)))).toBe(true);
});

it('C099 5: the flyer moves exactly 20 once; 0.25 is +25%p; the result and promise check survive save/resume', () => {
  expect(planDay(view({ day: 7, available: 200 })).adBudget).toBe(30); expect(planDay(view({ day: 8 })).adBudget).toBe(0);
  const data = new Map<string, string>(), f = setup(data); f.to(1440 + 60);
  f.rv().plan = { ...f.rv().plan!, adBudget: 30 }; f.to(1440 + 421);
  const paid = f.state.world.ledger.transactions.filter(t => t.from === 'doren' && t.reason.startsWith('Ad:'));
  expect(paid.map(t => t.amount)).toEqual([20]); expect(f.rv().campaign?.messageId).toBe('price');
  f.shop(DOREN).store.stock.forEach(st => { st.price = 20; }); f.session.saveNow();
  const again = createSession({ getItem: k => data.get(k) ?? null, setItem: () => {} });
  for (const s of [f.session, again]) s.tick((4 * 1440 - s.state.world.clock.totalMinutes) / s.state.world.clock.minutesPerSecond);
  expect(again.tycoon.state().systems.rival).toEqual(f.rv()); expect(f.rv().campaign!.broken).toBe(true);
  const c = { id: 'x', startDay: 2, messageId: 'price' as const, broken: false, result: { ...f.rv().campaign!.result,
    peak: Object.fromEntries(segments.map(g => [g, 0.25])) as Record<typeof segments[number], number>, curve: [1, 1, 1] } };
  expect(rivalBonus({ ...f.ctx(), time: { day: 3, hour: 9, minute: 0 } }, { ...f.rv(), reputation: 0, campaign: c }, 'velo')).toBeCloseTo(25);
});

it.todo('C099 6: staff offers and joint orders — moved to a follow-up card (size limit)');

it('C099 7: three short closes → closing → closed two days later; rent stays a debt, the deposit needs the landlord to pay', () => {
  const f = setup();
  for (let day = 1; day <= 5; day++) { f.to(day * 1440 - 1); f.move('doren', 'aro'); if (day === 5) f.move('sori', 'aro'); f.to(day * 1440 + 1); }
  expect(f.rv()).toMatchObject({ status: 'closed', closeAt: 5, depositDue: 40, plan: null });
  expect(f.shop(DOREN).closedAt).not.toBeNull(); expect(f.rv().rentDue.length).toBeGreaterThan(0);
  const sales = f.shop(DOREN).store.events.length; f.move('aro', 'sori', 100); f.to(6 * 1440 + 1);
  expect([f.rv().depositDue, f.shop(DOREN).store.events.length, f.total()]).toEqual([0, sales, f.initial]);
});

it('C099 8: 30 days in one tick, hourly ticks and a mid-way save/resume agree; empty wallets stop sales; old orders never replay', () => {
  const a = setup(); a.to(30 * 1440);
  const b = setup(); for (let m = 60; m <= 30 * 1440; m += 60) b.to(m);
  const data = new Map<string, string>(), c = setup(data); c.to(11 * 1440 + 37); c.session.saveNow();
  const resumed = createSession({ getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) });
  resumed.tick((30 * 1440 - resumed.state.world.clock.totalMinutes) / resumed.state.world.clock.minutesPerSecond);
  for (const other of [b.state, resumed.state]) {
    expect(other.tycoon.systems.rival).toEqual(a.rv()); expect(other.world.ledger.balances).toEqual(a.state.world.ledger.balances);
  }
  const ledger = a.state.world.ledger, stock = a.shop(DOREN).store.stock[0], before = stock.backroom;
  expect(isRecorded(ledger, 'rival:order:2:tea') || isRecorded(ledger, 'rival:order:3:tea')).toBe(true); // compacted, still known
  const sold = (day: number) => a.shop(DOREN).store.events.filter(e => e.reason === 'purchased' && e.time.day === day).length, usual = sold(30);
  for (const n of a.ctx().residents) a.move(n.id, 'player'); // wages still come back, so sales fall rather than vanish
  a.to(32 * 1440); expect(sold(32)).toBeLessThan(usual / 2);
  expect(stock.backroom).toBeGreaterThanOrEqual(before); expect(a.total()).toBe(a.initial); expect(data.get(SESSION_KEY)).toBeTruthy();
}, 60000); // 30 days run three ways take ~6s

const paid = (f: ReturnType<typeof setup>, id: string) => f.shop(id).store.events.filter(e => e.reason === 'purchased');
it('C109 1·2: one intent, one paying shop (any hour); Doren is held to the same parking and price tolerance', () => {
  const f = setup(); f.to(1440 + 430); f.state.player.placeId = 'nest'; // nobody at the player's counter: Doren alone
  f.shop(DOREN).store.stock.forEach(st => { st.price = 2 * st.price - 2; }); f.to(4 * 1440); // tea 14, bread 18
  const later = (e: { time: { day: number; hour: number } }) => e.time.day + e.time.hour / 24 > 2.3, n = (id: string) => f.ctx().residents.find(r => r.id === id)!;
  const tolerance = (id: string) => customerOf(123, n(id), basePersona(f.ctx(), undefined, id)).priceTolerance * 1.25; // rain lifts tea by 1/4
  expect(paid(f, DOREN).filter(e => later(e) && e.amount > Math.floor((e.amount + 2) / 2 * tolerance(e.actorId)))).toEqual([]);
  expect(f.shop(DOREN).store.events.filter(e => later(e) && e.reason === 'expensive').length).toBeGreaterThan(3);
  const g = setup(); g.to(1440 + 400); g.rv().parking = [9e6, 9e6]; g.to(8 * 1440);
  const drives = (id: string) => ['bigSpender', 'parkingHog'].includes(basePersona(g.ctx(), undefined, id));
  expect(paid(g, DOREN).filter(e => e.time.day >= 2 && drives(e.actorId))).toEqual([]);
  expect(paid(g, DOREN).filter(e => e.time.day >= 2).length).toBeGreaterThan(10);
  const day = (e: { actorId: string; time: { day: number } }) => `${e.actorId}:${e.time.day}`, ours = new Set(paid(g, DOREN).map(day));
  expect(paid(g, 'player').filter(e => ours.has(day(e)))).toEqual([]);
  expect(paid(g, 'player').length).toBeGreaterThan(5);
});

it('C109 3: Doren sees the public shelf, the floor and only what he or his helper stood in front of', () => {
  const a = setup(), b = setup(); a.to(1440 + 719); b.to(1440 + 719);
  b.shop('player').store.stock.forEach(st => { st.backroom += 50; }); b.move('player', 'aro', 200);
  a.to(1440 + 721); b.to(1440 + 721);
  const mind = (f: typeof a) => ({ ...f.rv(), heard: null }); // what the customers went through may differ; Doren's books and views may not
  expect(mind(b)).toEqual(mind(a)); expect(b.shop(DOREN).store.events).toEqual(a.shop(DOREN).store.events);
  let seen = 0;
  for (let m = 2 * 1440 + 720; m < 6 * 1440; m += m % 1440 === 720 ? 360 : 1080) {
    a.to(m); const look = a.rv().observations.find(o => o.minute === m);
    if (look) seen++, expect(a.ctx().placeOf(look.via)).toBe('cafe');
    a.to(m + 1); expect(a.state.world.people.doren.placeId).toBe('shop');
  }
  expect(seen).toBeGreaterThan(0);
});

it('C109 4: orders then ads come out of one available sum that never touches rent, arrears or tax', () => {
  const f = setup(); f.to(2 * 1440 + 419);
  const s = f.rv(), reserve = () => 4 * (s.rentDue.length + 3) + Math.floor(s.tax.taxable * 5 / 100) - s.tax.paid;
  f.move('doren', 'aro', f.bal('doren') - reserve() - 25);
  s.plan = { ...s.plan!, day: 3, orders: { tea: 20, bread: 20 }, adBudget: 60 }; f.to(2 * 1440 + 421);
  expect(f.bal('doren')).toBeGreaterThanOrEqual(reserve()); expect(s.plan!.done).toMatch(/^tea 12\/20 · bread 0\/20 · 광고/);
  expect(f.state.world.ledger.transactions.filter(t => t.from === 'doren' && t.reason.startsWith('Ad:'))).toEqual([]);
});

it('C109 5: the last trading day pays rent and counts its taxable sales; debts stay; stock, helpers and lease end', () => {
  const f = setup();
  for (let day = 1; day <= 5; day++) { f.to(day * 1440 - 1); f.move('doren', 'aro'); f.to(day * 1440 + 1); }
  const s = f.rv(), sold = paid(f, DOREN).reduce((n, e) => n + e.amount, 0);
  expect([s.status, s.closeAt, s.tax.taxable, s.helpers]).toEqual(['closed', 5, sold, []]);
  expect(s.rentDue).toContain(5); expect(f.shop(DOREN).store.stock.every(st => st.backroom + st.displayed === 0)).toBe(true);
  f.move('aro', 'doren', 200); f.to(6 * 1440 + 1);
  expect([s.rentDue, s.tax.paid, f.total()]).toEqual([[], Math.floor(sold * 5 / 100), f.initial]);
});

it('C109 6: a sold-out rumour carries its own visit, item and time', () => {
  const a = setup(); a.to(3 * 1440);
  const first = paid(a, DOREN).find(e => e.time.day === 2)!, other = first.itemId === 'tea' ? 'bread' : 'tea';
  const at = (first.time.day - 1) * 1440 + first.time.hour * 60, b = setup(); b.to(at - 1);
  b.rv().heard[first.actorId] = { visit: 'shop:x:2:velo', itemId: other, minute: at - 30 }; b.to(at + 1);
  expect(b.rv().observations).toContainEqual({ kind: 'soldOut', minute: at - 30, itemId: other, value: 1, source: 'shop:x:2:velo', via: first.actorId });
});

// C108's '보통' play (owner 09~12, 6 per item) for 180 days, with and without Doren: residents' wallets and the shops' takings.
function season(systems: typeof tycoonSystems, days = 180) {
  const session = createSession({ getItem: () => null, setItem: () => {} }, 123, systems, 2, true), { state } = session, ledger = state.world.ledger;
  for (const from of ['nuel', 'sori', 'aro', 'iri', 'velo', 'lise']) transfer(ledger, { id: `capital:${from}`, from, to: 'player', amount: 300,
    time: gameTime(state.world.clock), reason: 'Capital transfer' });
  const lease = session.rentStore('cafe-unit'), shop = session.openShop('tea'), rows: Record<string, number | string>[] = [];
  const takings = (id: string) => { const b = state.book.businesses.find(b => b.id === id);
    return b ? Object.values(state.revenueHistory[id] ?? {}).reduce((a, n) => a + n, 0) + paid({ shop: () => b } as never, id).reduce((n, e) => n + e.amount, 0) : 0; };
  for (let day = 1; day <= days; day++) {
    for (const st of shop.store.stock) {
      const q = 6 - st.backroom - st.displayed - lease.orders.filter(o => !o.delivered && o.itemId === st.itemId).reduce((n, o) => n + o.quantity, 0);
      if (q > 0) session.orderStock(st.itemId === 'soup' ? 'iri' : 'nuel', st.itemId, q);
    }
    session.tick(540 / 2); state.player.placeId = 'cafe'; session.tick(180 / 2); state.player.placeId = 'nest'; session.tick(720 / 2);
    if (day !== 30 && day !== days) continue;
    const w = session.tycoon.ctx().residents.map(n => ledger.balances[n.id]).sort((x, y) => x - y);
    rows.push({ day, doren: systems.includes(rival) ? 'O' : 'X', 중앙값: w[w.length >> 1], 빈털터리: w.filter(n => n < 8).length, 주민합: w.reduce((a, n) => a + n, 0),
      도렌현금: ledger.balances.doren ?? 0, 플레이어매출: takings(shop.id), 도렌매출: takings(DOREN) });
  }
  return rows;
}
it('C109 7: Doren\'s takings go round — after 180 days no more broke residents than without him (+3), his cash capped', () => {
  const before = season(tycoonSystems.filter(x => x !== rival)), after = season(tycoonSystems);
  console.table([...before, ...after]);
  expect(after[1].빈털터리).toBeLessThanOrEqual(Number(before[1].빈털터리) + 3);
  expect(after[1].도렌현금).toBeLessThan(600); expect(after[1].중앙값).toBeGreaterThanOrEqual(Number(before[1].중앙값));
}, 120000);
