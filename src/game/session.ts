import { npcs } from '../data/npcs';
import { places } from '../data/places';
import { companies } from '../data/companies';
import { advanceClock, gameTime } from '../sim/clock';
import { createWorld } from '../sim/world';
import { restoreWorld } from '../sim/save';
import { whereIs } from '../sim/npc';
import { generate } from '../sim/npcgen';
import { createMarket, advanceDay } from '../sim/market';
import { createWorkState, finishWork } from '../sim/work';
import { createStore, expireVisits } from '../sim/store';
import { createShopState } from '../sim/shop';
import { createRelationshipState } from '../sim/relationship';
import { createEncounterState } from '../sim/encounter';
import { createMatchmakingState, resolveMatch } from '../sim/matchmaking';
import { axes, createBonds, seedLegacy } from '../sim/bonds';
import { createDialogueState } from '../sim/dialogue';
import { createRippleState } from '../sim/ripple';
import type { Storage } from './storage';
export const SESSION_KEY = 'vworld.session', AUTOSAVE_MINUTES = 60;
export type SaveResult = { ok: true } | { ok: false; error: unknown };
function freshState() {
  const world = createWorld();
  world.places = Object.fromEntries(places.map(p => [p.id, { ...p }]));
  world.companies = Object.fromEntries(companies.map(c => [c.id, { id: c.id, name: c.name }]));
  world.people = Object.fromEntries(npcs.map(n => [n.id,
    { id: n.id, name: n.name, role: 'npc' as const, placeId: whereIs(n, gameTime(world.clock)) }]));
  world.people.player = { id: 'player', name: '플레이어', role: 'player', placeId: 'nest' };
  return { npcSeed: Math.floor(Math.random() * 0x100000000), world, player: { x: -7, z: -6, direction: 0, placeId: 'nest' },
    market: createMarket(), work: createWorkState(), store: createStore('player'),
    shop: createShopState(), relationships: createRelationshipState(),
    encounters: createEncounterState(), matchmaking: createMatchmakingState(),
    dialogue: createDialogueState(), bonds: createBonds(), ripple: createRippleState(), relationMode: 'bonds' as 'legacy' | 'bonds' };
}
// Check required structures before exposing a restored state to simulation ticks.
function checkShape(value: unknown, template: unknown): void {
  if (Array.isArray(template)) { if (!Array.isArray(value)) throw Error('Invalid array'); return; }
  if (template && typeof template === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid object');
    for (const [key, child] of Object.entries(template))
      checkShape((value as Record<string, unknown>)[key], child);
  } else if (typeof value !== typeof template || typeof value === 'number' && !Number.isFinite(value)) {
    throw Error('Invalid value');
  }
}
function checkSocial(state: ReturnType<typeof freshState>): void {
  const require = (valid: boolean) => { if (!valid) throw Error('Invalid social state'); };
  const id = (value: unknown) => typeof value === 'string' && value.length > 0;
  const minute = (value: number) => Number.isSafeInteger(value) && value >= 0;
  const pairKey = (key: string, daily = false) => {
    const pair = JSON.parse(key);
    require(Array.isArray(pair) && pair.length === (daily ? 3 : 2) && id(pair[0]) && id(pair[1])
      && pair[0] !== pair[1] && JSON.stringify(pair) === key
      && (!daily || Number.isSafeInteger(pair[2]) && pair[2] >= 1));
  };
  require(['legacy', 'bonds'].includes(state.relationMode) && state.bonds.version === 1);
  for (const [key, bond] of Object.entries(state.bonds.edges)) {
    pairKey(key); checkShape(bond, { ...Object.fromEntries(axes.map(axis => [axis, 0])), met: false });
    require(axes.every(axis => bond[axis] >= (axis === 'romance' ? 0 : -100) && bond[axis] <= 100)
      && (bond.legacyScore === undefined || Number.isFinite(bond.legacyScore)));
  }
  for (const [key, gain] of Object.entries(state.bonds.gained)) {
    pairKey(key, true); require(Number.isFinite(gain) && gain >= 0 && gain <= 10);
  }
  require(state.bonds.applied.every(id));
  for (const pair of state.dialogue.dating) require(id(pair?.actorId) && id(pair?.npcId) && pair.actorId !== pair.npcId);
  for (const [npcId, memories] of Object.entries(state.dialogue.memories)) {
    checkShape(memories, { npcId: '', entries: [] }); require(id(npcId) && memories.npcId === npcId);
    for (const m of memories.entries) {
      checkShape(m, { id: '', subjectId: '', topic: '', choiceId: '', kind: '', created: 0,
        lastAccessed: 0, importance: 0, change: 0 });
      require([m.id, m.subjectId, m.topic, m.choiceId].every(id) && ['gift', 'chat', 'meal', 'shared-work'].includes(m.kind)
        && minute(m.created) && minute(m.lastAccessed) && m.lastAccessed >= m.created
        && m.importance >= 0 && m.importance <= 10 && (m.mentionedAt === undefined || minute(m.mentionedAt) && m.mentionedAt >= m.created));
      require([m.placeId, m.placeName, m.sourceEventId].every(value => value === undefined || id(value))
        && (m.participants === undefined || Array.isArray(m.participants) && m.participants.every(id)));
      if (m.kind === 'meal' || m.kind === 'shared-work') require(id(m.placeId) && id(m.placeName) && id(m.sourceEventId)
        && !!m.participants?.includes(npcId) && m.participants.includes(m.subjectId));
    }
  }
  for (const n of state.ripple.notices) {
    checkShape(n, { eventId: '', observerId: '', sourceId: '', actorId: '', targetId: '', topic: '',
      created: 0, learned: 0, hops: 0, mode: '', kind: '' });
    require([n.eventId, n.observerId, n.sourceId, n.actorId, n.targetId, n.topic].every(id)
      && n.actorId !== n.targetId && ![n.actorId, n.targetId].includes(n.observerId)
      && minute(n.created) && minute(n.learned) && n.learned >= n.created && ['help', 'hurt', 'dating'].includes(n.kind)
      && (n.mode === 'witness' && n.hops === 0 && n.sourceId === n.observerId && n.learned === n.created
        || n.mode === 'rumor' && [1, 2].includes(n.hops) && n.sourceId !== n.observerId && n.learned >= n.created + 60 * n.hops));
  }
}
export function createSession(storage: Storage) {
  let state = freshState(), lastSaved = 0, damaged: string | null = null;
  let loadResult: SaveResult = { ok: true };
  const backup = () => {
    if (damaged === null) return;
    let key = `${SESSION_KEY}.backup`, suffix = 0;
    while (storage.getItem(key) !== null) key = `${SESSION_KEY}.backup.${++suffix}`;
    storage.setItem(key, damaged); damaged = null;
  };
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1) {
          state.world = restoreWorld(raw);
          state.player.placeId = state.world.people.player?.placeId ?? state.player.placeId;
          state.market.day = gameTime(state.world.clock).day;
        } else if (parsed?.version === 2 || parsed?.version === 3) state = parsed.state;
        else throw Error('Unsupported session version');
        state.npcSeed = parsed.version === 1 ? 0 : state.npcSeed ?? 0;
        if (parsed.version !== 3) Object.assign(state, { dialogue: createDialogueState(), bonds: createBonds(),
          ripple: createRippleState(), relationMode: 'legacy' });
        checkShape(state, { ...freshState(), world: createWorld() });
        if (parsed.version !== 3) state.bonds = seedLegacy(state.world, state.encounters);
        checkSocial(state);
        generate(state.npcSeed, 0); // Validate the saved uint32 seed before accepting the save.
        if (state.world.clock.totalMinutes < 0 || state.world.clock.minutesPerSecond < 0 ||
          state.market.day !== gameTime(state.world.clock).day) throw Error('Invalid clock');
      } catch (error) { state = freshState(); damaged = raw; loadResult = { ok: false, error }; backup(); }
    }
  } catch (error) { loadResult = { ok: false, error }; }
  const residents = [...npcs, ...generate(state.npcSeed, 50)];
  for (const n of residents) state.world.people[n.id] =
    { id: n.id, name: n.name, role: 'npc', placeId: whereIs(n, gameTime(state.world.clock)) };
  lastSaved = state.world.clock.totalMinutes;
  const saveNow = (): SaveResult => {
    try {
      backup(); // Never overwrite a damaged save until its backup succeeds.
      if (state.world.people.player) state.world.people.player.placeId = state.player.placeId;
      const people = Object.fromEntries(Object.entries(state.world.people).filter(([id]) => !id.startsWith('generated-')));
      storage.setItem(SESSION_KEY, JSON.stringify({ version: 3, state: { ...state, world: { ...state.world, people } } }));
      lastSaved = state.world.clock.totalMinutes;
      return { ok: true };
    } catch (error) { return { ok: false, error }; }
  };
  const tick = (realSeconds: number): SaveResult | undefined => {
    const days = advanceClock(state.world.clock, realSeconds);
    for (const _day of days) advanceDay(state.market);
    const now = gameTime(state.world.clock);
    for (const npc of residents) if (state.world.people[npc.id]) state.world.people[npc.id].placeId = whereIs(npc, now);
    if (state.world.people.player) state.world.people.player.placeId = state.player.placeId;
    expireVisits(state.store, now);
    for (const shift of state.work.shifts) if (!shift.paid && shift.endsAt <= state.world.clock.totalMinutes)
      finishWork(state.work, state.world.ledger, shift.id, now);
    for (const appointment of state.matchmaking.appointments) {
      const npc = residents.find(n => n.id === appointment.npcId);
      if (npc && (appointment.time.day - 1) * 1440 + appointment.time.hour * 60 + appointment.time.minute <= state.world.clock.totalMinutes)
        resolveMatch(appointment, state.encounters, npc, now,
          { playerPlaceId: state.player.placeId, npcPlaceId: whereIs(npc, now) });
    }
    if (days.length || state.world.clock.totalMinutes - lastSaved >= AUTOSAVE_MINUTES) return saveNow();
  };
  return { state, loadResult, tick, saveNow };
}
