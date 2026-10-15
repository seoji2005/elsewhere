import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { gameTime } from '../../src/sim/clock';
import { transfer } from '../../src/sim/ledger';
import { tycoonSystems } from '../../src/game/tycoon/registry';
import { answerHaggle, park, patrons, personaOf, type PatronState } from '../../src/game/tycoon/patrons';
import type { TycoonSystem } from '../../src/game/tycoon/system';

// The owner stays in the cafe with stock delivered on day 2, so every resident visit reaches the persona hooks.
function setup(seed = 123, systems: readonly TycoonSystem<any>[] = tycoonSystems) {
  const session = createSession({ getItem: () => null, setItem: () => {} }, seed, systems), { state } = session;
  const total = () => Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0), initial = total();
  for (const from of ['nuel', 'sori', 'aro', 'iri', 'velo', 'lise']) transfer(state.world.ledger, { id: `capital:${from}`, from,
    to: 'player', amount: 300, time: gameTime(state.world.clock), reason: 'Capital transfer' });
  session.rentStore('cafe-unit'); const b = session.openShop('tea');
  for (const id of ['tea', 'bread', 'soup']) session.orderStock(id === 'soup' ? 'iri' : 'nuel', id, 20);
  state.player.placeId = 'cafe';
  const advance = (minutes: number) => session.tick(minutes / state.world.clock.minutesPerSecond);
  const pat = () => session.tycoon.state().systems.patrons as PatronState;
  return { session, state, b, total, initial, advance, pat };
}

it('C095: same seed gives the same personas and lines; split ticks agree; money is conserved', () => {
  const [a, c] = [setup(), setup()];
  a.advance(1440 * 3);
  for (let i = 0; i < 72; i++) c.advance(60);
  expect(c.session.tycoon.state()).toEqual(a.session.tycoon.state());
  expect(c.state.world.ledger.balances).toEqual(a.state.world.ledger.balances);
  expect(Object.keys(a.pat().personas).length).toBeGreaterThan(5);
  expect(a.pat().feed.length).toBeGreaterThan(3);
  expect(a.pat().feed.every(l => l.text && l.name)).toBe(true);
  expect(a.total()).toBe(a.initial);
});

it('C095: three purchases make a regular', () => {
  const { session } = setup(), ctx = session.tycoon.ctx(), s = patrons.create(ctx), id = ctx.residents[3].id;
  const event = { npcId: id, businessId: 'x', itemId: 'tea', price: 8, count: 1, result: 'purchased' as const };
  for (let i = 0; i < 2; i++) patrons.onShopEvent!(ctx, s, event);
  expect(personaOf(ctx, s, id)).not.toBe('regular');
  patrons.onShopEvent!(ctx, s, event);
  expect(personaOf(ctx, s, id)).toBe('regular');
});

it('C095: parking hogs fill both spaces for 20 minutes and drivers pass by meanwhile', () => {
  const { session, advance } = setup(), ctx = session.tycoon.ctx(), s = patrons.create(ctx);
  const [h1, h2, big] = ctx.residents.map(n => n.id);
  expect(park(ctx, s, big, 'bigSpender')).toBe(true); // nobody parked yet; a big spender does not hold a space
  expect(park(ctx, s, h1, 'parkingHog') && park(ctx, s, h2, 'parkingHog')).toBe(true);
  expect(park(ctx, s, big, 'bigSpender')).toBe(false);
  expect(park(ctx, s, big, 'elder')).toBe(true); // walkers never need a space
  advance(20);
  expect(park(session.tycoon.ctx(), s, big, 'bigSpender')).toBe(true);
});

it('C095: an accepted haggle moves exactly the offer; a refused one sells nothing', () => {
  const { session, state, b, advance, pat } = setup(), ledger = state.world.ledger;
  advance(1440 + 600);
  const tea = b.store.stock.find(s => s.itemId === 'tea')!, list = tea.price, offer = list - 1;
  const npc = session.tycoon.ctx().residents.map(n => n.id).sort((x, y) => ledger.balances[y] - ledger.balances[x])[0];
  const ask = () => session.tycoon.command('patrons', (c, s: PatronState) => patrons.onShopEvent!(c, s,
    { npcId: npc, businessId: b.id, itemId: 'tea', price: offer, count: 1, result: 'haggle' }));
  ask(); expect(pat().haggles).toHaveLength(1);
  const before = ledger.balances.player, sales = b.store.events.filter(e => e.reason === 'purchased').length;
  expect(session.tycoon.command('patrons', (c, s: PatronState) => answerHaggle(c, s, pat().haggles[0].visitId, true))).toBe(true);
  expect(ledger.balances.player - before).toBe(offer);
  expect(b.store.events.at(-1)).toMatchObject({ reason: 'purchased', amount: offer, actorId: npc });
  expect(tea.price).toBe(list); expect(pat().haggles).toHaveLength(0);
  advance(1440); ask();
  const after = ledger.balances.player, count = b.store.events.filter(e => e.reason === 'purchased').length;
  session.tycoon.command('patrons', (c, s: PatronState) => answerHaggle(c, s, pat().haggles[0].visitId, false));
  expect(ledger.balances.player).toBe(after);
  expect(b.store.events.filter(e => e.reason === 'purchased').length).toBe(count);
  expect(b.store.events.at(-1)).toMatchObject({ reason: 'expensive', actorId: npc });
  expect(count).toBeGreaterThan(sales);
});

it('C095: a +40 visitBonus system brings more visits to the player shop', () => {
  const booster: TycoonSystem<object> = { id: 'booster', create: () => ({}), validate: raw => raw as object, visitBonus: () => 40 };
  const visits = (systems: readonly TycoonSystem<any>[]) => {
    const f = setup(7, systems); f.advance(1440 * 3); expect(f.total()).toBe(f.initial);
    return f.b.store.visits.length + f.pat().feed.filter(l => l.situation === 'parkingFull').length;
  };
  expect(visits([patrons, booster])).toBeGreaterThan(visits([patrons]));
});
