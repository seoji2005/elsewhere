// C099 라이벌 도렌: 새 세계에서만 근처 점포를 연 채 시작해, 관측(12·18시)과 자기 장부로 다음 날 가격·발주·주간 광고를 정하고 07시에 실행한다.
// 손님의 그 시간 구매 의도는 한 가게에서만 결제된다: 도렌이 가져간 손님은 그 시간 플레이어 가게 방문 확률 −100.
import { items } from '../../data/items';
import { adChannels, type Segment } from '../../data/ads';
import { taxRate } from '../../data/cityEvents';
import { retailDemand } from '../../data/storefronts';
import { RIVAL, rivalLines as L, rivalSpec as R } from '../../data/rival';
import { adEffectOnVisit, buyCampaign, checkPromise, planCampaign, type CampaignInput, type CampaignResult } from '../../sim/ads';
import { checkoutBusiness, openBusiness, procure, producerJobs, type Business } from '../../sim/business';
import { createPurse, dayCashflow, funds } from '../../sim/purse';
import { restock, setPrice, visitStore } from '../../sim/store';
import { pick } from '../../sim/tycoonCore';
import { planDay, type Discount, type RivalObservation, type RivalPlan, type RivalView } from '../../sim/rival';
import { MEDIA_JOB, segmentOf, shopMix } from './ads';
import { CITY } from './cityEvents';
import { patrons, type PatronState } from './patrons';
import type { ShopEvent, TycoonCtx, TycoonSystem } from './system';

export interface RivalCampaign { id: string; startDay: number; messageId: CampaignInput['messageId']; result: CampaignResult; broken: boolean }
export interface RivalState {
  version: 1; prepare?: true; npcId: string; businessId: string | null; status: 'unavailable' | 'operating' | 'closing' | 'closed';
  observations: RivalObservation[]; heard: Record<string, number>; // heard: 플레이어 가게 품절을 겪은 손님 → 그 분
  plan: RivalPlan | null; discount: Discount | null; campaign: RivalCampaign | null; reputation: number;
  rentDue: number[]; depositDue: number; tax: { taxable: number; paid: number }; insufficientCashDays: number; closeAt: number | null;
  takenAt: number; taken: string[]; board: { minute: number; text: string } | null; news: { minute: number; text: string }[];
}
const at = (t: { day: number; hour: number; minute: number }) => (t.day - 1) * 1440 + t.hour * 60 + t.minute, now = (ctx: TycoonCtx) => at(ctx.time);
const base = (itemId: string) => items.find(i => i.id === itemId)!.price;
const cost = (itemId: string) => Math.max(1, Math.floor(base(itemId) / 4)); // 플레이어와 같은 공급 견적(판매가와 무관)
const producer = (ctx: TycoonCtx, itemId: string) => ctx.residents.find(n => n.job === producerJobs[itemId])!;
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
  return { day, minute: day * 1440 - 1, available: ctx.world.ledger.balances[RIVAL] - R.rent * (s.rentDue.length + 3),
    items: b.store.stock.map(st => ({ itemId: st.itemId, price: st.price, cost: cost(st.itemId), stock: st.backroom + st.displayed,
      sold: Array.from({ length: days }, (_, i) => sales.filter(e => e.itemId === st.itemId && e.time.day === day - i).length) })),
    observations: s.observations, discount: s.discount, revenue7: sales.filter(e => e.time.day > day - 7).reduce((n, e) => n + e.amount, 0),
    adRunning: !!c && (c.result.curve[day + 1 - c.startDay] ?? 0) > 0 };
}

