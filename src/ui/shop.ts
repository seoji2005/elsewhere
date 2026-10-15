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
import { carried, dropAtShop, pickupOrder, pickupProblem, type HaulState } from '../game/tycoon/haul';
import { canNegotiate, currentDraft, findingsOf, negotiate, requestReview, reviewFee, risks, type CounselState, type Draft } from '../game/tycoon/counsel';
import { reviewDays } from '../sim/advisors';
import { adChannels, adMessages, adModels, segmentNames, segments } from '../data/ads';
import { planCampaign, type CampaignInput } from '../sim/ads';
import { buyCampaign, running, type AdState } from '../game/tycoon/ads';

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
const haulOf = (state: State) => state.tycoon.systems.haul as HaulState;
const staff = (state: State, businessId: string) => state.book.employment.filter(e => e.businessId === businessId && e.leftAt === null);
let wage = 5, reply = '', replyTo = '', reading = ''; // storefront whose contract is open
const counselOf = (state: State) => state.tycoon.systems.counsel as CounselState | undefined;
const adsOf = (state: State) => state.tycoon.systems.ads as AdState | undefined;
// C098 ad picker: one decision per screen (channel → target → message → model → weeks → preview).
let adStep = -1, adMore = false, adDraft: Partial<CampaignInput> = {};
const reachNames = { neighborhood: '동네', city: '도시 전체', national: '전국' } as const;
const promiseNotes: Record<string, string> = { price: '값이 싸야 약속을 지켜요', speed: '줄이 짧아야 약속을 지켜요',
  quality: '품절이 적어야 약속을 지켜요', emotion: '지킬 약속이 없어요', buzz: '눈길은 끌지만 과열될 수 있어요' };
const pct = (p: number) => `${Math.round(p * 100)}%`;
const nameIn = (list: readonly { id: string; name: string }[], id?: string) => list.find(x => x.id === id)?.name ?? '';

