// 결폰 '내 가게' tab (C086): renders the player's lease and shop from session state and drives the C085 shop API.
import { items } from '../data/items';
import { storefronts, shopKinds, type ShopKind } from '../data/storefronts';
import type { Npc } from '../data/npcs';
import { producerJobs } from '../sim/business';
import { friendly, readBond } from '../sim/bonds';
import { gameTime } from '../sim/clock';
import { dailySummary } from '../sim/store';
import { weatherFor } from '../sim/weather';
import type { createSession } from '../game/session';
import type { PatronState } from '../game/tycoon/patrons';
import { personas } from '../data/personas';

type Session = ReturnType<typeof createSession>;
type State = Session['state'];
export interface ShopUi {
  body: HTMLElement; residents: readonly Npc[]; hiring: boolean; hire: (on: boolean) => void;
  make: (className: string, parent?: HTMLElement, tag?: string, text?: string) => HTMLElement;
  button: (parent: HTMLElement, text: string, action: () => string | void, disabled?: boolean | (() => boolean)) => HTMLElement;
  row: (label: string, sub: string | (() => string)) => HTMLElement;
  title: (text: string) => HTMLElement; note: (text: string) => HTMLElement;
  live: (element: Node, text: () => string) => Node;
  contacts: () => Npc[]; stage: (npc: Npc) => string; placeName: (id: string) => string;
}
const kindNames: Record<ShopKind, string> = { tea: '찻집', general: '잡화점' };
const weathers = { sunny: ['☀', '맑음'], cloudy: ['☁', '흐림'], rain: ['☂', '비'] } as const;
const itemName = (id: string) => items.find(i => i.id === id)?.name ?? id;
const unitCost = (id: string) => Math.max(1, Math.floor((items.find(i => i.id === id)?.price ?? 4) / 4)); // as session.orderStock
const hhmm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;
const activeLease = (state: State) => state.leases.find(l => !l.ended);
const playerShop = (state: State) => {
  const lease = activeLease(state);
  return lease && state.book.businesses.find(b => b.id === lease.businessId && b.closedAt === null);
};
const staff = (state: State, businessId: string) => state.book.employment.filter(e => e.businessId === businessId && e.leftAt === null);
let wage = 5, reply = '', replyTo = '';

// Status-bar extras: today's weather glyph and the latest lease's arrears warning.
export function shopStatus(state: State) {
  const lease = state.leases.at(-1), [icon, name] = weathers[weatherFor(state.npcSeed, gameTime(state.world.clock).day)];
  return { icon, name, warning: lease?.warning === 'shop.unpaid' ? `⚠ 연체 ${lease.arrears}일`
    : lease?.warning === 'shop.closed.arrears' ? '⚠ 가게 닫힘' : '' };
}
// What decides a rebuild of this tab: lease/shop lifecycle, pending orders, reports and staff.
export function shopKey(state: State) {
  const b = playerShop(state);
  return [state.leases.map(l => [l.id, l.ended, l.businessId, l.orders.filter(o => !o.delivered).length, l.reports.length]),
    b ? staff(state, b.id).map(e => e.actorId) : []];
}
// Relationship-aware answers: friends speak casually, everyone else politely.
const lines: Record<string, [string, string]> = {
  'job.accept': ['좋아요. 내일 아침 9시까지 갈게요.', '좋아, 너라면 믿고 일할 수 있지. 9시에 갈게!'],
  'job.refuse.wage': ['그 시급이면 지금 자리를 옮길 이유가 없어요.', '미안, 그 시급이면 지금 일이 더 나아.'],
  'job.refuse.owner': ['저도 꾸리는 가게가 있어서 어렵겠어요.', '나도 내 가게가 있잖아. 응원할게!'],
  'job.refuse.capacity': ['가게에 일할 자리가 더 없어 보이는데요.', '가게에 자리가 꽉 찼던데?'],
};
function answer(state: State, npc: Npc, reason: string) {
  const bond = readBond(state.bonds, npc.id, 'player'), casual = friendly(bond);
  const text = reason === 'job.refuse.trust' ? !bond.met ? '저기… 우리 아직 제대로 인사도 안 했잖아요.'
    : '좋은 분인 건 알지만, 같이 일할 만큼 서로 알진 못해요.' : lines[reason]?.[Number(casual)] ?? '지금은 어렵겠어요.';
  return `${npc.name}: “${text}”`;
}