// 매시: 두 가게 근처 주민의 구매 의도 하나를 점수로 한 가게에 배정(R4 A9). 도렌이 이긴 의도만 여기서 결제한다.
function serve(ctx: TycoonCtx, s: RivalState, b: Business, minute: number) {
  const p = playerShop(ctx), queue = new Map([b, p].map(x => [x, x ? queueOf(x, minute) : 0]));
  const staffed = !!p && (ctx.player.placeId === p.placeId || ctx.book.employment.some(e => e.businessId === p.id && e.leftAt === null));
  const visits = (x: Business, id: string) => Math.min(3, bought(x).filter(e => e.actorId === id).length);
  const score = (x: Business, price: number, itemId: string, here: boolean, id: string) =>
    100 - 40 * price / base(itemId) - 2 * (here ? R.walkHere : R.walkThere) - 3 * queue.get(x)! + 4 * visits(x, id);
  s.takenAt = minute; s.taken = []; const order = [...ctx.residents].sort((x, y) => ctx.roll('rival', `order:${x.id}`, minute) - ctx.roll('rival', `order:${y.id}`, minute));
  for (const n of order) { // 같은 계산대 규칙: 손님 한 명은 하루 한 번, 한 시간에 계산대 수만큼
    if (s.taken.length >= b.capacity) break;
    const place = ctx.placeOf(n.id), visitId = `${b.id}:${ctx.time.day}:${n.id}`;
    if (place !== b.placeId && place !== p?.placeId || b.store.visits.some(v => v.id === visitId) ||
        ctx.roll('rival', `visit:${n.id}`, minute) * 100 >= retailDemand.visitChance + rivalBonus(ctx, s, n.id)) continue;
    const st = pick(b.store.stock, ctx.roll('rival', `want:${n.id}`, minute)), mine = p?.store.stock.find(x => x.itemId === st.itemId);
    const theirs = staffed && mine && mine.backroom + mine.displayed > 0 ? score(p!, mine.price, st.itemId, place === p!.placeId, n.id) : -Infinity;
    const ours = score(b, st.price, st.itemId, place === b.placeId, n.id);
    if (ours < theirs || ours === theirs && ctx.roll('rival', `tie:${n.id}`, minute) < 0.5 || st.backroom + st.displayed === 0 ||
        funds(ctx.world.ledger, ctx.purses[n.id]).spendable < st.price ||
        dayCashflow(ctx.world.ledger, ctx.purses[n.id], ctx.time.day).consumption + st.price > retailDemand.dailyBudget) continue;
    restock(b.store, st.itemId, 5);
    const visit = visitStore(b.store, ctx.world.ledger, visitId, n.id, { itemId: st.itemId, maxPrice: st.price }, 1, ctx.time);
    if (!checkoutBusiness(ctx.book, ctx.world.people, ctx.world.ledger, b.id, ctx.purses[n.id], visit.id, ctx.time).ok) continue;
    s.taken.push(n.id);
    if (s.heard[n.id] !== undefined) { // 계산하며 들은 말: 경쟁점 품절 소문(원본 방문 하나 = 증거 하나)
      s.observations = [...s.observations, { kind: 'soldOut' as const, minute, itemId: st.itemId, value: 1, source: `${n.id}:${s.heard[n.id]}`, via: n.id }].slice(-12);
      delete s.heard[n.id];
    }
    const feed = ctx.systems.patrons as PatronState | undefined;
    if (feed && p && place === p.placeId && mine && st.price < mine.price) patrons.onShopEvent!(ctx, feed,
      { npcId: n.id, businessId: p.id, itemId: st.itemId, price: st.price, count: 1, result: 'rivalCheaper' as ShopEvent['result'] });
  }
}

// 12·18시: 자리를 비울 수 있으면 플레이어 가게 앞을 지나가며 가격표와 줄을 본다(R6 ③). 못 본 날은 자료가 낡는다.
function look(ctx: TycoonCtx, s: RivalState, b: Business, minute: number) {
  const p = playerShop(ctx);
  if (!p || s.status !== 'operating' || ctx.roll('rival', 'look', minute) >= R.lookChance) return;
  const queue = ctx.residents.filter(n => ctx.placeOf(n.id) === p.placeId).length, common = p.store.stock.filter(st => b.store.stock.some(x => x.itemId === st.itemId));
  s.observations = [...s.observations, ...common.map(st => ({ kind: 'price' as const, minute, itemId: st.itemId, value: st.price, source: `look:${minute}`, via: RIVAL })),
    { kind: 'queue' as const, minute, itemId: '', value: queue, source: `look:${minute}`, via: RIVAL }].slice(-12);
  if (common.length && ctx.player.placeId === p.placeId) news(s, minute, `도렌: ${L.look(common[0].price, queue)}`);
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
  for (const st of b.store.stock) setPrice(b.store, st.itemId, plan.prices[st.itemId] ?? st.price);
  for (const [itemId, n] of Object.entries(plan.orders)) if (n > 0) done.push(`${itemId} ${procure(ctx.book, ctx.world.people, ctx.world.ledger,
    b.id, producer(ctx, itemId), itemId, n, cost(itemId), `rival:order:${plan.day}:${itemId}`, ctx.time).ok ? n : 0}/${n}`);
  if (plan.adBudget) done.push(buyAd(ctx, s, b, plan.adBudget));
  plan.done = done.join(' · ') || '없음';
}

