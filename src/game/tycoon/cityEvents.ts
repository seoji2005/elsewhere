// C100 원인 있는 도시 사건: 세금 → 정비 승인 → 도로 공사(예고·주차 통제·인부) → 종료·복원. 시 계정이 있는 세계에서만 움직인다.
import { partnerLot, preparedCity, roadworks, taxHoliday, taxRate } from '../../data/cityEvents';
import { items } from '../../data/items';
import { activeAt, authorizeProblem, closure, validCauses, type CityState, type Response, type RoadEvent } from '../../sim/cityEvents';
import type { TycoonCtx, TycoonSystem } from './system';

export const CITY = 'city';
const now = (ctx: TycoonCtx) => (ctx.time.day - 1) * 1440 + ctx.time.hour * 60 + ctx.time.minute;
const playerShop = (ctx: TycoonCtx) => ctx.book.businesses.find(b => b.ownerId === 'player' && b.closedAt === null);
const busy = (ctx: TycoonCtx, s: CityState, id: string) => ctx.book.employment.some(e => e.actorId === id && e.leftAt === null) ||
  ctx.book.businesses.some(b => b.ownerId === id && b.closedAt === null) || s.events.some(e => e.stage !== 'ended' && e.workers.includes(id));
/** 공고·대응 카드에 보일 사건: 끝난 뒤에는 복원 안내를 한 번 확인할 때까지. */
export const currentEvent = (s: CityState) => s.events.find(e => e.stage !== 'cancelled' && !e.seen.includes(e.stage));

/** 새 세계만(세션이 표시하고 첫 분에 실행): 기존 사업자의 실제 세금·운영비 출연 이체 + 노후 조사로 찾은 정비 요청. 돈을 만들지 않는다. */
function prepareCity(ctx: TycoonCtx, s: CityState): void {
  delete s.prepare;
  const { balances } = ctx.world.ledger, { payers, paid, operating } = preparedCity;
  if (Object.hasOwn(balances, CITY)) return;
  balances[CITY] = 0;
  const legs = payers.flatMap(from => [{ from, to: CITY, amount: paid, reason: 'Tax: prepared' },
    { from, to: CITY, amount: operating / payers.length, reason: 'City: operating allocation' }]);
  if (ctx.settle('city:prepared', legs).ok) s.revenue += payers.length * paid;
  s.requests.push({ id: `repair:${roadworks.roadId}:0`, roadId: roadworks.roadId, minute: now(ctx), resolvedAt: null });
}

function authorize(ctx: TycoonCtx, s: CityState, day: number) {
  const free = ctx.residents.filter(n => !busy(ctx, s, n.id)).slice(0, roadworks.workers).map(n => n.id);
  if (authorizeProblem(s, ctx.world.ledger.balances[CITY], free.length)) return;
  const request = s.requests.find(r => r.resolvedAt === null)!, id = `roadworks:${s.events.length}`, escrowId = `escrow:${id}`;
  ctx.world.ledger.balances[escrowId] = 0; // 예치 계정은 0에서 이체로만 채운다
  if (!ctx.settle(`${id}:budget`, [{ from: CITY, to: escrowId, amount: roadworks.budget, reason: `City: ${id} budget` }]).ok)
    return void delete ctx.world.ledger.balances[escrowId];
  s.spent += roadworks.budget;
  const minute = now(ctx), startAt = (day - 1 + roadworks.leadDays) * 1440 + roadworks.workFrom;
  s.causes.push({ id: `${id}:auth`, kind: 'maintenanceAuthorization', parentId: null, depth: 0, sourceIds: [request.id, 'tax', `${id}:budget`, ...free], minute },
    { id, kind: 'roadworks', parentId: `${id}:auth`, depth: 1, sourceIds: [], minute });
  s.events.push({ id, causeId: id, requestId: request.id, stage: 'announced', announcedAt: minute, startAt,
    endAt: startAt + roadworks.days * 1440, escrowId, workers: free, responses: [], seen: [], impact: { carFails: 0, workerBuys: 0 } });
  for (const observerId of ['player', ...free]) s.notices.push({ eventId: id, observerId, sourceId: 'cityhall', learnedAt: minute, hops: 0 });
}

/** 결폰 카드의 대응 세 가지. 하나를 골라도 다른 대응은 막히지 않는다. */
export function respond(ctx: TycoonCtx, s: CityState, kind: Response['kind'], itemId?: string): boolean {
  const e = s.events.find(e => e.stage === 'announced' || e.stage === 'active'), minute = now(ctx), shop = playerShop(ctx), r: Response = { kind, minute };
  if (!e) return false;
  if (kind === 'breakfast') {
    if (!itemId || items.find(i => i.id === itemId)?.category !== 'food' || !shop?.store.stock.some(st => st.itemId === itemId)) return false;
    r.itemId = itemId;
  }
  if (kind === 'parking') {
    if (e.responses.some(x => x.kind === 'parking')) return false; // 같은 칸을 두 번 팔지 않는다
    r.cost = partnerLot.perDay * Math.ceil((e.endAt - Math.max(minute, e.startAt)) / 1440);
    if (!ctx.settle(`${e.id}:lot`, [{ from: 'player', to: partnerLot.operatorId, amount: r.cost, reason: `Parking: ${partnerLot.id}` }]).ok) return false;
  }
  e.responses.push(r); if (!e.seen.includes(e.stage)) e.seen.push(e.stage);
  return true;
}
/** 확인만(복원 안내 등). */ export function readNotice(_: TycoonCtx, s: CityState): void { const e = currentEvent(s); if (e) e.seen.push(e.stage); }

