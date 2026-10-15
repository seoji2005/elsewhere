import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { gameTime } from '../../src/sim/clock';
import { transfer } from '../../src/sim/ledger';
import type { Segment } from '../../src/data/ads';
import { ads, adEffect, buyCampaign, MEDIA_JOB, type AdState } from '../../src/game/tycoon/ads';
import type { PatronState } from '../../src/game/tycoon/patrons';
import type { CampaignInput } from '../../src/sim/ads';

// As the C095 test: the owner minds the cafe; stock is topped up every morning so 30 days stay comparable.
function setup(seed = 123, storage: Storage = { getItem: () => null, setItem: () => {} } as unknown as Storage) {
  const session = createSession(storage, seed), { state } = session;
  const total = () => Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0), initial = total();
  for (const from of ['nuel', 'sori', 'aro', 'iri', 'velo', 'lise']) transfer(state.world.ledger, { id: `capital:${from}`, from,
    to: 'player', amount: 300, time: gameTime(state.world.clock), reason: 'Capital transfer' });
  session.rentStore('cafe-unit'); const b = session.openShop('tea');
  state.player.placeId = 'cafe';
  const advance = (minutes: number) => session.tick(minutes / state.world.clock.minutesPerSecond);
  const days = (n: number) => { for (let i = 0; i < n; i++) {
    for (const id of ['tea', 'bread', 'soup']) session.orderStock(id === 'soup' ? 'iri' : 'nuel', id, 10);
    advance(1440);
  } };
  const ad = () => session.tycoon.state().systems.ads as AdState;
  const buy = (input: CampaignInput) => session.tycoon.command('ads', (c, s: AdState) => buyCampaign(c, s, input));
  return { session, state, b, total, initial, advance, days, ad, buy };
}
const plan = (target: Segment): CampaignInput => ({ channelId: 'flyer', messageId: 'emotion', modelId: 'none', targets: [target], weeks: 4 });

it('C098: buying pays the medium once, conserves money, and a reload never re-rolls the result', () => {
  const saved: Record<string, string> = {}, storage = { getItem: (k: string) => saved[k] ?? null, setItem: (k: string, v: string) => { saved[k] = v; } };
  const f = setup(123, storage as unknown as Storage), ledger = f.state.world.ledger;
  const media = f.session.tycoon.ctx().residents.find(n => n.job === MEDIA_JOB)!.id;
  const [player, paid] = [ledger.balances.player, ledger.balances[media]];
  const c = f.buy(plan('elders'));
  if (typeof c === 'string') throw Error(c);
  expect(player - ledger.balances.player).toBe(c.cost);
  expect(ledger.balances[media] - paid).toBe(c.cost);
  expect(c.cost).toBe(80); expect(f.total()).toBe(f.initial);
  const again = createSession(storage as unknown as Storage, 123);
  expect((again.tycoon.state().systems.ads as AdState).campaigns).toEqual(f.ad().campaigns);
  again.tick(1440 / again.state.world.clock.minutesPerSecond);
  expect((again.tycoon.state().systems.ads as AdState).campaigns[0].result).toEqual(c.result);
});

// The payment itself reaches a resident who spends it at the shop, so each ad is compared with the same money sent without an ad.
it('C098: an ad for the shop\'s own customers adds visits over 30 days; one for absent customers adds far fewer', () => {
  const ad: CampaignInput = { channelId: 'transit', messageId: 'speed', modelId: 'influencer', targets: ['workers'], weeks: 4 };
  const visits = (seed: number, mode: 'none' | 'pay' | Segment) => {
    const f = setup(seed), media = f.session.tycoon.ctx().residents.find(n => n.job === MEDIA_JOB)!.id;
    if (mode === 'pay') transfer(f.state.world.ledger, { id: 'same-money', from: 'player', to: media, amount: 760,
      time: gameTime(f.state.world.clock), reason: 'Same money, no ad' });
    else if (mode !== 'none') {
      const c = f.buy({ ...ad, targets: [mode] });
      if (typeof c === 'string') throw Error(c);
      expect(c.cost).toBe(760); expect(['normal', 'hit']).toContain(c.result.outcome);
    }
    f.days(30); expect(f.total()).toBe(f.initial);
    return f.b.store.visits.length;
  };
  let right = 0, wrong = 0;
  for (const seed of [7, 123, 9, 42, 5]) {
    const [none, pay, absent, own] = (['none', 'pay', 'affluent', 'workers'] as const).map(m => visits(seed, m));
    console.log(`seed ${seed} 30일 방문: 광고 없음 ${none} · 같은 돈만 이체 ${pay} · 부유층(거의 없음) 광고 ${absent} · 직장인 광고 ${own}`);
    expect(own).toBeGreaterThan(pay); expect(own).toBeGreaterThanOrEqual(absent);
    right += own - pay; wrong += absent - pay;
  }
  expect(right).toBeGreaterThanOrEqual(25); expect(right).toBeGreaterThan(1.5 * wrong);
}, 60_000);

it('C098: backlash lowers the shop\'s ad reputation; a broken price promise does too', () => {
  const f = setup(), ctx = f.session.tycoon.ctx(), s = ads.create(ctx);
  const c = buyCampaign({ ...ctx, roll: () => 0 }, s, { ...plan('elders'), modelId: 'influencer' }); // every sample 0: model scandal
  if (typeof c === 'string') throw Error(c);
  expect(c.result.outcome).toBe('backlash');
  ads.onDay!(ctx, s, c.startDay + 1);
  expect(s.reputation).toBe(-8);
  const p = buyCampaign({ ...ctx, roll: () => 0.99 }, s, { ...plan('elders'), messageId: 'price' });
  if (typeof p === 'string') throw Error(p);
  for (const st of f.b.store.stock) f.session.setShopPrice(st.itemId, st.price * 2);
  ads.onDay!(ctx, s, p.startDay + 1);
  expect(p.broken).toBeTruthy(); expect(s.reputation).toBeLessThan(-8 + p.result.reputation);
});

it('C098: "saw the ad" lines come only from customers the ad reached; split ticks agree', () => {
  const lines = (f: ReturnType<typeof setup>) => (f.session.tycoon.state().systems.patrons as PatronState).feed.filter(l => l.situation === 'adSeen');
  const quiet = setup(7); quiet.days(4);
  expect(lines(quiet)).toHaveLength(0);
  const [a, c] = [setup(7), setup(7)];
  for (const f of [a, c]) f.buy({ ...plan('elders'), channelId: 'search', targets: ['elders', 'workers', 'families'] });
  a.days(4);
  for (let d = 0; d < 4; d++) {
    for (const id of ['tea', 'bread', 'soup']) c.session.orderStock(id === 'soup' ? 'iri' : 'nuel', id, 10);
    for (let i = 0; i < 48; i++) c.advance(30);
  }
  expect(c.session.tycoon.state()).toEqual(a.session.tycoon.state());
  expect(c.state.world.ledger.balances).toEqual(a.state.world.ledger.balances);
  const said = lines(a), ctx = a.session.tycoon.ctx();
  expect(said.length).toBeGreaterThan(0);
  expect(a.ad().campaigns[0].seen).toBeGreaterThanOrEqual(said.length);
  for (const l of said) expect(adEffect({ ...ctx, time: { day: Math.floor(l.minute / 1440) + 1, hour: 12, minute: 0 } }, a.ad(), l.npcId)).toBeGreaterThan(0);
});
