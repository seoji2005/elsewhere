// C103 AI 외주(R3 A1~9): 수락한 기회('aiContract.start') → 협력자 → 범위 → 데이터 조항 → 서명 → 착수 → 예약 근무 분에만 개발.
// 계약 조항·정산 규칙은 여기 두고 화면에는 사람 한 명·한 문장만. 돈은 고객·플레이어·개발자 계정 사이 settle뿐.
// C104(R3 A10~13): 검수 → 재작업 1회 → 잔금(awaitingPayment)·실패 환급(채무) → 납품 후 운영 기록과 다음 일감 후보.
import { advanceRate, cases, developers, orderClients, reworkMinutes, scopes, type CaseKind, type DevId, type OrderKind, type ScopeId } from '../../data/aiContracts';
import { acceptance, preview } from '../../sim/aiAutomation';
import type { Leg } from '../../sim/tycoonCore';
import type { OpportunityState } from './opportunity';
import type { TycoonCtx, TycoonSystem } from './system';

export type AiStage = 'scoping' | 'awaitingFunding' | 'building' | 'testing' | 'reworking' | 'awaitingPayment' | 'delivered' | 'failed';
/** 납품 뒤 하루 실제 주문 묶음의 처리 기록(자동 건수·사람 확인 분). */
export interface AiRun { day: number; auto: number; check: number; minutes: number }
/** reuse: '다른 고객 재사용' 제안에 대한 고객 답(null 제안 없음). asked: 50% 중간 확인 0 전·1 질문 중·2 답함. */
export interface AiContract {
  id: string; oppId: string; clientId: string; dev: DevId | null; scope: ScopeId | null; pay: 'advance' | 'successOnly' | null;
  signed: boolean; stage: AiStage; version: number; reuse: boolean | null; work: number; left: number; asked: 0 | 1 | 2; defects: string[];
  /** C104. fixes: 재작업 지정 기능군. owed: 남은 환급 채무. next: 운영 기록에서 나온 다음 일감 범위. */
  reworked: boolean; fixes: string[]; owed: number; cause: string | null; runs: AiRun[]; next: ScopeId | null;
}
/** devs: 개발자 후보 → 주민 ID(그 사람의 지갑으로 지급). */
export interface AiState { devs: Record<DevId, string>; contracts: AiContract[] }
const stages: AiStage[] = ['scoping', 'awaitingFunding', 'building', 'testing', 'reworking', 'awaitingPayment', 'delivered', 'failed'];

const get = (s: AiState, id: string) => { const c = s.contracts.find(c => c.id === id); if (!c) throw Error('Contract unavailable'); return c; };
const unsigned = (s: AiState, id: string) => { const c = get(s, id); if (c.signed) throw Error('Contract signed'); return c; };
/** 같은 개발자를 서명된 다른 계약과 겹쳐 예약하지 않는다(시험물이 나올 때까지). */
export const busy = (s: AiState, dev: DevId, except = '') => s.contracts.some(c => c.id !== except && c.dev === dev && c.signed &&
  ['scoping', 'awaitingFunding', 'building', 'reworking'].includes(c.stage));
export const fee = (c: AiContract) => developers[c.dev!].work[c.scope!]![1];
export const canSuccessOnly = (c: AiContract) => !!c.dev && developers[c.dev].successFee !== null && c.scope === 'list';

/** 지급 묶음. 일반: 착수 때 선금 40%·개발비 절반, 성공 때 나머지. 성공보수: 착수 때 없음, 성공 때 총액과 개발자 성공보수. */
export function legs(s: AiState, c: AiContract, phase: 'start' | 'final'): Leg[] {
  const price = scopes[c.scope!].price, advance = Math.round(price * advanceRate), half = Math.floor(fee(c) / 2);
  const [client, dev] = c.pay === 'successOnly' ? (phase === 'start' ? [0, 0] : [price, developers[c.dev!].successFee!])
    : phase === 'start' ? [advance, half] : [price - advance, fee(c) - half];
  return client ? [{ from: c.clientId, to: 'player', amount: client, reason: `AI 외주 ${c.id}:${phase}` },
    { from: 'player', to: s.devs[c.dev!], amount: dev, reason: `개발비 ${c.id}:${phase}` }] : [];
}

