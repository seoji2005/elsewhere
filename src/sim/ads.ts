// Ad campaigns: preview, payment through the ledger, sampled outcome and daily visit lift.
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
  minLift: number; maxLift: number; expectedLift: number; // average daily lift over target segments
}
export type Outcome = 'hit' | 'normal' | 'dud' | 'backlash';
export interface CampaignResult {
  outcome: Outcome;
  peak: Record<Segment, number>; // daily visit lift while running (negative for backlash)
  curve: number[];               // 0..1 shape per day since purchase: lead, run, fading tail; visits = 1 + peak * curve
  reputation: number; buzz: number; summary: string;
}
export interface ActiveCampaign { startDay: number; result: CampaignResult }
export type ShopMix = Record<Segment, number>;

const OUTCOME: Record<Outcome, [number, number]> = { hit: [1.8, 2.6], normal: [0.8, 1.2], dud: [0, 0.2], backlash: [0.15, 0.3] };
const SPILL = 0.15; // non-target segments still notice a little
export const MIN_VISIT = 0.5, MAX_VISIT = 3;

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
// Daily lift per segment at outcome multiplier 1. Spreading over more targets thins each one.
function baseLift(input: CampaignInput, [channel, message, model]: Parts): Record<Segment, number> {
  const focus = 1 / Math.sqrt(input.targets.length);
  const strength = channel.power * (1 - reachWaste[channel.reach]) * model.boost;
  const lift = {} as Record<Segment, number>;
  for (const s of segments) lift[s] = strength * channel.fit[s] * message.fit[s] * (input.targets.includes(s) ? focus : SPILL);
  return lift;
}
function chances(input: CampaignInput, [channel, message, model]: Parts) {
  const scandal = 1 - (1 - model.scandal) ** input.weeks, overheat = message.overheat;
  return { scandal, overheat, backlash: 1 - (1 - scandal) * (1 - overheat), hit: channel.variance / 2, dud: channel.variance / 2 };
}

export function planCampaign(input: CampaignInput): CampaignPlan {
  const all = parts(input), [channel, , model] = all, base = baseLift(input, all), p = chances(input, all);
  const target = input.targets.reduce((sum, s) => sum + base[s], 0) / input.targets.length;
  const mid = ([a, b]: [number, number]) => (a + b) / 2, normal = 1 - p.hit - p.dud;
  return {
    ...input, targets: [...input.targets], cost: (channel.weeklyCost + model.weeklyFee) * input.weeks, leadDays: channel.leadDays,
    hitChance: p.hit, dudChance: p.dud, backlashChance: p.backlash,
    minLift: p.backlash > 0 ? -OUTCOME.backlash[1] : target * OUTCOME.dud[0],
    maxLift: target * OUTCOME.hit[1],
    expectedLift: (1 - p.backlash) * target * (p.hit * mid(OUTCOME.hit) + normal * mid(OUTCOME.normal) + p.dud * mid(OUTCOME.dud))
      - p.backlash * mid(OUTCOME.backlash),
  };
}

// Pays the whole campaign up front as one transfer; the same id never charges twice.
export function buyCampaign(ledger: LedgerState, buyerId: string, payeeId: string, plan: CampaignPlan,
  time: GameTime, id: string): TransferResult {
  const cost = planCampaign(plan).cost;
  return transfer(ledger, { id, time, from: buyerId, to: payeeId, amount: cost, reason: `Ad: ${plan.channelId}` });
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
  for (const s of segments) peak[s] = outcome === 'backlash' ? -scale : base[s] * scale;
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

// Visit multiplier for one segment on one day, summing every campaign and clamping the total.
export function adEffectOnVisit(campaigns: readonly ActiveCampaign[], segment: Segment, day: number): number {
  let lift = 0;
  for (const { startDay, result } of campaigns) {
    const v = result.curve[day - startDay];
    if (v) lift += result.peak[segment] * v;
  }
  return Math.min(MAX_VISIT, Math.max(MIN_VISIT, 1 + lift));
}
