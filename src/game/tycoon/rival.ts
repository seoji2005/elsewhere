// C099 라이벌 도렌: 새 세계에서만 근처 점포를 연 채 시작해, 관측(12·18시)과 자기 장부로 다음 날 가격·발주·주간 광고를 정하고 07시에 실행한다.
// C109: 손님의 하루 구매 의도(기존 수요 슬롯) 하나는 한 가게에서만 결제된다. 도렌은 손님과 같은 자격 검사(주차·성격 가격 허용치)를 받고,
// 공개 진열·현장 붐빔·직접 본 것만 쓰며, 번 돈은 임금·생산자 매입·확장 공사로 이웃에게 돌아간다.
import { items } from '../../data/items';
import { adChannels, type Segment } from '../../data/ads';
import { taxRate } from '../../data/cityEvents';
import { retailDemand } from '../../data/storefronts';
import type { Npc } from '../../data/npcs';
import { RIVAL, rivalLines as L, rivalSpec as R } from '../../data/rival';
import { adEffectOnVisit, buyCampaign, checkPromise, planCampaign, type CampaignInput, type CampaignResult } from '../../sim/ads';
import { checkoutBusiness, openBusiness, procure, producerJobs, type Business } from '../../sim/business';
import { createPurse, dayCashflow, funds } from '../../sim/purse';
import { restock, setPrice, visitStore } from '../../sim/store';
import { chooseWeatherNeed, demandWeight, weatherFor } from '../../sim/weather';
import { planDay, type Discount, type RivalObservation, type RivalPlan, type RivalView } from '../../sim/rival';
import { MEDIA_JOB, segmentOf, shopMix } from './ads';
import { CITY } from './cityEvents';
import { basePersona, choice, customerOf, intentOf, paidAt, park, patrons, type PatronState } from './patrons';
import type { SceneState } from './scene';
import type { ShopEvent, TycoonCtx, TycoonSystem } from './system';

export interface RivalCampaign { id: string; startDay: number; messageId: CampaignInput['messageId']; result: CampaignResult; broken: boolean }
export interface Rumor { visit: string; itemId: string; minute: number }
export interface RivalState {
  version: 1; prepare?: true; npcId: string; businessId: string | null; status: 'unavailable' | 'operating' | 'closing' | 'closed';
  observations: RivalObservation[]; heard: Record<string, Rumor>; // heard: 플레이어 가게 품절을 겪은 손님 → 원본 방문·품목·시각
  plan: RivalPlan | null; discount: Discount | null; campaign: RivalCampaign | null; reputation: number;
  rentDue: number[]; depositDue: number; tax: { taxable: number; paid: number }; insufficientCashDays: number; closeAt: number | null;
  parking: number[]; lot?: number[]; helpers: string[]; board: { minute: number; text: string } | null; news: { minute: number; text: string }[];
}
const at = (t: { day: number; hour: number; minute: number }) => (t.day - 1) * 1440 + t.hour * 60 + t.minute, now = (ctx: TycoonCtx) => at(ctx.time);
const base = (itemId: string) => items.find(i => i.id === itemId)!.price;
const cost = (itemId: string) => Math.max(1, Math.floor(base(itemId) / 4)); // 플레이어와 같은 공급 견적(판매가와 무관)
const poorest = (ctx: TycoonCtx, ns: readonly Npc[]) =>
  ns.reduce<Npc | undefined>((a, n) => !a || ctx.world.ledger.balances[n.id] < ctx.world.ledger.balances[a.id] ? n : a, undefined);
const producer = (ctx: TycoonCtx, itemId: string) => poorest(ctx, ctx.residents.filter(n => n.job === producerJobs[itemId]))!; // supplyDay처럼
const owed = (s: RivalState) => Math.max(0, Math.floor(s.tax.taxable * taxRate / 100) - s.tax.paid);
/** 공통 가용액: 잔액 − 밀린 임대료 − 미납 세금 − 향후 3일 임대료. 발주·광고·임금·공사 대금은 모두 여기서 차례로 뺀다. */
const spare = (ctx: TycoonCtx, s: RivalState) => ctx.world.ledger.balances[RIVAL] - R.rent * (s.rentDue.length + 3) - owed(s);
/** 플레이어 가게의 현장 붐빔(이번·지난 시간 가게에 있던 손님): 그 자리에서 보이는 줄. */
const crowd = (ctx: TycoonCtx) => { const sc = ctx.systems.scene as SceneState | undefined;
  return sc && sc.hour >= Math.floor(now(ctx) / 60) - 1 ? sc.present.length : 0; };