/** 진입점: 수락한 기회 하나에 계약 하나. 잔액은 보지 않는다. */
export function start(ctx: TycoonCtx, s: AiState, oppId: string) {
  const o = (ctx.systems.opportunity as OpportunityState | undefined)?.opps.find(o => o.id === oppId);
  if (o?.status !== 'accepted') throw Error('Opportunity unavailable');
  const old = s.contracts.find(c => c.oppId === oppId);
  if (old) return old;
  return open(ctx, s, oppId, o.npcId);
}
const open = (ctx: TycoonCtx, s: AiState, oppId: string, clientId: string) => {
  const c: AiContract = { id: ctx.nextId('aiContract'), oppId, clientId, dev: null, scope: null, pay: null, signed: false, stage: 'scoping',
    version: 1, reuse: null, work: 0, left: 0, asked: 0, defects: [], reworked: false, fixes: [], owed: 0, cause: null, runs: [], next: null };
  s.contracts.push(c); return c;
};
export function pickDev(_ctx: TycoonCtx, s: AiState, id: string, dev: DevId) {
  const c = unsigned(s, id);
  if (busy(s, dev, id)) throw Error('Developer busy');
  if (c.scope && !developers[dev].work[c.scope]) c.scope = null;
  c.dev = dev; return c;
}
export function pickScope(_ctx: TycoonCtx, s: AiState, id: string, scope: ScopeId) {
  const c = unsigned(s, id);
  if (!c.dev || !developers[c.dev].work[scope]) throw Error(c.dev ? developers[c.dev].refuse : 'No developer');
  c.scope = scope; return c;
}
/** 개발자의 '다른 고객 재사용' 제안을 고객에게 묻는다. 답은 계약·버전에 묶인 굴림(재질문 재굴림 없음). 조항이 바뀌면 버전이 오른다. */
export function askReuse(ctx: TycoonCtx, s: AiState, id: string) {
  const c = unsigned(s, id);
  if (c.reuse === null) { c.reuse = ctx.roll('aiContract', `${c.id}:reuse`, 0) < 0.5; c.version++; }
  return c.reuse;
}
export function sign(_ctx: TycoonCtx, s: AiState, id: string, pay: 'advance' | 'successOnly') {
  const c = unsigned(s, id);
  if (!c.dev || !c.scope || busy(s, c.dev, id) || (pay === 'successOnly' && !canSuccessOnly(c))) throw Error('Cannot sign');
  Object.assign(c, { pay, signed: true }); return c;
}
/** 착수: 선금·착수비 settle 묶음(하나라도 안 되면 둘 다 없음 → awaitingFunding). 결함은 기능군마다 여기서 한 번 정한다. */
export function begin(ctx: TycoonCtx, s: AiState, id: string) {
  const c = get(s, id), l = legs(s, c, 'start');
  if (!c.signed || (c.stage !== 'scoping' && c.stage !== 'awaitingFunding')) throw Error('Cannot start');
  if (l.length && !ctx.settle(`${c.id}:start`, l).ok) { c.stage = 'awaitingFunding'; return false; }
  const work = developers[c.dev!].work[c.scope!]![0];
  c.defects = ['list', ...scopes[c.scope!].auto].filter(f => ctx.roll('ai:defect', `${c.id}${f}`, 0) < developers[c.dev!].defect);
  Object.assign(c, { stage: 'building', work, left: work }); return true;
}
/** 50% 확인 답: 기존 합의의 재확인(진행도·결함은 그대로). */
export function confirmMid(_ctx: TycoonCtx, s: AiState, id: string) { const c = get(s, id); if (c.asked === 1) c.asked = 2; return c; }

