// Ad campaigns: preview, payment (luck fixed at purchase), daily visit-consideration bonus, promise checks.
import { adChannels, adMessages, adModels, reachWaste, scandalHeadlines, segmentNames, segments } from '../data/ads';
import type { AdChannel, AdMessage, AdModel, Segment } from '../data/ads';
import { transfer } from './ledger';
import type { GameTime } from './clock';
import type { LedgerState, TransferResult } from './ledger';

export interface CampaignInput {
  channelId: string; messageId: AdMessage['id']; modelId: AdModel['id']; targets: Segment[]; weeks: number;
}
export interface CampaignPlan extends CampaignInput {
  cost: number; leadDays: number;
  hitChance: number; dudChance: number; backlashChance: number;
  minLift: number; maxLift: number; expectedLift: number; // consideration bonus, averaged over target segments
}
export type Outcome = 'hit' | 'normal' | 'dud' | 'backlash';
export interface CampaignResult {
  outcome: Outcome;
  peak: Record<Segment, number>; // added visit-consideration probability while running (0..CAP)
  curve: number[];               // 0..1 shape per day since purchase: lead, run, fading tail; bonus = peak * curve
  reputation: number; buzz: number; summary: string;
}
export interface ActiveCampaign { startDay: number; result: CampaignResult }
export type ShopMix = Record<Segment, number>;

// Campaign luck by outcome; backlash brings no visitors, only reputation loss.
const OUTCOME: Record<Outcome, [number, number]> = { hit: [1.8, 2.6], normal: [0.8, 1.2], dud: [0, 0.2], backlash: [0, 0] };
const SPILL = 0.15;  // non-target segments still notice a little
const SATURATE = 0.3; // exposure scale: repeated exposure flattens out
export const CAP = 0.25; // most an ad can add to a customer's chance of considering a visit

function pick<T extends { id: string }>(list: readonly T[], id: string): T {
  const found = list.find(entry => entry.id === id);
  if (!found) throw Error(`Unknown ad option: ${id}`);
  return found;
}
type Parts = [AdChannel, AdMessage, AdModel];
function parts(input: CampaignInput): Parts {
  if (!Number.isSafeInteger(input.weeks) || input.weeks < 1) throw Error('Invalid weeks');
  if (!input.targets.length || input.targets.some(t => !segments.includes(t)) || new Set(input.targets).size < input.targets.length)
    throw Error('Invalid targets');
  return [pick(adChannels, input.channelId), pick(adMessages, input.messageId), pick(adModels, input.modelId)];
}
// Consideration bonus per segment at luck 1: saturating exposure × channel fit × message fit.
// Spreading over more targets thins each one.
function baseLift(input: CampaignInput, [channel, message, model]: Parts): Record<Segment, number> {
  const focus = 1 / Math.sqrt(input.targets.length);
  const strength = channel.power * (1 - reachWaste[channel.reach]) * model.boost;
  const lift = {} as Record<Segment, number>;
  for (const s of segments) lift[s] = CAP * channel.fit[s] * message.fit[s] *
    (1 - Math.exp(-strength * (input.targets.includes(s) ? focus : SPILL) / SATURATE));
  return lift;
}
function chances(input: CampaignInput, [channel, message, model]: Parts) {
  const scandal = 1 - (1 - model.scandal) ** input.weeks, overheat = message.overheat;
  return { scandal, overheat, backlash: 1 - (1 - scandal) * (1 - overheat), hit: channel.variance / 2, dud: channel.variance / 2 };
}

export function planCampaign(input: CampaignInput): CampaignPlan {
  const all = parts(input), [channel, , model] = all, base = baseLift(input, all), p = chances(input, all);
  const target = input.targets.reduce((sum, s) => sum + base[s], 0) / input.targets.length;
  const at = (luck: number) => Math.min(CAP, target * luck), mid = ([a, b]: [number, number]) => at((a + b) / 2);
  const normal = 1 - p.hit - p.dud;
  return {
    ...input, targets: [...input.targets], cost: (channel.weeklyCost + model.weeklyFee) * input.weeks, leadDays: channel.leadDays,
    hitChance: p.hit * (1 - p.backlash), dudChance: p.dud * (1 - p.backlash), backlashChance: p.backlash,
    minLift: 0, maxLift: at(OUTCOME.hit[1]),
    expectedLift: (1 - p.backlash) * (p.hit * mid(OUTCOME.hit) + normal * mid(OUTCOME.normal) + p.dud * mid(OUTCOME.dud)),
  };
}