// Status-bar extras: today's weather glyph and the latest lease's arrears warning.
export function shopStatus(state: State) {
  const lease = state.leases.at(-1), [icon, name] = weathers[weatherFor(state.npcSeed, gameTime(state.world.clock).day)];
  return { icon, name, load: carried(haulOf(state)), warning: lease?.warning === 'shop.unpaid' ? `⚠ 연체 ${lease.arrears}일`
    : lease?.warning === 'shop.closed.arrears' ? '⚠ 가게 닫힘' : '' };
}
// What decides a rebuild of this tab: lease/shop lifecycle, pending orders, reports and staff.
export function shopKey(state: State) {
  const b = playerShop(state);
  return [state.leases.map(l => [l.id, l.ended, l.businessId, l.orders.filter(o => !o.delivered).length, l.reports.length]), haulOf(state).load,
    b ? staff(state, b.id).map(e => e.actorId) : [], reading,
    counselOf(state)?.drafts.map(d => [d.id, d.removed, d.reviews.map(r => r.done)]), counselOf(state)?.messages,
    adsOf(state)?.campaigns.map(c => [c.id, c.revealed, c.broken])];
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
    const counsel = counselOf(state);
    for (const text of counsel?.messages.slice(-2) ?? []) note(text);
    title('빈 점포 · 계약서를 읽고 서명하면 보증금을 맡겨요');
    for (const u of storefronts) {
      const line = row(`${ui.placeName(u.placeId)} 점포`,
        `보증금 ${u.deposit}결 · 하루 임대료 ${u.dailyRent}결 · ${u.kinds.map(k => kindNames[k]).join('·')} · 직원 ${u.capacity}명`);
      const d = counsel && currentDraft(counsel, u.id);
      if (d) button(line, reading === u.id ? '접기' : '조항 보기', () => { reading = reading === u.id ? '' : u.id; });
      if (d && reading === u.id) contract(counsel!, d, u);
      else button(line, '계약', () => { session.rentStore(u.id, d?.id); return `${ui.placeName(u.placeId)} 점포를 계약했어요 (-${u.deposit}결)`; });
    }
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
  if (adStep >= 0) return adView();
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
  const adState = adsOf(state);
  if (adState) {
    title(`광고 · 광고 평판 ${signed(adState.reputation)}`);
    for (const c of adState.campaigns.slice(-3)) row(`${nameIn(adChannels, c.channelId)} · ${c.targets.map(t => segmentNames[t]).join('·')}`, () => {
      const left = c.startDay + c.result.curve.indexOf(0, adChannels.find(ch => ch.id === c.channelId)!.leadDays) - day();
      return `${!c.revealed ? '준비 중' : c.result.summary}${c.broken ? `\n⚠ ${c.broken}` : ''}`
        + `\n${running(c, day()) ? `여운 포함 ${left}일 남음 · ` : '끝남 · '}광고 보고 왔다는 손님 ${c.seen}명`;
    });
    button(make('hud-chips', body), '광고 내기', () => { adStep = 0; adMore = false; adDraft = {}; });
  }
  const load = carried(haulOf(state));
  if (load) button(row(`들고 있는 상자 📦×${load}`, state.player.placeId === b.placeId ? '가게 안이에요' : `${ui.placeName(b.placeId)} 가게로 가져가세요 · 걸음이 느려요`),
    '뒷방에 내려놓기', () => `상자 ${session.tycoon.command('haul', (ctx, h: HaulState) => dropAtShop(ctx, h))}개를 뒷방에 넣었어요`,
    state.player.placeId !== b.placeId);
  title('재고 · 판매가 · 주문 (배달은 내일, 직접 가면 지금)');
  for (const s of b.store.stock) {
    const supplier = ui.residents.find(n => n.job === producerJobs[s.itemId]);
    const pending = () => lease.orders.filter(o => !o.delivered && o.itemId === s.itemId).reduce((n, o) => n + o.quantity, 0);
    const where = () => supplier ? session.tycoon.ctx().placeOf(supplier.id) : '';
    const line = row(itemName(s.itemId), () => `${s.backroom + s.displayed}개${pending() ? ` · 입고 예정 ${pending()}` : ''}`
      + `\n원가 ${unitCost(s.itemId)}결 · 판매가 ${s.price}결`);
    button(line, '−', () => session.setShopPrice(s.itemId, s.price - 1), () => s.price <= 1).setAttribute('aria-label', `${itemName(s.itemId)} 값 내리기`);
    button(line, '+', () => session.setShopPrice(s.itemId, s.price + 1)).setAttribute('aria-label', `${itemName(s.itemId)} 값 올리기`);
    const fee = session.deliveryCost(s.itemId, 5), here = !!supplier && state.player.placeId === where(), order = make('hud-chips', body);
    if (supplier) live(make('hud-sub', order, 'span'), () => `주문 5 = 배달 (배달비 ${fee}결 · 내일)\n생산자 ${supplier.name} · 지금 ${ui.placeName(where())} (07–19시)`);
    button(line, '주문 5', () => {
      const result = session.orderStock(supplier!.id, s.itemId, 5);
      if (!result.ok) throw Error(result.error);
      return `${itemName(s.itemId)} 5개 배달 주문 (-${5 * unitCost(s.itemId) + fee}결, 배달비 ${fee}결) · 내일 입고`;
    }, !supplier);
    button(order, here ? '상자 받기 5 · 지금' : '직접 가지러 가기 · 배달비 0', () => {
      const problem = pickupProblem(session.tycoon.ctx(), haulOf(state), supplier!.id, s.itemId, 5);
      if (problem === 'Producer elsewhere') return `${supplier!.name} 님은 지금 ${ui.placeName(where())}에 있어요 · 가서 받으면 배달비 0`;
      if (problem) return { 'Producer closed': '생산자는 07–19시에만 내줘요', 'Too much to carry': '상자는 12개까지만 들 수 있어요' }[problem] ?? '지금은 받을 수 없어요';
      const result = session.tycoon.command('haul', (ctx, h: HaulState) => pickupOrder(ctx, h, supplier!.id, s.itemId, 5));
      if (!result.ok) throw Error(result.error);
      return `${itemName(s.itemId)} 상자 5개를 받았어요 (-${5 * unitCost(s.itemId)}결) · 가게 뒷방에 내려놓으세요`;
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

  // C101: every article is readable from the start; the lawyer adds risk and fix lines next to the ones found.
  function contract(counsel: CounselState, d: Draft, u: typeof storefronts[number]) {
    const lawyer = counsel.experts.find(e => e.kind === 'lawyer')!, name = ui.residents.find(n => n.id === lawyer.npcId)?.name ?? '변호사';
    const review = d.reviews.find(r => r.advisorId === lawyer.id), findings = findingsOf(d);
    for (const a of d.articles) {
      const gone = d.removed.includes(a.article), f = findings.find(f => f.clause.article === a.article);
      const line = row(`제${a.article}조${gone ? ' · 빼기로 함' : ''}`, a.text + (f && !gone ? `\n⚠ 위험: ${risks[f.clause.kind]}`
        + `\n수정안: ${f.fix ?? (f.negotiable ? '이 조항을 빼 달라고 하기' : '빼기 어려움')}` : ''));
      if (a.kind && !gone) button(line, '빼 달라고 하기', () => {
        session.tycoon.command('counsel', (c, s: CounselState) => negotiate(c, s, d.id, a.article));
        return `제${a.article}조를 빼기로 했어요 · 하루 임대료 +1결`;
      }, !canNegotiate(d, a.article));
    }
    if (d.extraRent) note(`조항을 뺀 대가로 하루 임대료 +${d.extraRent}결`);
    const chips = make('hud-chips', body);
    if (!review) button(chips, `변호사 ${name}에게 맡기기 (${reviewFee(lawyer)}결·${reviewDays(lawyer.tier)}일)`, () => {
      session.tycoon.command('counsel', (c, s: CounselState) => requestReview(c, s, d.id, lawyer.id));
      return `${name}: “계약서 받았어요. ${reviewDays(lawyer.tier)}일 뒤에 알려 드릴게요.”`;
    });
    else live(make('hud-sub', chips, 'span'), () => review.done ? `${name} 검토 끝 · 짚은 조항 ${review.findings.length}개`
      : `${name} 검토 중 · ${Math.max(1, review.readyDay - gameTime(state.world.clock).day)}일 뒤 결과`);
    button(chips, '서명', () => { session.rentStore(u.id, d.id); return `${ui.placeName(u.placeId)} 점포를 계약했어요 (-${u.deposit}결)`; });
  }
  function adView() {
    const head = make('hud-head', body);
    button(head, adStep ? '‹ 이전' : '‹ 가게', () => { adStep--; });
    make('hud-name', head, 'div', adStep < 5 ? `광고 내기 ${adStep + 1}/5` : '광고 미리보기');
    const pickOne = (question: string, options: [string, string, () => void][]) => {
      title(question);
      for (const [label, sub, choose] of options) button(row(label, sub), '고르기', () => { choose(); adStep++; });
    };
    const target = (adDraft.targets ?? [])[0];
    if (adStep === 0) pickOne('어디에 낼까요?', adChannels.map(ch => [ch.name, `${reachNames[ch.reach]}에 닿아요${ch.leadDays ? ` · ${ch.leadDays}일 뒤 시작` : ' · 바로 시작'}`,
      () => { adDraft.channelId = ch.id; }]));
    if (adStep === 1) pickOne('누구에게 보일까요?', segments.map(g => [segmentNames[g],
      `${nameIn(adChannels, adDraft.channelId)}${adChannels.find(ch => ch.id === adDraft.channelId)!.fit[g] >= 0.8 ? '에 잘 닿는 손님' : '은 덜 닿아요'}`,
      () => { adDraft.targets = [g]; }]));
    if (adStep === 2) pickOne(`${segmentNames[target!]}에게 무엇을 말할까요?`, adMessages.map(m => [m.name, promiseNotes[m.id], () => { adDraft.messageId = m.id; }]));
    if (adStep === 3) pickOne('누가 광고에 나올까요?', adModels.map(m => [m.name, m.id === 'none' ? '가게만 보여 줘요'
      : m.scandal ? '눈길을 더 끌지만 구설 위험이 있어요' : '눈길을 더 끌어요', () => { adDraft.modelId = m.id; }]));
    if (adStep === 4) pickOne('얼마 동안 낼까요?', [1, 2, 4].map(w => [`${w}주`, w === 4 ? '오래 보일수록 손님이 익숙해져요' : '짧게 시험해 봐요',
      () => { adDraft.weeks = w; }]));
    if (adStep < 5) return;
    const input = adDraft as CampaignInput, plan = planCampaign(input);
    title(`${nameIn(adChannels, input.channelId)} · ${segmentNames[target!]} · ${nameIn(adMessages, input.messageId)} · ${input.weeks}주`);
    const stats = make('shop-stats', body);
    for (const [label, text] of [['비용', `${plan.cost}결`], ['대박', pct(plan.hitChance)], ['역풍', pct(plan.backlashChance)]])
      make('', make('', stats, 'div', label), 'b', text);
    note(`운은 사는 순간 정해져요. 결과는 손님 말로 먼저 와요.`);
    const chips = make('hud-chips', body);
    button(chips, adMore ? '접기' : '자세히', () => { adMore = !adMore; });
    if (adMore) note(`무반응 ${pct(plan.dudChance)} · 손님이 들를 마음 +${pct(plan.minLift)}~${pct(plan.maxLift)} (보통 +${pct(plan.expectedLift)})`);
    button(chips, '광고 사기', () => {
      const c = session.tycoon.command('ads', (ctx, s: AdState) => buyCampaign(ctx, s, input));
      if (typeof c === 'string') throw Error(c);
      adStep = -1;
      return `${nameIn(adChannels, c.channelId)} 광고를 샀어요 (-${c.cost}결)`;
    });
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
