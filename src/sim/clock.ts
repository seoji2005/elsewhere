export interface GameTime { day: number; hour: number; minute: number }
export interface ClockState { totalMinutes: number; minutesPerSecond: number; paused: boolean }

export function createClock(minutesPerSecond = 1): ClockState {
  if (!Number.isFinite(minutesPerSecond) || minutesPerSecond < 0) throw Error('Invalid speed');
  return { totalMinutes: 0, minutesPerSecond, paused: false };
}

export function gameTime(clock: ClockState): GameTime {
  const minutes = Math.floor(clock.totalMinutes);
  return { day: Math.floor(minutes / 1440) + 1, hour: Math.floor(minutes % 1440 / 60), minute: minutes % 60 };
}

// Returns each entered day in order, including when one tick crosses several days.
export function advanceClock(clock: ClockState, realSeconds: number): number[] {
  if (!Number.isFinite(realSeconds) || realSeconds < 0) throw Error('Invalid elapsed time');
  if (!Number.isFinite(clock.minutesPerSecond) || clock.minutesPerSecond < 0) throw Error('Invalid speed');
  if (clock.paused) return [];
  const next = clock.totalMinutes + realSeconds * clock.minutesPerSecond;
  if (!Number.isFinite(next) || next > Number.MAX_SAFE_INTEGER) throw Error('Clock overflow');
  const previousDay = gameTime(clock).day;
  clock.totalMinutes = next;
  const days: number[] = [];
  for (let day = previousDay + 1; day <= gameTime(clock).day; day++) days.push(day);
  return days;
}