const statuses = ['unavailable', 'operating', 'closing', 'closed'], kinds = ['price', 'queue', 'soldOut'], natural = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
export const rival: TycoonSystem<RivalState> = {
  id: 'rival',
  create: () => ({ version: 1, npcId: RIVAL, businessId: null, status: 'unavailable', observations: [], heard: {}, plan: null, discount: null,
    campaign: null, reputation: 0, rentDue: [], depositDue: 0, tax: { taxable: 0, paid: 0 }, insufficientCashDays: 0, closeAt: null,
    takenAt: 0, taken: [], board: null, news: [] }),
  validate(raw, ctx) {
    const s = raw as RivalState;
    if (s?.version !== 1 || s.prepare !== undefined && s.prepare !== true || !statuses.includes(s.status) || (s.businessId === null) !== (s.status === 'unavailable') ||
        s.businessId !== null && !ctx.book.businesses.some(b => b.id === s.businessId && b.ownerId === s.npcId) ||
        !Array.isArray(s.observations) || !s.observations.every(o => kinds.includes(o?.kind) && natural(o.minute) && typeof o.source === 'string') ||
        !Array.isArray(s.rentDue) || !s.rentDue.every(natural) || !Array.isArray(s.taken) || !Array.isArray(s.news) || !natural(s.depositDue) ||
        !natural(s.tax?.paid) || !natural(s.tax.taxable) || !Object.values(s.heard ?? 0).every(natural) || !Number.isFinite(s.reputation)) throw Error('Invalid rival');
    return s;
  },
  beforeMinute(ctx, s, minute) {
    if (s.prepare) openRival(ctx, s);
    const b = shopOf(ctx, s), m = minute % 1440;
    if (!b || b.closedAt !== null) return;
    if (m === 420 && s.plan?.day === ctx.time.day) execute(ctx, s, b, s.plan);
    if (m % 60 === 0 && m >= R.openFrom * 60 && m < R.openTo * 60) serve(ctx, s, b, minute);
    if ((R.lookAt as readonly number[]).includes(m)) look(ctx, s, b, minute);
    if (ctx.player.placeId === b.placeId) s.board = { minute, text: boardOf(b) }; // 직접 가 본 가격표
  },
  visitBonus: (ctx, s, v) => s.takenAt === now(ctx) && s.taken.includes(v.npcId) ? -100 : 0,
  onShopEvent(ctx, s, e) { if (e.result === 'missing' && s.status === 'operating') s.heard[e.npcId] = now(ctx); },
  onDay(ctx, s, day) {
    const b = shopOf(ctx, s), minute = now(ctx), balance = () => ctx.world.ledger.balances[RIVAL];
    if (!b) return;
    if (s.status === 'closing' && day >= s.closeAt!) { b.closedAt = minute; Object.assign(s, { status: 'closed', plan: null, depositDue: R.deposit }); }
    if (b.closedAt === null) s.rentDue.push(day); // 체불은 채무로 남고, 보증금은 임대인이 실제로 돌려줄 때만
    s.rentDue = s.rentDue.filter(d => !ctx.settle(`rival:rent:${d}`, [{ from: RIVAL, to: R.landlordId, amount: R.rent, reason: `Rent: ${b.id}` }]).ok);
    if (s.depositDue && ctx.settle('rival:deposit:back', [{ from: R.landlordId, to: RIVAL, amount: s.depositDue, reason: `Deposit: ${b.id}` }]).ok) s.depositDue = 0;
    if (b.closedAt !== null) return;
    for (const [id, m] of Object.entries(s.heard)) if (minute - m > 2 * 1440) delete s.heard[id];
    s.tax.taxable += bought(b).filter(e => e.time.day === day).reduce((n, e) => n + e.amount, 0);
    const tax = Math.min(Math.floor(s.tax.taxable * taxRate / 100) - s.tax.paid, balance()); // C100과 같은 5%, 주 단위 납부
    if (day % 7 === 0 && tax > 0 && Object.hasOwn(ctx.world.ledger.balances, CITY) &&
        ctx.settle(`rival:tax:${day}`, [{ from: RIVAL, to: CITY, amount: tax, reason: `Tax: ${b.id}` }]).ok) s.tax.paid += tax;
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
  },
};
