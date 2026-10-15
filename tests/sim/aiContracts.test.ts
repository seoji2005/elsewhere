import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { cases, scopes } from '../../src/data/aiContracts';
import { classify, devInput, preview } from '../../src/sim/aiAutomation';
import { answer, askQuestion, inquire, type OpportunityState } from '../../src/game/tycoon/opportunity';
import { askReuse, begin, followUp, inspect, legs, pickDev, pickScope, results, retryPayment, rework, sign, start, type AiState } from '../../src/game/tycoon/aiContracts';
import { compactLedger } from '../../src/sim/ledger';

function setup(data = new Map<string, string>()) {
  const fresh = !data.size;
  const session = createSession({ getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } }, 7);
  const ai = () => session.tycoon.state().systems.aiContract as AiState;
  const run = <T>(fn: (c: ReturnType<typeof session.tycoon.ctx>, s: AiState) => T) => session.tycoon.command('aiContract', fn);
  const opp = <T>(fn: (c: ReturnType<typeof session.tycoon.ctx>, s: OpportunityState) => T) => session.tycoon.command('opportunity', fn);
  const advance = (minutes: number) => session.tick(minutes / session.state.world.clock.minutesPerSecond);
  const bal = session.state.world.ledger.balances;
  /** 공개 문의 → 질문 두 개 → 수락 → 'aiContract.start'. */
  const contract = () => {
    const o = opp((c, s) => inquire(c, s, 'ai'))!;
    opp((c, s) => askQuestion(c, s, o.id)); opp((c, s) => askQuestion(c, s, o.id)); opp((c, s) => answer(c, s, o.id, true));
    return run((c, s) => start(c, s, o.id));
  };
  const deal = (dev: 'novice' | 'senior', scope: 'list' | 'normal' | 'extended', pay: 'advance' | 'successOnly') => {
    const c = contract();
    run((cx, s) => pickDev(cx, s, c.id, dev)); run((cx, s) => pickScope(cx, s, c.id, scope)); run((cx, s) => sign(cx, s, c.id, pay));
    return c;
  };
  if (fresh) advance(1440 * 2);
  return { session, ai, run, advance, bal, contract, deal, data };
}
const total = (b: Record<string, number>) => Object.values(b).reduce((a, n) => a + n, 0);

it('C103 A1: with 0 결 the player can inquire, scope and start a success-only list contract; no money moves', () => {
  const f = setup();
  f.bal.player = 0;
  const before = { ...f.bal }, c = f.deal('novice', 'list', 'successOnly');
  expect(f.run((cx, s) => begin(cx, s, c.id))).toBe(true);
  expect(f.ai().contracts[0].stage).toBe('building');
  expect(f.bal).toEqual(before);
});

it('C103 A2: check minutes 30·18·6; missing info is never auto; unsupported scope is refused', () => {
  expect((['list', 'normal', 'extended'] as const).map(k => preview(k).checkMinutes)).toEqual([30, 18, 6]);
  expect(preview('normal')).toMatchObject({ auto: 4, check: 6, saved: 32 });
  for (const k of Object.keys(scopes) as (keyof typeof scopes)[]) for (const x of cases.filter(x => x.kind === 'missing')) expect(classify(k, x)).toBe('check');
  const f = setup(), c = f.contract();
  f.run((cx, s) => pickDev(cx, s, c.id, 'novice'));
  expect(() => f.run((cx, s) => pickScope(cx, s, c.id, 'extended'))).toThrow('원래 주문과 연결하는 부분은 아직 못 맡아요.');
  expect(() => f.run((cx, s) => sign(cx, s, c.id, 'advance'))).toThrow();
});