const shopOf = (ctx: TycoonCtx, s: RivalState) => ctx.book.businesses.find(b => b.id === s.businessId);
const playerShop = (ctx: TycoonCtx) => ctx.book.businesses.find(b => b.ownerId === 'player' && b.closedAt === null);
const bought = (b: Business) => b.store.events.filter(e => e.reason === 'purchased');
const queueOf = (b: Business, minute: number) => bought(b).filter(e => at(e.time) >= minute - 60).length;
const news = (s: RivalState, minute: number, text: string) => { s.news = [...s.news, { minute, text }].slice(-3); };
const priceLevel = (b: Business) => b.store.stock.reduce((n, st) => n + st.price / base(st.itemId), 0) / b.store.stock.length;
export const boardOf = (b: Business) => b.store.stock.map(st => `${items.find(i => i.id === st.itemId)!.name} ${st.price}결`).join(' · ');
/** 도렌 광고·광고 평판이 더하는 방문 고려 확률(%p). C098 효과값 0~0.25 × 100. */
export const rivalBonus = (ctx: TycoonCtx, s: RivalState, npcId: string) =>
  (s.campaign ? adEffectOnVisit([s.campaign], segmentOf(ctx, npcId), ctx.time.day) * 100 : 0) + s.reputation / 5;

/** 새 세계 초기 배분(세션이 새 게임에만 표시, 첫 분에 실행): 이웃 여섯의 출자 이체로 600 → 보증금·첫 재고를 실제 지급. 돈을 만들지 않는다. */
function openRival(ctx: TycoonCtx, s: RivalState): void {
  const { people, ledger } = ctx.world;
  delete s.prepare;
  if (s.status !== 'unavailable' || Object.hasOwn(ledger.balances, RIVAL)) return;
  ledger.balances[RIVAL] = 0;
  if (!ctx.settle('rival:capital', R.funders.map(from => ({ from, to: RIVAL, amount: R.capital / R.funders.length, reason: 'Initial allocation' }))).ok)
    return void delete ledger.balances[RIVAL];
  people[RIVAL] = { id: RIVAL, name: R.name, role: 'npc', placeId: R.placeId };
  ctx.purses[RIVAL] = createPurse(people, ledger, RIVAL);
  const b = openBusiness(ctx.book, people, ledger, R.businessId, RIVAL, R.placeId, 1,
    R.stock.map(([itemId, price]) => ({ itemId, price, capacity: 5, backroom: 0, displayed: 0 })), ctx.time);
  ctx.settle('rival:deposit', [{ from: RIVAL, to: R.landlordId, amount: R.deposit, reason: `Deposit: ${b.id}` }]);
  for (const [itemId, , n] of R.stock) procure(ctx.book, people, ledger, b.id, producer(ctx, itemId), itemId, n, cost(itemId), `rival:stock:${itemId}`, ctx.time);
  Object.assign(s, { businessId: b.id, status: 'operating' });
}

/** 판단 입력: 자기 장부 + 저장된 관측만. 플레이어의 잔액·원가·창고·직원은 읽지 않는다. */
export function rivalView(ctx: TycoonCtx, s: RivalState, day: number): RivalView {
  const b = shopOf(ctx, s)!, days = Math.max(0, Math.min(3, day - Math.floor(b.openedAt / 1440)));
  const sales = bought(b), c = s.campaign;
  return { day, minute: day * 1440 - 1, available: spare(ctx, s),
    items: b.store.stock.map(st => ({ itemId: st.itemId, price: st.price, cost: cost(st.itemId), stock: st.backroom + st.displayed,
      sold: Array.from({ length: days }, (_, i) => sales.filter(e => e.itemId === st.itemId && e.time.day === day - i).length) })),
    observations: s.observations, discount: s.discount, revenue7: sales.filter(e => e.time.day > day - 7).reduce((n, e) => n + e.amount, 0),
    adRunning: !!c && (c.result.curve[day + 1 - c.startDay] ?? 0) > 0 };
}

