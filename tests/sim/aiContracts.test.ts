import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { cases, scopes } from '../../src/data/aiContracts';
import { classify, devInput, preview } from '../../src/sim/aiAutomation';
import { answer, askQuestion, inquire, type OpportunityState } from '../../src/game/tycoon/opportunity';
import { askReuse, begin, legs, pickDev, pickScope, sign, start, type AiState } from '../../src/game/tycoon/aiContracts';

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
