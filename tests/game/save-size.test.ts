import { expect, it } from 'vitest';
import { createSession, SESSION_KEY } from '../../src/game/session';
import { gameTime } from '../../src/sim/clock';
import { transfer, type Transaction } from '../../src/sim/ledger';
import { settle } from '../../src/sim/tycoonCore';
import { buyCampaign, type AdState } from '../../src/game/tycoon/ads';

// C108: a new game run like the C087 '보통' policy (owner 09~12, 6 per item), optionally a one-week flyer every week.
function play(days: number, ads: boolean, seed = 123) {
  const saved: Record<string, string> = {};
  const storage = { getItem: (k: string) => saved[k] ?? null, setItem: (k: string, v: string) => { saved[k] = v; } } as unknown as Storage;
  const session = createSession(storage, seed, undefined, 2, true), { state } = session, ledger = state.world.ledger;
  const advance = (minutes: number) => session.tick(minutes / state.world.clock.minutesPerSecond);
  for (const from of ['nuel', 'sori', 'aro', 'iri', 'velo', 'lise']) transfer(ledger, { id: `capital:${from}`, from, to: 'player',
    amount: 300, time: gameTime(state.world.clock), reason: 'Capital transfer' });
  const lease = session.rentStore('cafe-unit'), business = session.openShop('tea'), early: Transaction[] = [];
  for (let day = 1; day <= days; day++) {
    for (const stock of business.store.stock) {
      const pending = lease.orders.filter(o => !o.delivered && o.itemId === stock.itemId).reduce((n, o) => n + o.quantity, 0);
      const quantity = Math.max(0, 6 - stock.backroom - stock.displayed - pending);
      if (quantity) session.orderStock(stock.itemId === 'soup' ? 'iri' : 'nuel', stock.itemId, quantity);
    }
    if (ads && day % 7 === 1) session.tycoon.command('ads', (c, s: AdState) =>
      buyCampaign(c, s, { channelId: 'flyer', messageId: 'emotion', modelId: 'none', targets: ['workers'], weeks: 1 }));
    advance(540); state.player.placeId = 'cafe'; advance(180); state.player.placeId = 'nest'; advance(720);
    if (day === 3) early.push(...ledger.transactions);
  }
  session.saveNow();
  const revenue = Object.values(state.revenueHistory).flatMap(days => Object.values(days)).reduce((a, b) => a + b, 0) +
    [state.store, ...state.book.businesses.map(b => b.store)].flatMap(s => s.events).reduce((n, e) => n + e.amount, 0);
  return { session, storage, early, revenue, bytes: Buffer.byteLength(saved[SESSION_KEY]) };
}

const checksum = (balances: Record<string, number>) => Object.keys(balances).sort()
  .reduce((h, k) => [...`${k}=${balances[k]};`].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 2147483647, h), 0);
// Before C108 the same runs saved 879,807 / 975,519 bytes; balances and revenue are the same runs without C108 compaction
// (re-pinned at each integration merge that changes game rules — integrate-0300: C107 tax holiday·delivery run, C099 Doren;
// C109: Doren's fair competition and money circulation; C114: 알바 시급 2·3결·최소 배송비 1결).
// The card's 300KB is out of reach while existing tests pin 14 days of transactions and shop records (~286KB with ads),
// so this bounds the rest: about half the old size.
it.each([
  [false, { player: 4273, revenue: 74409, checksum: 819345195 }],
  [true, { player: 4035, revenue: 79422, checksum: 588727505 }],
])('C108: 180 days of normal trading (ads %s) save under 500KiB with unchanged results and retired IDs', (ads, expected) => {
  const { session, storage, early, revenue, bytes } = play(180, ads), { state } = session, ledger = state.world.ledger;
  console.log('C108 180-day save bytes', { ads, bytes });
  expect(bytes).toBeLessThanOrEqual(500 * 1024);
  expect({ player: ledger.balances.player, revenue, checksum: checksum(ledger.balances) }).toEqual(expected);
  const again = createSession(storage, 123, undefined, 2, true);
  expect(again.loadResult.ok).toBe(true); expect(again.state).toEqual(state);
  // Day-3 sales, supplies, wages, orders and delivery fees are compacted away, yet re-running each is still a duplicate.
  const kinds = new Set(early.map(t => t.id.split(/[:[]/)[0]));
  for (const kind of ['store-sale', 'supply', 'daily-supply', 'production', 'work', 'lease']) expect(kinds).toContain(kind);
  const balances = { ...ledger.balances }, now = gameTime(state.world.clock);
  for (const t of early) {
    expect(ledger.transactions.some(x => x.id === t.id)).toBe(false);
    expect(transfer(ledger, { ...t, time: now })).toEqual({ ok: true, duplicate: true });
  }
  const fee = early.find(t => t.id.endsWith(':fee:0'))!, batch = fee.id.slice(0, -2);
  expect(settle(ledger, batch, early.filter(t => t.id.startsWith(`${batch}:`)), now)).toEqual({ ok: true, duplicate: true });
  expect(ledger.balances).toEqual(balances);
}, 60000);
