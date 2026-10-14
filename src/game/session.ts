import { npcs } from '../data/npcs';
import { places } from '../data/places';
import { companies } from '../data/companies';
import { advanceClock, gameTime } from '../sim/clock';
import { createWorld } from '../sim/world';
import { restoreWorld } from '../sim/save';
import { whereIs } from '../sim/npc';
import { createMarket, advanceDay } from '../sim/market';
import { createWorkState, finishWork } from '../sim/work';
import { createStore, expireVisits } from '../sim/store';
import { createShopState } from '../sim/shop';
import { createRelationshipState } from '../sim/relationship';
import { createEncounterState } from '../sim/encounter';
import { createMatchmakingState, resolveMatch } from '../sim/matchmaking';
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
  return { world, player: { x: -7, z: -6, direction: 0, placeId: 'nest' },
    market: createMarket(), work: createWorkState(), store: createStore('player'),
    shop: createShopState(), relationships: createRelationshipState(),
    encounters: createEncounterState(), matchmaking: createMatchmakingState() };
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
        } else if (parsed?.version === 2) state = parsed.state;
        else throw Error('Unsupported session version');
        checkShape(state, { ...freshState(), world: createWorld() });
        if (state.world.clock.totalMinutes < 0 || state.world.clock.minutesPerSecond < 0 ||
          state.market.day !== gameTime(state.world.clock).day) throw Error('Invalid clock');
      } catch (error) { state = freshState(); damaged = raw; loadResult = { ok: false, error }; backup(); }
    }
  } catch (error) { loadResult = { ok: false, error }; }
  lastSaved = state.world.clock.totalMinutes;
  const saveNow = (): SaveResult => {
    try {
      backup(); // Never overwrite a damaged save until its backup succeeds.
      if (state.world.people.player) state.world.people.player.placeId = state.player.placeId;
      storage.setItem(SESSION_KEY, JSON.stringify({ version: 2, state }));
      lastSaved = state.world.clock.totalMinutes;
      return { ok: true };
    } catch (error) { return { ok: false, error }; }
  };
  const tick = (realSeconds: number): SaveResult | undefined => {
    const days = advanceClock(state.world.clock, realSeconds);
    for (const _day of days) advanceDay(state.market);
    const now = gameTime(state.world.clock);
    for (const npc of npcs) if (state.world.people[npc.id]) state.world.people[npc.id].placeId = whereIs(npc, now);
    if (state.world.people.player) state.world.people.player.placeId = state.player.placeId;
    expireVisits(state.store, now);
    for (const shift of state.work.shifts) if (!shift.paid && shift.endsAt <= state.world.clock.totalMinutes)
      finishWork(state.work, state.world.ledger, shift.id, now);
    for (const appointment of state.matchmaking.appointments) {
      const npc = npcs.find(n => n.id === appointment.npcId);
      if (npc && (appointment.time.day - 1) * 1440 + appointment.time.hour * 60 + appointment.time.minute <= state.world.clock.totalMinutes)
        resolveMatch(appointment, state.encounters, npc, now,
          { playerPlaceId: state.player.placeId, npcPlaceId: whereIs(npc, now) });
    }
    if (days.length || state.world.clock.totalMinutes - lastSaved >= AUTOSAVE_MINUTES) return saveNow();
  };
  return { state, loadResult, tick, saveNow };
}
