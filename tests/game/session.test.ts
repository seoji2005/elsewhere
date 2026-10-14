import { expect, it } from 'vitest';
import { createSession, SESSION_KEY, AUTOSAVE_MINUTES } from '../../src/game/session';
import type { Storage } from '../../src/game/storage';
import { saveWorld } from '../../src/sim/save';
import { createWorld } from '../../src/sim/world';
import { advanceDay, applyEvent } from '../../src/sim/market';
import { whereIs } from '../../src/sim/npc';
import { npcs } from '../../src/data/npcs';
import { gameTime } from '../../src/sim/clock';
import { generate } from '../../src/sim/npcgen';
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
  const next = createSession(storage); expect(next.loadResult.ok).toBe(true); expect(next.state.world).toMatchObject(world);
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
it('restores seeded residents, migrates seedless v2 saves and resolves generated dates', () => {
  const storage = memory(), session = createSession(storage); session.saveNow();
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!); saved.state.npcSeed = 123;
  storage.setItem(SESSION_KEY, JSON.stringify(saved)); const first = createSession(storage);
  expect(first.state.world.people).toEqual(createSession(storage).state.world.people);
  first.saveNow(); expect(createSession(storage).state.npcSeed).toBe(123);
  saved.state.npcSeed = 456; storage.setItem(SESSION_KEY, JSON.stringify(saved));
  expect(first.state.world.people).not.toEqual(createSession(storage).state.world.people);
  delete saved.state.npcSeed; storage.setItem(SESSION_KEY, JSON.stringify(saved)); const old = createSession(storage);
  expect(old.loadResult.ok).toBe(true); expect(old.state.npcSeed).toBe(0); expect(Object.keys(old.state.world.people)).toHaveLength(57);
  const npc = generate(0, 50)[0], time = { day: 1, hour: 12, minute: 0 }, placeId = whereIs(npc, time);
  old.state.player.placeId = placeId;
  old.state.matchmaking.appointments.push({ id: 'date', actorId: 'player', introducerId: 'aro', npcId: npc.id, placeId, time,
    impression: { name: npc.name, appearance: npc.appearance, keywords: npc.traits }, playerInterest: 2, npcInterest: 2, status: 'scheduled', noShowBy: [] });
  old.tick(720); expect(old.state.world.people[npc.id].placeId).toBe(placeId);
  for (const n of generate(0, 50)) expect(old.state.world.people[n.id].placeId).toBe(whereIs(n, time));
  expect(old.state.matchmaking.appointments[0].status).toBe('met'); expect(old.state.encounters.met[0].npcId).toBe(npc.id);
});