it('C103 A3: payments are conserved and atomic (180/80: −180 +100 +80; success-only −180 +60 +120)', () => {
  for (const [pay, expected] of [['advance', [-180, 100, 80]], ['successOnly', [-180, 60, 120]]] as const) {
    const f = setup(), c = f.deal('novice', 'list', pay), dev = f.ai().devs.novice;
    f.bal[c.clientId] = 500; // 고객 지갑을 시험용으로 채운 뒤부터 보존을 센다
    const sum = total(f.bal);
    const before = [f.bal[c.clientId], f.bal.player, f.bal[dev]];
    expect(f.run((cx, s) => begin(cx, s, c.id))).toBe(true);
    if (pay === 'advance') expect([f.bal[c.clientId], f.bal.player, f.bal[dev]]).toEqual([before[0] - 72, before[1] + 32, before[2] + 40]);
    f.run((cx, s) => cx.settle(`${c.id}:final`, legs(s, s.contracts[0], 'final')));
    expect([f.bal[c.clientId] - before[0], f.bal.player - before[1], f.bal[dev] - before[2]]).toEqual(expected);
    expect(total(f.bal)).toBe(sum);
  }
  const f = setup(), c = f.deal('novice', 'list', 'advance');
  f.bal.player = 0; f.bal[c.clientId] = 50; // 선금 72결 불가 → 착수비도 없음
  const before = { ...f.bal };
  expect(f.run((cx, s) => begin(cx, s, c.id))).toBe(false);
  expect(f.ai().contracts[0].stage).toBe('awaitingFunding'); expect(f.bal).toEqual(before);
  f.bal[c.clientId] = 500;
  expect(f.run((cx, s) => begin(cx, s, c.id))).toBe(true);
  expect(f.bal.player).toBe(32);
});

it('C103 A6: developers only see agreed fields; reuse needs the client and is asked once; signed terms are fixed', () => {
  for (const ok of [false, true]) {
    const input = devInput(ok);
    expect(input.purpose).toBe(ok ? 'approvedReuse' : 'projectOnly');
    for (const row of input.rows) expect(Object.keys(row).sort()).toEqual(['id', 'item', 'qty']);
  }
  const f = setup(), c = f.contract(), answer1 = f.run((cx, s) => askReuse(cx, s, c.id));
  expect(f.run((cx, s) => askReuse(cx, s, c.id))).toBe(answer1);
  expect(f.ai().contracts[0].version).toBe(2);
  f.run((cx, s) => pickDev(cx, s, c.id, 'senior')); f.run((cx, s) => pickScope(cx, s, c.id, 'normal')); f.run((cx, s) => sign(cx, s, c.id, 'advance'));
  expect(() => f.run((cx, s) => askReuse(cx, s, c.id))).toThrow();
  expect(() => f.run((cx, s) => pickScope(cx, s, c.id, 'list'))).toThrow();
});

it('C103 A8: progress only in booked hours; 180 min at once = minute by minute; no double booking; save and reload', () => {
  const [a, b] = [setup(), setup()];
  for (const f of [a, b]) {
    f.advance(720); const c = f.deal('senior', 'extended', 'advance'); f.bal[c.clientId] = 500; // 12:00 착수
    expect(f.run((cx, s) => begin(cx, s, c.id))).toBe(true);
  }
  const at = a.session.state.economyMinute;
  a.advance(120); for (let i = 0; i < 120; i++) b.advance(1);
  expect(b.ai()).toEqual(a.ai()); expect(b.bal).toEqual(a.bal);
  let booked = 0; for (let m = at + 1; m <= a.session.state.economyMinute; m++) { const h = Math.floor(m % 1440 / 60); if (h >= 13 && h < 19) booked++; }
  const c = a.ai().contracts[0];
  expect(booked).toBeGreaterThanOrEqual(45); expect(c.work - c.left).toBe(booked); expect(c.asked).toBe(1); // 13시 전에는 진행 없음, 50%에서 질문
  const second = a.contract();
  expect(() => a.run((cx, s) => pickDev(cx, s, second.id, 'senior'))).toThrow('Developer busy');
  a.run((cx, s) => pickDev(cx, s, second.id, 'novice'));
  const restored = setup(a.data);
  expect(restored.session.loadResult.ok).toBe(true); expect(restored.ai()).toEqual(a.ai());
  a.advance(1440);
  expect(a.ai().contracts[0].stage).toBe('testing');
  expect(() => a.run((cx, s) => pickDev(cx, s, second.id, 'senior'))).not.toThrow(); // 시험물이 나오면 예약이 풀린다
});

