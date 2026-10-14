import { describe, expect, it } from 'vitest';
import { advanceClock, createClock, gameTime } from '../../src/sim/clock';

describe('clock', () => {
  it('tracks day, hour, minute, speed and fractional progress', () => {
    const clock = createClock(60);
    advanceClock(clock, 1.5);
    expect(gameTime(clock)).toEqual({ day: 1, hour: 1, minute: 30 });
    clock.minutesPerSecond = 0.5;
    advanceClock(clock, 1);
    expect(gameTime(clock).minute).toBe(30);
    advanceClock(clock, 1);
    expect(gameTime(clock).minute).toBe(31);
  });
  it('pauses and resumes without accumulating paused time', () => {
    const clock = createClock();
    clock.paused = true;
    expect(advanceClock(clock, 5000)).toEqual([]);
    expect(clock.totalMinutes).toBe(0);
    clock.paused = false;
    advanceClock(clock, 1);
    expect(clock.totalMinutes).toBe(1);
  });
  it('emits every day boundary once and is deterministic', () => {
    const a = createClock(60);
    const b = createClock(60);
    const inputs = [23, 1, 48, 0];
    const events = inputs.map(seconds => advanceClock(a, seconds));
    expect(events).toEqual([[], [2], [3, 4], []]);
    expect(inputs.map(seconds => advanceClock(b, seconds))).toEqual(events);
    expect(a).toEqual(b);
    expect(gameTime(a)).toEqual({ day: 4, hour: 0, minute: 0 });
  });
  it('rejects invalid speed or elapsed time without advancing', () => {
    expect(() => createClock(-1)).toThrow();
    const clock = createClock();
    for (const seconds of [-1, NaN, Infinity]) expect(() => advanceClock(clock, seconds)).toThrow();
    expect(clock.totalMinutes).toBe(0);
  });
});
