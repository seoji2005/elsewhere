// C101 전문가 계약 검토: 계약서 원문은 처음부터 전부 읽을 수 있고, 변호사는 조항의 위험·수정안을 설명한다.
// 돈은 기존 계정 사이 settle만(수수료·추가 임대료·위약금). 조항 효과는 지금은 자동 갱신·위약금 두 가지만.
import { advisorKinds, clauses as clauseDefs, type AdvisorKind, type ClauseKind, type Tier } from '../../data/advisors';
import { storefronts } from '../../data/storefronts';
import { generateContract, reviewContract, reviewDays, type Finding } from '../../sim/advisors';
import { rentStorefront } from '../../sim/business';
import type { TycoonCtx, TycoonSystem } from './system';

export interface Expert { id: string; npcId: string; kind: AdvisorKind; tier: Tier }
export interface Article { article: number; kind: ClauseKind | null; text: string }
export interface Review { advisorId: string; readyDay: number; done: boolean; findings: Finding[] }
export interface Draft {
  id: string; storefrontId: string; seed: number; termDays: number; articles: Article[]; removed: number[];
  extraRent: number; reviews: Review[]; leaseId: string | null; endDay: number; closed: boolean;
}
export interface CounselState { experts: Expert[]; drafts: Draft[]; messages: string[] }

// 변호사가 설명하는 "이 게임에서 실제로 생기는 일". 원문(data/advisors의 text)과 별개.
export const risks: Record<ClauseKind, string> = {
  autoRenew: '기간이 끝날 때 말없이 52일 더 묶여요. 나가려면 그 기간을 다시 채워야 해요.',
  heavyPenalty: '기간 전에 나가면 남은 날수만큼 임대료 전부를 위약금으로 내요.',
  exclusiveSupply: '물건을 이 건물주가 정한 곳에서만 받아야 할 수 있어요.',
  priceHike: '건물주가 통보만으로 임대료를 올릴 수 있어요.',
  liabilityShift: '건물 쪽 잘못으로 난 손해도 우리가 물어요.',
  noEarlyExit: '기간 중에는 해지할 근거가 없어요.',
  hiddenFee: '임대료 말고 관리비가 따로 붙을 수 있어요.',
  farCourt: '다툼이 나면 멀리 가서 소송해야 해서 비용이 커요.',
  nonCompete: '계약이 끝나도 1년간 같은 장사를 못 해요.',
};
export const reviewFee = (e: Expert) => Math.ceil(advisorKinds[e.kind].weeklyFee[e.tier] / 7); // 주급의 하루치
export const currentDraft = (s: CounselState, storefrontId: string) =>
  [...s.drafts].reverse().find(d => d.storefrontId === storefrontId && d.leaseId === null);
const say = (s: CounselState, text: string) => { s.messages = [...s.messages, text].slice(-5); };
const nameOf = (ctx: TycoonCtx, e: Expert) => ctx.residents.find(n => n.id === e.npcId)?.name ?? e.npcId;
const active = (d: Draft, kind: ClauseKind) => d.articles.some(a => a.kind === kind && !d.removed.includes(a.article));

// 임대 기간과 숨은 조항은 여기서 확정되고 다시는 바뀌지 않는다(협상은 removed에 번호만 남긴다).
function draft(ctx: TycoonCtx, s: CounselState, storefrontId: string) {
  const unit = storefronts.find(u => u.id === storefrontId)!;
  const id = `counsel:${storefrontId}:${s.drafts.filter(d => d.storefrontId === storefrontId).length}`;
  const seed = Math.floor(ctx.roll('counsel', id, 0) * 2 ** 32), c = generateContract('lease', seed);
  const landlord = ctx.residents.find(n => n.id === unit.landlordId)?.name ?? unit.landlordId;
  s.drafts.push({ id, storefrontId, seed, termDays: c.weeks, removed: [], extraRent: 0, reviews: [], leaseId: null, endDay: 0, closed: false,
    articles: [
      { article: 1, kind: null, text: `임대인 ${landlord}은(는) 이 점포를 임차인에게 빌려준다.` },
      { article: 2, kind: null, text: `보증금 ${unit.deposit}결은 계약 때 맡기고, 끝나면 80%를 돌려준다.` },
      { article: 3, kind: null, text: `임대료는 하루 ${unit.dailyRent}결, 임대 기간은 ${c.weeks}일로 한다.` },
      ...c.clauses.map(k => ({ article: k.article, kind: k.kind, text: clauseDefs[k.kind].text })),
    ] });
}
function unsigned(s: CounselState, contractId: string) {
  const d = s.drafts.find(d => d.id === contractId);
  if (!d || d.leaseId !== null) throw Error('Contract unavailable');
  return d;
}
export const findingsOf = (d: Draft) => d.reviews.filter(r => r.done).flatMap(r => r.findings);
export function canNegotiate(d: Draft, article: number) {
  const a = d.articles.find(a => a.article === article);
  return !!a?.kind && d.leaseId === null && !d.removed.includes(article) &&
    (clauseDefs[a.kind].negotiable || findingsOf(d).some(f => f.clause.article === article && f.negotiable));
}

