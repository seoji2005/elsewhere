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
import { applyBondEvent, edgeKey, readBond } from '../../src/sim/bonds';
import { createMemoryState, rememberSharedEvent } from '../../src/sim/memory';
import { buildDialogue } from '../../src/sim/dialogue';
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
  saved.version = 2; delete saved.state.npcSeed; storage.setItem(SESSION_KEY, JSON.stringify(saved)); const old = createSession(storage);
  expect(old.loadResult.ok).toBe(true); expect(old.state.npcSeed).toBe(0); expect(Object.keys(old.state.world.people)).toHaveLength(57);
  const npc = generate(0, 50)[0], time = { day: 1, hour: 12, minute: 0 }, placeId = whereIs(npc, time);
  old.state.player.placeId = placeId;
  old.state.matchmaking.appointments.push({ id: 'date', actorId: 'player', introducerId: 'aro', npcId: npc.id, placeId, time,
    impression: { name: npc.name, appearance: npc.appearance, keywords: npc.traits }, playerInterest: 2, npcInterest: 2, status: 'scheduled', noShowBy: [] });
  old.tick(720); expect(old.state.world.people[npc.id].placeId).toBe(placeId);
  for (const n of generate(0, 50)) expect(old.state.world.people[n.id].placeId).toBe(whereIs(n, time));
  expect(old.state.matchmaking.appointments[0].status).toBe('met'); expect(old.state.encounters.met[0].npcId).toBe(npc.id);
});
it('round trips v3 memories, dating, bond receipts/budgets and ripple notices without replay', () => {
  const storage = memory(), session = createSession(storage), { state } = session;
  expect(state.relationMode).toBe('bonds'); expect(state.bonds.edges).toEqual({});
  const time = { day: 1, hour: 0, minute: 0 }, npc = npcs.find(n => n.id === 'lise')!;
  state.dialogue.memories.lise = createMemoryState('lise');
  rememberSharedEvent(state.dialogue.memories.lise, { id: 'meal', actorId: 'player', kind: 'meal',
    participants: ['player', 'lise'], placeId: 'cafe', placeName: '카페', activityName: '차', time, status: 'completed' });
  state.dialogue.dating.push({ actorId: 'player', npcId: 'lise' });
  const effects = [{ fromId: 'lise', toId: 'player', delta: { trust: 10 }, met: true as const }];
  applyBondEvent(state.bonds, 'meal', time, effects);
  state.ripple.notices.push({ eventId: 'meal', observerId: 'aro', sourceId: 'aro', created: 0, learned: 0,
    hops: 0, mode: 'witness', kind: 'help', actorId: 'player', targetId: 'lise', topic: '차' });
  session.tick(1440); const ctx = { actorId: 'player', npc, time: gameTime(state.world.clock), value: 30 };
  const recalled = buildDialogue(state.dialogue, ctx).line; session.saveNow();
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!); expect(saved.version).toBe(3);
  expect(Object.keys(saved.state.world.people).some(id => id.startsWith('generated-'))).toBe(false);
  const next = createSession(storage); expect(next.loadResult.ok).toBe(true); expect(next.state).toEqual(state);
  expect(next.state.dialogue.memories.lise.entries[0].mentionedAt).toBe(1440);
  expect(buildDialogue(next.state.dialogue, ctx).line).not.toBe(recalled);
  expect(applyBondEvent(next.state.bonds, 'meal', time, effects)).toBe(false);
  applyBondEvent(next.state.bonds, 'other', time, effects); expect(readBond(next.state.bonds, 'lise', 'player').trust).toBe(10);
});
it.each([1, 2])('migrates v%i to legacy v3 while preserving directional scores and meetings', version => {
  const storage = memory(), { state } = createSession(storage);
  state.world.relationships.player = { lise: 35 }; state.world.relationships.lise = { player: -5 };
  state.encounters.met.push({ actorId: 'player', npcId: 'aro', day: 1 });
  const { dialogue: _dialogue, bonds: _bonds, ripple: _ripple, relationMode: _mode, ...v2 } = state;
  storage.setItem(SESSION_KEY, version === 1 ? saveWorld(state.world) : JSON.stringify({ version: 2, state: v2 }));
  const next = createSession(storage); expect(next.loadResult.ok).toBe(true); expect(next.state.relationMode).toBe('legacy');
  expect(next.state.dialogue).toEqual({ memories: {}, dating: [] }); expect(next.state.ripple.notices).toEqual([]);
  expect(readBond(next.state.bonds, 'player', 'lise')).toMatchObject({ legacyScore: 35, met: true, affection: 0 });
  expect(readBond(next.state.bonds, 'lise', 'player').legacyScore).toBe(-5);
  if (version === 2) expect(readBond(next.state.bonds, 'player', 'aro').met).toBe(true);
  expect(next.state.world.relationships).toEqual(state.world.relationships); next.saveNow();
  expect(JSON.parse(storage.getItem(SESSION_KEY)!).version).toBe(3);
  expect(createSession(storage).state.bonds).toEqual(next.state.bonds);
});
it.each<[string, (state: ReturnType<typeof createSession>['state']) => void]>([
  ['axis', s => { s.bonds.edges[edgeKey('player', 'lise')] = { affection: 101, trust: 0, respect: 0, comfort: 0, romance: 0, met: true }; }],
  ['edge key', s => { s.bonds.edges.bad = { affection: 0, trust: 0, respect: 0, comfort: 0, romance: 0, met: false }; }],
  ['budget', s => { s.bonds.gained[JSON.stringify(['player', 'lise', 1])] = 11; }],
  ['receipt', s => { s.bonds.applied = [null as unknown as string]; }],
  ['notices', s => { s.ripple.notices = {} as typeof s.ripple.notices; }],
  ['notice entry', s => { s.ripple.notices = [null as unknown as typeof s.ripple.notices[number]]; }],
  ['memory entries', s => { s.dialogue.memories.lise = { npcId: 'lise', entries: [null as unknown as typeof s.dialogue.memories.lise.entries[number]] }; }],
  ['dating', s => { s.dialogue.dating = [{ actorId: 'player', npcId: 'player' }]; }],
  ['mode', s => { s.relationMode = 'invalid' as typeof s.relationMode; }],
])('backs up invalid v3 %s before saving a fresh session', (_name, damage) => {
  const storage = memory(), { state } = createSession(storage); damage(state);
  const raw = JSON.stringify({ version: 3, state }); storage.setItem(SESSION_KEY, raw);
  const next = createSession(storage); expect(next.loadResult.ok).toBe(false); expect(storage.getItem(`${SESSION_KEY}.backup`)).toBe(raw);
  expect(next.state.relationMode).toBe('bonds'); expect(next.saveNow().ok).toBe(true);
});
