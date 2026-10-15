// C102 기회: 매일 아침 실제 주문 기록에서 기회가 생기고(세계 기록), 단골의 고민이나 공개 문의로 플레이어가 알게 된다.
// 상태: open(아무도 모름) → offered → reviewing → accepted / declined / expired. 잔액은 읽지 않는다.
import { checkOpportunities, opportunities, orderClients, type OrderKind, type Predicate } from '../../data/opportunities';
import type { PatronState } from './patrons';
import type { TycoonCtx, TycoonSystem } from './system';

export type OppStatus = 'open' | 'offered' | 'reviewing' | 'accepted' | 'declined' | 'expired';
/** known: 들은 질문 답의 수(단골 경로는 처음부터 전부). until: 이날 아침 만료. */
export interface Opp { id: string; defId: string; npcId: string; status: OppStatus; day: number; until: number; via: 'customer' | 'inquiry' | null; known: number }
export interface Worry { oppId: string; npcId: string; placeId: string }
/** closed: 마지막으로 마감된 날. 주문 기록은 저장하지 않고 그날까지의 굴림에서 다시 읽는다(세이브 용량). */
export interface OpportunityState { closed: number; opps: Opp[]; worry: Worry | null }
export const maxShown = 3;
const statuses: OppStatus[] = ['open', 'offered', 'reviewing', 'accepted', 'declined', 'expired'];
checkOpportunities(opportunities);

export const defOf = (o: Opp) => opportunities.find(d => d.id === o.defId)!;
const live = (o: Opp) => o.status === 'open' || o.status === 'offered' || o.status === 'reviewing';
/** 결폰 업무 탭에 보이는 제안(최대 3개). 세계의 open 기회 수와 따로 센다. */
export const shown = (s: OpportunityState) => s.opps.filter(o => o.status === 'offered' || o.status === 'reviewing').slice(-maxShown);

/** 고객 사업자의 최근 keepDays일 주문 기록 건수(하루 한 번 굴린 실제 기록). */
export function recordCount(ctx: TycoonCtx, s: OpportunityState, npcId: string, kind: OrderKind) {
  if (!orderClients.jobs.includes(ctx.residents.find(n => n.id === npcId)?.job ?? '')) return 0;
  let count = 0;
  for (let day = s.closed; day > s.closed - orderClients.keepDays && day >= 0; day--)
    if (ctx.roll('opportunity', `${npcId}:${kind}`, day) < orderClients.chance[kind]) count++;
  return count;
}
function fact(ctx: TycoonCtx, s: OpportunityState, npcId: string, name: string): number | string {
  if (name === 'visitsAtMyShop') return (ctx.systems.patrons as PatronState | undefined)?.visits[npcId] ?? 0;
  if (name === 'jobOf') return ctx.residents.find(n => n.id === npcId)?.job ?? '';
  return recordCount(ctx, s, npcId, name.slice('record.'.length) as OrderKind);
}
const holds = (ctx: TycoonCtx, s: OpportunityState, npcId: string, ps: readonly Predicate[]) => ps.every(p => {
  const v = fact(ctx, s, npcId, p.fact);
  return p.op === 'in' ? (p.value as readonly string[]).includes(v as string) : (v as number) >= (p.value as number);
});

/** day가 끝난 뒤(다음 날 아침): 만료를 처리하고, 조건이 맞는 사업자에게 기회가 생긴다(세계 동시 worldCap개까지). */
function morning(ctx: TycoonCtx, s: OpportunityState, day: number) {
  const today = day + 1;
  s.closed = day;
  for (const o of s.opps) if (live(o) && today >= o.until) o.status = 'expired';
  if (s.worry && s.opps.find(o => o.id === s.worry!.oppId)?.status !== 'open') s.worry = null;
  // 거절·만료 뒤 수명만큼은 같은 사람에게 다시 생기지 않는다("다음에 또 말해 줘요").
  s.opps = s.opps.filter(o => live(o) || o.status === 'accepted' || o.until + defOf(o).lifeDays > today);
  for (const d of opportunities) for (const n of [...ctx.residents].sort((a, b) => ctx.roll('opportunity', a.id, day) - ctx.roll('opportunity', b.id, day)))
    if (s.opps.filter(o => o.defId === d.id && o.status === 'open').length < d.worldCap &&
        !s.opps.some(o => o.defId === d.id && o.npcId === n.id) && holds(ctx, s, n.id, d.giver) && holds(ctx, s, n.id, d.trigger))
      s.opps.push({ id: ctx.nextId('opportunity'), defId: d.id, npcId: n.id, status: 'open', day: today, until: today + d.lifeDays, via: null, known: 0 });
}

