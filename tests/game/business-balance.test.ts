import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { emptyBond, edgeKey } from '../../src/sim/bonds';
import { gameTime } from '../../src/sim/clock';
import { transfer } from '../../src/sim/ledger';
import { whereIs } from '../../src/sim/npc';
import { generate } from '../../src/sim/npcgen';
import { npcs } from '../../src/data/npcs';
import { runPolicy } from '../../tools/business-sim.mjs';

const dependencies = { transfer, gameTime, emptyBond, edgeKey };
const periods = [[0, 7], [7, 14], [14, 21], [21, 30]];
it.each([0, 1, 123])('C087: 30-day solo/staff curves and conserved cash, seed %i', seed => {
  for (const policy of ['보통', '잘함']) {
    const result = runPolicy(createSession, dependencies, policy, seed);
    expect(result.total).toBe(result.initial); // The runner also checks every day, including escrow.
    expect(result.ended).toBe(false);
    expect(result.reputation).toBeGreaterThan(0);
    expect(result.net).toBeGreaterThanOrEqual(policy === '보통' ? 300 : 400);
    expect(result.net).toBeLessThanOrEqual(policy === '보통' ? 750 : 1000);
    for (const [start, end] of policy === '보통' ? periods : periods.slice(1)) {
      const average = result.daily.slice(start, end).reduce((n, d) => n + d.net, 0) / (end - start);
      expect(average).toBeGreaterThanOrEqual(policy === '보통' ? 10 : 20);
      expect(average).toBeLessThanOrEqual(policy === '보통' ? 25 : 50);
    }
    if (policy === '잘함') {
      expect(result.breakEven).toBeGreaterThanOrEqual(5);
      expect(result.breakEven).toBeLessThanOrEqual(9);
      expect(result.wages).toBe(960);
    }
  }
}, 30000);

it.each(['missing', 'expensive', 'below-cost'])('C087: bad operation loses money: %s', bad => {
  const result = runPolicy(createSession, dependencies, '게으름', 123, bad);
  expect(result.net).toBeLessThanOrEqual(-800);
  expect(result.net).toBeGreaterThanOrEqual(-1800);
  expect(result.total).toBe(6100);
  if (bad !== 'below-cost') expect(result.reputation).toBeLessThan(0);
}, 15000);

it('C087: owner sells only while present; shopping stops and production pay use real residents', () => {
  const session = createSession({ getItem: () => null, setItem: () => {} }, 123), { state } = session;
  const advance = (minutes: number) => session.tick(minutes / state.world.clock.minutesPerSecond);
  expect(transfer(state.world.ledger, { id: 'capital', from: 'nuel', to: 'player', amount: 300,
    time: gameTime(state.world.clock), reason: 'Capital transfer' }).ok).toBe(true);
  session.rentStore('cafe-unit'); const business = session.openShop('tea');
  for (const id of ['tea', 'bread', 'soup']) expect(session.orderStock(id === 'soup' ? 'iri' : 'nuel', id, 20).ok).toBe(true);
  advance(1440 + 540);
  expect(business.store.events).toHaveLength(0);
  state.player.placeId = 'cafe'; advance(180);
  expect(business.store.events.filter(e => e.reason === 'purchased')).toHaveLength(3);
  state.player.placeId = 'nest'; const count = business.store.events.length; advance(720);
  expect(business.store.events).toHaveLength(count);

  const residents = [...npcs, ...generate(123, 50)];
  let stops = 0;
  for (let hour = 0; hour < 24; hour++) {
    state.player.placeId = 'cafe'; advance(60);
    const now = gameTime(state.world.clock);
    for (const shop of state.book.businesses) for (const sale of shop.store.events.filter(e =>
      e.reason === 'purchased' && e.time.day === now.day && e.time.hour === now.hour)) {
      expect(state.world.people[sale.actorId].placeId).toBe(shop.placeId);
      if (whereIs(residents.find(n => n.id === sale.actorId)!, now) !== shop.placeId) stops++;
    }
  }
  expect(stops).toBeGreaterThan(0);
  const bonuses = state.world.ledger.transactions.filter(t => t.reason.startsWith('Wage: production-bonus:'));
  expect(new Set(bonuses.map(t => t.to)).size).toBeGreaterThan(5);
  expect(bonuses.every(t => t.amount === 24 && t.from !== 'player')).toBe(true);
  expect(Object.values(state.world.ledger.balances).reduce((n, cash) => n + cash, 0)).toBe(6100);
});