// 매시: 공통 의도가 있는 두 가게 근처 주민이 점수로 가게를 고른다(R4 A8·A9). 도렌이 이긴 의도만 여기서, 플레이어 가게와 같은 검사로 결제한다.
function serve(ctx: TycoonCtx, s: RivalState, b: Business, minute: number) {
  const p = playerShop(ctx), pat = ctx.systems.patrons as PatronState | undefined, day = ctx.time.day;
  const staffed = !!p && (ctx.player.placeId === p.placeId || ctx.book.employment.some(e => e.businessId === p.id && e.leftAt === null));
  const visits = (x: Business, id: string) => Math.min(3, x === b ? bought(b).filter(e => e.actorId === id).length : pat?.visits[id] ?? 0);
  const score = (x: Business, price: number, itemId: string, here: boolean, id: string) =>
    100 - 40 * price / base(itemId) - 2 * (here ? R.walkHere : R.walkThere) - 3 * (x === b ? queueOf(b, minute) : crowd(ctx)) + 4 * visits(x, id);
  const order = [...ctx.residents].sort((x, y) => ctx.roll('rival', `order:${x.id}`, minute) - ctx.roll('rival', `order:${y.id}`, minute));
  let served = 0;
  for (const n of order) { // 같은 계산대 규칙: 한 시간에 계산대 수만큼
    if (served >= b.capacity) break;
    const place = ctx.placeOf(n.id), intent = intentOf(ctx, n.id), visitId = `${b.id}:${day}:${n.id}`;
    if (place !== b.placeId && place !== p?.placeId || b.store.visits.some(v => v.id === visitId) || paidAt(ctx, n.id) ||
        pat?.haggles.some(h => h.npcId === n.id)) continue; // 결제됐거나 플레이어와 흥정 중인 의도는 건드리지 않는다
    const persona = basePersona(ctx, pat, n.id), customer = customerOf(ctx.npcSeed, n, persona);
    const need = chooseWeatherNeed(customer, items.filter(i => (p ?? b).store.stock.some(st => st.itemId === i.id)), // 의도의 품목도 하나
      choice(ctx.npcSeed, `need:${intent}`) / 0x100000000, day, weatherFor(ctx.npcSeed, day));
    const st = need && b.store.stock.find(x => x.itemId === need.itemId);
    if (!st || choice(ctx.npcSeed, intent) % 100 >= retailDemand.visitChance + 15 * demandWeight(st.itemId, day) + rivalBonus(ctx, s, n.id)) continue;
    const mine = p?.store.stock.find(x => x.itemId === st.itemId); // 손님이 보는 것: 공개 진열(창고 아님)
    const theirs = staffed && mine && mine.displayed > 0 ? score(p!, mine.price, st.itemId, place === p!.placeId, n.id) : -Infinity;
    const ours = score(b, st.price, st.itemId, place === b.placeId, n.id);
    if (ours < theirs || ours === theirs && ctx.roll('rival', `tie:${n.id}`, minute) < 0.5 || st.backroom + st.displayed === 0 ||
        funds(ctx.world.ledger, ctx.purses[n.id]).spendable < st.price ||
        dayCashflow(ctx.world.ledger, ctx.purses[n.id], day).consumption + st.price > retailDemand.dailyBudget || !park(ctx, s, n.id, persona)) continue;
    restock(b.store, st.itemId, 5);
    const visit = visitStore(b.store, ctx.world.ledger, visitId, n.id, need, customer.patienceMinutes, ctx.time); // 비싸면 'expensive'로 떠난다
    if (!checkoutBusiness(ctx.book, ctx.world.people, ctx.world.ledger, b.id, ctx.purses[n.id], visit.id, ctx.time).ok) continue;
    served++;
    const h = s.heard[n.id];
    if (h) { // 계산하며 들은 말: 원본 방문·품목·시각 그대로(같은 방문 = 증거 하나)
      s.observations = [...s.observations, { kind: 'soldOut' as const, minute: h.minute, itemId: h.itemId, value: 1, source: h.visit, via: n.id }].slice(-12);
      delete s.heard[n.id];
    }
    if (pat && p && place === p.placeId && mine && st.price < mine.price) patrons.onShopEvent!(ctx, pat,
      { npcId: n.id, businessId: p.id, itemId: st.itemId, price: st.price, count: 1, result: 'rivalCheaper' as ShopEvent['result'] });
  }
  // 돈 순환 ①: 가용액이 넉넉한 시간엔 지금 가게에 있는, 다른 데 고용되지 않은 가장 가난한 주민을 한 시간 보조로 쓴다.
  const helper = spare(ctx, s) >= R.cashFloor + R.wage && poorest(ctx, ctx.residents.filter(n =>
    ctx.placeOf(n.id) === b.placeId && !ctx.book.employment.some(e => e.actorId === n.id && e.leftAt === null)));
  if (helper && ctx.settle(`rival:wage:${minute}`, [{ from: RIVAL, to: helper.id, amount: R.wage, reason: `Wage: ${b.id}` }]).ok &&
      !s.helpers.includes(helper.id)) s.helpers.push(helper.id);
}

