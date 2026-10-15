import { describe, expect, it } from 'vitest';
import { adChannels, adMessages, segments } from '../../src/data/ads';
import { adEffectOnVisit, buyCampaign, planCampaign, resolveCampaign, type CampaignInput, type ShopMix } from '../../src/sim/ads';
import { createLedger } from '../../src/sim/ledger';

function rng(seed: number) {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const draws = (next: () => number) => Array.from({ length: 5 }, next);
const elderShop: ShopMix = { students: 0.05, workers: 0.1, elders: 0.6, families: 0.2, affluent: 0.05 };
const input = (over: Partial<CampaignInput> = {}): CampaignInput =>
  ({ channelId: 'flyer', messageId: 'price', modelId: 'none', targets: ['elders'], weeks: 2, ...over });
const weighted = (plan: ReturnType<typeof planCampaign>, mix: ShopMix, n: number) => {
  const next = rng(7); let sum = 0;
  for (let i = 0; i < n; i++) { const r = resolveCampaign(plan, mix, draws(next)); sum += segments.reduce((a, s) => a + mix[s] * r.peak[s], 0); }
  return sum / n;
};

describe('ads', () => {
  it('is deterministic for the same input and samples', () => {
    const plan = planCampaign(input({ channelId: 'sns', modelId: 'influencer', messageId: 'buzz', targets: ['students'] }));
    expect(planCampaign(input({ channelId: 'sns', modelId: 'influencer', messageId: 'buzz', targets: ['students'] }))).toEqual(plan);
    const s = [0.5, 0.5, 0.1, 0.3, 0.2];
    expect(resolveCampaign(plan, elderShop, s)).toEqual(resolveCampaign(plan, elderShop, [...s]));
  });

  it('previews cost and a range that brackets the result', () => {
    const plan = planCampaign(input({ channelId: 'tv', modelId: 'celebrity', weeks: 3 }));
    expect(plan.cost).toBe((600 + 350) * 3);
    expect(plan.minLift).toBeLessThan(0);
    expect(plan.maxLift).toBeGreaterThan(plan.expectedLift);
    const r = resolveCampaign(plan, elderShop, [0.9, 0.9, 0.01, 0.999, 0]);
    expect(r.outcome).toBe('hit');
    expect(r.peak.elders).toBeLessThanOrEqual(plan.maxLift);
  });

  it('expects more from targeting the real customers than the wrong ones', () => {
    const right = planCampaign(input({ targets: ['elders'] })), wrong = planCampaign(input({ targets: ['students'] }));
    expect(weighted(right, elderShop, 2000)).toBeGreaterThan(2 * weighted(wrong, elderShop, 2000));
  });

  it('never backlashes without a model unless the message is hype', () => {
    const next = rng(3);
    for (const channel of adChannels) for (const message of adMessages.filter(m => m.id !== 'buzz')) {
      const plan = planCampaign(input({ channelId: channel.id, messageId: message.id }));
      expect(plan.backlashChance).toBe(0);
      for (let i = 0; i < 500; i++) expect(resolveCampaign(plan, elderShop, draws(next)).outcome).not.toBe('backlash');
    }
    expect(planCampaign(input({ messageId: 'buzz' })).backlashChance).toBeGreaterThan(0);
    const scandal = resolveCampaign(planCampaign(input({ modelId: 'celebrity' })), elderShop, [0, 0.9, 0.5, 0.5, 0]);
    expect(scandal).toMatchObject({ outcome: 'backlash', summary: '모델 음주운전 기사로 불매 조짐' });
    expect(scandal.reputation).toBeLessThan(0);
    expect(adEffectOnVisit([{ startDay: 1, result: scandal }], 'elders', 1 + 1 + 3)).toBeLessThan(1);
  });

  it('matches hit and dud rates to channel variance over 100k samples', () => {
    for (const channel of adChannels) {
      const plan = planCampaign(input({ channelId: channel.id })), next = rng(channel.id.length * 31);
      const count = { hit: 0, normal: 0, dud: 0, backlash: 0 };
      for (let i = 0; i < 100_000; i++) count[resolveCampaign(plan, elderShop, draws(next)).outcome]++;
      expect(count.hit / 1e5).toBeCloseTo(channel.variance / 2, 2);
      expect(count.dud / 1e5).toBeCloseTo(channel.variance / 2, 2);
    }
  }, 60_000);

  it('runs after lead days and fades to nothing after the campaign', () => {
    const plan = planCampaign(input({ weeks: 1 })), r = resolveCampaign(plan, elderShop, [0.5, 0.5, 0.5, 0.5, 0]);
    const lead = adChannels.find(c => c.id === 'flyer')!.leadDays, at = (day: number) => adEffectOnVisit([{ startDay: 10, result: r }], 'elders', day);
    expect(r.summary).toBe('전단지가 어르신에게 무난하게 닿았다');
    expect(at(10)).toBe(1);
    expect(at(10 + lead)).toBeGreaterThan(1);
    const end = 10 + lead + 7;
    expect(at(end - 1)).toBe(at(10 + lead));
    expect(at(end)).toBeLessThan(at(end - 1));
    expect(at(end + 1)).toBeLessThan(at(end));
    expect(at(end + 60)).toBe(1);
    expect(adEffectOnVisit(Array(40).fill({ startDay: 10, result: r }), 'elders', 12)).toBe(3);
  });

  it('pays by transfer only, once per id, and fails without funds', () => {
    const ledger = createLedger({ shop: 100, agency: 0 }), time = { day: 1, hour: 9, minute: 0 };
    const plan = planCampaign(input({ weeks: 2 }));
    expect(buyCampaign(ledger, 'shop', 'agency', plan, time, 'ad:1')).toEqual({ ok: true, duplicate: false });
    expect(buyCampaign(ledger, 'shop', 'agency', plan, time, 'ad:1')).toEqual({ ok: true, duplicate: true });
    expect(ledger.balances).toEqual({ shop: 60, agency: 40 });
    expect(buyCampaign(ledger, 'shop', 'agency', planCampaign(input({ channelId: 'tv' })), time, 'ad:2'))
      .toEqual({ ok: false, error: 'Insufficient funds' });
    expect(Object.values(ledger.balances).reduce((a, b) => a + b, 0)).toBe(100);
  });
});
