import { storefronts, retailDemand, shopKinds, shopStock, type ShopKind } from '../data/storefronts';
import { rentStorefront, endLease, jobOffer, type Lease } from '../sim/business';
import { npcs, type Npc } from '../data/npcs';
import { companionEvents } from '../data/companions';
import { places } from '../data/places';
import { companies } from '../data/companies';
import { items } from '../data/items';
import { personas } from '../data/personas';
import type { Customer } from '../sim/customer';
import { chooseWeatherNeed, weatherFor, demandWeight } from '../sim/weather';
import { advanceClock, gameTime, type GameTime } from '../sim/clock';
import { createWorld } from '../sim/world';
import { compactLedger, isRecorded } from '../sim/ledger';
import { restoreWorld } from '../sim/save';
import { roll as tycoonRoll, settle as tycoonSettle, nextId as tycoonNextId } from '../sim/tycoonCore';
import { tycoonSystems } from './tycoon/registry';
import type { ShopEvent, TycoonCtx, TycoonSystem } from './tycoon/system';
import { patrons, park, personaOf, type PatronState } from './tycoon/patrons';
import { applyPersona, decideWithPersona } from '../sim/persona';
import { emptyTycoon, createTycoon, restoreTycoon, runMinute, runDay, type TycoonState } from './tycoon/state';
import { whereIs, validateTime } from '../sim/npc';
import { generate } from '../sim/npcgen';
import { createMarket, advanceDay, recordNpcRevenue } from '../sim/market';
import { createWorkState, finishWork, startWork as beginWork } from '../sim/work';
import { createStore, expireVisits, restock, visitStore, setPrice, dailySummary } from '../sim/store';
import { createShopState, useItem, giveGift, inviteHomeTea } from '../sim/shop';
import { createRelationshipState, relationshipStage, type DialogueChoice } from '../sim/relationship';
import { createEncounterState } from '../sim/encounter';
import { createMatchmakingState, resolveMatch, noShowEffects, requestMatch, type MatchRequest } from '../sim/matchmaking';
import { minuteOf, createMemoryState, rememberSharedEvent, type SharedEvent } from '../sim/memory';
import { axes, createBonds, seedLegacy, edgeKey, emptyBond, applyBondEvent, reactionEffect, readBond, stageOf, canStartDating, friendly, reconcileBond } from '../sim/bonds';
import { createDialogueState, buildDialogue, talk, recordDialogue, confess, isDating, conflictLine, type Consent } from '../sim/dialogue';
import { createRippleState, deliverRipple, noticeLine, type SocialEvent } from '../sim/ripple';
import { createPurse, funds, personAccount, payPerson, dayCashflow } from '../sim/purse';
import { openBusiness, hire, startEmployeeShift, payCompletedShift, checkoutBusiness, revenueChange, procure, producerJobs, type BusinessBook } from '../sim/business';
import { jobs } from '../data/jobs';
import { createMessengerState, send, due, meetSlot, replyLine, type MessageKind } from '../sim/messenger';
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
// Two paid five-unit batches: a full shelf and a reserve for the first night.
function supplyDay(state: ReturnType<typeof freshState>, residents: ReturnType<typeof addResidents>) {
  const { world, book } = state, time = gameTime(world.clock);
  for (const b of book.businesses) if (b.closedAt === null && b.ownerId !== 'player') for (const stock of b.store.stock) {
    let producer = residents.find(n => n.id !== b.ownerId && n.job === businessProducerJobs[stock.itemId]);
    if (state.leases.some(l => !l.ended && l.businessId)) producer = residents
      .filter(n => n.id !== b.ownerId && n.job === businessProducerJobs[stock.itemId])
      .reduce<typeof residents[number] | undefined>((best, n) => !best || world.ledger.balances[n.id] < world.ledger.balances[best.id] ? n : best, undefined);
    if (!producer) continue;
    for (let batch = 0; stock.backroom + stock.displayed < 10 && batch < 2; batch++) {
      const unitCost = Math.max(1, Math.floor(stock.price / 4)), id = `daily-supply:${b.id}:${stock.itemId}:${time.day}:${batch}`;
      const result = stock.itemId === 'lamp'
        ? payPerson(world.people, world.ledger, { id, from: b.ownerId, to: producer.id,
          amount: 5 * unitCost, time, reason: `Procurement: ${b.id}:lamp:5:${unitCost}` })
        : procure(book, world.people, world.ledger, b.id, producer, stock.itemId, 5, unitCost, id, time);
      if (!result.ok || result.duplicate) break;
      if (stock.itemId === 'lamp') stock.backroom += 5; // Same paid adapter as hourly procurement.
    }
    restock(b.store, stock.itemId, stock.capacity);
  }
}
function freshState(npcSeed = Math.floor(Math.random() * 0x100000000)) {
  const world = createWorld();
  world.places = Object.fromEntries(places.map(p => [p.id, { ...p }]));
  world.companies = Object.fromEntries(companies.map(c => [c.id, { id: c.id, name: c.name }]));
  world.people = Object.fromEntries(npcs.map(n => [n.id,
    { id: n.id, name: n.name, role: 'npc' as const, placeId: whereIs(n, gameTime(world.clock)) }]));
  world.people.player = { id: 'player', name: '플레이어', role: 'player', placeId: 'nest' };
  return { leases: [] as Lease[], npcSeed, populationEconomy: false, reputation: { player: 0 } as Record<string, number>,
    revenueHistory: {} as Record<string, Record<string, number>>,
    world, player: { x: -7, z: -6, direction: 0, placeId: 'nest' },
    ...createEconomy(world), market: createMarket(), work: createWorkState(), store: createStore('player'),
    shop: createShopState(), relationships: createRelationshipState(),
    encounters: createEncounterState(), matchmaking: createMatchmakingState(),
    dialogue: createDialogueState(), bonds: createBonds(), ripple: createRippleState(), relationMode: 'bonds' as 'legacy' | 'bonds', messenger: createMessengerState(), tycoon: emptyTycoon() };
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
    // Missing hurt means no pending incident in older saves.
    if (bond.hurt !== undefined) {
      checkShape(bond.hurt, { id: '', trust: 0, comfort: 0, resolved: false });
      require(id(bond.hurt.id) && [bond.hurt.trust, bond.hurt.comfort].every(n => n >= -100 && n <= 100));
    }
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
export function createSession(storage: Storage, npcSeed?: number, systems: readonly TycoonSystem<any>[] = tycoonSystems) {
  let state = freshState(npcSeed), lastSaved = 0, damaged: string | null = null, tycoonReady = false;
  const ctxFor = (t: TycoonState, people: readonly Npc[], time = gameTime(state.world.clock)): TycoonCtx => ({
    world: state.world, book: state.book, leases: state.leases, purses: state.purses, residents: people,
    npcSeed: state.npcSeed, player: state.player, time, systems: t.systems,
    placeOf: id => { const n = people.find(p => p.id === id); return n ? staffPlace(n, time) : state.world.people[id]?.placeId ?? ''; },
    roll: (system, entity, index) => tycoonRoll(state.npcSeed, system, entity, index),
    settle: (batchId, legs) => tycoonSettle(state.world.ledger, batchId, legs, time), nextId: kind => tycoonNextId(t, kind) });
  // v2+ saves replace the whole state, so only seed the fresh one when it is kept (C092: load cost).
  const unseeded = state, seed = () => supplyDay(state, addResidents(state, true, true));
  let loadResult: SaveResult = { ok: true };
  const backup = () => {
    if (damaged === null) return;
    let key = `${SESSION_KEY}.backup`, suffix = 0;
    while (storage.getItem(key) !== null) key = `${SESSION_KEY}.backup.${++suffix}`;
    storage.setItem(key, damaged); damaged = null;
  };
  try {
    const raw = storage.getItem(SESSION_KEY);
    if (raw === null) seed();
    else {
      try {
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1) {
          seed();
          state.world = restoreWorld(raw);
          state.player.placeId = state.world.people.player?.placeId ?? state.player.placeId;
          state.market.day = gameTime(state.world.clock).day;
        } else if ([2, 3, 4, 5, 6].includes(parsed?.version)) state = parsed.state;
        else throw Error('Unsupported session version');
        state.npcSeed = parsed.version === 1 ? 0 : state.npcSeed ?? 0;
        if (parsed.version < 3) Object.assign(state, { dialogue: createDialogueState(), bonds: createBonds(),
          ripple: createRippleState(), relationMode: 'legacy' });
        if (parsed.version < 4) Object.assign(state, createEconomy(state.world));
        if (parsed.version < 5) state.populationEconomy = false;
        state.leases ??= [];
        state.revenueHistory ??= {};
        state.reputation ??= { player: 0 };
        state.messenger ??= createMessengerState(); // saves before the messenger (C076)
        // Generated identities are omitted from saves; wallets and contracts are retained.
        if (parsed.version >= 5 && generate(state.npcSeed, 50).some(n =>
          !state.purses[n.id] || !Object.hasOwn(state.world.ledger.balances, n.id))) throw Error('Missing resident wallet');
        const loaded = addResidents(state);
        state.market.hints ??= [];
        if (parsed.version < 6) state.tycoon = emptyTycoon(); // v5 and older open with an empty container.
        checkShape(state, { ...freshState(), world: createWorld() });
        if (Object.values(state.reputation).some(n => !Number.isFinite(n) || n < -100 || n > 100))
          throw Error('Invalid reputation');
        if (parsed.version < 3) state.bonds = seedLegacy(state.world, state.encounters);
        checkSocial(state);
        if (state.economyMinute !== Math.floor(state.world.clock.totalMinutes) ||
            state.settledDay !== state.market.day - 1) throw Error('Invalid economic cursor');
        const history = state.world.ledger.history;
        if (history !== undefined) {
          checkShape(history, { ids: [], days: {} });
          if (!history.ids.every(id => typeof id === 'string' && id.length > 0) ||
              new Set(history.ids).size !== history.ids.length) throw Error('Invalid retired IDs');
          if (history.retired !== undefined) {
            checkShape(history.retired, {});
            for (const [day, group] of Object.entries(history.retired)) {
              if (!Number.isSafeInteger(Number(day)) || Number(day) < 1) throw Error('Invalid retired day');
              checkShape(group, {});
              for (const ids of Object.values(group)) if (!Array.isArray(ids) ||
                !ids.every(id => typeof id === 'string')) throw Error('Invalid grouped IDs');
            }
          }
          for (const [day, accounts] of Object.entries(history.days)) {
            if (!Number.isSafeInteger(Number(day)) || Number(day) < 1) throw Error('Invalid history day');
            checkShape(accounts, {});
            for (const totals of Object.values(accounts)) if (!Array.isArray(totals) || (totals.length < 2 || totals.length > 4) ||
              !totals.every(n => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0)) throw Error('Invalid cashflow');
          }
        }
        for (const days of Object.values(state.revenueHistory)) {
          checkShape(days, {});
          if (Object.entries(days).some(([d, n]) => !Number.isSafeInteger(Number(d)) || Number(d) < 1 ||
              !Number.isSafeInteger(n) || n < 0)) throw Error('Invalid revenue history');
        }
        for (const [id, purse] of Object.entries(state.purses)) {
          if (purse.personId !== id || !personAccount(state.world.people, state.world.ledger, id)) throw Error('Invalid purse');
          funds(state.world.ledger, purse);
        }
        const template = createEconomy(createWorld());
        checkShape(state.book, template.book);
        for (const [index, l] of state.leases.entries()) {
          const unit = storefronts.find(s => s.id === l.storefrontId), b = state.book.businesses.find(b => b.id === l.businessId);
          checkShape(l, { id: '', storefrontId: '', rentedDay: 0, ended: false, arrears: 0, rentDue: [], reports: [], orders: [] });
          if (l.id !== `lease:${index}` || !unit || !Number.isSafeInteger(l.rentedDay) || l.rentedDay < 1 ||
              l.businessId !== null && (!b || b.ownerId !== 'player' || b.placeId !== unit.placeId || l.ended !== (b.closedAt !== null)) ||
              state.world.ledger.balances[`${l.id}:deposit`] !== (l.ended ? 0 : unit.deposit) ||
              !Number.isSafeInteger(l.arrears) || l.arrears < 0 || l.reports.length > 7 ||
              !l.rentDue.every(d => Number.isSafeInteger(d) && d >= l.rentedDay && d <= state.settledDay)) throw Error('Invalid lease');
          for (const [i, o] of l.orders.entries()) {
            checkShape(o, { id: '', itemId: '', quantity: 0, arrival: 0, delivered: false });
            if (o.id !== `${l.id}:order:${i}` || !b?.store.stock.some(s => s.itemId === o.itemId) ||
                !Number.isSafeInteger(o.quantity) || o.quantity < 1 || !Number.isSafeInteger(o.arrival) || o.arrival < 1440)
              throw Error('Invalid stock order');
          }
        }
        if (state.leases.filter(l => !l.ended).length > 1) throw Error('Multiple active leases');
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
        state.tycoon = restoreTycoon(state.tycoon, systems, t => ctxFor(t, loaded)); tycoonReady = true;
      } catch (error) { tycoonReady = false; state = freshState(npcSeed); supplyDay(state, addResidents(state, true, true)); damaged = raw; loadResult = { ok: false, error }; backup(); }
    }
  } catch (error) { if (state === unseeded) seed(); loadResult = { ok: false, error }; }
  const residents = addResidents(state);
  const ctx = (t = state.tycoon, time?: GameTime) => ctxFor(t, residents, time);
  if (!tycoonReady) state.tycoon = createTycoon(systems, ctx);
  // C095 demand hooks, player's shop only (see TycoonSystem.visitBonus / onShopEvent).
  const visitBonus = (v: { npcId: string; businessId: string; hour: number }) =>
    Math.min(40, systems.reduce((n, sys) => n + (sys.visitBonus?.(ctx(), state.tycoon.systems[sys.id], v) ?? 0), 0));
  const shopEvent = (e: ShopEvent) => { for (const sys of systems) sys.onShopEvent?.(ctx(), state.tycoon.systems[sys.id], e); };
  for (const n of residents) state.world.people[n.id] =
    { id: n.id, name: n.name, role: 'npc', placeId: staffPlace(n, gameTime(state.world.clock)) };
  lastSaved = state.world.clock.totalMinutes;
  const saveNow = (): SaveResult => {
    try {
      backup(); // Never overwrite a damaged save until its backup succeeds.
      if (state.world.people.player) state.world.people.player.placeId = state.player.placeId;
      const people = Object.fromEntries(Object.entries(state.world.people).filter(([id]) => !id.startsWith('generated-')));
      // An empty tycoon container reads back identically from v5, so older builds can still open it.
      const version = state.tycoon.seq || Object.keys(state.tycoon.systems).length ? 6 : 5;
      storage.setItem(SESSION_KEY, JSON.stringify({ version, state: { ...state, world: { ...state.world, people } } }));
      lastSaved = state.world.clock.totalMinutes;
      return { ok: true };
    } catch (error) { return { ok: false, error }; }
  };
  const activeLease = () => {
    const lease = state.leases.find(l => !l.ended);
    if (!lease) throw Error('No active lease');
    return lease;
  };
  const playerShop = () => {
    const b = state.book.businesses.find(b => b.id === activeLease().businessId && b.closedAt === null);
    if (!b) throw Error('Shop not opened');
    return b;
  };
  const shops = {
    rentStore(storefrontId: string) {
      const lease = rentStorefront(state.leases, state.world.ledger, storefrontId, gameTime(state.world.clock));
      saveNow(); return lease;
    },
    terminateStore() { endLease(activeLease(), state.book, state.world.ledger, gameTime(state.world.clock)); saveNow(); },
    openShop(kind: ShopKind) {
      const lease = activeLease(), unit = storefronts.find(s => s.id === lease.storefrontId)!;
      if (!Object.hasOwn(shopKinds, kind) || !(unit.kinds as readonly string[]).includes(kind) || lease.businessId) throw Error('Invalid shop kind');
      const b = openBusiness(state.book, state.world.people, state.world.ledger, `shop:${lease.id}`, 'player',
        unit.placeId, unit.capacity, shopStock(kind), gameTime(state.world.clock));
      lease.businessId = b.id; saveNow(); return b;
    },
    orderStock(producerId: string, itemId: string, quantity: number) {
      const b = playerShop(), lease = activeLease(), now = gameTime(state.world.clock);
      const producer = residents.find(n => n.id === producerId), item = items.find(i => i.id === itemId);
      if (!producer || !item) throw Error('Unknown supplier or item');
      const stock = b.store.stock.find(s => s.itemId === itemId);
      if (!Number.isSafeInteger((stock?.backroom ?? 0) + (stock?.displayed ?? 0) + quantity +
          lease.orders.filter(o => !o.delivered && o.itemId === itemId).reduce((n, o) => n + o.quantity, 0))) throw Error('Stock overflow');
      const id = `${lease.id}:order:${lease.orders.length}`;
      const result = procure(state.book, state.world.people, state.world.ledger, b.id, producer, itemId,
        quantity, Math.max(1, Math.floor(item.price / 4)), id, now);
      if (result.ok && !result.duplicate) {
        b.store.stock.find(s => s.itemId === itemId)!.backroom -= quantity;
        lease.orders.push({ id, itemId, quantity, arrival: minuteOf(now) + 1440, delivered: false }); saveNow();
      }
      return result;
    },
    setShopPrice(itemId: string, price: number) { setPrice(playerShop().store, itemId, price); saveNow(); },
    offerJob(npcId: string, hourlyWage: number) {
      const b = playerShop(), now = gameTime(state.world.clock), npc = residents.find(n => n.id === npcId);
      if (!npc) throw Error('Unknown resident');
      const old = state.book.employment.find(e => e.actorId === npcId && e.leftAt === null);
      const reason = jobOffer(readBond(state.bonds, npcId, 'player'), hourlyWage, old?.job.hourlyWage ?? 3,
        state.book.businesses.some(b => b.ownerId === npcId && b.closedAt === null));
      if (reason !== 'job.accept') return { accepted: false, reason };
      if (old?.businessId === b.id || state.book.employment.filter(e => e.businessId === b.id && e.leftAt === null).length >= b.capacity)
        return { accepted: false, reason: 'job.refuse.capacity' };
      if (old) old.leftAt = minuteOf(now);
      hire(state.book, state.world.people, state.world.ledger, b.id, npcId, { id: `${b.id}:staff:${state.book.employment.length}`,
        name: npc.job, placeId: b.placeId, employerId: 'player', fromMinute: 540, toMinute: 1020, durationMinutes: 480, hourlyWage }, now);
      saveNow(); return { accepted: true, reason };
    },
    fireEmployee(npcId: string) {
      const b = playerShop(), now = gameTime(state.world.clock);
      const e = state.book.employment.find(e => e.actorId === npcId && e.businessId === b.id && e.leftAt === null);
      if (!e) throw Error('Not employed');
      e.leftAt = minuteOf(now);
      applyBondEvent(state.bonds, `fire:${e.job.id}`, now, [{ fromId: npcId, toId: 'player', delta: { trust: -10, respect: -5 } }]); saveNow();
    },
    shopReport() { return state.leases.map(l => ({ leaseId: l.id, warning: l.warning, arrears: l.arrears, reports: l.reports })); },
  };
  function staffPlace(npc: typeof residents[number], now: ReturnType<typeof gameTime>) {
    const e = state.book.employment.find(e => e.actorId === npc.id && e.leftAt === null && e.job.employerId === 'player');
    if (e && now.hour * 60 + now.minute >= e.job.fromMinute && now.hour * 60 + now.minute < e.job.toMinute) return e.job.placeId;
    // One shopping stop during today's outing; actual NPC placement and purchases share this route.
    // Existing NPC-only saves keep their schedules until a new storefront opens.
    if (state.leases.some(l => !l.ended && l.businessId)) {
      const slots = npc.schedule[(now.day - 1) % 7], homes = ['nest', 'quiet', 'high'];
      const outing = slots.find((s, i) => !homes.includes(s.placeId) && s.fromMinute < 1020 &&
        (slots[i + 1]?.fromMinute ?? 1440) > 540);
      const first = Math.max(9, Math.ceil((outing?.fromMinute ?? 1440) / 60));
      const last = Math.min(17, Math.ceil((slots.find(s => s.fromMinute > (outing?.fromMinute ?? 1440) && homes.includes(s.placeId))?.fromMinute ?? 1020) / 60));
      if (last > first && now.hour === first + choice(state.npcSeed, `trip:${now.day}:${npc.id}`) % (last - first) &&
          !state.work.shifts.some(s => s.actorId === npc.id && s.startedAt <= minuteOf(now) && s.endsAt > minuteOf(now))) {
        const shops = [...new Set(storefronts.filter(unit => state.book.businesses.some(b => b.closedAt === null && b.placeId === unit.placeId)).map(unit => unit.placeId))];
        return shops[choice(state.npcSeed, `stop:${now.day}:${npc.id}`) % shops.length];
      }
    }
    return whereIs(npc, now);
  };
  const settleShops = (day: number) => {
    const now = { day, hour: 23, minute: 59 }, { world, book } = state;
    for (const lease of state.leases) {
      const unit = storefronts.find(s => s.id === lease.storefrontId)!, b = book.businesses.find(b => b.id === lease.businessId);
      if (!lease.ended) lease.rentDue.push(day);
      lease.rentDue = lease.rentDue.filter(d => !payPerson(world.people, world.ledger, { id: `${lease.id}:rent:${d}`,
        from: 'player', to: unit.landlordId, amount: unit.dailyRent, time: now, reason: `Rent: ${lease.id}` }).ok);
      const shifts = state.work.shifts.filter(s => s.employerId === 'player' && s.endsAt <= minuteOf(now) &&
        book.employment.some(e => e.businessId === b?.id && e.job.id === s.jobId));
      for (const shift of shifts) if (!shift.paid) payCompletedShift(book, world.people, world.ledger, b!.id, shift, now);
      const unpaid = shifts.some(s => !s.paid) || lease.rentDue.length > 0;
      lease.arrears = unpaid ? lease.arrears + 1 : 0;
      lease.warning = unpaid ? 'shop.unpaid' : null;
      if (!lease.ended && lease.arrears >= 3) {
        endLease(lease, book, world.ledger, now); lease.warning = 'shop.closed.arrears';
      }
      const tx = world.ledger.transactions.filter(t => t.from === 'player' && t.time.day === day);
      const sum = (predicate: (t: typeof tx[number]) => boolean) => tx.filter(predicate).reduce((n, t) => n + t.amount, 0);
      const cost = sum(t => t.reason.startsWith(`Procurement: ${b?.id}:`)), rent = sum(t => t.reason === `Rent: ${lease.id}`);
      const wages = sum(t => shifts.some(s => s.id === t.id));
      const summary = dailySummary(b?.store ?? createStore('player', []), day);
      lease.reports.push({ ...summary, cost, rent, wages, net: summary.revenue - cost - rent - wages, reputation: state.reputation.player });
      lease.reports = lease.reports.slice(-7);
    }
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
    const time = gameTime(state.world.clock), placeId = staffPlace(npc, time);
    const atWork = Object.entries({ office: ['빛씨 조율사', '빛고리 조율실 수석 조율사', '밤결 기록사'],
      cafe: ['잔향 차 배합사'], shop: ['공유물 순환지기'], park: ['떠오름 뜰 돌봄사'] })
      .some(([place, jobs]) => place === placeId && jobs.includes(npc.job)) || state.book.employment.some(e =>
        e.actorId === npcId && e.leftAt === null && e.job.employerId === 'player' && time.hour >= 9 && time.hour < 17);
    return { market: state.player.placeId === placeId ? state.market : undefined, actorId: 'player', npc, time, value: state.world.relationships.player?.[npcId] ?? 0,
      scene: { placeId, atWork, peopleCount: residents.filter(n => staffPlace(n, time) === placeId).length
        + Number(state.player.placeId === placeId),
      bond: state.relationMode === 'bonds' ? readBond(state.bonds, npcId, 'player') : undefined } };
  };
  const publish = (id: string, npcId: string, topic: string, kind: SocialEvent['kind']) => {
    seedAcquaintances();
    const { world } = state, time = gameTime(world.clock);
    world.people.player.placeId = state.player.placeId;
    for (const n of residents) world.people[n.id].placeId = staffPlace(n, time);
    const event = { id, actorId: 'player', targetId: npcId, time, placeId: state.player.placeId, topic, kind };
    for (const n of residents) deliverRipple(state.ripple, state.bonds, world, state.dialogue, event, n.id, time);
  };
  const completeShared = (event: SharedEvent, delta: { trust: number; respect?: number; comfort: number }) => {
    if (state.relationMode !== 'bonds') return false;
    const participants = event.participants.filter(id => id !== 'player');
    if (!applyBondEvent(state.bonds, event.id, event.time, participants.map(fromId =>
      ({ fromId, toId: 'player', delta, met: true })))) return false;
    for (const id of participants) rememberSharedEvent(state.dialogue.memories[id] ??= createMemoryState(id), event);
    return true;
  };
  const requirePresent = (npcId: string) => {
    const { npc, time } = context(npcId);
    if (staffPlace(npc, time) !== state.player.placeId) throw Error('지금 여기 없어요');
  };
  const social = {
    availableCompanions() {
      const time = gameTime(state.world.clock), minute = time.hour * 60 + time.minute;
      return companionEvents.filter(event => state.relationMode === 'bonds'
        && minute >= event.fromMinute && minute < event.untilMinute && state.player.placeId === event.placeId
        && staffPlace(residents.find(n => n.id === event.npcId)!, time) === event.placeId
        && !state.dialogue.memories[event.npcId]?.entries.some(m =>
          m.sourceEventId === `companion:${event.id}:${time.day}`));
    },
    joinCompanion(eventId: string) {
      const event = social.availableCompanions().find(event => event.id === eventId);
      if (!event) return false;
      const time = gameTime(state.world.clock);
      return completeShared({ id: `companion:${event.id}:${time.day}`, actorId: 'player',
        participants: ['player', event.npcId], kind: 'shared-work', time, status: 'completed',
        placeId: event.placeId, placeName: state.world.places[event.placeId].name,
        activityName: event.activityName }, { trust: 3, respect: 2, comfort: 3 });
    },
    stageFor(npcId: string) {
      const ctx = context(npcId);
      if (state.relationMode === 'bonds') return stageOf(state.bonds, npcId, 'player', state.dialogue);
      return isDating(state.dialogue, 'player', npcId) ? '연인 첫 단계'
        : relationshipStage(Math.min(ctx.value, 89));
    },
    npcWantsDatingFor(npcId: string) {
      const ctx = context(npcId);
      return state.relationMode === 'legacy' ? ctx.value >= 90 : readBond(state.bonds, npcId, 'player').affection >= 30;
    },
    canConfessFor(npcId: string) {
      const ctx = context(npcId);
      return state.relationMode === 'legacy' ? ctx.value >= 60 : canStartDating(readBond(state.bonds, 'player', npcId),
        readBond(state.bonds, npcId, 'player'), { playerWantsDating: true, npcWantsDating: social.npcWantsDatingFor(npcId) });
    },
    setFeeling(npcId: string, feeling: 'friend' | 'crush' | 'love', id = `feeling:${JSON.stringify([npcId, state.bonds.applied.length])}`) {
      context(npcId);
      if (state.relationMode !== 'bonds' || state.bonds.applied.includes(id)) return false;
      if (!id || !['friend', 'crush', 'love'].includes(feeling)) throw Error('Invalid feeling');
      const love = feeling === 'love', previous = readBond(state.bonds, 'player', npcId);
      state.bonds.edges[edgeKey('player', npcId)] = { ...previous, affection: love ? 40 : 30,
        trust: love ? 25 : 15, respect: 0, comfort: love ? 20 : 10, romance: love ? 60 : feeling === 'crush' ? 40 : 0,
        met: previous.met || readBond(state.bonds, npcId, 'player').met };
      state.bonds.applied.push(id); return true;
    },
    expressFeelings(npcId: string) {
      requirePresent(npcId);
      const { time } = context(npcId), bond = readBond(state.bonds, npcId, 'player');
      return state.relationMode === 'bonds' && applyBondEvent(state.bonds, `feelings:${JSON.stringify([npcId, time.day])}`, time,
        [{ fromId: npcId, toId: 'player', delta: bond.affection >= 40 && bond.comfort >= 20 ? { romance: 6 } : { comfort: -3 } }]);
    },
    inviteHomeTea(id: string, npcId: string) {
      requirePresent(npcId);
      const { npc, time } = context(npcId);
      if (state.relationMode !== 'bonds' || state.player.placeId !== 'nest' || staffPlace(npc, time) !== 'nest') return false;
      const event = inviteHomeTea(state.shop, state.world, 'player', npc, id, time, state.bonds);
      return !!event && completeShared({ ...event, status: 'completed' }, { comfort: 3, trust: 2 });
    },
    buildDialogue(npcId: string) {
      const result = buildDialogue(state.dialogue, context(npcId));
      result.stage = social.stageFor(npcId);
      const names = Object.fromEntries(Object.values(state.world.people).map(p => [p.id, p.name]));
      const notice = noticeLine(npcId, state.ripple, gameTime(state.world.clock), names);
      return { ...result, line: notice ? `${notice} ${result.line}` : result.line };
    },
    apologize(npcId: string) {
      requirePresent(npcId);
      const ctx = context(npcId), accepted = state.relationMode === 'bonds'
        && reconcileBond(state.bonds, npcId, 'player', ctx.time);
      return { accepted, line: conflictLine(context(npcId)) ?? '사과할 일은 없어요.' };
    },
    talk(id: string, npcId: string, choice: DialogueChoice) {
      requirePresent(npcId);
      if (state.relationMode === 'bonds' && state.bonds.applied.includes(id)) throw Error('Duplicate bond event');
      const result = talk(state.world, state.relationships, state.dialogue, id, context(npcId), choice);
      if (state.relationMode === 'bonds') applyBondEvent(state.bonds, id, result.entry.time, [reactionEffect(result.entry)]);
      return result;
    },
    giveGift(id: string, npcId: string, itemId: string) {
      requirePresent(npcId);
      if (state.relationMode === 'bonds' && state.bonds.applied.includes(id)) throw Error('Duplicate bond event');
      if (!id || state.dialogue.memories[npcId]?.entries.some(m => m.id === id)) throw Error('Invalid or duplicate gift event');
      const ctx = context(npcId), entry = giveGift(state.shop, state.world, state.relationships, 'player', ctx.npc, itemId, ctx.time);
      let line = recordDialogue(state.dialogue, id, ctx.npc, entry, ctx);
      if (state.relationMode === 'bonds') applyBondEvent(state.bonds, id, entry.time, [reactionEffect(entry)]);
      if (state.relationMode === 'bonds' && !ctx.npc.dislikes.includes(entry.choice.topic)
        && ctx.npc.likes.includes(entry.choice.topic) && reconcileBond(state.bonds, npcId, 'player', ctx.time))
        line = conflictLine(context(npcId))!;
      publish(id, npcId, entry.choice.topic, entry.change < 0 ? 'hurt' : 'help'); return { entry, line };
    },
    confess(id: string, npcId: string, consent: Consent) {
      requirePresent(npcId);
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
    sendMessage(id: string, npcId: string, kind: MessageKind) {
      const { npc, time } = context(npcId);
      return send(state.messenger, npc, kind, social.stageFor(npcId), time, id);
    },
  };
  const playerLife = () => state.shop.residents.player ??= { inventory: {}, energy: 50,
    appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
  const startWork = (jobId: string) => {
    if (playerLife().energy < 10) return { ok: false as const, error: '활력이 부족해요 (10 이상 필요)' };
    try { return { ok: true as const, shift: beginWork(state.work, 'player', jobId,
      state.player.placeId, gameTime(state.world.clock)) }; }
    catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : String(error) }; }
  };
  const resolveMatches = (now: ReturnType<typeof gameTime>) => {
    for (const appointment of state.matchmaking.appointments) {
      if (!['scheduled', 'offered'].includes(appointment.status) || minuteOf(appointment.time) > minuteOf(now)) continue;
      const npc = residents.find(n => n.id === appointment.npcId);
      if (npc && resolveMatch(appointment, state.encounters, npc, now,
        { playerPlaceId: state.player.placeId, npcPlaceId: staffPlace(npc, now) }) === 'met') {
        applyBondEvent(state.bonds, `match-met:${appointment.id}`, now, [
          { fromId: appointment.actorId, toId: npc.id, delta: {}, met: true },
          { fromId: npc.id, toId: appointment.actorId, delta: state.relationMode === 'bonds' ? { trust: 3 } : {}, met: true },
          ...(state.relationMode === 'bonds' ? [{ fromId: appointment.introducerId, toId: appointment.actorId, delta: { trust: 3 } }] : []),
        ]);
      }
      if (appointment.status === 'no-show' && appointment.noShowBy.includes(appointment.actorId))
        applyBondEvent(state.bonds, `match-no-show:${appointment.id}`, now, noShowEffects(appointment));
    }
  };
  // Replies land when their minute arrives: chat warms the bond, a friend's yes becomes a real appointment.
  const deliverMessages = (now: ReturnType<typeof gameTime>) => {
    for (const reply of due(state.messenger, minuteOf(now))) {
      const npc = residents.find(n => n.id === reply.npcId)!;
      const close = state.relationMode === 'bonds' ? friendly(readBond(state.bonds, npc.id, 'player'))
        : (state.world.relationships.player?.[npc.id] ?? 0) >= 30;
      const slot = reply.kind === 'meet' && close && !state.matchmaking.appointments.some(a =>
        ['scheduled', 'offered'].includes(a.status)) ? meetSlot(npc, minuteOf(now)) : undefined;
      if (slot) state.matchmaking.appointments.push({ id: `meet:${reply.id}`, actorId: 'player', introducerId: npc.id,
        npcId: npc.id, ...slot, impression: { name: npc.name, appearance: {}, keywords: [...npc.traits], note: '' },
        playerInterest: 2, npcInterest: 2, status: 'scheduled', noShowBy: [] });
      if (reply.kind !== 'meet') applyBondEvent(state.bonds, reply.id, now, [{ fromId: npc.id, toId: 'player',
        delta: reply.kind === 'hello' ? { comfort: 2 } : { affection: 2, comfort: 1 } }]);
      reply.text = replyLine(npc, reply, slot); reply.delivered = true;
    }
  };
  const tick = (realSeconds: number): SaveResult | undefined => {
    const before = gameTime(state.world.clock);
    const days = advanceClock(state.world.clock, realSeconds);
    const target = state.world.clock.totalMinutes, { world, book, purses } = state;
    resolveMatches(before);
    for (let minute = state.economyMinute + 1; minute <= Math.floor(target); minute++) {
      world.clock.totalMinutes = minute;
      const now = gameTime(world.clock);
      const life = playerLife(), hour = Math.floor((minute - 1) % 1440 / 60);
      const working = state.work.shifts.some(s => s.actorId === 'player' && s.startedAt < minute && s.endsAt >= minute);
      const resting = hour >= 22 || hour < 6 || ['nest', 'quiet', 'high'].includes(state.player.placeId);
      life.energy = Math.max(0, Math.min(100, life.energy + ((resting && !working ? 3 : -1) - (working ? 5 : 0)) / 60));
      const payWages = () => {
        for (const shift of state.work.shifts) if (!shift.paid && shift.endsAt <= minute && shift.employerId !== 'player') {
          shift.employerId = personalEmployer[shift.employerId] ?? shift.employerId;
          if (state.relationMode === 'bonds' && shift.actorId === 'player' && shift.endsAt === minute) {
            const job = jobs.find(j => j.id === shift.jobId)!;
            const coworkers = state.work.shifts.filter(s => s.actorId !== 'player' && s.startedAt < shift.endsAt && s.endsAt > shift.startedAt
              && (jobs.find(j => j.id === s.jobId) ?? book.employment.find(e => e.actorId === s.actorId && e.job.id === s.jobId)?.job)?.placeId === job.placeId);
            const participants = [...new Set(['player', personalEmployer[shift.employerId] ?? shift.employerId, ...coworkers.map(s => s.actorId)])];
            completeShared({ id: `shared:${shift.id}`, actorId: 'player', participants, kind: 'shared-work', time: now,
              placeId: job.placeId, placeName: world.places[job.placeId].name, activityName: job.name, status: 'completed' },
            { trust: 3, respect: 2, comfort: 2 });
          }
          const employment = book.employment.find(e => e.actorId === shift.actorId && e.job.id === shift.jobId &&
            e.job.employerId === shift.employerId && e.hiredAt <= shift.startedAt && (e.leftAt === null || shift.startedAt < e.leftAt));
          // A broke employer's unrecorded wage can only fail without side effects; skip the per-minute retry (C092).
          if (employment) {
            if (!(world.ledger.balances[shift.employerId] < shift.wage) || isRecorded(world.ledger, shift.id))
              payCompletedShift(book, world.people, world.ledger, employment.businessId, shift, now);
          } else if (personAccount(world.people, world.ledger, shift.employerId) && personAccount(world.people, world.ledger, shift.actorId))
            finishWork(state.work, world.ledger, shift.id, now);
        }
      };
      for (const lease of state.leases) for (const order of lease.orders) if (!order.delivered && order.arrival <= minute) {
        const stock = book.businesses.find(b => b.id === lease.businessId)!.store.stock.find(s => s.itemId === order.itemId)!;
        stock.backroom += order.quantity; order.delivered = true;
      }
      payWages();
      if (minute % 60 === 0) {
        const retail = state.leases.some(l => !l.ended && l.businessId);
        const byPlace = new Map<string, typeof residents>();
        for (const npc of residents) {
          const place = staffPlace(npc, now), present = byPlace.get(place) ?? [];
          present.push(npc); byPlace.set(place, present); world.people[npc.id].placeId = place;
        }
        for (const b of book.businesses) if (b.closedAt === null && b.openedAt <= minute) {
          expireVisits(b.store, now);
          for (const npc of byPlace.get(b.placeId) ?? []) {
            const employment = book.employment.find(e => e.businessId === b.id && e.actorId === npc.id && e.leftAt === null);
            const slots = npc.schedule[(now.day - 1) % 7];
            const next = b.ownerId === 'player' ? 1440 : slots.find(slot => slot.fromMinute > minute % 1440)?.fromMinute ?? 1440;
            if (employment && minute % 1440 >= employment.job.fromMinute &&
                minute % 1440 + employment.job.durationMinutes <= Math.min(next, employment.job.toMinute) &&
                !state.work.shifts.some(s => s.actorId === npc.id && (!s.paid || Math.floor(s.startedAt / 1440) === now.day - 1)))
              startEmployeeShift(book, state.work, npc.id, b.placeId, now);
            if (npc.id === b.ownerId) continue;
            if (b.ownerId === 'player' && (employment || state.player.placeId !== b.placeId && !book.employment.some(e => e.businessId === b.id && e.leftAt === null &&
                state.work.shifts.some(s => s.jobId === e.job.id && s.startedAt <= minute && s.endsAt > minute)))) continue;
            const visitId = `${b.id}:${now.day}:${npc.id}${retail && b.ownerId !== 'player' ? `:${Math.floor(now.hour / 8)}` : ''}`;
            if (b.store.visits.some(v => v.id === visitId)) continue;
            if (b.ownerId === 'player') {
              // Opening deliveries precede trading; each counter serves one customer per hourly step.
              const orders = state.leases.find(l => l.businessId === b.id)!.orders;
              if (orders.length && orders.every(o => !o.delivered)) continue;
              if (b.store.events.filter(e => e.reason === 'purchased' && e.time.day === now.day && e.time.hour === now.hour).length >= b.capacity) continue;
            }
            const pat = b.ownerId === 'player' && systems.includes(patrons) ? state.tycoon.systems.patrons as PatronState : undefined;
            const persona = pat && personaOf(ctx(), pat, npc.id);
            let customer: Customer = { likes: npc.likes,
              priceTolerance: 1 + choice(state.npcSeed, `tolerance:${npc.id}`) % 5 / 10, patienceMinutes: 1 };
            // Personas shift tolerance only above the reference price: list prices never offend (C087 balance kept).
            if (persona) customer = { ...applyPersona(customer, persona), priceTolerance: Math.max(1, applyPersona(customer, persona).priceTolerance) };
            const preferred = state.relationMode === 'bonds' && state.populationEconomy;
            let need = preferred ? chooseWeatherNeed(customer, items.filter(item => b.store.stock.some(s => s.itemId === item.id)),
              choice(state.npcSeed, `need:${visitId}`) / 0x100000000, now.day, weatherFor(state.npcSeed, now.day)) : undefined;
            const cash = b.ownerId === 'player' ? funds(world.ledger, purses[npc.id]).spendable : 0;
            const wanted = b.ownerId === 'player' ? b.store.stock.find(s => s.itemId === need?.itemId) : undefined;
            if (b.ownerId === 'player' && need && wanted && wanted.price > cash && wanted.price <= need.maxPrice)
              need = chooseWeatherNeed(customer, items.filter(item => b.store.stock.some(s => s.itemId === item.id && s.price <= cash)),
                choice(state.npcSeed, `need:${visitId}`) / 0x100000000, now.day, weatherFor(state.npcSeed, now.day)) ?? need;
            const stock = preferred ? b.store.stock.find(s => s.itemId === need?.itemId) : b.store.stock[0];
            if (!stock || state.populationEconomy && choice(state.npcSeed, visitId) % 100 >= (retail ? retailDemand.visitChance : 45) +
                15 * demandWeight(stock.itemId, now.day) + (b.ownerId === 'player' ? visitBonus({ npcId: npc.id, businessId: b.id, hour: now.hour }) : 0)) continue;
            const event = { npcId: npc.id, businessId: b.id, itemId: stock.itemId, price: stock.price, count: 1 };
            if (pat && !park(ctx(), pat, npc.id, persona!)) { shopEvent({ ...event, result: 'parkingFull' }); continue; }
            if (need && stock.price > need.maxPrice) {
              // A haggler asks the owner in person; with nobody to ask it is a lost 'expensive' sale.
              if (persona && state.player.placeId === b.placeId && decideWithPersona(need, { itemId: stock.itemId, price: stock.price,
                  available: stock.displayed + stock.backroom }, cash, persona) === 'haggle') {
                shopEvent({ ...event, price: need.maxPrice, result: 'haggle' }); continue;
              }
              visitStore(b.store, world.ledger, visitId, npc.id, need, customer.patienceMinutes, now);
              if (pat) shopEvent({ ...event, result: b.store.events.at(-1)!.reason });
              continue;
            }
            if (funds(world.ledger, purses[npc.id]).spendable < stock.price ||
                dayCashflow(world.ledger, purses[npc.id], now.day).consumption + stock.price > (retail ? retailDemand.dailyBudget : 32)) continue;
            if (b.ownerId !== 'player' && stock.backroom + stock.displayed === 0) {
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
            let sale = checkoutBusiness(book, world.people, world.ledger, b.id, purses[npc.id], visit.id, now);
            // A big spender buys the basket while stock, the counter's hour and the day's budget last: one visit and checkout per item.
            for (let count = 1; sale.ok && !sale.duplicate; count++) {
              const life = state.shop.residents[npc.id] ??= { inventory: {}, energy: 50, appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
              life.inventory[stock.itemId] = (life.inventory[stock.itemId] ?? 0) + 1; useItem(state.shop, npc.id, stock.itemId);
              const more = `${visitId}:${count}`;
              if (persona !== 'bigSpender' || count >= personas.bigSpender.basket || stock.displayed + stock.backroom === 0 || b.capacity <=
                  b.store.events.filter(e => e.reason === 'purchased' && e.time.day === now.day && e.time.hour === now.hour).length ||
                  funds(world.ledger, purses[npc.id]).spendable < stock.price ||
                  dayCashflow(world.ledger, purses[npc.id], now.day).consumption + stock.price > retailDemand.dailyBudget) {
                if (pat) shopEvent({ ...event, count, result: 'purchased' });
                break;
              }
              restock(b.store, stock.itemId, 5);
              visitStore(b.store, world.ledger, more, npc.id, need ?? { itemId: stock.itemId, maxPrice: stock.price }, customer.patienceMinutes, now);
              sale = checkoutBusiness(book, world.people, world.ledger, b.id, purses[npc.id], more, now);
              if (!sale.ok) shopEvent({ ...event, count, result: 'purchased' });
            }
            if (pat && !sale.ok && b.store.events.at(-1)?.visitId === visit.id) shopEvent({ ...event, result: b.store.events.at(-1)!.reason });
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
        for (const store of [state.store, ...book.businesses.map(b => b.store)]) {
          const events = store.events.filter(e => e.time.day === now.day - 1);
          const complaints = events.filter(e => e.reason === 'missing' || e.reason === 'expensive').length;
          const sales = events.filter(e => e.reason === 'purchased').length;
          const owner = store.accountId;
          state.reputation[owner] = Math.max(-100, Math.min(100,
            (state.reputation[owner] ?? 0) + (complaints ? -2 * complaints : sales ? 1 : 0)));
        }
        for (const b of book.businesses) if (companies.some(c => c.npcId === b.ownerId)) recordNpcRevenue(state.market, b.ownerId, revenueChange(b, now.day - 1));
        settleShops(now.day - 1);
        advanceDay(state.market); state.settledDay = now.day - 1;
        runDay(state.tycoon, systems, t => ctx(t, { day: now.day - 1, hour: 23, minute: 59 }), now.day - 1);
        if (state.populationEconomy) {
          // Cash-funded production bonuses circulate surplus to poorer workers; contracts and arrears stay intact.
          if (book.businesses.some(b => b.ownerId === 'player' && b.closedAt === null)) for (const npc of [...residents].sort((a, b) =>
              world.ledger.balances[a.id] - world.ledger.balances[b.id])) {
            if (book.employment.some(e => e.actorId === npc.id && e.leftAt === null)) continue;
            const employer = book.businesses.find(b => b.ownerId !== 'player' && b.closedAt === null && b.ownerId !== npc.id &&
              b.store.stock.some(s => businessProducerJobs[s.itemId] === npc.job));
            const slots = npc.schedule[(now.day - 2) % 7];
            if (!employer || !slots.some((s, i) => s.placeId === employer.placeId &&
                (slots[i + 1]?.fromMinute ?? 1440) - s.fromMinute >= 480)) continue;
            if (world.ledger.balances[employer.ownerId] < retailDemand.employerReserve + retailDemand.productionBonus) continue;
            payPerson(world.people, world.ledger, { id: `production:${now.day - 1}:${npc.id}`, from: employer.ownerId,
              to: npc.id, amount: retailDemand.productionBonus, time: { day: now.day - 1, hour: 23, minute: 59 }, reason: `Wage: production-bonus:${employer.id}` });
          }
          supplyDay(state, residents);
        }
        const cutoff = minute - 14 * 1440;
        const beforeDay = now.day - 14;
        compactLedger(world.ledger, beforeDay);
        state.work.shifts = state.work.shifts.filter(s => !s.paid || s.endsAt >= cutoff);
        for (const [id, store] of [['player-store', state.store], ...book.businesses.map(b => [b.id, b.store] as const)] as const) {
          store.visits = store.visits.filter(v => v.status === 'waiting' || v.joinedMinute >= cutoff);
          const history = state.revenueHistory[id] ??= {};
          store.events = store.events.filter(e => {
            if (e.time.day >= beforeDay) return true;
            history[e.time.day] = (history[e.time.day] ?? 0) + e.amount;
            return false;
          });
        }
      }
      expireVisits(state.store, now);
      resolveMatches(now);
      runMinute(state.tycoon, systems, ctx, minute);
      state.economyMinute = minute;
    }
    state.world.clock.totalMinutes = target;
    const now = gameTime(state.world.clock);
    resolveMatches(now);
    deliverMessages(now);
    for (const npc of residents) if (state.world.people[npc.id]) state.world.people[npc.id].placeId = staffPlace(npc, now);
    if (state.world.people.player) state.world.people.player.placeId = state.player.placeId;
    if (days.length || state.world.clock.totalMinutes - lastSaved >= AUTOSAVE_MINUTES) return saveNow();
  };
  const tycoon = {
    ctx: () => ctx(),
    state: () => state.tycoon,
    /** Runs a player command against one system's state, then saves. */
    command<T, S = any>(systemId: string, fn: (ctx: TycoonCtx, s: S) => T): T {
      if (!systems.some(s => s.id === systemId)) throw Error('Unknown tycoon system');
      const result = fn(ctx(), state.tycoon.systems[systemId] as S); saveNow(); return result;
    },
  };
  return { state, loadResult, tick, saveNow, startWork, ...social, ...shops, tycoon };
}
