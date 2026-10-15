// C106 30분 경로(헤드리스): ?trial=1과 같은 준비 세계에서 세션 API·tycoon.command만으로 GDD §4를 따라가며 단계별 도달을 기록한다.
// 이동은 결폰 장소 버튼(hud go)과 같은 대입. 경로 중 A(상자 받은 직후)·B(채용·정책·광고 뒤)·C(AI 검수 직전)에서 총액·저장 재개·틱 분할.
import { expect, test } from 'vitest';
import { createSession } from '../../src/game/session';
import { prepareTrial, trial } from '../../src/data/tycoonScenario';
import { producerJobs } from '../../src/sim/business';
import { dropAtShop, pickupOrder, type HaulState } from '../../src/game/tycoon/haul';
import { answerHaggle, type PatronState } from '../../src/game/tycoon/patrons';
import { applicants, hireTrial, onDuty, report, setPolicy, startTrial, type StaffState } from '../../src/game/tycoon/staff';
import { buyCampaign, type AdState } from '../../src/game/tycoon/ads';
import { respond, currentEvent } from '../../src/game/tycoon/cityEvents';
import { askQuestion, inquire, answer, defOf, type OpportunityState } from '../../src/game/tycoon/opportunity';
import { askReuse, begin, legs, renegotiate, inspect, pickDev, pickScope, rework, results, sign, start, type AiState } from '../../src/game/tycoon/aiContracts';
import { leisure } from '../../src/game/tycoon/leisure';
import { scopes } from '../../src/data/aiContracts';
import { shows } from '../../src/data/shows';
import { partnerLot, roadworks } from '../../src/data/cityEvents';
import type { CityState } from '../../src/sim/cityEvents';
import type { RivalState } from '../../src/game/tycoon/rival';

type Session = ReturnType<typeof createSession>;
const memory = (from?: Map<string, string>) => {
  const m = new Map(from);
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
};
const open = (store = memory()) => ({ store, s: createSession(store, trial.seed, undefined, 2, true) });
const go = (s: Session, placeId: string) => { s.state.player.placeId = placeId; s.state.world.people.player.placeId = placeId; };
const minute = (s: Session) => Math.floor(s.state.world.clock.totalMinutes);
const total = (s: Session) => Object.values(s.state.world.ledger.balances).reduce((n, v) => n + v, 0);
const sys = <T>(s: Session, id: string) => s.tycoon.state().systems[id] as T;
const snapshot = (s: Session) => JSON.stringify([s.state.world.ledger.balances, s.state.book, s.state.leases, s.tycoon.state(), minute(s)]);
const shop = (s: Session) => s.state.book.businesses.find(b => b.ownerId === 'player' && b.closedAt === null)!;
/** Plays real seconds until done() (or the cap), returning the seconds used. */
const play = (s: Session, done: () => boolean, cap: number) => { let t = 0; while (!done() && t < cap) { s.tick(1); t++; } return t; };

// 같은 시작 상태에서 연속·분할(분 경계를 걸치는 0.25초)·저장 재개 세 가지가 같은 결과와 총액 보존을 내야 한다.
function integrity(s: Session, store: ReturnType<typeof memory>, start: number, label: string) {
  expect(s.saveNow().ok, label).toBe(true);
  expect(total(s), `${label} 총액`).toBe(start);
  expect(Object.values(s.state.world.ledger.balances).every(v => Number.isInteger(v) && v >= 0), `${label} 비음수`).toBe(true);
  const restored = open(memory(store.m)).s;
  expect(restored.loadResult.ok, label).toBe(true);
  expect(snapshot(restored), `${label} 저장 재개`).toBe(snapshot(s));
  const whole = open(memory(store.m)).s, split = open(memory(store.m)).s;
  whole.tick(30); for (let i = 0; i < 120; i++) split.tick(0.25);
  expect(snapshot(split), `${label} 틱 분할`).toBe(snapshot(whole));
  expect(total(whole), `${label} 총액 뒤`).toBe(start);
}