/** C104: 180결 목록 정리 선금 계약을 착수하고 시험물까지(결함은 시험용으로 지정). */
function built(defects: string[], pay: 'advance' | 'successOnly' = 'advance') {
  const f = setup(), c = f.deal('novice', 'list', pay);
  f.bal[c.clientId] = 500; f.run((cx, s) => begin(cx, s, c.id));
  f.ai().contracts[0].defects = defects; f.advance(1440);
  expect(f.ai().contracts[0].stage).toBe('testing');
  return { ...f, id: c.id, c: () => f.ai().contracts[0], dev: f.ai().devs.novice };
}

it('C104 A4: same artifact gives the same result across runs and reloads; repeat tests do not erase defects; one safety failure blocks delivery', () => {
  const f = built(['list']), first = results(f.c());
  expect(first.filter(r => !r.ok).map(r => r.actual)).toEqual(Array(12).fill('목록에서 사라짐')); // 목록 정리기 결함: 주문이 사라짐
  for (let i = 0; i < 3; i++) expect(f.run((cx, s) => inspect(cx, s, f.id)).length).toBe(12);
  expect(f.c().stage).toBe('testing'); expect(results(f.c())).toEqual(first);
  const restored = setup(f.data);
  expect(results(restored.ai().contracts[0])).toEqual(first);
  const clean = built([]);
  expect(results(clean.c()).every(r => r.ok)).toBe(true);
  expect(results(clean.c()).filter(r => r.expected === '사람 확인').length).toBe(12); // 목록 정리: 모두 확인 목록이 정상
  const safety = built([]); safety.c().scope = 'normal'; safety.c().defects = ['normal']; // 정상 처리기 결함: 주소 없는 주문 자동 확정
  const bad = results(safety.c()).filter(r => !r.ok);
  expect(bad.some(r => r.id === 's0')).toBe(true);
  safety.run((cx, s) => inspect(cx, s, safety.id)); expect(safety.c().stage).toBe('testing');
});

it('C104 A5: one included rework fixes only the marked defect and reruns everything; unresolved failures are final; no reset', () => {
  const f = built(['list']);
  expect(() => f.run((cx, s) => rework(cx, s, f.id, []))).toThrow();
  f.run((cx, s) => rework(cx, s, f.id, ['normal'])); // 무관한 기능군만 지정
  expect(f.c()).toMatchObject({ stage: 'reworking', left: 30, reworked: true });
  f.advance(1440);
  expect(f.c().stage).toBe('testing'); expect(f.c().defects).toEqual(['list']);
  expect(() => f.run((cx, s) => rework(cx, s, f.id, ['list']))).toThrow('Cannot rework');
  f.run((cx, s) => inspect(cx, s, f.id));
  expect(f.c()).toMatchObject({ stage: 'failed', cause: '개발 결함' });
  expect(f.run((cx, s) => start(cx, s, f.c().oppId)).id).toBe(f.id); // 같은 기회로 새로 시작해 초기화할 수 없다
  expect(() => f.run((cx, s) => rework(cx, s, f.id, ['list']))).toThrow();
  const g = built(['list']);
  g.run((cx, s) => rework(cx, s, g.id, ['list'])); g.advance(1440);
  expect(g.c().defects).toEqual([]);
  g.run((cx, s) => inspect(cx, s, g.id));
  expect(g.c().stage).toBe('delivered');
});

