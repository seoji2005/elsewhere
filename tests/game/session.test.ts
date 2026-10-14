import { expect, it } from 'vitest';
import { createSession, SESSION_KEY, AUTOSAVE_MINUTES } from '../../src/game/session';
import type { Storage } from '../../src/game/storage';
import { saveWorld } from '../../src/sim/save';
import { createWorld } from '../../src/sim/world';
import { advanceDay, applyEvent } from '../../src/sim/market';
import { whereIs } from '../../src/sim/npc';
import { npcs } from '../../src/data/npcs';
import { gameTime } from '../../src/sim/clock';
function memory(): Storage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
it('saves the full session including position and continues after reopening', () => {
  const storage = memory(), session = createSession(storage);
  session.state.player = { x: 2, z: 3, direction: 1.5, placeId: 'cafe' };
  session.state.world.relationships.player = { lise: 30 };
  session.state.shop.residents.player = { inventory: { tea: 2 }, energy: 70, appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
  session.tick(10); expect(session.saveNow()).toEqual({ ok: true });
  const next = createSession(storage); expect(next.state).toEqual(session.state);
  next.tick(1); expect(next.state.world.clock.totalMinutes).toBe(11);
});
it('backs up malformed, invalid and unsupported saves without replacing earlier backups', () => {
  for (const raw of ['{', 'null', '{"version":99}', '{"version":2,"state":{}}']) {
    const storage = memory(); storage.setItem(SESSION_KEY, raw); storage.setItem(`${SESSION_KEY}.backup`, 'older');
    const session = createSession(storage); expect(session.loadResult.ok).toBe(false);
    expect(session.state.world.clock.totalMinutes).toBe(0); expect(session.saveNow().ok).toBe(true);
    expect(storage.getItem(`${SESSION_KEY}.backup.1`)).toBe(raw); expect(storage.getItem(`${SESSION_KEY}.backup`)).toBe('older');
  }
});
it('migrates version 1 world saves', () => {
  const storage = memory(), world = createWorld(); world.clock.totalMinutes = 2881;
  world.people.player = { id: 'player', name: '플레이어', role: 'player', placeId: 'cafe' };
  storage.setItem(SESSION_KEY, saveWorld(world));
  const next = createSession(storage); expect(next.loadResult.ok).toBe(true); expect(next.state.world).toEqual(world);
  expect(next.state.market.day).toBe(3); expect(next.state.player.placeId).toBe('cafe'); expect(next.saveNow().ok).toBe(true);
});
it('advances each skipped day and saves by game time, on day changes and explicitly', () => {
  const storage = memory(), session = createSession(storage); expect(session.tick(AUTOSAVE_MINUTES - 1)).toBeUndefined();
  expect(session.tick(1)?.ok).toBe(true); applyEvent(session.state.market, { companyId: 'tea', size: .1, days: 2 });
  const market = structuredClone(session.state.market); for (let i = 0; i < 3; i++) advanceDay(market);
  expect(session.tick(4320)?.ok).toBe(true); expect(session.state.market).toEqual(market);
  for (const npc of npcs) expect(session.state.world.people[npc.id].placeId).toBe(whereIs(npc, gameTime(session.state.world.clock)));
  session.state.world.clock.paused = true; expect(session.tick(100)).toBeUndefined(); expect(session.saveNow().ok).toBe(true);
});
it('reports storage failures while time continues and retains unbacked damaged data', () => {
  const storage = memory(); storage.setItem(SESSION_KEY, '{'); storage.setItem = () => { throw Error('quota'); };
  const session = createSession(storage); expect(session.tick(1441)?.ok).toBe(false);
  expect(session.state.world.clock.totalMinutes).toBe(1441); expect(storage.getItem(SESSION_KEY)).toBe('{');
});