// 12·18시: 도렌이 짬을 내 플레이어 가게 앞까지 걸어가거나(그 분 동안 실제로 거기 있다) 오늘 보조가 마침 거기 있을 때만 본다(R6 ③).
// 보는 것은 공개 가격표와 현장 붐빔뿐. 못 본 날은 자료가 낡는다.
function look(ctx: TycoonCtx, s: RivalState, b: Business, minute: number) {
  const p = playerShop(ctx);
  if (!p || s.status !== 'operating') return;
  if (ctx.roll('rival', 'look', minute) < R.lookChance) ctx.world.people[RIVAL].placeId = p.placeId;
  const by = [RIVAL, ...s.helpers].find(id => ctx.placeOf(id) === p.placeId);
  if (!by) return;
  const queue = crowd(ctx), common = p.store.stock.filter(st => b.store.stock.some(x => x.itemId === st.itemId));
  s.observations = [...s.observations, ...common.map(st => ({ kind: 'price' as const, minute, itemId: st.itemId, value: st.price, source: `look:${minute}`, via: by })),
    { kind: 'queue' as const, minute, itemId: '', value: queue, source: `look:${minute}`, via: by }].slice(-12);
  if (common.length && by === RIVAL && ctx.player.placeId === p.placeId) news(s, minute, `도렌: ${L.look(common[0].price, queue)}`);
}

function buyAd(ctx: TycoonCtx, s: RivalState, b: Business, budget: number): string {
  const count = new Map<Segment, number>();
  for (const e of bought(b).filter(e => e.time.day > ctx.time.day - 7)) count.set(segmentOf(ctx, e.actorId), (count.get(segmentOf(ctx, e.actorId)) ?? 0) + 1);
  const target = [...count].sort((x, y) => y[1] - x[1])[0]?.[0] ?? 'workers', messageId = priceLevel(b) <= 1.1 ? 'price' : 'emotion';
  const plan = R.adChannels.map(channelId => planCampaign({ channelId, messageId, modelId: 'none', targets: [target], weeks: 1 }))
    .filter(p => p.cost <= budget).sort((x, y) => y.expectedLift / y.cost - x.expectedLift / x.cost || x.cost - y.cost)[0];
  if (!plan) return '광고 보류';
  const id = `rival-ad:${ctx.time.day}`, media = ctx.residents.find(n => n.job === MEDIA_JOB) ?? ctx.residents[0];
  const paid = buyCampaign(ctx.world.ledger, RIVAL, media.id, plan, ctx.time, id, shopMix(ctx), [0, 1, 2, 3, 4].map(i => ctx.roll('rival', id, i)));
  if (!paid.campaign) return '광고 실패';
  s.campaign = { id, startDay: ctx.time.day, messageId, result: paid.campaign.result, broken: false };
  s.reputation = Math.max(-100, Math.min(100, s.reputation + paid.campaign.result.reputation));
  const name = adChannels.find(c => c.id === plan.channelId)!.name;
  news(s, now(ctx), L.ad(name));
  return `${name} ${plan.cost}결`;
}

