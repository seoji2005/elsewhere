import { npcs } from '../data/npcs';
import { places } from '../data/places';
import { companies } from '../data/companies';
import { advanceClock, gameTime } from '../sim/clock';
import { createWorld } from '../sim/world';
import { restoreWorld } from '../sim/save';
import { whereIs, validateTime } from '../sim/npc';
import { generate } from '../sim/npcgen';
import { createMarket, advanceDay, recordNpcRevenue } from '../sim/market';
import { createWorkState, finishWork } from '../sim/work';
import { createStore, expireVisits, restock, visitStore } from '../sim/store';
import { createShopState, useItem } from '../sim/shop';
import { createRelationshipState } from '../sim/relationship';
import { createEncounterState } from '../sim/encounter';
import { createMatchmakingState, resolveMatch } from '../sim/matchmaking';
import { axes, createBonds, seedLegacy } from '../sim/bonds';
import { createDialogueState } from '../sim/dialogue';
import { createRippleState } from '../sim/ripple';
import { createPurse, funds, personAccount } from '../sim/purse';
import { openBusiness, hire, startEmployeeShift, payCompletedShift, checkoutBusiness, revenueChange, type BusinessBook } from '../sim/business';
import { jobs } from '../data/jobs';
import type { Storage } from './storage';
export const SESSION_KEY = 'vworld.session', AUTOSAVE_MINUTES = 60;
export type SaveResult = { ok: true } | { ok: false; error: unknown };
const personalEmployer: Record<string, string> = { cafe: 'nuel', shop: 'sori', market: 'aro' };
function createEconomy(world: ReturnType<typeof createWorld>) {
  const { people, ledger } = world, now = gameTime(world.clock);
  for (const n of npcs) people[n.id] ??= { id: n.id, name: n.name, role: 'npc', placeId: whereIs(n, now) };
  people.player ??= { id: 'player', name: '플레이어', role: 'player', placeId: 'nest' };
  for (const id of ['player', ...npcs.map(n => n.id)]) ledger.balances[id] ??= id === 'player' ? 100 : 1000;
  for (const [account, person] of Object.entries(personalEmployer)) if (Object.hasOwn(ledger.balances, account)) {
    ledger.balances[person] += ledger.balances[account]; delete ledger.balances[account];
  }
  const purses = Object.fromEntries(['player', ...npcs.map(n => n.id)].map(id => [id, createPurse(people, ledger, id)]));
  const book: BusinessBook = { businesses: [], employment: [] };
  openBusiness(book, people, ledger, 'tea-counter', 'nuel', 'cafe', 1,
    [{ itemId: 'tea', backroom: 300, displayed: 0, capacity: 5, price: 8 }], now);
  hire(book, people, ledger, 'tea-counter', 'iri', jobs[0], now);
  return { purses, book, economyMinute: Math.floor(world.clock.totalMinutes), settledDay: now.day - 1 };
}
function freshState() {
  const world = createWorld();
  world.places = Object.fromEntries(places.map(p => [p.id, { ...p }]));
  world.companies = Object.fromEntries(companies.map(c => [c.id, { id: c.id, name: c.name }]));
  world.people = Object.fromEntries(npcs.map(n => [n.id,
    { id: n.id, name: n.name, role: 'npc' as const, placeId: whereIs(n, gameTime(world.clock)) }]));
  world.people.player = { id: 'player', name: '플레이어', role: 'player', placeId: 'nest' };
  return { npcSeed: Math.floor(Math.random() * 0x100000000), world, player: { x: -7, z: -6, direction: 0, placeId: 'nest' },
    ...createEconomy(world), market: createMarket(), work: createWorkState(), store: createStore('player'),
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
        } else if ([2, 3, 4].includes(parsed?.version)) state = parsed.state;
        else throw Error('Unsupported session version');
        state.npcSeed = parsed.version === 1 ? 0 : state.npcSeed ?? 0;
        if (parsed.version < 3) Object.assign(state, { dialogue: createDialogueState(), bonds: createBonds(),
          ripple: createRippleState(), relationMode: 'legacy' });
        if (parsed.version < 4) Object.assign(state, createEconomy(state.world));
        checkShape(state, { ...freshState(), world: createWorld() });
        if (parsed.version < 3) state.bonds = seedLegacy(state.world, state.encounters);
        checkSocial(state);
        if (state.economyMinute !== Math.floor(state.world.clock.totalMinutes) ||
            state.settledDay !== state.market.day - 1) throw Error('Invalid economic cursor');
        for (const [id, purse] of Object.entries(state.purses)) {
          if (purse.personId !== id || !personAccount(state.world.people, state.world.ledger, id)) throw Error('Invalid purse');
          funds(state.world.ledger, purse);
        }
        const template = createEconomy(createWorld());
        checkShape(state.book, template.book);
        const dated = (n: number) => Number.isSafeInteger(n) && n >= 0 && n <= state.economyMinute;
        if (!state.book.businesses.length || !state.book.employment.length ||
            new Set(state.book.businesses.map(b => b.id)).size !== state.book.businesses.length) throw Error('Invalid business book');
        for (const b of state.book.businesses) {
          checkShape({ ...b, closedAt: null }, template.book.businesses[0]);
          if (!b.id || !b.placeId || !state.purses[b.ownerId] ||
              b.store.accountId !== b.ownerId || !Number.isSafeInteger(b.capacity) || b.capacity < 0 ||
              !dated(b.openedAt) || b.closedAt !== null && (!dated(b.closedAt) || b.closedAt < b.openedAt)) throw Error('Invalid business');
          createStore(b.ownerId, b.store.stock);
          for (const v of b.store.visits) {
            checkShape(v, { id: '', actorId: '', need: { itemId: '', maxPrice: 0 }, joinedMinute: 0, patienceMinutes: 0, price: 0, status: '' });
            if (!v.id || !state.purses[v.actorId] || !['waiting', 'paid', 'left'].includes(v.status) ||
                ![v.joinedMinute, v.patienceMinutes, v.price, v.need.maxPrice].every(n => Number.isSafeInteger(n) && n >= 0)) throw Error('Invalid visit');
          }
          for (const e of b.store.events) {
            checkShape(e, { visitId: '', actorId: '', itemId: '', time: { day: 1, hour: 0, minute: 0 }, reason: '', amount: 0 });
            validateTime(e.time);
            if (!state.purses[e.actorId] || !['purchased', 'missing', 'expensive', 'unaffordable', 'impatient'].includes(e.reason) ||
                !Number.isSafeInteger(e.amount) || e.amount < 0) throw Error('Invalid sale');
          }
          if (state.book.employment.filter(e => e.businessId === b.id && e.leftAt === null).length > b.capacity) throw Error('Invalid capacity');
        }
        for (const e of state.book.employment) {
          checkShape({ ...e, leftAt: null }, template.book.employment[0]);
          const b = state.book.businesses.find(b => b.id === e.businessId), j = e.job;
          if (!b || !state.purses[e.actorId] || e.actorId === b.ownerId || !dated(e.hiredAt) || e.hiredAt < b.openedAt ||
              e.leftAt !== null && (!dated(e.leftAt) || e.leftAt < e.hiredAt) ||
              !j.id || !j.name || j.placeId !== b.placeId || j.employerId !== b.ownerId ||
              ![j.fromMinute, j.toMinute, j.durationMinutes, j.hourlyWage, j.hourlyWage * j.durationMinutes / 60]
                .every(n => Number.isSafeInteger(n) && n >= 0) || j.durationMinutes === 0 || j.hourlyWage === 0 ||
              j.fromMinute >= j.toMinute || j.toMinute > 1440 || j.durationMinutes > j.toMinute - j.fromMinute) throw Error('Invalid employment');
          if (e.leftAt === null && (b.closedAt !== null ||
              state.book.employment.some(other => other !== e && other.actorId === e.actorId && other.leftAt === null) ||
              state.book.businesses.some(other => other.ownerId === e.actorId && other.closedAt === null))) throw Error('Invalid active employment');
        }
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
      storage.setItem(SESSION_KEY, JSON.stringify({ version: 4, state: { ...state, world: { ...state.world, people } } }));
      lastSaved = state.world.clock.totalMinutes;
      return { ok: true };
    } catch (error) { return { ok: false, error }; }
  };
  const tick = (realSeconds: number): SaveResult | undefined => {
    const days = advanceClock(state.world.clock, realSeconds);
    const target = state.world.clock.totalMinutes, { world, book, purses } = state;
    for (let minute = state.economyMinute + 1; minute <= Math.floor(target); minute++) {
      world.clock.totalMinutes = minute;
      const now = gameTime(world.clock);
      const payWages = () => {
        for (const shift of state.work.shifts) if (!shift.paid && shift.endsAt <= minute) {
          shift.employerId = personalEmployer[shift.employerId] ?? shift.employerId;
          const employment = book.employment.find(e => e.actorId === shift.actorId && e.job.id === shift.jobId &&
            e.job.employerId === shift.employerId && e.hiredAt <= shift.startedAt && (e.leftAt === null || shift.startedAt < e.leftAt));
          if (employment) payCompletedShift(book, world.people, world.ledger, employment.businessId, shift, now);
          else if (personAccount(world.people, world.ledger, shift.employerId) && personAccount(world.people, world.ledger, shift.actorId))
            finishWork(state.work, world.ledger, shift.id, now);
        }
      };
      payWages();
      if (minute % 60 === 0) {
        for (const b of book.businesses) for (const npc of npcs) if (
          b.closedAt === null && b.openedAt <= minute && whereIs(npc, now) === b.placeId) {
          const employment = book.employment.find(e => e.businessId === b.id && e.actorId === npc.id && e.leftAt === null);
          if (employment && now.hour * 60 >= employment.job.fromMinute &&
              now.hour * 60 + employment.job.durationMinutes <= employment.job.toMinute && !state.work.shifts.some(s => s.actorId === npc.id &&
              (!s.paid || Math.floor(s.startedAt / 1440) === now.day - 1)))
            startEmployeeShift(book, state.work, npc.id, b.placeId, now);
          if (npc.id === b.ownerId) continue;
          restock(b.store, 'tea', 5);
          const visit = visitStore(b.store, world.ledger, `tea:${now.day}:${npc.id}`, npc.id,
            { itemId: 'tea', maxPrice: 8 }, 1, now);
          const sale = checkoutBusiness(book, world.people, world.ledger, b.id, purses[npc.id], visit.id, now);
          if (sale.ok && !sale.duplicate) {
            const life = state.shop.residents[npc.id] ??= { inventory: {}, energy: 50, appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
            life.inventory.tea = (life.inventory.tea ?? 0) + 1; useItem(state.shop, npc.id, 'tea');
          }
        }
        payWages();
      }
      if (minute % 1440 === 0) {
        for (const b of book.businesses) recordNpcRevenue(state.market, b.ownerId, revenueChange(b, now.day - 1));
        advanceDay(state.market); state.settledDay = now.day - 1;
      }
      expireVisits(state.store, now);
      for (const appointment of state.matchmaking.appointments) {
        const npc = residents.find(n => n.id === appointment.npcId);
        if (npc && (appointment.time.day - 1) * 1440 + appointment.time.hour * 60 + appointment.time.minute <= minute)
          resolveMatch(appointment, state.encounters, npc, now,
            { playerPlaceId: state.player.placeId, npcPlaceId: whereIs(npc, now) });
      }
      state.economyMinute = minute;
    }
    state.world.clock.totalMinutes = target;
    const now = gameTime(state.world.clock);
    for (const npc of residents) if (state.world.people[npc.id]) state.world.people[npc.id].placeId = whereIs(npc, now);
    if (state.world.people.player) state.world.people.player.placeId = state.player.placeId;
    if (days.length || state.world.clock.totalMinutes - lastSaved >= AUTOSAVE_MINUTES) return saveNow();
  };
  return { state, loadResult, tick, saveNow };
}