/** 수수료는 처음 한 번만. 같은 계약·같은 전문가는 기존 검토를 돌려준다(재굴림 없음). */
export function requestReview(ctx: TycoonCtx, s: CounselState, contractId: string, advisorId: string): Review {
  const d = unsigned(s, contractId), e = s.experts.find(e => e.id === advisorId);
  if (!e || e.kind !== 'lawyer') throw Error('Not a lawyer');
  const old = d.reviews.find(r => r.advisorId === advisorId);
  if (old) return old;
  const paid = ctx.settle(`${d.id}:review:${advisorId}`, [{ from: 'player', to: e.npcId, amount: reviewFee(e), reason: '계약 검토 수수료' }]);
  if (!paid.ok) throw Error(paid.error);
  let index = 0; // 계약·전문가에 묶인 난수: 같은 의뢰는 같은 결과
  const findings = reviewContract(generateContract('lease', d.seed), e.tier, () => ctx.roll('counsel', `${d.id}:${advisorId}`, index++));
  const review = { advisorId, readyDay: ctx.time.day + reviewDays(e.tier), done: false, findings };
  d.reviews.push(review); return review;
}
/** 조항을 빼는 대가로 하루 임대료 +1결. */
export function negotiate(_ctx: TycoonCtx, s: CounselState, contractId: string, article: number) {
  const d = unsigned(s, contractId);
  if (!canNegotiate(d, article)) throw Error('Not negotiable');
  d.removed.push(article); d.extraRent++;
}
/** 기존 rentStorefront로 임대하고, 남은 조항은 계약 상태로 보존한다. */
export function sign(ctx: TycoonCtx, s: CounselState, contractId: string, storefrontId: string) {
  const d = unsigned(s, contractId);
  if (d.storefrontId !== storefrontId) throw Error('Contract unavailable');
  const lease = rentStorefront(ctx.leases, ctx.world.ledger, storefrontId, ctx.time);
  d.leaseId = lease.id; d.endDay = ctx.time.day + d.termDays;
  draft(ctx, s, storefrontId); // 다음 임차를 위한 새 계약서
  return lease;
}

export const counsel: TycoonSystem<CounselState> = {
  id: 'counsel',
  create(ctx) {
    const [a, b] = ctx.residents.filter(n => Object.hasOwn(ctx.world.ledger.balances, n.id) && !storefronts.some(u => u.landlordId === n.id))
      .map(n => [ctx.roll('counsel', n.id, 0), n] as const).sort((x, y) => x[0] - y[0]).map(([, n]) => n);
    const tier: Tier = ctx.roll('counsel', 'tier', 0) < 0.5 ? 1 : 2;
    const s: CounselState = { drafts: [], messages: [], experts: [
      { id: 'lawyer', npcId: a.id, kind: 'lawyer', tier }, { id: 'accountant', npcId: b.id, kind: 'accountant', tier: tier === 1 ? 2 : 1 }] };
    for (const u of storefronts) draft(ctx, s, u.id);
    return s;
  },
  validate(raw) {
    const s = raw as CounselState;
    if (!Array.isArray(s?.experts) || !Array.isArray(s.drafts) || !Array.isArray(s.messages) || s.drafts.some(d =>
      typeof d?.id !== 'string' || !Array.isArray(d.articles) || !Array.isArray(d.removed) || !Array.isArray(d.reviews))) throw Error('Invalid counsel');
    return s;
  },
  onDay(ctx, s, day) {
    for (const d of s.drafts) {
      for (const r of d.reviews) if (!r.done && day + 1 >= r.readyDay) {
        r.done = true;
        say(s, `${nameOf(ctx, s.experts.find(e => e.id === r.advisorId)!)}: 계약서 검토 끝났어요. 짚을 조항 ${r.findings.length}개.`);
      }
      if (!d.leaseId || d.closed) continue;
      const lease = ctx.leases.find(l => l.id === d.leaseId)!, landlord = storefronts.find(u => u.id === d.storefrontId)!;
      if (!lease.ended) {
        // 추가 임대료는 낼 수 있을 때만(밀린 몫은 쌓지 않는다).
        if (d.extraRent) ctx.settle(`${d.id}:rent:${day}`, [{ from: 'player', to: landlord.landlordId, amount: d.extraRent, reason: '추가 임대료' }]);
        if (day >= d.endDay && active(d, 'autoRenew')) {
          d.endDay += clauseDefs.autoRenew.effect.renewWeeks; say(s, `자동 갱신 조항으로 임대 기간이 ${clauseDefs.autoRenew.effect.renewWeeks}일 늘었어요.`);
        }
        continue;
      }
      d.closed = true;
      const rate = active(d, 'heavyPenalty') ? clauseDefs.heavyPenalty.effect.penaltyRate : 0;
      const amount = Math.min(ctx.world.ledger.balances.player ?? 0, Math.floor(Math.max(0, d.endDay - day) * landlord.dailyRent * rate));
      if (amount > 0 && ctx.settle(`${d.id}:penalty`, [{ from: 'player', to: landlord.landlordId, amount, reason: '위약금' }]).ok)
        say(s, `기간 전에 나가서 위약금 ${amount}결을 냈어요.`);
    }
  },
};