/** 인부의 아침은 한 번: 근무 중이거나 오늘 이미 어디서 샀으면 이 가게에서 새 구매를 만들지 않는다(C107: 광고 가산과 무관하게 차단). */
function banned(ctx: TycoonCtx, s: CityState, v: { npcId: string; hour: number }): boolean {
  if (!closure(s, now(ctx))?.workers.includes(v.npcId)) return false;
  return v.hour !== roadworks.mealFrom / 60 ||
    ctx.book.businesses.some(b => b.store.events.some(x => x.reason === 'purchased' && x.time.day === ctx.time.day && x.actorId === v.npcId));
}

const valid = (s: CityState) => s?.version === 1 && (s.prepare === undefined || s.prepare === true) && Array.isArray(s.requests) && Array.isArray(s.events) && Array.isArray(s.notices) &&
  Number.isSafeInteger(s.revenue) && Number.isSafeInteger(s.spent) && s.spent <= s.revenue && !!s.tax && typeof s.tax === 'object' &&
  Array.isArray(s.causes) && validCauses(s.causes) && s.events.every(e => s.causes.some(c => c.id === e.causeId && c.kind === 'roadworks') &&
    e.startAt > e.announcedAt && e.endAt > e.startAt && Array.isArray(e.workers) && Array.isArray(e.responses) && Array.isArray(e.seen));

export const cityEvents: TycoonSystem<CityState> = {
  id: 'cityEvents',
  create: () => ({ version: 1, requests: [], tax: {}, revenue: 0, spent: 0, causes: [], events: [], notices: [] }),
  validate(raw, ctx) {
    const s = raw as CityState;
    if (!valid(s) || s.events.some(e => e.stage !== 'ended' && !Object.hasOwn(ctx.world.ledger.balances, e.escrowId))) throw Error('Invalid cityEvents');
    return s;
  },
  /** 시작·종료·임금은 그 분의 손님 처리보다 먼저(통제 전 주차를 쓰지 못하게). */
  beforeMinute(ctx, s, minute) {
    if (s.prepare) prepareCity(ctx, s);
    for (const e of s.events) {
      if (e.stage === 'announced' && minute >= e.startAt) {
        e.stage = 'active';
        ctx.settle(`${e.id}:materials`, [{ from: e.escrowId, to: roadworks.supplierId, amount: roadworks.materials, reason: `Materials: ${e.id}` }]);
      }
      if (e.stage === 'active' && minute >= e.endAt) {
        e.stage = 'ended';
        const request = s.requests.find(r => r.id === e.requestId);
        if (request) request.resolvedAt = minute;
      }
      if (activeAt(e, minute) && minute % 1440 === roadworks.mealFrom) ctx.settle(`${e.id}:wage:${Math.floor(minute / 1440)}`,
        e.workers.map(to => ({ from: e.escrowId, to, amount: roadworks.wage, reason: `Wage: ${e.id}` })));
    }
  },
  onDay(ctx, s, day) {
    if (!Object.hasOwn(ctx.world.ledger.balances, CITY)) return;
    // 매출세: 누적 과세매출의 5%에서 이미 낸 세액을 뺀다. 잔액이 모자라면 미납으로 남고 수입이 아니다.
    for (const b of ctx.book.businesses.filter(b => b.ownerId === 'player')) {
      const t = s.tax[b.id] ??= { taxable: 0, paid: 0 };
      // C107: 신규 사업자 감면 — 개업일부터 taxHoliday일 동안의 판매는 과세매출이 아니다.
      if (day >= Math.floor(b.openedAt / 1440) + 1 + taxHoliday)
        t.taxable += b.store.events.filter(e => e.reason === 'purchased' && e.time.day === day).reduce((n, e) => n + e.amount, 0);
      const amount = Math.min(Math.floor(t.taxable * taxRate / 100) - t.paid, ctx.world.ledger.balances[b.ownerId]);
      if (amount > 0 && ctx.settle(`tax:${b.id}:${day}`, [{ from: b.ownerId, to: CITY, amount, reason: `Tax: ${b.id}` }]).ok)
        t.paid += amount, s.revenue += amount;
    }
    authorize(ctx, s, day);
  },
  blocksVisit: (ctx, s, v) => banned(ctx, s, v),
  visitBonus(ctx, s, v) {
    const e = closure(s, now(ctx));
    if (!e?.workers.includes(v.npcId)) return 0;
    if (banned(ctx, s, v)) return -100;
    const menu = e.responses.find(r => r.kind === 'breakfast'), b = ctx.book.businesses.find(b => b.id === v.businessId);
    return roadworks.workerBonus + (menu && (b?.store.stock.find(st => st.itemId === menu.itemId)?.displayed ?? 0) > 0 ? roadworks.menuBonus : 0);
  },
  onShopEvent(ctx, s, e) {
    const ev = closure(s, now(ctx));
    if (!ev) return;
    if (e.result === 'parkingFull') { // 한 사람이 하루에 몇 번 돌아가도 접근 실패는 한 건
      const day = `${ctx.time.day}:`, seen = (ev.impact.turned ?? []).filter(id => id.startsWith(day));
      if (seen.includes(day + e.npcId)) return;
      ev.impact.carFails++; ev.impact.turned = [...seen, day + e.npcId];
    } else if (e.result === 'purchased' && ev.workers.includes(e.npcId)) ev.impact.workerBuys++;
    else return;
    if (!s.causes.some(c => c.id === `${ev.id}:impact`))
      s.causes.push({ id: `${ev.id}:impact`, kind: 'shopImpact', parentId: ev.causeId, depth: 2, sourceIds: [e.businessId], minute: now(ctx) });
  },
};