/** 검수 결과: 결과물(범위·남은 결함·동의)이 같으면 같다. */
export const results = (c: AiContract) => acceptance(c.scope!, c.defects, c.reuse === true);
export const refund = (s: AiState, c: AiContract) => c.pay === 'advance' ? legs(s, c, 'start')[0].amount - legs(s, c, 'start')[1].amount : 0;
/** 잔금 묶음(고객→나, 나→개발자). 같은 묶음 ID라 반복·압축 뒤 재호출에도 한 번만 지급된다. 실패는 검수 결과를 바꾸지 않는다. */
function collect(ctx: TycoonCtx, s: AiState, c: AiContract) {
  if (ctx.settle(`${c.id}:final`, legs(s, c, 'final')).ok) c.stage = 'delivered';
  return c.stage === 'delivered';
}
/** 가진 만큼만 실제로 돌려주고 나머지는 채무로 남긴다(잔액을 음수로 만들지 않는다). */
function repay(ctx: TycoonCtx, s: AiState, c: AiContract, batch: string) {
  const paid = Math.min(c.owed, Math.max(0, ctx.world.ledger.balances.player ?? 0));
  if (paid && ctx.settle(batch, [{ from: 'player', to: c.clientId, amount: paid, reason: `AI 외주 환급 ${c.id}` }]).ok) c.owed -= paid;
}
/** 검수 실행. 전부 통과 → 잔금 청구, 재작업 뒤에도 실패 → 최종 실패·환급. 그 외에는 상태를 바꾸지 않는다(반복해도 같은 결과). */
export function inspect(ctx: TycoonCtx, s: AiState, id: string) {
  const c = get(s, id), fails = results(c).filter(r => !r.ok);
  if (c.stage !== 'testing') throw Error('Nothing to test');
  if (!fails.length) { c.stage = 'awaitingPayment'; collect(ctx, s, c); }
  else if (c.reworked) { Object.assign(c, { stage: 'failed', cause: '개발 결함', owed: refund(s, c) }); repay(ctx, s, c, `${c.id}:refund`); }
  return fails;
}
/** 포함 재작업 1회: 지정한 기능군의 결함만 30 작업 분에 고친다. 끝나면 다시 testing(전체 시험 재실행). */
export function rework(_ctx: TycoonCtx, s: AiState, id: string, fixes: string[]) {
  const c = get(s, id);
  if (c.stage !== 'testing' || c.reworked || !fixes.length || results(c).every(r => r.ok) || busy(s, c.dev!, id)) throw Error('Cannot rework');
  Object.assign(c, { stage: 'reworking', reworked: true, fixes, work: reworkMinutes, left: reworkMinutes }); return c;
}
export function retryPayment(ctx: TycoonCtx, s: AiState, id: string) {
  const c = get(s, id);
  if (c.stage !== 'awaitingPayment') throw Error('Nothing to collect');
  return collect(ctx, s, c);
}
/** 다음 일감은 새 계약(같은 고객, 개발자·범위·조항을 다시 정한다). 자동 수입 없음. */
export function followUp(ctx: TycoonCtx, s: AiState, id: string) {
  const c = get(s, id), key = `${c.id}>next`;
  if (c.stage !== 'delivered' || !c.next) throw Error('No follow-up');
  return s.contracts.find(x => x.oppId === key) ?? open(ctx, s, key, c.clientId);
}
const happened: Record<CaseKind, OrderKind | null> = { normal: null, missing: 'missingOrder', duplicate: 'duplicateOrder', changed: 'changedOrder' };
const upgrade: Record<ScopeId, ScopeId | null> = { list: 'normal', normal: 'extended', extended: null };
/** 납품 뒤 하루: 그날 실제 주문 기록(기회와 같은 굴림)으로 묶음을 처리해 기록. 다음 범위가 맡을 확인이 2건 이상이면 후보. */
function operate(ctx: TycoonCtx, c: AiContract, day: number) {
  const batch = cases.filter(x => { const k = happened[x.kind]; return !k || ctx.roll('opportunity', `${c.clientId}:${k}`, day) < orderClients.chance[k]; });
  const p = preview(c.scope!, batch), up = upgrade[c.scope!];
  c.runs = [...c.runs, { day, auto: p.auto, check: p.check, minutes: p.checkMinutes }].slice(-7);
  if (up && !c.next && batch.filter(x => preview(c.scope!, [x]).check && !preview(up, [x]).check).length >= 2) c.next = up;
}

export const aiContract: TycoonSystem<AiState> = {
  id: 'aiContract',
  create(ctx) {
    const [novice, senior] = ctx.residents.filter(n => Object.hasOwn(ctx.world.ledger.balances, n.id) && !orderClients.jobs.includes(n.job))
      .map(n => [ctx.roll('aiContract', n.id, 0), n.id] as const).sort((a, b) => a[0] - b[0]).map(([, id]) => id);
    return { devs: { novice, senior }, contracts: [] };
  },
  validate(raw) {
    const s = raw as AiState, int = (n: unknown) => Number.isSafeInteger(n);
    if (typeof s?.devs?.novice !== 'string' || typeof s.devs.senior !== 'string' || !Array.isArray(s.contracts) || !s.contracts.every(c =>
      typeof c?.id === 'string' && stages.includes(c.stage) && int(c.left) && int(c.work) && int(c.version) && Array.isArray(c.defects) &&
      (c.dev === null || c.dev in developers) && (c.scope === null || c.scope in scopes))) throw Error('Invalid aiContract');
    for (const c of s.contracts) c.runs ??= [], c.fixes ??= [], Object.assign(c, { reworked: !!c.reworked, owed: c.owed ?? 0, cause: c.cause ?? null, next: c.next ?? null }); // C103 저장
    if (!s.contracts.every(c => Number.isSafeInteger(c.owed) && c.owed >= 0)) throw Error('Invalid aiContract');
    return s;
  },
  onMinute(_ctx, s, minute) {
    const hour = Math.floor(minute % 1440 / 60);
    for (const c of s.contracts) {
      const [from, to] = developers[c.dev!]?.hours ?? [0, 0];
      if ((c.stage !== 'building' && c.stage !== 'reworking') || hour < from || hour >= to) continue; // 예약 근무 분에만 진행
      if (--c.left * 2 <= c.work && !c.asked) c.asked = 1;
      if (!c.left && c.stage === 'reworking') c.defects = c.defects.filter(f => !c.fixes.includes(f)); // 지정한 결함만
      if (!c.left) c.stage = 'testing';
    }
  },
  onDay(ctx, s, day) {
    for (const c of s.contracts) {
      if (c.stage === 'awaitingPayment') collect(ctx, s, c); // 다음 날 실제 지급 재시도
      else if (c.stage === 'failed' && c.owed) repay(ctx, s, c, `${c.id}:debt:${day}`);
      else if (c.stage === 'delivered') operate(ctx, c, day);
    }
  },
};
