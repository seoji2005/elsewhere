// C098: C089 ad campaigns in the game — buy (luck fixed at purchase), visit-consideration bonus, 'came from the ad' lines, promise checks.
import { adChannels, segments, type Segment } from '../../data/ads';
import { items } from '../../data/items';
import type { PersonaId } from '../../data/personas';
import { assignPersona } from '../../sim/persona';
import { CAP, adEffectOnVisit, buyCampaign as payCampaign, checkPromise, planCampaign, type CampaignInput, type CampaignResult, type ShopMix } from '../../sim/ads';
import { patrons, type PatronState } from './patrons';
import type { ShopEvent, TycoonCtx, TycoonSystem } from './system';

export interface Campaign extends CampaignInput {
  id: string; cost: number; startDay: number; result: CampaignResult;
  revealed: boolean; broken: string; seen: number; // broken: the promise complaint, once
}
export interface AdState { campaigns: Campaign[]; reputation: number; lastSeen: Record<string, number> }
export const MEDIA_JOB = '밤결 기록사', SEEN_CHANCE = 0.4;
const bySegment: Partial<Record<PersonaId, Segment>> = { students: 'students', rusher: 'workers', elder: 'elders', bigSpender: 'affluent' };

/** The resident's audience segment, from their base persona; others are families or workers by a fixed roll. Read only. */
export function segmentOf(ctx: TycoonCtx, npcId: string): Segment {
  const saved = (ctx.systems.patrons as PatronState | undefined)?.personas[npcId];
  const persona = saved ?? assignPersona(ctx.residents.find(n => n.id === npcId) ?? {}, ctx.roll('patrons', npcId, 0));
  return bySegment[persona] ?? (ctx.roll('ads', `segment:${npcId}`, 0) < 0.5 ? 'families' : 'workers');
}
export function shopMix(ctx: TycoonCtx): ShopMix {
  const mix = Object.fromEntries(segments.map(s => [s, 0])) as ShopMix;
  for (const n of ctx.residents) mix[segmentOf(ctx, n.id)] += 1 / ctx.residents.length;
  return mix;
}
const leadOf = (c: Campaign) => adChannels.find(ch => ch.id === c.channelId)!.leadDays;
export const running = (c: Campaign, day: number) => (c.result.curve[day - c.startDay] ?? 0) > 0;
/** Added visit-consideration probability (0..CAP) for this resident today. */
export const adEffect = (ctx: TycoonCtx, s: AdState, npcId: string) =>
  adEffectOnVisit(s.campaigns.map(c => ({ startDay: c.startDay, result: c.result })), segmentOf(ctx, npcId), ctx.time.day);
const adjust = (s: AdState, delta: number) => { s.reputation = Math.max(-100, Math.min(100, s.reputation + delta)); };

/** Pays the medium (a resident) the whole campaign at once and saves the result; the same purchase never charges twice. */
export function buyCampaign(ctx: TycoonCtx, s: AdState, input: CampaignInput): Campaign | string {
  const plan = planCampaign(input), id = ctx.nextId('ad');
  const media = ctx.residents.find(n => n.job === MEDIA_JOB) ?? ctx.residents[0];
  const sample = [0, 1, 2, 3, 4].map(i => ctx.roll('ads', id, i));
  const paid = payCampaign(ctx.world.ledger, 'player', media.id, plan, ctx.time, id, shopMix(ctx), sample);
  if (!paid.ok || !paid.campaign) return paid.ok ? 'Duplicate' : paid.error;
  const c: Campaign = { ...input, targets: [...input.targets], id, cost: plan.cost, startDay: ctx.time.day,
    result: paid.campaign.result, revealed: false, broken: '', seen: 0 };
  s.campaigns.push(c);
  return c;
}

/** One day's service at the player's shop, from its own records. */
export function serviceStats(ctx: TycoonCtx, day: number) {
  const store = ctx.book.businesses.find(b => b.ownerId === 'player' && b.closedAt === null)?.store;
  if (!store) return { avgWait: 0, soldOutRate: 0, priceLevel: 1 };
  const events = store.events.filter(e => e.time.day === day), bought = events.filter(e => e.reason === 'purchased');
  const waits = bought.map(e => {
    const v = store.visits.find(v => v.id === e.visitId);
    return v ? (e.time.day - 1) * 1440 + e.time.hour * 60 + e.time.minute - v.joinedMinute : 0;
  });
  const prices = store.stock.map(st => st.price / (items.find(i => i.id === st.itemId)?.price ?? st.price));
  return { avgWait: waits.length ? waits.reduce((a, b) => a + b, 0) / waits.length : 0,
    soldOutRate: events.length ? events.filter(e => e.reason === 'missing').length / events.length : 0,
    priceLevel: prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 1 };
}

export const ads: TycoonSystem<AdState> = {
  id: 'ads',
  create: () => ({ campaigns: [], reputation: 0, lastSeen: {} }),
  validate(raw) {
    const s = raw as AdState, natural = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
    if (!s || typeof s !== 'object' || !Array.isArray(s.campaigns) || !Number.isFinite(s.reputation) || Math.abs(s.reputation) > 100 ||
        !Object.values(s.lastSeen ?? 0).every(natural) || !s.campaigns.every(c => typeof c?.id === 'string' &&
          natural(c.cost) && natural(c.startDay) && natural(c.seen) && typeof c.broken === 'string' &&
          Array.isArray(c.result?.curve) && segments.every(g => Number.isFinite(c.result.peak?.[g]))))
      throw Error('Invalid ads');
    for (const c of s.campaigns) planCampaign(c); // unknown channel, message or model
    return s;
  },
  // +percentage points: the ad's consideration bonus, plus the shop's ad reputation (a fifth of it).
  visitBonus: (ctx, s, v) => (s.campaigns.length ? adEffect(ctx, s, v.npcId) * 100 : 0) + s.reputation / 5,
  onShopEvent(ctx, s, e: ShopEvent) {
    const day = ctx.time.day, effect = s.campaigns.length ? adEffect(ctx, s, e.npcId) : 0;
    if (!effect || s.lastSeen[e.npcId] === day) return;
    s.lastSeen[e.npcId] = day; // one chance a day per customer
    // Came because of the ad with the share the ad adds; says so 40% of the time (only what is said is counted).
    if (ctx.roll('ads', `came:${e.npcId}`, day) >= effect / CAP || ctx.roll('ads', `said:${e.npcId}`, day) >= SEEN_CHANCE) return;
    const c = s.campaigns.filter(c => running(c, day)).at(-1);
    if (c) c.seen++;
    const feed = ctx.systems.patrons as PatronState | undefined; // the patrons feed shows every customer line
    if (feed) patrons.onShopEvent!(ctx, feed, { ...e, result: 'adSeen' as ShopEvent['result'] });
  },
  onDay(ctx, s, day) {
    for (const c of s.campaigns) {
      if (!c.revealed && day >= c.startDay + leadOf(c)) { c.revealed = true; adjust(s, c.result.reputation); }
      if (c.broken || !c.revealed || !running(c, day)) continue;
      const check = checkPromise(c.messageId, serviceStats(ctx, day));
      if (check.broken) { c.broken = check.summary; adjust(s, check.reputation); }
    }
    for (const [id, d] of Object.entries(s.lastSeen)) if (d < day) delete s.lastSeen[id];
  },
};
