import { expect, it } from 'vitest';
import { createSession, SESSION_KEY } from '../../src/game/session';
import type { Storage } from '../../src/game/storage';
import type { TycoonSystem } from '../../src/game/tycoon/system';
import { emptyTycoon } from '../../src/game/tycoon/state';

function memory(): Storage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
const counter: TycoonSystem<{ count: number; hits: number }> = {
  id: 'counter',
  create: () => ({ count: 0, hits: 0 }),
  validate(raw) {
    const s = raw as { count: number; hits: number };
    if (!Number.isSafeInteger(s?.count) || !Number.isSafeInteger(s?.hits)) throw Error('Invalid counter');
    return s;
  },
  onMinute(ctx, s, minute) { s.count++; if (ctx.roll('counter', 'minute', minute) < 0.5) s.hits++; },
};
// Runs after counter: sees counter's count for the same minute. Moves 1 between two residents each day and back.
const shuttle: TycoonSystem<{ seen: number; days: number[]; batches: string[] }> = {
  id: 'shuttle',
  create: () => ({ seen: 0, days: [], batches: [] }),
  validate(raw) {
    const s = raw as { seen: number; days: number[]; batches: string[] };
    if (!Number.isSafeInteger(s?.seen) || !Array.isArray(s.days) || !Array.isArray(s.batches)) throw Error('Invalid shuttle');
    return s;
  },
  onMinute(ctx, s) { s.seen = (ctx.systems.counter as { count: number }).count; },
  onDay(ctx, s, day) {
    const [a, b] = ctx.residents, id = ctx.nextId('shuttle');
    const result = ctx.settle(id, [{ from: a.id, to: b.id, amount: 1, reason: 'Test shuttle' },
      { from: b.id, to: a.id, amount: 1, reason: 'Test shuttle' }]);
    if (result.ok) { s.days.push(day); s.batches.push(id); }
  },
};
const systems = [counter, shuttle];
const total = (balances: Record<string, number>) => Object.values(balances).reduce((sum, n) => sum + n, 0);
const snapshot = (session: ReturnType<typeof createSession>) =>
  ({ tycoon: session.tycoon.state(), balances: session.state.world.ledger.balances });

it('C093: a v5 save opens with an empty tycoon container and unchanged money, leases and shops', () => {
  const storage = memory(), old = createSession(storage, 77, []); // C095: the default registry is no longer empty
  old.rentStore('cafe-unit'); old.openShop('tea'); old.tick(600); old.saveNow();
  // A true v5 fixture: v6 minus the tycoon container (master 2026-10-16: saves are always v6 now).
  const v6 = JSON.parse(storage.getItem(SESSION_KEY)!); expect(v6.version).toBe(6); delete v6.state.tycoon;
  storage.setItem(SESSION_KEY, JSON.stringify({ ...v6, version: 5 }));
  const raw = storage.getItem(SESSION_KEY)!; expect(JSON.parse(raw).version).toBe(5);
  const before = JSON.parse(raw).state;
  const empty = createSession(storage, undefined, []);
  expect(empty.loadResult.ok).toBe(true); expect(empty.tycoon.state()).toEqual(emptyTycoon());
  const withSystems = createSession(storage, undefined, systems);
  for (const next of [empty, withSystems]) {
    expect(next.state.world.ledger.balances).toEqual(before.world.ledger.balances);
    expect(next.state.leases).toEqual(before.leases); expect(next.state.book).toEqual(before.book);
  }
  expect(withSystems.tycoon.state()).toEqual({ version: 1, seq: 0,
    systems: { counter: { count: 0, hits: 0 }, shuttle: { seen: 0, days: [], batches: [] } } });
});

it('C093: one long tick, minute ticks and save/resume give the same tycoon state and balances', () => {
  const whole = createSession(memory(), 123, systems); const start = total(whole.state.world.ledger.balances);
  whole.tick(1440 * 3);
  const minutes = createSession(memory(), 123, systems);
  for (let i = 0; i < 1440 * 3; i++) minutes.tick(1);
  const storage = memory(), first = createSession(storage, 123, systems);
  first.tick(2000); first.saveNow(); expect(JSON.parse(storage.getItem(SESSION_KEY)!).version).toBe(6);
  const resumed = createSession(storage, undefined, systems); expect(resumed.loadResult.ok).toBe(true);
  resumed.tick(1440 * 3 - 2000);
  expect(snapshot(minutes)).toEqual(snapshot(whole)); expect(snapshot(resumed)).toEqual(snapshot(whole));
  const s = whole.tycoon.state().systems as { counter: { count: number; hits: number }; shuttle: { seen: number; days: number[] } };
  expect(s.counter.count).toBe(1440 * 3); expect(s.counter.hits).toBeGreaterThan(0);
  expect(s.shuttle.seen).toBe(s.counter.count); // registry order: counter runs before shuttle every minute
  expect(s.shuttle.days).toEqual([1, 2, 3]); expect(whole.tycoon.state().seq).toBe(3);
  expect(total(whole.state.world.ledger.balances)).toBe(start);
});

it('C093: registry order decides processing order within a minute', () => {
  const session = createSession(memory(), 5, [shuttle, counter]); session.tick(10);
  const s = session.tycoon.state().systems as { counter: { count: number }; shuttle: { seen: number } };
  expect(s.counter.count).toBe(10); expect(s.shuttle.seen).toBe(9);
});

it('C093: invalid system state backs up the save and starts a new game; unknown systems are kept', () => {
  const storage = memory(), session = createSession(storage, 9, systems);
  session.tick(30); session.saveNow();
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!);
  saved.state.tycoon.systems.future = { note: 'later card' };
  storage.setItem(SESSION_KEY, JSON.stringify(saved));
  const kept = createSession(storage, undefined, systems); expect(kept.loadResult.ok).toBe(true);
  expect(kept.tycoon.state().systems.future).toEqual({ note: 'later card' });
  expect(kept.tycoon.command('counter', (_ctx, s: { count: number }) => s.count)).toBe(30);
  expect(JSON.parse(storage.getItem(SESSION_KEY)!).state.tycoon.systems.future).toEqual({ note: 'later card' });
  saved.state.tycoon.systems.counter = { count: 'x' }; const damaged = JSON.stringify(saved);
  storage.setItem(SESSION_KEY, damaged);
  const fresh = createSession(storage, 9, systems);
  expect(fresh.loadResult.ok).toBe(false); expect(storage.getItem(`${SESSION_KEY}.backup`)).toBe(damaged);
  expect(fresh.state.world.clock.totalMinutes).toBe(0);
  expect(fresh.tycoon.state().systems.counter).toEqual({ count: 0, hits: 0 });
});

it('placeOf gives the same resident places for whole and split ticks (Codex review P1)', () => {
  const seen: Record<string, string[]> = { whole: [], split: [] };
  const probe = (key: 'whole' | 'split'): TycoonSystem<{ n: number }> => ({
    id: 'probe', create: () => ({ n: 0 }), validate: raw => raw as { n: number },
    onMinute: (ctx, s, minute) => { if (minute % 97 === 0) seen[key].push(ctx.residents.slice(0, 5).map(r => ctx.placeOf(r.id)).join(',')); s.n++; },
  });
  const whole = createSession(memory(), 123, [probe('whole')]);
  whole.tick(1440);
  const split = createSession(memory(), 123, [probe('split')]);
  for (let i = 0; i < 1440; i++) split.tick(1);
  expect(seen.split).toEqual(seen.whole);
});
