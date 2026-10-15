// C115 사장 직접 계산: 계산대에 선 사장(직원 근무 없음)은 '계산'을 눌러야만 팔고, 누르지 않으면 손님이 인내를 넘겨 떠난다.
import { expect, test } from 'vitest';
import { createSession } from '../../src/game/session';
import { prepareTrial, trial } from '../../src/data/tycoonScenario';
import { patrons, type PatronState } from '../../src/game/tycoon/patrons';

type Session = ReturnType<typeof createSession>;
const memory = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } }; };
const total = (s: Session) => Object.values(s.state.world.ledger.balances).reduce((n, v) => n + v, 0);
const shop = (s: Session) => s.state.book.businesses.find(b => b.ownerId === 'player' && b.closedAt === null)!;
const sales = (s: Session) => shop(s).store.events.filter(e => e.reason === 'purchased').length;
const play = (s: Session, done: () => boolean, cap = 4000) => { for (let t = 0; t < cap && !done(); t++) s.tick(1); return done(); };
function ready(byHand: boolean) {
  const s = createSession(memory(), trial.seed, undefined, 2, true);
  prepareTrial(s);
  for (const st of shop(s).store.stock) st.backroom += 5; // goods in the backroom (the haul is C096's test)
  const b = shop(s);
  s.state.player.placeId = s.state.world.people.player.placeId = b.placeId;
  s.atCounter(byHand);
  return s;
}

test('C115: at the counter with nobody on duty, a sale happens only on 계산 — once, moving the price', () => {
  const s = ready(true), start = total(s);
  expect(s.counter().open).toBe(true);
  expect(play(s, () => s.counter().queue.some(l => l.offer === undefined))).toBe(true);
  expect(sales(s)).toBe(0);
  const head = s.counter().queue[0], cash = s.state.world.ledger.balances.player;
  expect(() => s.ringUp('not-the-head')).toThrow('Not queue head');
  expect(s.ringUp(head.ref)).toBe(true);
  expect(sales(s)).toBe(1);
  expect(s.state.world.ledger.balances.player).toBe(cash + head.price);
  expect(s.counter().queue.some(l => l.ref === head.ref)).toBe(false);
  expect(() => s.ringUp(head.ref)).toThrow(); // paid once: no longer in line
  expect(total(s)).toBe(start);
});

test('C115: nobody rings up → the customer leaves past their patience and nothing is sold', () => {
  const s = ready(true);
  expect(play(s, () => s.counter().queue.length > 0)).toBe(true);
  const head = s.counter().queue[0];
  expect(play(s, () => !s.counter().queue.some(l => l.ref === head.ref))).toBe(true);
  play(s, () => shop(s).store.events.some(e => e.visitId === head.ref), 120);
  expect(shop(s).store.events.find(e => e.visitId === head.ref)?.reason).toBe('impatient');
  expect(sales(s)).toBe(0);
});

test('C115: a haggler at the head gets two answers — 깎아 주기 sells at the offer, 정가 sells nothing', () => {
  for (const accept of [true, false]) {
    const s = ready(true), b = shop(s), list = b.store.stock[0].price, start = total(s), cash = s.state.world.ledger.balances.player;
    s.tycoon.command('patrons', (c, p: PatronState) => patrons.onShopEvent!(c, p, { npcId: 'aro',
      businessId: b.id, itemId: b.store.stock[0].itemId, price: list - 1, count: 1, result: 'haggle' }));
    const head = s.counter().queue[0];
    expect(head.offer).toBe(list - 1);
    expect(s.ringUp(head.ref, accept)).toBe(accept);
    expect(s.state.world.ledger.balances.player).toBe(cash + (accept ? list - 1 : 0));
    expect(s.counter().queue.some(l => l.ref === head.ref)).toBe(false);
    expect(total(s)).toBe(start);
  }
});

test('C115: away from the counter (headless, skipped hours) the boss still serves automatically', () => {
  const s = ready(false);
  expect(s.counter().open).toBe(false);
  expect(play(s, () => sales(s) > 0)).toBe(true);
  const t = ready(true);
  t.skipTo(Math.floor(t.state.world.clock.totalMinutes) + 600);
  expect(t.counter().open).toBe(false);
  expect(sales(t)).toBeGreaterThan(0);
});
