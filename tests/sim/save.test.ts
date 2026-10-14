import { expect, it } from 'vitest';
import { advanceClock } from '../../src/sim/clock';
import { createLedger, transfer } from '../../src/sim/ledger';
import { restoreWorld, saveWorld, SAVE_VERSION } from '../../src/sim/save';
import { createWorld } from '../../src/sim/world';

it('round-trips the entire state and continues time and duplicate protection', () => {
  const world = createWorld();
  world.clock.minutesPerSecond = 0.5;
  advanceClock(world.clock, 1);
  world.clock.paused = true;
  world.places.home = { id: 'home', name: '집' };
  world.people.p = { id: 'p', name: '사람', role: 'player', placeId: 'home' };
  world.companies.c = { id: 'c', name: '회사' };
  world.relationships.p = { n: 5 };
  world.ledger = createLedger({ p: 10, c: 0 });
  const entry = { id: '1', time: { day: 1, hour: 0, minute: 0 }, from: 'p', to: 'c', amount: 3, reason: '구매' };
  transfer(world.ledger, entry);
  const json = saveWorld(world);
  expect(JSON.parse(json).version).toBe(SAVE_VERSION);
  const restored = restoreWorld(json);
  expect(restored).toEqual(world);
  expect(saveWorld(restored)).toBe(json);
  expect(transfer(restored.ledger, entry)).toEqual({ ok: true, duplicate: true });
  restored.clock.paused = false;
  advanceClock(restored.clock, 1);
  expect(restored.clock.totalMinutes).toBe(1);
  expect(world.clock.totalMinutes).toBe(0.5);
});
it('rejects unknown versions, malformed JSON and missing state', () => {
  for (const json of ['{"version":2}', '{}', 'null', '{', '{"version":1,"world":{}}']) {
    expect(() => restoreWorld(json)).toThrow();
  }
});