test('C106 30분 경로: 준비 세계에서 단계별 도달·보존·방치 비교', () => {
  const { store, s } = open();
  expect(prepareTrial(s)).toBe(true);
  expect(prepareTrial(s)).toBe(false); // 이미 준비된 세계는 다시 손대지 않는다
  expect([minute(s), shop(s).placeId, s.state.world.ledger.balances.player]).toEqual([420, 'shop', 60]); // C111 초기 배분: 보증금 뒤 60결
  expect(shop(s).store.stock.every(x => x.backroom + x.displayed === 0)).toBe(true); // 재고·판매를 미리 넣지 않는다
  const startTotal = total(s), rows: [string, string][] = [], step = (name: string, f: () => string) => {
    let r: string; try { r = f(); } catch (e) { r = `막힘: ${(e as Error).message}`; } rows.push([name, r]); return r;
  };
  go(s, 'shop');
  const res = s.tycoon.ctx().residents, producer = res.find(n => n.job === producerJobs.tea)!;

  step('0~3분 수령·운반·판매', () => {
    go(s, s.tycoon.ctx().placeOf(producer.id));
    const paid = s.tycoon.command('haul', (c, h: HaulState) => pickupOrder(c, h, producer.id, 'tea', 5));
    if (!paid.ok) throw Error(paid.error);
    integrity(s, store, startTotal, 'A 상자 받은 직후');
    go(s, 'shop');
    expect(s.tycoon.command('haul', (c, h: HaulState) => dropAtShop(c, h))).toBe(5);
    expect(s.tycoon.command('haul', (c, h: HaulState) => dropAtShop(c, h))).toBe(0); // 두 번 내려놓아도 늘지 않는다
    const secs = play(s, () => shop(s).store.events.some(e => e.reason === 'purchased'), 180);
    const tea = shop(s).store.stock.find(x => x.itemId === 'tea')!, sold = shop(s).store.events.filter(e => e.reason === 'purchased' && e.itemId === 'tea').length;
    expect(tea.backroom + tea.displayed + sold).toBe(5);
    if (secs >= 180) throw Error('180초 안에 판매 없음');
    return `도달 · 내려놓은 뒤 ${secs}초(게임 ${minute(s) - 420}분)`;
  });
  step('3~8분 손님 한마디·흥정', () => {
    const p = sys<PatronState>(s, 'patrons');
    play(s, () => p.haggles.length > 0, 120); // C111: 흥정을 2분까지 기다린다(3~8분 구간, 시험 근무가 근무 시간 안에 끝나게)
    const h = p.haggles[0];
    if (h) s.tycoon.command('patrons', (c, st: PatronState) => answerHaggle(c, st, h.visitId, true));
    const guest = res.find(n => s.state.world.people[n.id]?.placeId === 'shop' && n.id !== shows[0].hostId); // 가게 손님과 첫 대화 → 아는 사이
    if (guest) s.talk('c106:talk', guest.id, s.buildDialogue(guest.id).choices[0]);
    return `${p.feed.length ? '도달' : '막힘'} · 한마디 ${p.feed.length}개 · 흥정 ${h ? '응답' : '없음'}`;
  });
  step('8~14분 직원 시험·채용·정책', () => {
    play(s, () => minute(s) >= 540, 600); // 영업 시작 이후 지원자
    go(s, s.tycoon.ctx().placeOf(producer.id)); // 맡기기 전 두 번째 수령(차·빵 상자 5씩)
    for (const item of ['tea', 'bread']) if (!s.tycoon.command('haul', (c, h: HaulState) => pickupOrder(c, h, producer.id, item, 5)).ok) throw Error(`${item} 수령 실패`);
    go(s, 'shop'); s.tycoon.command('haul', (c, h: HaulState) => dropAtShop(c, h));
    const st = sys<StaffState>(s, 'staff'), who = applicants(s.tycoon.ctx())[0].npc.id;
    const why = s.tycoon.command('staff', (c, x: StaffState) => startTrial(c, x, who));
    if (why) throw Error(why);
    go(s, 'nest'); // 시험 근무는 사장 없이
    play(s, () => st.trial?.status === 'done', 120);
    go(s, 'shop');
    if (!s.tycoon.command('staff', (c, x: StaffState) => hireTrial(c, x))) throw Error(`채용 안 됨(${st.trial?.status})`);
    s.tycoon.command('staff', (_c, x: StaffState) => setPolicy(x, { taskPriority: 'checkout' }));
    // C111 채용 당일: 근무 시간 안이면 바로 계산대에 서고, 그 분부터 분 단위 급여가 쌓인다.
    const hiredAt = minute(s), sameDay = () => Math.floor(minute(s) / 1440) === Math.floor(hiredAt / 1440);
    expect(hiredAt % 1440 >= 540 && hiredAt % 1440 < 1020, `근무 시간 안에 채용 ${hiredAt}`).toBe(true);
    expect(onDuty(s.tycoon.ctx(), st)).toContain(who);
    expect(s.state.world.people[who].placeId).toBe('shop');
    play(s, () => (st.people[who].pay?.min ?? 0) >= 30, 60);
    expect(sameDay() && st.people[who].pay!.min >= 30, '채용 당일 근무 분').toBe(true);
    return `도달 · 시험 계산 ${st.trial!.checkouts}·진열 ${st.trial!.stocked} · 정책 v${st.policy.version} · 당일 근무 ${st.people[who].pay!.min}분`;
  });
  step('8~14분 광고 하나', () => {
    const c = s.tycoon.command('ads', (ctx, a: AdState) => buyCampaign(ctx, a, { channelId: 'flyer', messageId: 'price', modelId: 'none', targets: ['workers'], weeks: 1 }));
    if (typeof c === 'string') throw Error(c);
    integrity(s, store, startTotal, 'B 채용·정책·광고 뒤');
    return `도달 · 전단지 ${c.cost}결`;
  });
  const idleAfterHire = memory(store.m);
  step('14~20분 사장 부재·직원 마감 보고', () => {
    go(s, 'nest');
    const st = sys<StaffState>(s, 'staff');
    for (let i = 0; i < 6 && !s.nextEvent().reason.includes('직원 출근'); i++) s.skipTo(s.nextEvent().minute); // '다음 일까지'
    s.skipTo(s.nextEvent().minute);
    play(s, () => st.outcomes.some(o => o.alone), 600);
    const day = s.tycoon.ctx().time.day;
    s.skipTo(day * 1440 + 30);
    return `${st.outcomes.some(o => o.alone) ? '도달' : '막힘'} · 혼자 처리 ${st.outcomes.filter(o => o.alone).length}건 · 보고 "${report(st, day).text}" · 근무 중 ${onDuty(s.tycoon.ctx(), st).length}`;
  });
  step('14~20분 도렌 가격표', () => {
    const r = sys<RivalState>(s, 'rival');
    return `${r.status === 'operating' ? '도달' : '막힘'} · ${r.status} · 관측 ${r.observations.length} · 소식 ${r.news.length}`;
  });
  step('14~20분 공사 예고 대응', () => {
    const c = sys<CityState>(s, 'cityEvents');
    play(s, () => !!currentEvent(c), 1440);
    if (!currentEvent(c)) throw Error(`공사 예고 없음(요청 ${c.requests.length})`);
    const wallet = s.state.world.ledger.balances.player;
    if (s.tycoon.command('cityEvents', (ctx, x: CityState) => respond(ctx, x, 'parking'))) return '도달 · 주차 제휴';
    if (!s.tycoon.command('cityEvents', (ctx, x: CityState) => respond(ctx, x, 'breakfast', 'bread'))) throw Error('대응 실패');
    return `도달 · 주차 제휴 ${partnerLot.perDay * roadworks.days}결 > 지갑 ${wallet} → 아침 메뉴로 대응`;
  });
  let aiId = '';
  step('20~25분 AI 기회·조건 협의', () => {
    const o = s.tycoon.command('opportunity', (ctx, x: OpportunityState) => inquire(ctx, x, 'ai'));
    if (!o) throw Error(`AI 기회 없음(열린 기회 ${sys<OpportunityState>(s, 'opportunity').opps.length})`);
    for (const _ of defOf(o).questions) s.tycoon.command('opportunity', (c, x: OpportunityState) => askQuestion(c, x, o.id));
    s.tycoon.command('opportunity', (c, x: OpportunityState) => answer(c, x, o.id, true));
    const c = s.tycoon.command('aiContract', (ctx, x: AiState) => start(ctx, x, o.id));
    aiId = c.id;
    s.tycoon.command('aiContract', (ctx, x: AiState) => { pickDev(ctx, x, c.id, 'novice'); pickScope(ctx, x, c.id, 'list'); askReuse(ctx, x, c.id); });
    s.tycoon.command('aiContract', (ctx, x: AiState) => sign(ctx, x, c.id, 'advance'));
    let pay = '선금';
    if (!s.tycoon.command('aiContract', (ctx, x: AiState) => begin(ctx, x, c.id))) { // 착수금이 모자라면 성공보수로 재합의
      pay = `선금 부족(지갑 ${s.state.world.ledger.balances.player})→성공보수`;
      s.tycoon.command('aiContract', (ctx, x: AiState) => renegotiate(ctx, x, c.id, 'successOnly'));
      if (!s.tycoon.command('aiContract', (ctx, x: AiState) => begin(ctx, x, c.id))) throw Error('착수 실패');
    }
    return `도달 · ${pay} · 계약 v${c.version} · 재사용 동의 ${c.reuse} · 변호사 데이터 조항 검토 미연결`;
  });
  step('25~30분 AI 검수·잔금', () => {
    const c = sys<AiState>(s, 'aiContract').contracts.find(x => x.id === aiId);
    if (!c) throw Error('계약 없음');
    play(s, () => c.stage === 'testing', 3 * 1440 / 2);
    if (c.stage !== 'testing') throw Error(`검수 단계 못 감(${c.stage})`);
    integrity(s, store, startTotal, 'C AI 검수 직전');
    let fails = s.tycoon.command('aiContract', (ctx, x: AiState) => inspect(ctx, x, c.id));
    if (fails.length) {
      s.tycoon.command('aiContract', (ctx, x: AiState) => rework(ctx, x, c.id, fails.map(f => f.feature)));
      play(s, () => c.stage === 'testing', 1440);
      fails = s.tycoon.command('aiContract', (ctx, x: AiState) => inspect(ctx, x, c.id));
    }
    const share = legs(sys<AiState>(s, 'aiContract'), c, 'start').concat(legs(sys<AiState>(s, 'aiContract'), c, 'final'))
      .reduce((n, l) => n + (l.to === 'player' ? l.amount : -l.amount), 0), nets = s.state.leases[0].reports.map(r => r.net);
    expect(s.state.purses[c.clientId].reserve, '고객 운영 자금에서 지급').toBe(trial.operating - scopes[c.scope!].price);
    return `${c.stage === 'delivered' ? `도달 · 내 몫 ${share}결(가게 하루 순이익 ${nets.join('·')})` : `막힘(잔금 ${legs(sys<AiState>(s, 'aiContract'), c, 'final')[0].amount}결 > 고객 지갑 ${s.state.world.ledger.balances[c.clientId]})`} · ${c.stage} · 재작업 ${c.reworked} · 사례 ${results(c).length}`;
  });
  step('25~30분 공연·취향·공동 기억', () => {
    const show = shows[0], l = leisure(s), mate = res.find(n => n.id !== show.hostId && s.stageFor(n.id) !== '낯섦');
    const day = s.tycoon.ctx().time.day;
    if (minute(s) % 1440 >= show.end) s.skipTo(day * 1440 + 420);
    l.buyTicket(show.id, mate?.id);
    go(s, show.placeId);
    s.skipTo(Math.floor(minute(s) / 1440) * 1440 + show.start + 5);
    l.choose(show.scenes[0].id);
    return `도달 · 동행 ${mate?.name ?? '혼자'} · 기억 ${mate ? s.state.dialogue.memories[mate.id]?.entries.length ?? 0 : 0}`;
  });
  console.table(rows);
  const end = minute(s);
  integrity(s, store, startTotal, '끝');

  // 방치: 같은 시작에서 명령 없이 같은 절대 분까지 / 채용·정책 직후 분기해 입력을 멈춘 경우.
  const measure = (x: Session) => ({ decisions: sys<StaffState>(x, 'staff').policy.version - 1 + sys<AdState>(x, 'ads').campaigns.length
      + sys<CityState>(x, 'cityEvents').events.reduce((n, e) => n + e.responses.length, 0),
    contracts: sys<AiState>(x, 'aiContract').contracts.filter(c => c.signed).length,
    relations: (x.tycoon.state().systems.leisure as { tickets: { sceneId: string | null }[] }).tickets.filter(t => t.sceneId).length });
  const idle = open().s; prepareTrial(idle); idle.skipTo(end);
  const delegated = open(idleAfterHire).s; go(delegated, 'nest'); delegated.skipTo(end);
  const table = { active: measure(s), idle: measure(idle), delegated: measure(delegated) };
  console.table(table);
  expect(table.idle).toEqual({ decisions: 0, contracts: 0, relations: 0 });
  expect(table.delegated.contracts + table.delegated.relations).toBe(0); // 맡긴 뒤 입력 없이 계약·공동 경험이 생기지 않는다
  expect(sys<StaffState>(delegated, 'staff').outcomes.length).toBeGreaterThan(0);
  expect([total(idle), total(delegated)]).toEqual([startTotal, startTotal]);
  // C111: AI 잔금 막힘 해소(고객 사업 운영 자금) → 모든 단계 도달.
  expect(rows.filter(([, r]) => !r.startsWith('도달'))).toEqual([]);
});