// 07시: 계획을 실행하되 그때의 잔액으로 다시 검사한다(못 산 물건은 도착하지 않는다).
function execute(ctx: TycoonCtx, s: RivalState, b: Business, plan: RivalPlan) {
  const done: string[] = [];
  let left = spare(ctx, s); // 의무를 뺀 공통 가용액에서 발주 → 광고 순으로 차감
  for (const st of b.store.stock) setPrice(b.store, st.itemId, plan.prices[st.itemId] ?? st.price);
  for (const [itemId, want] of Object.entries(plan.orders)) if (want > 0) {
    const n = Math.min(want, Math.max(0, Math.floor(left / cost(itemId))));
    const ok = n > 0 && procure(ctx.book, ctx.world.people, ctx.world.ledger, b.id, producer(ctx, itemId), itemId, n, cost(itemId),
      `rival:order:${plan.day}:${itemId}`, ctx.time).ok;
    if (ok) left -= n * cost(itemId);
    done.push(`${itemId} ${ok ? n : 0}/${want}`);
  }
  if (plan.adBudget) done.push(buyAd(ctx, s, b, Math.min(plan.adBudget, Math.floor(left * 0.2))));
  plan.done = done.join(' · ') || '없음';
}

const statuses = ['unavailable', 'operating', 'closing', 'closed'], kinds = ['price', 'queue', 'soldOut'], natural = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
const paidHere = (ctx: TycoonCtx, s: RivalState, npcId: string) =>
  !!shopOf(ctx, s)?.store.visits.some(v => v.id === `${s.businessId}:${ctx.time.day}:${npcId}` && v.status === 'paid');