it('C104 A7: unpaid balance waits (not a test failure); refund 32 with the rest as debt; no double payments after repeats and compaction', () => {
  const f = built([]);
  f.bal[f.c().clientId] = 50; // 잔금 108결 부족
  const before = { ...f.bal };
  f.run((cx, s) => inspect(cx, s, f.id));
  expect(f.c().stage).toBe('awaitingPayment'); expect(results(f.c()).every(r => r.ok)).toBe(true); expect(f.bal).toEqual(before);
  expect(f.run((cx, s) => retryPayment(cx, s, f.id))).toBe(false);
  f.bal[f.c().clientId] = 500; // 고객이 돈을 마련했다
  const sum = total(f.bal);
  f.advance(1440); // 다음 날 재시도
  expect(f.c().stage).toBe('delivered');
  const paid = { ...f.bal };
  compactLedger(f.session.state.world.ledger, f.session.tycoon.ctx().time.day + 1);
  f.run((cx, s) => cx.settle(`${f.id}:final`, legs(s, s.contracts[0], 'final')));
  expect(() => f.run((cx, s) => retryPayment(cx, s, f.id))).toThrow();
  expect(f.bal[f.c().clientId]).toBe(paid[f.c().clientId]); expect(total(f.bal)).toBe(sum);

  const g = built(['list']), client = g.c().clientId;
  g.run((cx, s) => rework(cx, s, g.id, ['normal'])); g.advance(1440);
  const spend = g.bal.player - 20; g.bal.player -= spend; g.bal[client] += spend; // 선금을 이미 다른 데 썼다: 20결만 남음
  const b = { ...g.bal }, gsum = total(g.bal);
  g.run((cx, s) => inspect(cx, s, g.id)); expect(() => g.run((cx, s) => inspect(cx, s, g.id))).toThrow(); // 환급은 한 번
  expect(g.c()).toMatchObject({ stage: 'failed', owed: 12 });
  expect([g.bal.player, g.bal[client]]).toEqual([0, b[client] + 20]);
  g.bal.player = 30; g.bal[client] -= 30; g.advance(1440); // 돈이 생기면 다음 날 채무를 갚는다
  expect(g.c().owed).toBe(0); expect(g.bal.player).toBe(18); expect(total(g.bal)).toBe(gsum);
  const s = built(['list'], 'successOnly');
  s.run((cx, st) => rework(cx, st, s.id, ['normal'])); s.advance(1440); s.run((cx, st) => inspect(cx, st, s.id));
  expect(s.c()).toMatchObject({ stage: 'failed', owed: 0 });
});

it('C104 A8: delivery records real runs; a follow-up needs those records and is a new contract; no automatic income; tick split and reload', () => {
  const [a, b] = [built([], 'successOnly'), built([], 'successOnly')];
  for (const f of [a, b]) f.run((cx, s) => inspect(cx, s, f.id));
  expect(a.c()).toMatchObject({ stage: 'delivered', next: null, runs: [] });
  expect(() => a.run((cx, s) => followUp(cx, s, a.id))).toThrow();
  const tx = () => a.session.state.world.ledger.transactions.filter(t => t.id.startsWith(a.id)).length, n = tx();
  a.advance(1440 * 3); for (let i = 0; i < 72; i++) b.advance(60);
  expect(b.ai()).toEqual(a.ai());
  expect(a.c().runs.length).toBe(3); expect(a.c().runs.every(r => r.auto === 0 && r.minutes === r.check * 3)).toBe(true);
  expect(a.c().next).toBe('normal'); expect(tx()).toBe(n);
  const next = a.run((cx, s) => followUp(cx, s, a.id));
  expect(next).toMatchObject({ stage: 'scoping', dev: null, scope: null, clientId: a.c().clientId });
  expect(a.run((cx, s) => followUp(cx, s, a.id)).id).toBe(next.id);
  const restored = setup(a.data);
  expect(restored.ai()).toEqual(a.ai());
});
