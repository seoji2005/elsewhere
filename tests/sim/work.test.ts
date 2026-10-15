import { expect, it } from 'vitest';
import { jobs } from '../../src/data/jobs';
import { places } from '../../src/data/places';
import { advanceClock, createClock, gameTime } from '../../src/sim/clock';
import { createLedger } from '../../src/sim/ledger';
import { createWorkState, finishWork, startWork } from '../../src/sim/work';

it('earns the first wage from midnight within one real minute and pays only once after reload', () => {
  const clock = createClock();
  const state = createWorkState();
  const ledger = createLedger({ player: 0, cafe: 100 });
  const shift = startWork(state, 'player', jobs[0].id, 'cafe', gameTime(clock));
  advanceClock(clock, 59);
  expect(finishWork(state, ledger, shift.id, gameTime(clock)).ok).toBe(false);
  advanceClock(clock, 1);
  expect(finishWork(state, ledger, shift.id, gameTime(clock))).toEqual({ ok: true, duplicate: false });
  // C114: 찻방 시급 30→2결(경제 재조정). 한 번만 지급되는 의도는 같다.
  expect(ledger.balances.player).toBe(2);
  expect(finishWork(JSON.parse(JSON.stringify(state)), ledger, shift.id, gameTime(clock)))
    .toEqual({ ok: true, duplicate: true });
  expect(ledger.transactions).toHaveLength(1);
});

it('uses existing workplaces, enforces hours and blocks overlapping shifts', () => {
  for (const job of jobs) {
    expect(places.some(place => place.id === job.placeId)).toBe(true);
    expect(job.durationMinutes).toBeGreaterThanOrEqual(60);
    expect(job.durationMinutes).toBeLessThanOrEqual(120);
  }
  const state = createWorkState();
  const time = { day: 1, hour: 8, minute: 0 };
  expect(() => startWork(state, 'player', jobs[1].id, 'cafe', time)).toThrow();
  expect(() => startWork(state, 'player', jobs[1].id, 'shop', { ...time, hour: 19 })).toThrow();
  const shift = startWork(state, 'player', jobs[1].id, 'shop', time);
  expect(() => startWork(state, 'player', jobs[0].id, 'cafe', time)).toThrow();
  const ledger = createLedger({ player: 0, shop: 100 });
  expect(finishWork(state, ledger, shift.id, { ...time, hour: 10 }).ok).toBe(true);
  // C114: 물건 정리 시급 40→3결, 2시간 = 6결.
  expect(ledger.balances.player).toBe(6);
  expect(() => startWork(state, 'player', jobs[0].id, 'cafe', time)).toThrow();
});

it('keeps an unpaid shift retryable when the employer has insufficient funds', () => {
  const state = createWorkState();
  const time = { day: 1, hour: 0, minute: 0 };
  const shift = startWork(state, 'player', jobs[0].id, 'cafe', time);
  const ledger = createLedger({ player: 0, cafe: 0 });
  expect(finishWork(state, ledger, shift.id, { ...time, hour: 1 }).ok).toBe(false);
  expect(shift.paid).toBe(false);
  expect(ledger.transactions).toHaveLength(0);
});
