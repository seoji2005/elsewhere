import { npcs } from '../data/npcs';
import { places } from '../data/places';
import { companies } from '../data/companies';
import { items } from '../data/items';
import { chooseNeed, type Customer } from '../sim/customer';
import { advanceClock, gameTime } from '../sim/clock';
import { createWorld } from '../sim/world';
import { restoreWorld } from '../sim/save';
import { whereIs, validateTime } from '../sim/npc';
import { generate } from '../sim/npcgen';
import { createMarket, advanceDay, recordNpcRevenue } from '../sim/market';
import { createWorkState, finishWork } from '../sim/work';
import { createStore, expireVisits, restock, visitStore } from '../sim/store';
import { createShopState, useItem, giveGift } from '../sim/shop';
import { createRelationshipState, type DialogueChoice } from '../sim/relationship';
import { createEncounterState } from '../sim/encounter';
import { createMatchmakingState, resolveMatch, requestMatch, type MatchRequest } from '../sim/matchmaking';
import { axes, createBonds, seedLegacy, edgeKey, emptyBond, applyBondEvent, reactionEffect, readBond, stageOf, canStartDating, friendly } from '../sim/bonds';
import { createDialogueState, buildDialogue, talk, recordDialogue, confess, isDating, type Consent } from '../sim/dialogue';
import { createRippleState, deliverRipple, noticeLine, type SocialEvent } from '../sim/ripple';
import { createPurse, funds, personAccount, payPerson, dayCashflow } from '../sim/purse';
import { openBusiness, hire, startEmployeeShift, payCompletedShift, checkoutBusiness, revenueChange, procure, producerJobs, type BusinessBook } from '../sim/business';
import { jobs } from '../data/jobs';
import type { Storage } from './storage';
export const SESSION_KEY = 'vworld.session', AUTOSAVE_MINUTES = 60;
export type SaveResult = { ok: true } | { ok: false; error: unknown };
const businessProducerJobs: Readonly<Record<string, string>> = { ...producerJobs, lamp: '빛씨 조율사' };
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
// Stable daily decisions do not depend on tick size or iteration order.
function choice(seed: number, key: string): number {
  let hash = seed;
  for (const c of key) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619) >>> 0;
  return hash;
}
function addResidents(state: ReturnType<typeof freshState>, allocate = false, open = false) {
  const { world, purses, book } = state, now = gameTime(world.clock);
  const generated = generate(state.npcSeed, 50), residents = [...npcs, ...generated];
  for (const [index, n] of generated.entries()) {
    world.people[n.id] = { id: n.id, name: n.name, role: 'npc', placeId: whereIs(n, now) };
    world.ledger.balances[n.id] ??= 0;
    purses[n.id] ??= createPurse(world.people, world.ledger, n.id);
    if (allocate) payPerson(world.people, world.ledger, { id: `initial:${n.id}`, from: npcs[index % npcs.length].id,
      to: n.id, amount: 20 + choice(state.npcSeed, n.id) % 20, time: now, reason: 'Initial allocation' });
  }
  if (open) {
    state.populationEconomy = true; book.businesses = []; book.employment = [];
  }
  if (open || state.populationEconomy) {
    for (const [id, ownerId, placeId, itemId, price, capacity] of [
      ['tea-counter', 'nuel', 'cafe', 'tea', 8, 1],
      ['exchange-counter', 'sori', 'shop', 'scarf', 25, 2],
      ['garden-counter', 'iri', 'park', 'soup', 15, 1],
      ['light-counter', 'aro', 'office', 'lamp', 30, 1],
    ] as const) {
      if (!open && (id !== 'light-counter' || book.businesses.some(b => b.id === id || b.ownerId === ownerId))) continue;
      openBusiness(book, world.people, world.ledger, id, ownerId, placeId, capacity,
        [{ itemId, backroom: 0, displayed: 0, capacity: 5, price }], now);
      for (const n of residents.filter(n => n.job === businessProducerJobs[itemId] && n.id !== ownerId).slice(0, capacity))
        hire(book, world.people, world.ledger, id, n.id, { id: `${id}-helper`, name: n.job,
          employerId: ownerId, placeId, fromMinute: 0, toMinute: 1440, durationMinutes: 60, hourlyWage: 4 }, now);
    }
  }
  return residents;
}
function freshState(npcSeed = Math.floor(Math.random() * 0x100000000)) {
  const world = createWorld();
  world.places = Object.fromEntries(places.map(p => [p.id, { ...p }]));
  world.companies = Object.fromEntries(companies.map(c => [c.id, { id: c.id, name: c.name }]));
  world.people = Object.fromEntries(npcs.map(n => [n.id,
    { id: n.id, name: n.name, role: 'npc' as const, placeId: whereIs(n, gameTime(world.clock)) }]));
  world.people.player = { id: 'player', name: '플레이어', role: 'player', placeId: 'nest' };
  return { npcSeed, populationEconomy: false, world, player: { x: -7, z: -6, direction: 0, placeId: 'nest' },
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
export function createSession(storage: Storage, npcSeed?: number) {
  let state = freshState(npcSeed), lastSaved = 0, damaged: string | null = null;
  addResidents(state, true, true);
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
        } else if ([2, 3, 4, 5].includes(parsed?.version)) state = parsed.state;
        else throw Error('Unsupported session version');
        state.npcSeed = parsed.version === 1 ? 0 : state.npcSeed ?? 0;
        if (parsed.version < 3) Object.assign(state, { dialogue: createDialogueState(), bonds: createBonds(),
          ripple: createRippleState(), relationMode: 'legacy' });
        if (parsed.version < 4) Object.assign(state, createEconomy(state.world));
        if (parsed.version < 5) state.populationEconomy = false;
        // Generated identities are omitted from saves; wallets and contracts are retained.
        if (parsed.version >= 5 && generate(state.npcSeed, 50).some(n =>
          !state.purses[n.id] || !Object.hasOwn(state.world.ledger.balances, n.id))) throw Error('Missing resident wallet');
        addResidents(state);
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
      } catch (error) { state = freshState(npcSeed); addResidents(state, true, true); damaged = raw; loadResult = { ok: false, error }; backup(); }
    }
  } catch (error) { loadResult = { ok: false, error }; }
  const residents = addResidents(state);
  for (const n of residents) state.world.people[n.id] =
    { id: n.id, name: n.name, role: 'npc', placeId: whereIs(n, gameTime(state.world.clock)) };
  lastSaved = state.world.clock.totalMinutes;
  const saveNow = (): SaveResult => {
    try {
      backup(); // Never overwrite a damaged save until its backup succeeds.
      if (state.world.people.player) state.world.people.player.placeId = state.player.placeId;
      const people = Object.fromEntries(Object.entries(state.world.people).filter(([id]) => !id.startsWith('generated-')));
      storage.setItem(SESSION_KEY, JSON.stringify({ version: 5, state: { ...state, world: { ...state.world, people } } }));
      lastSaved = state.world.clock.totalMinutes;
      return { ok: true };
    } catch (error) { return { ok: false, error }; }
  };
  // Seed only on social requests so restoration preserves every saved edge.
  const seedAcquaintances = () => {
    const homes = ['nest', 'quiet', 'high'];
    const home = (n: typeof residents[number]) => n.schedule[0].find(s => homes.includes(s.placeId))?.placeId;
    const work = (n: typeof residents[number]) => n.schedule.flat().find(s => !homes.includes(s.placeId))?.placeId;
    for (const a of residents) for (const b of residents) if (a.id !== b.id &&
      (home(a) === home(b) || work(a) !== undefined && work(a) === work(b))) {
      (state.world.relationships[a.id] ??= {})[b.id] ??= 15;
      state.bonds.edges[edgeKey(a.id, b.id)] ??= { ...emptyBond(), affection: 15, trust: 20, met: true };
    }
  };
  const context = (npcId: string) => {
    const npc = residents.find(n => n.id === npcId);
    if (!npc) throw Error('Unknown resident');
    return { actorId: 'player', npc, time: gameTime(state.world.clock), value: state.world.relationships.player?.[npcId] ?? 0 };
  };
  const publish = (id: string, npcId: string, topic: string, kind: SocialEvent['kind']) => {
    seedAcquaintances();
    const { world } = state, time = gameTime(world.clock);
    world.people.player.placeId = state.player.placeId;
    for (const n of residents) world.people[n.id].placeId = whereIs(n, time);
    const event = { id, actorId: 'player', targetId: npcId, time, placeId: state.player.placeId, topic, kind };
    for (const n of residents) deliverRipple(state.ripple, state.bonds, world, state.dialogue, event, n.id, time);
  };
  const social = {
    buildDialogue(npcId: string) {
      const result = buildDialogue(state.dialogue, context(npcId));
      if (state.relationMode === 'bonds') result.stage = stageOf(state.bonds, npcId, 'player', state.dialogue);
      const names = Object.fromEntries(Object.values(state.world.people).map(p => [p.id, p.name]));
      const notice = noticeLine(npcId, state.ripple, gameTime(state.world.clock), names);
      return { ...result, line: notice ? `${notice} ${result.line}` : result.line };
    },
    talk(id: string, npcId: string, choice: DialogueChoice) {
      if (state.relationMode === 'bonds' && state.bonds.applied.includes(id)) throw Error('Duplicate bond event');
      const result = talk(state.world, state.relationships, state.dialogue, id, context(npcId), choice);
      if (state.relationMode === 'bonds') applyBondEvent(state.bonds, id, result.entry.time, [reactionEffect(result.entry)]);
      publish(id, npcId, choice.topic, result.entry.change < 0 ? 'hurt' : 'help'); return result;
    },
    giveGift(id: string, npcId: string, itemId: string) {
      if (state.relationMode === 'bonds' && state.bonds.applied.includes(id)) throw Error('Duplicate bond event');
      if (!id || state.dialogue.memories[npcId]?.entries.some(m => m.id === id)) throw Error('Invalid or duplicate gift event');
      const ctx = context(npcId), entry = giveGift(state.shop, state.world, state.relationships, 'player', ctx.npc, itemId, ctx.time);
      const line = recordDialogue(state.dialogue, id, ctx.npc, entry);
      if (state.relationMode === 'bonds') applyBondEvent(state.bonds, id, entry.time, [reactionEffect(entry)]);
      publish(id, npcId, entry.choice.topic, entry.change < 0 ? 'hurt' : 'help'); return { entry, line };
    },
    confess(id: string, npcId: string, consent: Consent) {
      if (!id) throw Error('Missing event ID');
      const ctx = context(npcId), wasDating = isDating(state.dialogue, 'player', npcId);
      if (state.relationMode === 'bonds') ctx.value = canStartDating(readBond(state.bonds, 'player', npcId),
        readBond(state.bonds, npcId, 'player'), consent) ? 90 : 0;
      const result = confess(state.dialogue, ctx, consent);
      if (result.accepted && !wasDating) publish(id, npcId, '교제', 'dating'); return result;
    },
    requestMatch(request: MatchRequest) {
      seedAcquaintances();
      if (state.relationMode === 'legacy') return requestMatch(state.matchmaking, state.encounters, state.world, request);
      const relationships = { ...state.world.relationships, [request.player.id]: {
        ...state.world.relationships[request.player.id], [request.introducerId]:
          friendly(readBond(state.bonds, request.introducerId, request.player.id)) ? 30 : 0 },
        [request.introducerId]: Object.fromEntries(residents.map(n => [n.id,
          readBond(state.bonds, request.introducerId, n.id).met ? 10 : 0])) };
      return requestMatch(state.matchmaking, state.encounters, { relationships }, request);
    },
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
        const byPlace = new Map<string, typeof residents>();
        for (const npc of residents) {
          const place = whereIs(npc, now), present = byPlace.get(place) ?? [];
          present.push(npc); byPlace.set(place, present); world.people[npc.id].placeId = place;
        }
        for (const b of book.businesses) if (b.closedAt === null && b.openedAt <= minute) {
          expireVisits(b.store, now);
          for (const npc of byPlace.get(b.placeId) ?? []) {
            const employment = book.employment.find(e => e.businessId === b.id && e.actorId === npc.id && e.leftAt === null);
            const slots = npc.schedule[(now.day - 1) % 7];
            const next = slots.find(slot => slot.fromMinute > minute % 1440)?.fromMinute ?? 1440;
            if (employment && minute % 1440 >= employment.job.fromMinute &&
                minute % 1440 + employment.job.durationMinutes <= Math.min(next, employment.job.toMinute) &&
                !state.work.shifts.some(s => s.actorId === npc.id && (!s.paid || Math.floor(s.startedAt / 1440) === now.day - 1)))
              startEmployeeShift(book, state.work, npc.id, b.placeId, now);
            if (npc.id === b.ownerId) continue;
            const visitId = `${b.id}:${now.day}:${npc.id}`;
            const customer: Customer = { likes: npc.likes,
              priceTolerance: 1 + choice(state.npcSeed, `tolerance:${npc.id}`) % 5 / 10, patienceMinutes: 1 };
            const preferred = state.relationMode === 'bonds' && state.populationEconomy;
            const need = preferred ? chooseNeed(customer, items.filter(item => b.store.stock.some(s => s.itemId === item.id)),
              choice(state.npcSeed, `need:${visitId}`) / 0x100000000) : undefined;
            const stock = preferred ? b.store.stock.find(s => s.itemId === need?.itemId) : b.store.stock[0];
            if (!stock || state.populationEconomy && choice(state.npcSeed, visitId) % 100 >= 60 ||
                b.store.visits.some(v => v.id === visitId) ||
                funds(world.ledger, purses[npc.id]).spendable < stock.price ||
                need && stock.price > need.maxPrice ||
                dayCashflow(world.ledger, purses[npc.id], now.day).consumption + stock.price > 32) continue;
            if (stock.backroom + stock.displayed === 0) {
              const producer = residents.find(n => n.id !== b.ownerId && n.job === businessProducerJobs[stock.itemId]);
              if (producer && stock.itemId === 'lamp') {
                const result = payPerson(world.people, world.ledger, { id: `supply:${visitId}`, from: b.ownerId,
                  to: producer.id, amount: 5 * Math.max(1, Math.floor(stock.price / 4)), time: now,
                  reason: `Procurement: ${b.id}:lamp:5:${Math.max(1, Math.floor(stock.price / 4))}` });
                if (result.ok && !result.duplicate) stock.backroom += 5;
              } else if (producer) procure(book, world.people, world.ledger, b.id, producer, stock.itemId, 5,
                Math.max(1, Math.floor(stock.price / 4)), `supply:${visitId}`, now);
            }
            restock(b.store, stock.itemId, 5);
            const visit = visitStore(b.store, world.ledger, visitId, npc.id,
              need ?? { itemId: stock.itemId, maxPrice: stock.price }, customer.patienceMinutes, now);
            const sale = checkoutBusiness(book, world.people, world.ledger, b.id, purses[npc.id], visit.id, now);
            if (sale.ok && !sale.duplicate) {
              const life = state.shop.residents[npc.id] ??= { inventory: {}, energy: 50, appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
              life.inventory[stock.itemId] = (life.inventory[stock.itemId] ?? 0) + 1; useItem(state.shop, npc.id, stock.itemId);
            }
          }
        }
        for (const notice of [...state.ripple.notices]) {
          const time = { day: Math.floor(notice.created / 1440) + 1, hour: Math.floor(notice.created % 1440 / 60), minute: notice.created % 60 };
          const event = { id: notice.eventId, actorId: notice.actorId, targetId: notice.targetId, time,
            placeId: world.people[notice.observerId].placeId!, topic: notice.topic, kind: notice.kind };
          for (const npc of byPlace.get(event.placeId) ?? [])
            deliverRipple(state.ripple, state.bonds, world, state.dialogue, event, npc.id, now, notice.observerId);
        }
        payWages();
      }
      if (minute % 1440 === 0) {
        for (const b of book.businesses) if (companies.some(c => c.npcId === b.ownerId)) recordNpcRevenue(state.market, b.ownerId, revenueChange(b, now.day - 1));
        advanceDay(state.market); state.settledDay = now.day - 1;
        const cutoff = minute - 14 * 1440;
        state.work.shifts = state.work.shifts.filter(s => !s.paid || s.endsAt >= cutoff);
        for (const store of [state.store, ...book.businesses.map(b => b.store)])
          store.visits = store.visits.filter(v => v.status === 'waiting' || v.joinedMinute >= cutoff);
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
  return { state, loadResult, tick, saveNow, ...social };
}