// Pays the whole campaign up front as one transfer and fixes its luck from sample right then; the caller
// stores the returned campaign and never rolls it again. The same id never charges twice.
export function buyCampaign(ledger: LedgerState, buyerId: string, payeeId: string, plan: CampaignPlan,
  time: GameTime, id: string, mix: ShopMix, sample: number[]): TransferResult & { campaign?: ActiveCampaign } {
  const cost = planCampaign(plan).cost, result = resolveCampaign(plan, mix, sample);
  const paid = transfer(ledger, { id, time, from: buyerId, to: payeeId, amount: cost, reason: `Ad: ${plan.channelId}` });
  return paid.ok && !paid.duplicate ? { ...paid, campaign: { startDay: time.day, result } } : paid;
}

function curve(lead: number, days: number, fade: number): number[] {
  const out: number[] = Array(lead).fill(0).concat(Array(days).fill(1));
  for (let v = fade; v >= 0.02; v *= fade) out.push(v);
  return out.concat(0);
}
const josa = (word: string, withFinal: string, without: string) => {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  return word + (code >= 0 && code < 11172 && code % 28 ? withFinal : without);
};

// sample: five numbers in [0, 1) — scandal, overheat, outcome, magnitude, headline.
export function resolveCampaign(plan: CampaignPlan, mix: ShopMix, sample: number[]): CampaignResult {
  if (sample.length < 5 || sample.some(n => !(n >= 0 && n < 1))) throw Error('Need five samples in [0, 1)');
  const all = parts(plan), [channel, message, model] = all, base = baseLift(plan, all), p = chances(plan, all);
  const scandal = sample[0] < p.scandal, overheat = !scandal && sample[1] < p.overheat;
  const outcome: Outcome = scandal || overheat ? 'backlash'
    : sample[2] < p.hit ? 'hit' : sample[2] < p.hit + p.dud ? 'dud' : 'normal';
  const [lo, hi] = OUTCOME[outcome], scale = lo + (hi - lo) * sample[3];
  const peak = {} as Record<Segment, number>;
  for (const s of segments) peak[s] = Math.min(CAP, base[s] * scale);
  const shape = curve(channel.leadDays, plan.weeks * 7, outcome === 'backlash' ? 0.8 : 0.6);
  const top = segments.reduce((a, b) => (mix[b] ?? 0) * peak[b] > (mix[a] ?? 0) * peak[a] ? b : a);
  const name = channel.name, who = segmentNames[top];
  const summary = scandal ? scandalHeadlines[Math.floor(sample[4] * scandalHeadlines.length)]
    : overheat ? `${josa(`${message.name} 광고`, '이', '가')} 과열돼 역풍을 맞았다`
    : outcome === 'hit' ? `${josa(name, '이', '가')} ${who}에게 먹혔다`
    : outcome === 'dud' ? `${name}에 아무도 반응하지 않았다`
    : `${josa(name, '이', '가')} ${who}에게 무난하게 닿았다`;
  return {
    outcome, peak, curve: shape, summary,
    reputation: { hit: 3, normal: 1, dud: 0, backlash: scandal ? -8 : -4 }[outcome],
    buzz: Math.round(10 * message.buzz * model.buzz * { hit: 3, normal: 1, dud: 0.2, backlash: 2 }[outcome]),
  };
}

// Added visit-consideration probability (0..CAP) for one segment on one day. Campaigns combine with
// diminishing returns, so stacking ads on the same customers never passes CAP.
export function adEffectOnVisit(campaigns: readonly ActiveCampaign[], segment: Segment, day: number): number {
  let miss = 1;
  for (const { startDay, result } of campaigns) miss *= 1 - (result.peak[segment] * (result.curve[day - startDay] ?? 0)) / CAP;
  return CAP * (1 - miss);
}

export interface ServiceStats { avgWait: number; soldOutRate: number; priceLevel: number } // minutes, 0..1, 1 = market price
export interface PromiseCheck { broken: boolean; reputation: number; summary: string }
// What each message promises: [measured value, tolerated limit, range to worst disappointment, complaint].
const PROMISES: Partial<Record<AdMessage['id'], (s: ServiceStats) => [number, number, number, string]>> = {
  price: s => [s.priceLevel, 1.1, 0.4, '싸다더니 비싸다는 말이 돈다'],
  speed: s => [s.avgWait, 10, 20, '빠르다더니 한참 기다렸다는 불평이 돈다'],
  quality: s => [s.soldOutRate, 0.2, 0.3, '좋다던 물건이 늘 품절이라 실망이 쌓인다'],
};
// Backlash from an ad promising what the shop doesn't deliver; emotion and hype promise nothing measurable.
export function checkPromise(messageId: AdMessage['id'], service: ServiceStats): PromiseCheck {
  pick(adMessages, messageId);
  const rule = PROMISES[messageId];
  if (!rule) return { broken: false, reputation: 0, summary: '' };
  const [value, limit, range, summary] = rule(service);
  if (!(value > limit)) return { broken: false, reputation: 0, summary: '' };
  return { broken: true, reputation: -Math.round(2 + 4 * Math.min(1, (value - limit) / range)), summary };
}