function find(s: OpportunityState, oppId: string, ...from: OppStatus[]) {
  const o = s.opps.find(o => o.id === oppId);
  if (!o || !from.includes(o.status)) throw Error('Opportunity unavailable');
  return o;
}
const offer = (s: OpportunityState, o: Opp, via: 'customer' | 'inquiry') => {
  if (shown(s).length >= maxShown) throw Error('Too many opportunities');
  Object.assign(o, { status: 'offered', via, known: via === 'customer' ? defOf(o).questions.length : 0 });
  return o;
};
/** 단골 경로: 고민을 들은 뒤 '무슨 일 있어요?'. */
export function askWorry(_ctx: TycoonCtx, s: OpportunityState) {
  if (!s.worry) throw Error('Opportunity unavailable');
  const o = find(s, s.worry.oppId, 'open'); s.worry = null;
  return offer(s, o, 'customer');
}
/** 공개 문의 경로: '다른 사업 알아보기 → 반복 업무 도와주기'. 같은 실제 문제를 가진 사업자가 답한다(단골 먼저). */
export function inquire(ctx: TycoonCtx, s: OpportunityState, industry: string) {
  const visits = (id: string) => fact(ctx, s, id, 'visitsAtMyShop') as number;
  const o = s.opps.filter(o => o.status === 'open' && defOf(o).industry === industry)
    .sort((a, b) => visits(b.npcId) - visits(a.npcId) || a.day - b.day || (a.id < b.id ? -1 : 1))[0];
  if (!o) return null;
  if (s.worry?.oppId === o.id) s.worry = null;
  return offer(s, o, 'inquiry');
}
/** 상세를 열면 검토 중. 공개 문의로 온 제안은 질문 하나에 정보 하나. */
export function review(_ctx: TycoonCtx, s: OpportunityState, oppId: string) {
  const o = find(s, oppId, 'offered', 'reviewing'); o.status = 'reviewing'; return o;
}
export function askQuestion(_ctx: TycoonCtx, s: OpportunityState, oppId: string) {
  const o = find(s, oppId, 'offered', 'reviewing');
  o.status = 'reviewing'; o.known = Math.min(defOf(o).questions.length, o.known + 1); return o;
}
/** 수락은 다 듣고 나서. 실제 계약 진행은 defOf(o).next(C103). 거절은 관계를 깎지 않는다. */
export function answer(ctx: TycoonCtx, s: OpportunityState, oppId: string, accept: boolean) {
  const o = find(s, oppId, 'offered', 'reviewing');
  if (accept && o.known < defOf(o).questions.length) throw Error('Opportunity unavailable');
  if (!accept) o.until = ctx.time.day; // 쉬는 기간은 거절한 날부터
  o.status = accept ? 'accepted' : 'declined'; return o;
}

export const opportunity: TycoonSystem<OpportunityState> = {
  id: 'opportunity',
  create(ctx) { const s: OpportunityState = { closed: 0, opps: [], worry: null }; morning(ctx, s, ctx.time.day - 1); return s; },
  validate(raw) {
    const s = raw as OpportunityState, int = (n: unknown) => Number.isSafeInteger(n);
    if (!s || !int(s.closed) || !Array.isArray(s.opps) || (s.worry !== null && typeof s.worry?.oppId !== 'string') ||
        !s.opps.every(o => statuses.includes(o?.status) && opportunities.some(d => d.id === o.defId) && int(o.day) && int(o.until) && int(o.known)))
      throw Error('Invalid opportunity');
    return s;
  },
  onDay(ctx, s, day) { morning(ctx, s, day); },
  onMinute(ctx, s) { if (s.worry && ctx.placeOf(s.worry.npcId) !== s.worry.placeId) s.worry = null; }, // 손님이 가게를 떠남
  onShopEvent(ctx, s, e) {
    if (e.result !== 'purchased' || s.worry || shown(s).length >= maxShown) return;
    const o = s.opps.find(o => o.npcId === e.npcId && o.status === 'open' && holds(ctx, s, o.npcId, defOf(o).regular));
    const placeId = ctx.book.businesses.find(b => b.id === e.businessId)?.placeId;
    if (o && placeId) s.worry = { oppId: o.id, npcId: o.npcId, placeId };
  },
};