export const rival: TycoonSystem<RivalState> = {
  id: 'rival',
  create: () => ({ version: 1, npcId: RIVAL, businessId: null, status: 'unavailable', observations: [], heard: {}, plan: null, discount: null,
    campaign: null, reputation: 0, rentDue: [], depositDue: 0, tax: { taxable: 0, paid: 0 }, insufficientCashDays: 0, closeAt: null,
    parking: [], helpers: [], board: null, news: [] }),
  validate(raw, ctx) {
    const s = raw as RivalState;
    if (s && typeof s === 'object') { // C099 세이브: 시간 단위 배정 기록은 버리고, 품목 없는 옛 소문은 근거가 못 된다
      for (const [id, h] of Object.entries(s.heard ?? {})) if (typeof h === 'number') delete s.heard[id];
      delete (s as { takenAt?: number }).takenAt; delete (s as { taken?: string[] }).taken; s.parking ??= []; s.helpers ??= [];
    }
    if (s?.version !== 1 || s.prepare !== undefined && s.prepare !== true || !statuses.includes(s.status) || (s.businessId === null) !== (s.status === 'unavailable') ||
        s.businessId !== null && !ctx.book.businesses.some(b => b.id === s.businessId && b.ownerId === s.npcId) ||
        !Array.isArray(s.observations) || !s.observations.every(o => kinds.includes(o?.kind) && natural(o.minute) && typeof o.source === 'string') ||
        !Array.isArray(s.rentDue) || !s.rentDue.every(natural) || !Array.isArray(s.parking) || !s.parking.every(natural) || !Array.isArray(s.helpers) ||
        !Array.isArray(s.news) || !natural(s.depositDue) || !natural(s.tax?.paid) || !natural(s.tax.taxable) ||
        !Object.values(s.heard ?? 0).every(h => natural(h?.minute) && typeof h.visit === 'string' && typeof h.itemId === 'string') ||
        !Number.isFinite(s.reputation)) throw Error('Invalid rival');
    return s;
  },
  beforeMinute(ctx, s, minute) {
    if (s.prepare) openRival(ctx, s);
    const b = shopOf(ctx, s), m = minute % 1440;
    if (!b || b.closedAt !== null) return;
    ctx.world.people[RIVAL].placeId = b.placeId; // 가격표를 보러 나간 건 그 1분뿐
    if (m === 420 && s.plan?.day === ctx.time.day) execute(ctx, s, b, s.plan);
    if (m % 60 === 0 && m >= R.openFrom * 60 && m < R.openTo * 60) serve(ctx, s, b, minute);
    if ((R.lookAt as readonly number[]).includes(m)) look(ctx, s, b, minute);
    if (ctx.player.placeId === b.placeId) s.board = { minute, text: boardOf(b) }; // 직접 가 본 가격표
  },
  blocksVisit: (ctx, s, v) => paidHere(ctx, s, v.npcId), // 오늘 의도를 도렌에게서 결제한 손님(시간이 달라도)
  onShopEvent(ctx, s, e) {
    if (e.result === 'missing' && s.status === 'operating') s.heard[e.npcId] = { visit: `${e.businessId}:${ctx.time.day}:${e.npcId}`, itemId: e.itemId, minute: now(ctx) };
  },
  onDay(ctx, s, day) {
    const b = shopOf(ctx, s), minute = now(ctx), balance = () => ctx.world.ledger.balances[RIVAL];
    if (!b) return;
    const last = s.status === 'closing' && day >= s.closeAt!;
    if (b.closedAt === null) { // 영업한 날(마지막 날 포함): 임대료와 과세 매출
      s.rentDue.push(day); s.tax.taxable += bought(b).filter(e => e.time.day === day).reduce((n, e) => n + e.amount, 0);
    }
    s.rentDue = s.rentDue.filter(d => !ctx.settle(`rival:rent:${d}`, [{ from: RIVAL, to: R.landlordId, amount: R.rent, reason: `Rent: ${b.id}` }]).ok);
    const tax = Math.min(owed(s), balance()); // C100과 같은 5%, 주 단위 납부(폐점 뒤엔 남은 세금을 갚을 수 있을 때마다)
    if ((day % 7 === 0 || last || b.closedAt !== null) && tax > 0 && Object.hasOwn(ctx.world.ledger.balances, CITY) &&
        ctx.settle(`rival:tax:${day}`, [{ from: RIVAL, to: CITY, amount: tax, reason: `Tax: ${b.id}` }]).ok) s.tax.paid += tax;
    if (last) { // 정산 뒤 종료: 채무(rentDue·세금)는 남기고, 재고·보조·임대를 닫는다
      b.closedAt = minute; for (const st of b.store.stock) st.backroom = st.displayed = 0;
      Object.assign(s, { status: 'closed', plan: null, depositDue: R.deposit, helpers: [] });
    }
    if (s.depositDue && ctx.settle('rival:deposit:back', [{ from: R.landlordId, to: RIVAL, amount: s.depositDue, reason: `Deposit: ${b.id}` }]).ok) s.depositDue = 0;
    if (b.closedAt !== null) return;
    s.helpers = [];
    for (const [id, h] of Object.entries(s.heard)) if (minute - h.minute > 2 * 1440) delete s.heard[id];
    s.insufficientCashDays = balance() < R.rent * (s.rentDue.length + 1) ? s.insufficientCashDays + 1 : 0;
    if (s.status === 'operating' && s.insufficientCashDays >= R.closeAfter) { s.status = 'closing'; s.closeAt = day + R.closeDelay; news(s, minute, L.closing); }
    const c = s.campaign;
    if (c && !c.broken && (c.result.curve[day - c.startDay] ?? 0) > 0) {
      const check = checkPromise(c.messageId, { avgWait: 0, soldOutRate: 0, priceLevel: priceLevel(b) });
      if (check.broken) { c.broken = true; s.reputation = Math.max(-100, s.reputation + check.reputation); }
    }
    const plan = planDay(rivalView(ctx, s, day));
    if (s.status === 'closing') { plan.orders = {}; plan.adBudget = 0; }
    const d = plan.discount;
    if (d && d.startedDay !== s.discount?.startedDay) news(s, minute, L.poster(items.find(i => i.id === d.itemId)!.name, d.price));
    if (!d && s.discount) news(s, minute, L.restore);
    s.discount = d; s.plan = plan;
    // 돈 순환 ②: 내일 발주와 상한(cashCap)을 넘는 이익은 확장 공사 대금으로 가장 가난한 이웃들에게(한 묶음 지급).
    const excess = spare(ctx, s) - R.cashCap - Object.entries(plan.orders).reduce((n, [id, q]) => n + q * cost(id), 0);
    const poor = [...ctx.residents].sort((x, y) => ctx.world.ledger.balances[x.id] - ctx.world.ledger.balances[y.id] || (x.id < y.id ? -1 : 1))
      .slice(0, Math.max(0, Math.min(R.workers, Math.floor(excess / R.workPay))));
    if (s.status === 'operating' && poor.length)
      ctx.settle(`rival:work:${day}`, poor.map(n => ({ from: RIVAL, to: n.id, amount: R.workPay, reason: `Wage: interior:${b.id}` })));
  },
};
