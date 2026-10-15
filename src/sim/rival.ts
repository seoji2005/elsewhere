// C099 도렌의 판단: 자기 장부와 관측 자료(RivalView)만 받는다. 플레이어 잔액·매입 원가·창고·직원은 입력에 없다.
import { rivalSpec as R } from '../data/rival';

/** source: 원본 사건 ID(같은 방문을 여럿이 전해도 증거는 하나), via: 전달한 사람. */
export interface RivalObservation { kind: 'price' | 'queue' | 'soldOut'; minute: number; itemId: string; value: number; source: string; via: string }
export interface Discount { itemId: string; originalPrice: number; price: number; startedDay: number; reviewDay: number; hardEndDay: number }
export interface RivalView {
  day: number; minute: number; available: number; // 가용액 = 잔액 − 밀린 임대료 − 향후 3일 고정비
  items: { itemId: string; price: number; cost: number; stock: number; sold: number[] }[]; // sold: 최근 완료 영업일(최대 3)의 판매 수량
  observations: readonly RivalObservation[]; discount: Discount | null; revenue7: number; adRunning: boolean;
}
export interface RivalPlan {
  day: number; prices: Record<string, number>; orders: Record<string, number>; discount: Discount | null;
  adBudget: number; defend: boolean; done: string; // done: 07시 실행 결과(실패는 실패로 남긴다)
}
const total = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);
const fresh = (v: RivalView, o: RivalObservation, days: number) => v.minute - o.minute <= days * 1440;
const seenPrice = (v: RivalView, itemId: string) =>
  v.observations.filter(o => o.kind === 'price' && o.itemId === itemId && fresh(v, o, R.priceDays)).at(-1)?.value ?? null;

/** 가격 경쟁 근거: 유효한 경쟁점 가격 + (줄 3명 이상 또는 서로 다른 방문의 품절 소문 2건). 모르면 null(평균으로 채우지 않는다). */
export function rivalPrice(v: RivalView, itemId: string): number | null {
  const queue = v.observations.some(o => o.kind === 'queue' && o.value >= R.queueMin && fresh(v, o, R.queueDays));
  const rumors = new Set(v.observations.filter(o => o.kind === 'soldOut' && o.itemId === itemId && fresh(v, o, 2)).map(o => o.source)).size;
  return queue || rumors >= 2 ? seenPrice(v, itemId) : null;
}

/** 마감 뒤 다음 날 계획: 현금 방어 → 가격 → 발주 → 주간 광고 예산. 새 할인은 하루 예고 뒤(모레 07시) 적용. */
export function planDay(v: RivalView): RivalPlan {
  const next = v.day + 1, defend = v.available <= 0;
  let discount = v.discount;
  if (discount && (defend || next >= discount.hardEndDay || next >= discount.reviewDay && rivalPrice(v, discount.itemId) === null)) discount = null;
  else if (discount && next >= discount.reviewDay) discount = { ...discount, reviewDay: discount.reviewDay + R.reviewDays }; // 종료 상한은 그대로
  if (!discount && !v.discount && !defend) {
    const main = [...v.items].filter(i => seenPrice(v, i.itemId) !== null)
      .sort((a, b) => total(b.sold) - total(a.sold) || (a.itemId < b.itemId ? -1 : 1))[0];
    const seen = main && rivalPrice(v, main.itemId), target = seen ? Math.max(main.cost + 1, Math.ceil(seen * R.cut)) : Infinity;
    if (main && target < main.price) discount = { itemId: main.itemId, originalPrice: main.price, price: target,
      startedDay: v.day + 2, reviewDay: v.day + 2 + R.reviewDays, hardEndDay: v.day + 2 + R.maxDiscountDays };
  }
  const prices: Record<string, number> = {}, orders: Record<string, number> = {};
  for (const i of v.items) {
    prices[i.itemId] = discount?.itemId === i.itemId ? next >= discount.startedDay ? discount.price : i.price
      : v.discount?.itemId === i.itemId ? v.discount.originalPrice : i.price;
    const demand = i.sold.length ? total(i.sold) / i.sold.length : R.startDemand; // 기록이 전혀 없을 때만 시작값
    orders[i.itemId] = Math.max(0, Math.min(R.maxOrder, Math.ceil((defend ? 1 : 2) * demand) - i.stock));
  }
  const adBudget = defend || v.day % 7 || v.adRunning ? 0 : Math.min(R.adCap, Math.floor(v.revenue7 * 0.1), Math.floor(v.available * 0.2));
  return { day: next, prices, orders, discount, adBudget, defend, done: '' };
}