export function shopTab(session: Session, ui: ShopUi) {
  const { state } = session, { make, button, row, title, note, live, body } = ui;
  const lease = activeLease(state), b = playerShop(state), last = state.leases.at(-1);
  if (!lease) {
    if (last?.warning === 'shop.closed.arrears') note('연체가 사흘 이어져 가게 문을 닫았어요. 남은 빚은 계속 갚아야 해요.');
    title('빈 점포 · 계약하면 보증금을 맡겨요');
    for (const u of storefronts) button(row(`${ui.placeName(u.placeId)} 점포`,
      `보증금 ${u.deposit}결 · 하루 임대료 ${u.dailyRent}결 · ${u.kinds.map(k => kindNames[k]).join('·')} · 직원 ${u.capacity}명`), '계약',
    () => { session.rentStore(u.id); return `${ui.placeName(u.placeId)} 점포를 계약했어요 (-${u.deposit}결)`; });
    return;
  }
  const unit = storefronts.find(u => u.id === lease.storefrontId)!;
  if (!b) {
    title(`${ui.placeName(unit.placeId)} 점포 · 업종을 고르세요`);
    for (const kind of unit.kinds) button(row(kindNames[kind], shopKinds[kind].map(itemName).join(' · ')), '개업',
      () => { session.openShop(kind); return `${kindNames[kind]} 개업! 물건을 주문하고 직원을 구해 보세요`; });
    button(row('계약 해지', '보증금 일부를 돌려받아요'), '해지', () => { session.terminateStore(); return '계약을 해지했어요'; });
    return;
  }
  if (ui.hiring) return hireView(b.id);
  const kind = (Object.keys(shopKinds) as ShopKind[]).find(k => (shopKinds[k] as readonly string[]).includes(b.store.stock[0]?.itemId));
  const day = () => gameTime(state.world.clock).day, today = () => dailySummary(b.store, day());
  title(`${kind ? kindNames[kind] : '가게'} · ${ui.placeName(b.placeId)} · 오늘`);
  if (lease.warning) note(`임대료나 급여가 밀렸어요 (${lease.arrears}일). 사흘째면 문을 닫아요.`).classList.add('shop-warn');
  const stats = make('shop-stats', body);
  for (const [label, text] of [
    ['매출', () => `${today().revenue}결`], ['방문', () => `${today().visits}명`],
    ['불만', () => `${Object.values(today().complaints).reduce((n, c) => n + c, 0)}건`],
    ['어제 순이익', () => lease.reports.length ? `${signed(lease.reports.at(-1)!.net)}결` : '–'],
    ['평판', () => signed(state.reputation.player ?? 0)], ['날씨', () => shopStatus(state).name],
  ] as const) live(make('', make('', stats, 'div', label), 'b'), text);
  title('오늘 손님 한마디');
  live(make('shop-barks', body), () => ((session.tycoon.state().systems.patrons as PatronState | undefined)?.feed ?? [])
    .filter(l => Math.floor(l.minute / 1440) === Math.floor(state.world.clock.totalMinutes / 1440)).slice(-5)
    .map(l => `${hhmm(l.minute % 1440)} ${l.name}(${personas[l.personaId].name}) “${l.text}”`).join('\n') || '아직 손님 말이 없어요.');
  title('재고 · 판매가 · 주문 (내일 입고)');
  for (const s of b.store.stock) {
    const supplier = ui.residents.find(n => n.job === producerJobs[s.itemId]);
    const pending = () => lease.orders.filter(o => !o.delivered && o.itemId === s.itemId).reduce((n, o) => n + o.quantity, 0);
    const line = row(itemName(s.itemId), () => `${s.backroom + s.displayed}개${pending() ? ` · 입고 예정 ${pending()}` : ''}`
      + `\n원가 ${unitCost(s.itemId)}결 · 판매가 ${s.price}결`);
    button(line, '−', () => session.setShopPrice(s.itemId, s.price - 1), () => s.price <= 1).setAttribute('aria-label', `${itemName(s.itemId)} 값 내리기`);
    button(line, '+', () => session.setShopPrice(s.itemId, s.price + 1)).setAttribute('aria-label', `${itemName(s.itemId)} 값 올리기`);
    button(line, '주문 5', () => {
      const result = session.orderStock(supplier!.id, s.itemId, 5);
      if (!result.ok) throw Error(result.error);
      return `${itemName(s.itemId)} 5개 주문 (-${5 * unitCost(s.itemId)}결) · 내일 입고`;
    }, !supplier);
  }
  const employees = staff(state, b.id);
  title(`직원 ${employees.length}/${b.capacity}`);
  if (!employees.length) note('직원이 없으면 가게를 열어도 손님을 받지 못해요.');
  for (const e of employees) {
    const name = ui.residents.find(n => n.id === e.actorId)?.name ?? e.actorId;
    button(row(name, `시급 ${e.job.hourlyWage}결 · ${hhmm(e.job.fromMinute)}–${hhmm(e.job.toMinute)} 근무`), '해고',
      () => { session.fireEmployee(e.actorId); return `${name} 님을 내보냈어요`; });
  }
  button(make('hud-chips', body), '직원 구하기', () => { reply = replyTo = ''; ui.hire(true); }, employees.length >= b.capacity);
  title('최근 7일 순이익');
  if (!lease.reports.length) note('첫 결산은 오늘 자정에 나와요.');
  const chart = make('shop-chart', body), max = Math.max(1, ...lease.reports.map(r => Math.abs(r.net)));
  for (const r of lease.reports) {
    const bar = make('shop-bar', chart);
    make('', bar, 'span', signed(r.net));
    make(r.net < 0 ? 'neg' : '', bar, 'i').style.height = `${Math.abs(r.net) / max * 60}px`;
    make('', bar, 'span', `${r.day}일`);
  }

  function hireView(businessId: string) {
    const head = make('hud-head', body);
    button(head, '‹ 가게', () => ui.hire(false));
    make('hud-name', head, 'div', '직원 구하기');
    const chips = make('hud-chips', body);
    button(chips, '−', () => { wage--; }, () => wage <= 1).setAttribute('aria-label', '시급 내리기');
    live(make('hud-sub', chips, 'span'), () => `제안 시급 ${wage}결 · 09:00–17:00`);
    button(chips, '+', () => { wage++; }).setAttribute('aria-label', '시급 올리기');
    title('아는 주민에게 일자리 제안');
    for (const n of ui.contacts()) {
      const job = state.book.employment.find(e => e.actorId === n.id && e.leftAt === null);
      const ours = job?.businessId === businessId;
      button(row(`${n.name} · ${ui.stage(n)}`, `${n.job}${ours ? ' · 우리 가게 직원' : job ? ` · 지금 시급 ${job.job.hourlyWage}결` : ''}`), '제안',
        () => { replyTo = n.id; reply = answer(state, n, session.offerJob(n.id, wage).reason); }, ours);
      if (replyTo === n.id && reply) make('hud-say', body, 'div', reply); // the answer sits under the person asked
    }
  }
}
