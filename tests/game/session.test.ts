import { expect, it } from 'vitest';
import { createSession, SESSION_KEY, AUTOSAVE_MINUTES } from '../../src/game/session';
import type { Storage } from '../../src/game/storage';
import { saveWorld } from '../../src/sim/save';
import { createWorld } from '../../src/sim/world';
import { advanceDay, applyEvent, recordNpcRevenue, trade } from '../../src/sim/market';
import { whereIs } from '../../src/sim/npc';
import { npcs } from '../../src/data/npcs';
import { gameTime } from '../../src/sim/clock';
import { generate } from '../../src/sim/npcgen';
import { applyBondEvent, edgeKey, emptyBond, readBond, canStartDating } from '../../src/sim/bonds';
import { createMemoryState, rememberSharedEvent } from '../../src/sim/memory';
import { buildDialogue } from '../../src/sim/dialogue';
import { hire, openBusiness, startEmployeeShift } from '../../src/sim/business';
import { jobs } from '../../src/data/jobs';
import { dailySummary, visitStore } from '../../src/sim/store';
import { useItem } from '../../src/sim/shop';
import { checkoutBusiness, producerJobs, revenueChange } from '../../src/sim/business';
import { createPurse, dayCashflow } from '../../src/sim/purse';
import { companies } from '../../src/data/companies';
import { compactLedger, transfer, type Transaction } from '../../src/sim/ledger';
function memory(): Storage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
}
it('C055: v2 confession uses legacy eligibility and consent, with dating recorded before the lover label', () => {
  const storage = memory(), initial = createSession(storage, 123);
  initial.state.world.relationships.player = { lise: 90 }; initial.saveNow();
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!); saved.version = 2;
  storage.setItem(SESSION_KEY, JSON.stringify(saved)); const session = createSession(storage), { state } = session;
  state.player.placeId = 'quiet';
  expect(state.relationMode).toBe('legacy'); expect(session.stageFor('lise')).toBe('호감');
  expect(readBond(state.bonds, 'lise', 'player').affection).toBe(0);
  for (const [score, eligible, willing] of [[59, false, false], [60, true, false], [89, true, false], [90, true, true]] as const) {
    state.world.relationships.player.lise = score;
    expect(session.canConfessFor('lise')).toBe(eligible); expect(session.npcWantsDatingFor('lise')).toBe(willing);
    expect(session.confess(`refuse:${score}`, 'lise', { playerWantsDating: false, npcWantsDating: willing }).accepted).toBe(false);
    if (score < 90) expect(session.confess(`low-score:${score}`, 'lise',
      { playerWantsDating: true, npcWantsDating: true }).accepted).toBe(false);
  }
  expect(session.confess('refuse-consent', 'lise', { playerWantsDating: true, npcWantsDating: false }).accepted).toBe(false);
  expect(session.confess('legacy-date', 'lise', { playerWantsDating: true,
    npcWantsDating: session.npcWantsDatingFor('lise') }).accepted).toBe(true);
  expect(session.stageFor('lise')).toBe('연인 첫 단계'); session.saveNow();
  expect(createSession(storage).stageFor('lise')).toBe('연인 첫 단계');
});
it.each([[false, false], [true, false], [false, true]])('C055: no-show applies once; skipped=%s, player present=%s', (skipped, present) => {
  const storage = memory(), session = createSession(storage, 123), { state } = session, npc = generate(123, 50)[0];
  const date: typeof state.matchmaking.appointments[number] = { id: 'missed-date', actorId: 'player', introducerId: 'aro',
    npcId: npc.id, placeId: 'cafe', time: { day: 1, hour: 12, minute: 0 },
    impression: { name: npc.name, appearance: npc.appearance, keywords: npc.traits, note: '' },
    playerInterest: 2, npcInterest: 2, status: 'scheduled', noShowBy: [] };
  state.matchmaking.appointments.push(date); session.tick(660);
  state.player.placeId = present ? 'cafe' : 'shop';
  if (present) date.npcId = 'lise'; // Lise stays at the office throughout this appointment.
  if (skipped) { expect(session.startWork('exchange-helper').ok).toBe(true); session.tick(120); }
  else for (let minute = 0; minute < 120; minute++) session.tick(1);
  expect(date.status).toBe('no-show'); expect(date.noShowBy.includes('player')).toBe(!present);
  expect(readBond(state.bonds, 'aro', 'player').trust).toBe(present ? 0 : -5);
  expect(readBond(state.bonds, date.npcId, 'player').trust).toBe(present ? 0 : -10);
  expect(state.bonds.applied.filter(id => id === 'match-no-show:missed-date')).toHaveLength(present ? 0 : 1);
  const bonds = structuredClone(state.bonds); session.tick(0); session.tick(1); session.saveNow();
  const next = createSession(storage); next.tick(1); expect(next.state.bonds).toEqual(bonds);
});
it('C055: crossing 06:00 rejects all five interactions without mutations; co-located talk and gift work', () => {
  const session = createSession(memory(), 123), { state } = session;
  state.player.placeId = 'quiet'; session.tick(359);
  state.shop.residents.player.inventory.bread = 2;
  const choice = session.buildDialogue('lise').choices[0];
  expect(session.talk('present-chat', 'lise', choice).entry.npcId).toBe('lise');
  expect(session.giveGift('present-gift', 'lise', 'bread').entry.npcId).toBe('lise'); session.tick(1);
  expect(state.world.people.lise.placeId).toBe('office'); const before = structuredClone(state);
  for (const action of [() => session.talk('absent-chat', 'lise', choice),
    () => session.giveGift('absent-gift', 'lise', 'bread'),
    () => session.confess('absent-date', 'lise', { playerWantsDating: true, npcWantsDating: true }),
    () => session.expressFeelings('lise'), () => session.inviteHomeTea('absent-tea', 'lise')]) {
    expect(action).toThrow('지금 여기 없어요'); expect(state).toEqual(before);
  }
});
it('C050: completed exchange arrears allow cafe work and remain payable later', () => {
  const session = createSession(memory(), 123), { state } = session;
  session.tick(1440 + 480);
  for (let day = 2; day <= 3; day++) {
    state.player.placeId = 'shop';
    for (let i = 0; i < 5; i++) { expect(session.startWork('exchange-helper').ok).toBe(true); session.tick(120); }
    if (day === 2) { state.player.placeId = 'nest'; session.tick(840); }
  }
  const arrears = state.work.shifts.find(s => s.actorId === 'player' && !s.paid)!;
  expect(arrears).toMatchObject({ wage: 80, paid: false }); expect(state.world.ledger.balances.sori).toBe(44);
  state.player.placeId = 'cafe'; expect(session.startWork('tea-helper').ok).toBe(true);
  expect(session.startWork('tea-helper').ok).toBe(false); expect(arrears.paid).toBe(false);
  transfer(state.world.ledger, { id: 'fund-arrears', from: 'player', to: 'sori', amount: 80,
    time: gameTime(state.world.clock), reason: 'Transfer' });
  session.tick(1); expect(arrears.paid).toBe(true);
});
it.each([[720, 0], [779.25, .5], [779.25, .75]])('C050: arrival %s, tick %s records both bonds without no-shows', (arrival, elapsed) => {
  const session = createSession(memory(), 123), { state } = session, npc = generate(123, 50)[0];
  const date: typeof state.matchmaking.appointments[number] = { id: 'date', actorId: 'player', introducerId: 'aro',
    npcId: 'generated-123-0', placeId: 'cafe', time: { day: 1, hour: 12, minute: 0 },
    impression: { name: npc.name, appearance: npc.appearance, keywords: npc.traits, note: '' },
    playerInterest: 2, npcInterest: 2, status: 'scheduled', noShowBy: [] };
  state.matchmaking.appointments.push(date);
  if (arrival === 720) { state.player.placeId = 'cafe'; session.tick(720); }
  else { session.tick(779.25); state.player.placeId = 'cafe'; session.tick(elapsed); }
  expect(date.status).toBe('met'); expect(date.noShowBy).toEqual([]);
  expect(state.encounters.met).toContainEqual({ actorId: 'player', npcId: npc.id, day: 1 });
  for (const [a, b] of [['player', npc.id], [npc.id, 'player']]) expect(readBond(state.bonds, a, b)).toEqual({ ...emptyBond(), met: true, trust: a === npc.id ? 3 : 0 });
  expect(readBond(state.bonds, 'aro', 'player').trust).toBe(3);
  expect(session.buildDialogue(npc.id).stage).toBe('아는 사이');
  const bonds = structuredClone(state.bonds); session.tick(.25); expect(date.status).toBe('met');
  expect(date.noShowBy).toEqual([]); expect(state.bonds).toEqual(bonds);
});
it('C050: retry-buy after 16 days leaves money and holdings unchanged', () => {
  const session = createSession(memory(), 123), { state } = session;
  const order = { id: 'retry-buy', account: 'player', companyId: 'tea', quantity: 1, side: 'buy' as const };
  const buy = () => trade(state.market, state.world.ledger, { ...order, time: gameTime(state.world.clock) }, 'aro');
  expect(buy()).toEqual({ ok: true, duplicate: false }); expect(state.world.ledger.balances.player).toBe(19);
  session.tick(16 * 1440); expect(state.world.ledger.transactions.some(t => t.id === order.id)).toBe(false);
  const before = structuredClone({ market: state.market, balances: state.world.ledger.balances });
  expect(buy()).toEqual({ ok: true, duplicate: true });
  expect({ market: state.market, balances: state.world.ledger.balances }).toEqual(before);
});
it('C050: retry-visit after 16 days leaves stock and daily revenue unchanged', () => {
  const session = createSession(memory(), 123), { state } = session, { world, book, purses } = state;
  const store = book.businesses.find(b => b.id === 'tea-counter')!.store;
  const buy = () => {
    const time = gameTime(world.clock);
    visitStore(store, world.ledger, 'retry-visit', 'player', { itemId: 'tea', maxPrice: 8 }, 1, time);
    return checkoutBusiness(book, world.people, world.ledger, 'tea-counter', purses.player, 'retry-visit', time);
  };
  expect(buy()).toEqual({ ok: true, duplicate: false }); expect(world.ledger.balances.player).toBe(92);
  session.tick(16 * 1440); expect(store.visits.some(v => v.id === 'retry-visit')).toBe(false);
  const before = structuredClone({ stock: store.stock, events: store.events, balances: world.ledger.balances });
  const revenue = dailySummary(store, 17).revenue;
  expect(buy()).toEqual({ ok: true, duplicate: true }); expect(buy()).toEqual({ ok: true, duplicate: true });
  expect({ stock: store.stock, events: store.events, balances: world.ledger.balances }).toEqual(before);
  expect(dailySummary(store, 17).revenue).toBe(revenue);
});
// Original C031 v4 fixture: keep regression assertions against its seven funded wallets and contracts.
function legacySession(storage: Storage) {
  const session = createSession(storage, 123), { state } = session, { world, book } = state;
  world.ledger.balances = Object.fromEntries(['player', ...npcs.map(n => n.id)].map(id => [id, id === 'player' ? 100 : 1000]));
  world.ledger.transactions = [];
  state.purses = Object.fromEntries(Object.keys(world.ledger.balances).map(id => [id, createPurse(world.people, world.ledger, id)]));
  book.businesses = book.businesses.slice(0, 1); book.businesses[0].store.stock[0].backroom = 300;
  book.employment = []; hire(book, world.people, world.ledger, 'tea-counter', 'iri', jobs[0], gameTime(world.clock));
  session.saveNow(); const saved = JSON.parse(storage.getItem(SESSION_KEY)!); saved.version = 4;
  storage.setItem(SESSION_KEY, JSON.stringify(saved)); return createSession(storage);
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
  const storage = memory(), session = legacySession(storage); expect(session.tick(AUTOSAVE_MINUTES - 1)).toBeUndefined();
  expect(session.tick(1)?.ok).toBe(true); applyEvent(session.state.market, { companyId: 'tea', size: .1, days: 2 });
  const market = structuredClone(session.state.market); for (const change of [0, 0, 1]) { recordNpcRevenue(market, 'nuel', change); advanceDay(market); }
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
  const storage = memory(), session = legacySession(storage); session.saveNow();
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!); saved.version = 4;
  for (const id of Object.keys(saved.state.purses).filter(id => id.startsWith('generated-'))) { delete saved.state.purses[id]; delete saved.state.world.ledger.balances[id]; }
  saved.state.npcSeed = 123;
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
it('round trips v4 memories, dating, bond receipts/budgets and ripple notices without replay', () => {
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
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!); expect(saved.version).toBe(6);
  expect(Object.keys(saved.state.world.people).some(id => id.startsWith('generated-'))).toBe(false);
  const next = createSession(storage); expect(next.loadResult.ok).toBe(true); expect(next.state).toEqual(state);
  expect(next.state.dialogue.memories.lise.entries[0].mentionedAt).toBe(1440);
  expect(buildDialogue(next.state.dialogue, ctx).line).not.toBe(recalled);
  expect(applyBondEvent(next.state.bonds, 'meal', time, effects)).toBe(false);
  applyBondEvent(next.state.bonds, 'other', time, effects); expect(readBond(next.state.bonds, 'lise', 'player').trust).toBe(10);
});
it.each([1, 2])('migrates v%i to legacy v4 while preserving directional scores and meetings', version => {
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
  expect(JSON.parse(storage.getItem(SESSION_KEY)!).version).toBe(6);
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

it('conserves all seven wallets for 30 days and produces identical split/reloaded ticks', () => {
  const storage = memory(), whole = legacySession(storage); whole.saveNow();
  const splitStorage = memory(); splitStorage.setItem(SESSION_KEY, storage.getItem(SESSION_KEY)!);
  let split = createSession(splitStorage);
  whole.tick(30 * 1440);
  for (let day = 0; day < 30; day++) {
    for (const step of [660.5, 239.5, 60, 480]) split.tick(step);
    expect(Object.values(split.state.world.ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
    split.saveNow(); split = createSession(splitStorage); expect(split.loadResult.ok).toBe(true);
  }
  expect(split.state).toEqual(whole.state); expect(whole.state.settledDay).toBe(30);
  const { balances, transactions } = whole.state.world.ledger;
  expect(Object.keys(balances).filter(id => balances[id] > 0).sort()).toEqual(['aro', 'iri', 'lise', 'nuel', 'player', 'sori', 'velo']);
  expect(transactions.length + whole.state.world.ledger.history!.ids.length +
    Object.values(whole.state.world.ledger.history!.retired ?? {}).flatMap(group => Object.values(group)).flat().length).toBeGreaterThan(30);
  expect(transactions.every(t => Object.hasOwn(balances, t.from) && Object.hasOwn(balances, t.to))).toBe(true);
  expect(whole.state.work.shifts.every(s => s.paid)).toBe(true);
});
it('migrates v3 once, preserving existing money, social state and the current-day cursor', () => {
  const storage = memory(), { state } = createSession(storage);
  state.world.clock.totalMinutes = 3000; state.market.day = 3; state.world.ledger.balances = { player: 77, cafe: 123 };
  const { purses: _p, book: _b, economyMinute: _m, settledDay: _d, ...v3 } = state;
  storage.setItem(SESSION_KEY, JSON.stringify({ version: 3, state: v3 }));
  const migrated = createSession(storage); expect(migrated.loadResult.ok).toBe(true);
  expect(migrated.state.world.ledger.balances).toMatchObject({ player: 77, nuel: 1123 });
  expect(migrated.state.settledDay).toBe(2); expect(migrated.state.economyMinute).toBe(3000);
  expect(migrated.state.relationMode).toBe('bonds'); migrated.saveNow();
  const restored = createSession(storage); expect(restored.state).toEqual(migrated.state);
  restored.tick(0); expect(restored.state).toEqual(migrated.state);
});
it('settles revenue once at midnight and applies growth to the next-day tea price', () => {
  const session = legacySession(memory()); session.tick(3 * 1440 - 1);
  const baseline = structuredClone(session.state.market); advanceDay(baseline);
  const expected = structuredClone(session.state.market); recordNpcRevenue(expected, 'nuel', 1); advanceDay(expected);
  session.tick(1); expect(session.state.market).toEqual(expected);
  expect(session.state.market.prices.tea).toBeGreaterThan(baseline.prices.tea);
  session.tick(0); expect(session.state.market).toEqual(expected);
});
it.each(['purse', 'cursor', 'business', 'employment', 'owner', 'wage', 'stock', 'visit', 'sale'])('backs up damaged v4 economic %s', kind => {
  const storage = memory(), session = createSession(storage); session.saveNow();
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!);
  if (kind === 'purse') saved.state.purses.player.reserve = -1;
  if (kind === 'cursor') saved.state.settledDay = 9;
  if (kind === 'business') saved.state.book.businesses = [null];
  if (kind === 'employment') saved.state.book.employment = [];
  if (kind === 'owner') saved.state.book.businesses[0].store.accountId = 'cafe';
  if (kind === 'wage') saved.state.book.employment[0].job.hourlyWage = -1;
  if (kind === 'visit') saved.state.book.businesses[0].store.visits = [null];
  if (kind === 'sale') saved.state.book.businesses[0].store.events = [null];
  if (kind === 'stock') saved.state.book.businesses[0].store.stock[0].backroom = -1;
  const raw = JSON.stringify(saved); storage.setItem(SESSION_KEY, raw);
  expect(createSession(storage).loadResult.ok).toBe(false); expect(storage.getItem(`${SESSION_KEY}.backup`)).toBe(raw);
});
it('balances 30 days of tea demand and pays a care worker without employing tuners', () => {
  const session = legacySession(memory()), { state } = session;
  expect(state.book.employment.map(e => e.actorId)).toEqual(['iri']);
  expect(npcs.find(n => n.id === 'iri')!.job).toContain('돌봄');
  for (let day = 0; day < 30; day++) {
    session.tick(1440); expect(state.world.ledger.balances.nuel).toBeGreaterThanOrEqual(1000);
    expect(Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
  }
  const revenue = Object.values(state.revenueHistory['tea-counter']).reduce((sum, n) => sum + n, 0) +
    state.book.businesses[0].store.events.reduce((sum, e) => sum + e.amount, 0);
  const wages = Object.values(state.world.ledger.history!.days).reduce((sum, day) => sum + (day.iri?.[0] ?? 0), 0) +
    state.world.ledger.transactions.filter(t => t.reason.startsWith('Wage: ')).reduce((sum, t) => sum + t.amount, 0);
  expect({ revenue, wages, owner: state.world.ledger.balances.nuel, employee: state.world.ledger.balances.iri })
    .toEqual({ revenue: 336, wages: 120, owner: 1216, employee: 1088 });
  expect(wages).toBeLessThanOrEqual(revenue); expect(state.work.shifts.every(s => s.paid)).toBe(true);
});
it('restores two businesses with different contracts and pays their respective owners', () => {
  const storage = memory(), session = legacySession(storage), { world, book } = session.state;
  openBusiness(book, world.people, world.ledger, 'shared-counter', 'sori', 'shop', 3, [], gameTime(world.clock));
  hire(book, world.people, world.ledger, 'shared-counter', 'velo', { ...jobs[1], durationMinutes: 60 }, gameTime(world.clock));
  session.tick(480); startEmployeeShift(book, session.state.work, 'velo', 'shop', gameTime(world.clock));
  session.saveNow(); const next = createSession(storage);
  expect(next.loadResult.ok).toBe(true); expect(next.state).toEqual(session.state);
  next.tick(60); expect(next.state.world.ledger.balances.sori).toBe(960); expect(next.state.world.ledger.balances.velo).toBe(1040);
  next.tick(3 * 1440); next.saveNow(); expect(createSession(storage).state).toEqual(next.state);
});
it('preserves the original v4 two-worker tea contracts and unfinished wages', () => {
  const storage = memory(), session = legacySession(storage), { world, book } = session.state;
  book.businesses[0].capacity = 2; book.employment = [];
  for (const id of ['velo', 'lise']) hire(book, world.people, world.ledger, 'tea-counter', id, jobs[0], gameTime(world.clock));
  session.tick(900); session.saveNow(); const next = createSession(storage);
  expect(next.loadResult.ok).toBe(true); expect(next.state).toEqual(session.state);
  next.tick(60); expect(next.state.world.ledger.balances.velo).toBe(1022);
  expect(next.state.work.shifts.every(s => s.paid)).toBe(true);
});
it.each(['future opening', 'unknown business', 'wrong employer', 'capacity', 'duplicate worker'])('rejects invalid generalized contracts: %s', kind => {
  const storage = memory(), session = createSession(storage), { book } = session.state;
  if (kind === 'future opening') book.businesses[0].openedAt = 1;
  if (kind === 'unknown business') book.employment[0].businessId = 'missing';
  if (kind === 'wrong employer') book.employment[0].job.employerId = 'aro';
  if (kind === 'capacity') book.businesses[0].capacity = 0;
  if (kind === 'duplicate worker') { book.businesses[0].capacity = 2; book.employment.push(structuredClone(book.employment[0])); }
  session.saveNow(); const raw = storage.getItem(SESSION_KEY);
  expect(createSession(storage).loadResult.ok).toBe(false); expect(storage.getItem(`${SESSION_KEY}.backup`)).toBe(raw);
});

it.each([0, 1, 123, 0xffffffff])('runs a conserved, funded 56-resident economy for 30 days: seed %i', seed => {
  const storage = memory(), session = createSession(storage, seed), { state } = session;
  const residents = [...npcs, ...generate(seed, 50)], { ledger } = state.world;
  expect(Object.keys(state.purses)).toHaveLength(57);
  expect(generate(seed, 50).every(n => ledger.balances[n.id] >= 20)).toBe(true);
  expect(ledger.transactions.filter(t => t.reason === 'Initial allocation')).toHaveLength(50);
  expect(state.book.businesses).toHaveLength(4);
  for (const b of state.book.businesses) {
    const producerJob = b.id === 'light-counter' ? '빛씨 조율사' : producerJobs[b.store.stock[0].itemId];
    expect(residents.find(n => n.id === b.ownerId)!.job).toBe(producerJob);
    const staff = state.book.employment.filter(e => e.businessId === b.id);
    expect(staff).toHaveLength(b.capacity);
    expect(staff.every(e => residents.find(n => n.id === e.actorId)!.job === producerJob)).toBe(true);
    expect(b.store.stock[0].backroom + b.store.stock[0].displayed).toBe(10);
  }
  const started = performance.now(), minima: Record<string, number> = {};
  const transactions = new Map<string, Transaction>(), events = state.book.businesses.map(() => new Map());
  for (let day = 1; day <= 30; day++) {
    session.tick(1439);
    ledger.transactions.forEach(t => transactions.set(t.id, t));
    state.book.businesses.forEach((b, i) => b.store.events.forEach(e => events[i].set(e.visitId, e)));
    session.tick(1);
    expect(Object.values(ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
    for (const b of state.book.businesses) {
      minima[b.id] = Math.min(minima[b.id] ?? Infinity, ledger.balances[b.ownerId]);
      expect(ledger.balances[b.ownerId]).toBeGreaterThan(400);
    }
    for (const n of residents) expect(dayCashflow(ledger, state.purses[n.id], day).consumption).toBeLessThanOrEqual(32);
  }
  const elapsed = performance.now() - started;
  expect(elapsed).toBeLessThan(2000); expect(state.work.shifts.every(s => s.paid)).toBe(true);
  ledger.transactions.forEach(t => transactions.set(t.id, t));
  state.book.businesses.forEach((b, i) => b.store.events.forEach(e => events[i].set(e.visitId, e)));
  const allTransactions = [...transactions.values()];
  const report = state.book.businesses.map((b, i) => {
    const allEvents = [...events[i].values()];
    for (const event of allEvents.filter(e => e.reason === 'purchased'))
      expect(whereIs(residents.find(n => n.id === event.actorId)!, event.time)).toBe(b.placeId);
    const orders = allTransactions.filter(t => t.reason.startsWith(`Procurement: ${b.id}:`));
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.every(t => residents.find(n => n.id === t.to)!.job === (b.id === 'light-counter' ? '빛씨 조율사' : producerJobs[b.store.stock[0].itemId]))).toBe(true);
    const revenue = allEvents.reduce((sum, e) => sum + e.amount, 0), units = revenue / b.store.stock[0].price;
    expect(orders.length * 5 - units).toBe(b.store.stock[0].backroom + b.store.stock[0].displayed);
    return { id: b.id, revenue, wages: allTransactions.filter(t => t.from === b.ownerId && t.reason.startsWith('Wage: '))
      .reduce((sum, t) => sum + t.amount, 0), owner: ledger.balances[b.ownerId], minimum: minima[b.id] };
  });
  if (seed === 123) console.log('C032 30-day report', JSON.stringify({ report, milliseconds: Math.round(elapsed), saveBytes: Buffer.byteLength(storage.getItem(SESSION_KEY)!) }));
});
it('keeps the same seeded economy for whole, split and saved ticks without redistributing', () => {
  const whole = createSession(memory(), 123), repeated = createSession(memory(), 123), storage = memory();
  let split = createSession(storage, 123);
  expect(split.state).toEqual(whole.state); whole.tick(30 * 1440); repeated.tick(30 * 1440);
  expect(repeated.state).toEqual(whole.state);
  for (let day = 0; day < 30; day++) {
    for (const step of [359.5, 360.5, 719.75, .25]) split.tick(step);
    split.saveNow(); const before = structuredClone(split.state); split = createSession(storage);
    expect(split.loadResult.ok).toBe(true); expect(split.state).toEqual(before);
  }
  expect(split.state).toEqual(whole.state);
  expect(split.state.world.ledger.history!.ids.filter(id => id.startsWith('initial:'))).toHaveLength(50);
});
it('settles all three listed shops once using their actual revenue, without affecting the unlisted shop', () => {
  const session = createSession(memory(), 123); session.tick(3 * 1440 - 1);
  const expected = structuredClone(session.state.market);
  for (const b of session.state.book.businesses) if (companies.some(c => c.npcId === b.ownerId))
    recordNpcRevenue(expected, b.ownerId, revenueChange(b, 3));
  advanceDay(expected); session.tick(1); expect(session.state.market).toEqual(expected);
  session.tick(0); expect(session.state.market).toEqual(expected);
});
it('adds zero-balance generated wallets to v4 once and never repeats its initial distribution', () => {
  const storage = memory(), legacy = legacySession(storage); legacy.saveNow();
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!); saved.version = 4;
  for (const id of Object.keys(saved.state.purses).filter(id => id.startsWith('generated-'))) {
    delete saved.state.purses[id]; delete saved.state.world.ledger.balances[id];
  }
  storage.setItem(SESSION_KEY, JSON.stringify(saved)); const migrated = createSession(storage);
  expect(migrated.loadResult.ok).toBe(true);
  expect(generate(123, 50).every(n => migrated.state.world.ledger.balances[n.id] === 0)).toBe(true);
  expect(migrated.state.world.ledger.transactions).toEqual([]); migrated.saveNow();
  expect(createSession(storage).state).toEqual(migrated.state);
});
it('rejects a v5 save whose generated wallet was removed', () => {
  const storage = memory(), session = createSession(storage, 123); session.saveNow();
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!); delete saved.state.purses[generate(123, 50)[0].id];
  storage.setItem(SESSION_KEY, JSON.stringify(saved)); expect(createSession(storage).loadResult.ok).toBe(false);
});
it('connects generated dialogue, gifts, dating, introductions and public notices without changing saved edges', () => {
  const storage = memory(), session = createSession(storage, 123), { state } = session, residents = generate(123, 50);
  session.tick(720); const time = gameTime(state.world.clock), npc = residents.find(n => whereIs(n, time) === 'cafe')!;
  state.player.placeId = 'cafe'; const observer = residents.find(n => n.id !== npc.id && whereIs(n, time) === 'cafe')!;
  const opening = session.buildDialogue(npc.id); expect(session.talk('chat', npc.id, opening.choices[0]).line).toBeTruthy();
  expect(state.ripple.notices.some(n => n.eventId === 'chat')).toBe(false);
  state.shop.residents.player = { inventory: { scarf: 1 }, energy: 50, appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
  expect(session.giveGift('gift', npc.id, 'scarf').line).toBeTruthy();
  expect(() => session.giveGift('gift', npc.id, 'scarf')).toThrow();
  expect(state.shop.residents.player.inventory.scarf).toBe(0);
  state.world.relationships.player[npc.id] = 90;
  // bonds mode: both directions must meet the dating thresholds (C040), not only the legacy score.
  const ready = { ...emptyBond(), affection: 60, trust: 40, respect: 10, comfort: 30, romance: 70, met: true };
  state.bonds.edges[edgeKey('player', npc.id)] = { ...ready }; state.bonds.edges[edgeKey(npc.id, 'player')] = { ...ready };
  expect(session.confess('dating', npc.id, { playerWantsDating: true, npcWantsDating: true }).accepted).toBe(true);
  expect(state.ripple.notices.some(n => n.observerId === observer.id && n.eventId === 'gift')).toBe(true);
  expect(state.ripple.notices.some(n => n.observerId === observer.id && n.kind === 'dating')).toBe(true);
  expect(session.buildDialogue(observer.id).line).toContain('저도 봤어요');
  const all = [...npcs, ...residents], slotTime = { ...time, minute: 1 };
  const offered = session.requestMatch({ id: 'match', player: { id: 'player', traits: npc.traits, likes: npc.likes, dislikes: [], reputation: 0 },
    introducerId: npc.id, npcs: all, now: time, slot: { placeId: 'cafe', time: slotTime },
    appearances: Object.fromEntries(residents.map(n => [n.id, n.appearance])) });
  expect(offered?.npcId).toBeDefined(); expect(readBond(state.bonds, npc.id, observer.id).trust).toBe(20);
  session.tick(6 * 60); expect(state.ripple.notices.some(n => n.mode === 'rumor')).toBe(true);
  session.saveNow(); expect(createSession(storage).state).toEqual(state);
  expect(Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
});

it('adds the light counter once to existing population saves without allocating money', () => {
  const storage = memory(), session = createSession(storage, 123), { book, world } = session.state;
  book.businesses = book.businesses.filter(b => b.id !== 'light-counter');
  book.employment = book.employment.filter(e => e.businessId !== 'light-counter');
  const before = structuredClone(world.ledger); session.saveNow();
  const next = createSession(storage); expect(next.loadResult.ok).toBe(true);
  expect(next.state.book.businesses.filter(b => b.ownerId === 'aro')).toHaveLength(1);
  expect(next.state.world.ledger).toEqual(before); next.saveNow();
  expect(createSession(storage).state).toEqual(next.state);
});
it('prunes only completed records older than 14 days at midnight in every store', () => {
  const storage = memory(), session = createSession(storage, 123), { state } = session;
  session.tick(15 * 1440 - 1); const cutoff = 1440;
  const shift = { actorId: 'player', jobId: 'pending', employerId: 'aro', startedAt: 0, wage: 1000000 };
  state.work.shifts.push({ ...shift, id: 'old', endsAt: cutoff - 1, paid: true },
    { ...shift, id: 'boundary', endsAt: cutoff, paid: true }, { ...shift, id: 'unpaid', endsAt: 1, paid: false });
  for (const store of [state.store, ...state.book.businesses.map(b => b.store)]) {
    const visit = { actorId: 'player', need: { itemId: 'tea', maxPrice: 8 }, price: 8, patienceMinutes: 100000 };
    store.visits.push(...(['paid', 'left', 'waiting'] as const).map(status =>
      ({ ...visit, id: `old-${status}`, joinedMinute: cutoff - 1, status })),
      { ...visit, id: 'boundary', joinedMinute: cutoff, status: 'paid' });
  }
  const events = structuredClone(state.book.businesses.map(b => b.store.events));
  session.tick(0); expect(state.work.shifts.some(s => s.id === 'old')).toBe(true);
  session.tick(1); expect(state.work.shifts.some(s => s.id === 'old')).toBe(false);
  expect(state.work.shifts.filter(s => ['boundary', 'unpaid'].includes(s.id))).toHaveLength(2);
  for (const store of [state.store, ...state.book.businesses.map(b => b.store)]) {
    expect(store.visits.filter(v => v.id.startsWith('old-')).map(v => v.status)).toEqual(['waiting']);
    expect(store.visits.some(v => v.id === 'boundary')).toBe(true);
  }
  state.book.businesses.forEach((b, i) => {
    expect(b.store.events).toEqual(events[i].filter(e => e.time.day >= 2));
    expect(state.revenueHistory[b.id][1]).toBe(events[i].filter(e => e.time.day === 1).reduce((sum, e) => sum + e.amount, 0));
  });
  expect(createSession(storage).state).toEqual(state);
});
it('measures 30/60-day saves and keeps completed shift and visit history bounded', () => {
  const storage = memory(), session = createSession(storage, 123), { state } = session;
  const shifts = new Map(), visits = state.book.businesses.map(() => new Map());
  for (let day = 1; day <= 60; day++) {
    session.tick(1439);
    for (const s of state.work.shifts) shifts.set(s.id, s);
    state.book.businesses.forEach((b, i) => b.store.visits.forEach(v => visits[i].set(v.id, v)));
    session.tick(1);
    expect(Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
    expect(state.work.shifts.every(s => !s.paid || s.endsAt >= day * 1440 - 14 * 1440)).toBe(true);
    expect(state.book.businesses.every(b => b.store.visits.every(v => v.status === 'waiting' ||
      v.joinedMinute >= day * 1440 - 14 * 1440))).toBe(true);
    if (day === 30 || day === 60) {
      const raw = storage.getItem(SESSION_KEY)!, unpruned = JSON.parse(raw);
      unpruned.state.work.shifts = [...shifts.values()];
      unpruned.state.book.businesses.forEach((b: typeof state.book.businesses[number], i: number) => b.store.visits = [...visits[i].values()]);
      const bytes = Buffer.byteLength(raw), withoutPruning = Buffer.byteLength(JSON.stringify(unpruned));
      expect(bytes).toBeLessThan(withoutPruning);
      console.log('C035 save bytes', { day, bytes, withoutPruning });
      expect(createSession(storage).state).toEqual(state);
    }
  }
});

it('applies light revenue growth to its price exactly once at midnight', () => {
  const session = createSession(memory(), 123); session.tick(2 * 1440 - 1);
  const b = session.state.book.businesses.find(b => b.id === 'light-counter')!;
  expect(b.store.events.some(e => e.reason === 'purchased')).toBe(true);
  b.store.events.push({ visitId: 'growth', actorId: 'player', itemId: 'lamp',
    time: { day: 2, hour: 23, minute: 59 }, reason: 'purchased', amount: 300 });
  const expected = structuredClone(session.state.market), baseline = structuredClone(expected);
  for (const business of session.state.book.businesses) if (companies.some(c => c.npcId === business.ownerId)) {
    const change = revenueChange(business, 2); recordNpcRevenue(expected, business.ownerId, change);
    if (business.ownerId !== 'aro') recordNpcRevenue(baseline, business.ownerId, change);
  }
  advanceDay(expected); advanceDay(baseline); session.tick(1);
  expect(session.state.market).toEqual(expected); expect(expected.prices.light).not.toBe(baseline.prices.light);
  session.tick(0); session.saveNow(); expect(session.state.market).toEqual(expected);
});

it('applies ten chats and a gift once to the receiving bond, including after reload', () => {
  const storage = memory(), session = createSession(storage, 123), { state } = session;
  state.player.placeId = 'quiet'; expect(session.buildDialogue('lise').stage).toBe('낯섦');
  for (let i = 0; i < 10; i++) session.talk(`bond-chat:${i}`, 'lise', session.buildDialogue('lise').choices[0]);
  expect(readBond(state.bonds, 'lise', 'player')).toMatchObject({ affection: 7, comfort: 3, trust: 0, respect: 0, romance: 0, met: true });
  expect(readBond(state.bonds, 'player', 'lise').affection).toBe(0);
  expect(state.world.relationships.player.lise).toBe(10);
  expect(session.buildDialogue('lise').stage).toBe('아는 사이');
  state.shop.residents.player = { inventory: { bread: 2 }, energy: 50, appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
  session.tick(1440); const gift = session.giveGift('bond-gift', 'lise', 'bread');
  expect(readBond(state.bonds, 'lise', 'player').affection).toBeCloseTo(7 + gift.entry.change * .7);
  session.saveNow(); const next = createSession(storage);
  const liseChoice = next.buildDialogue('lise').choices[0], aroChoice = next.buildDialogue('aro').choices[0];
  const before = structuredClone(next.state);
  expect(() => next.talk('bond-chat:0', 'lise', liseChoice)).toThrow();
  expect(() => next.talk('bond-chat:0', 'aro', aroChoice)).toThrow();
  expect(() => next.giveGift('bond-gift', 'lise', 'bread')).toThrow();
  expect(next.state).toEqual(before);
  expect(state.bonds.applied.filter(id => id === 'bond-gift')).toHaveLength(1);
});
it('requires both bonds and both consents for dating, independently of legacy scores', () => {
  const session = createSession(memory(), 123), { state } = session;
  state.player.placeId = 'quiet';
  const ready = { affection: 40, trust: 25, respect: 0, comfort: 20, romance: 60, met: true };
  const consent = { playerWantsDating: true, npcWantsDating: true };
  state.world.relationships.player = { lise: 90 };
  state.bonds.edges[edgeKey('lise', 'player')] = { ...ready };
  expect(session.confess('one-sided', 'lise', consent).accepted).toBe(false);
  state.bonds.edges[edgeKey('player', 'lise')] = { ...ready };
  expect(session.confess('no-consent', 'lise', { ...consent, npcWantsDating: false }).accepted).toBe(false);
  expect(state.dialogue.dating).toEqual([]); state.world.relationships.player.lise = 0;
  expect(session.confess('mutual', 'lise', consent).accepted).toBe(true);
  expect(session.buildDialogue('lise').stage).toBe('연인 첫 단계');
});
it('uses the introducer bond and known acquaintances instead of legacy introduction scores', () => {
  const session = createSession(memory(), 123), { state } = session, candidate = generate(123, 50)[0];
  const time = { day: 1, hour: 12, minute: 0 };
  const request = { id: 'not-friends', player: { id: 'player', traits: candidate.traits, likes: candidate.likes, dislikes: [], reputation: 0 },
    introducerId: 'aro', npcs: [npcs[0], candidate], now: gameTime(state.world.clock),
    slot: { placeId: whereIs(candidate, time), time }, appearances: { [candidate.id]: candidate.appearance } };
  state.world.relationships.player = { aro: 90 };
  expect(session.requestMatch(request)).toBeNull();
  state.bonds.edges[edgeKey('aro', 'player')] = { affection: 30, trust: 15, respect: 0, comfort: 10, romance: 0, met: true };
  state.bonds.edges[edgeKey('aro', candidate.id)] = { affection: 0, trust: 0, respect: 0, comfort: 0, romance: 0, met: true };
  state.world.relationships.player.aro = 0; state.world.relationships.aro[candidate.id] = 0;
  expect(session.requestMatch({ ...request, id: 'bond-friends' })?.npcId).toBe(candidate.id);
  expect(state.world.relationships.player.aro).toBe(0); expect(state.world.relationships.aro[candidate.id]).toBe(0);
});
it('keeps legacy dialogue, gifts and dating unchanged after restoring an old save', () => {
  const storage = memory(), initial = createSession(storage, 123); initial.saveNow();
  const saved = JSON.parse(storage.getItem(SESSION_KEY)!); saved.version = 2;
  storage.setItem(SESSION_KEY, JSON.stringify(saved)); const session = createSession(storage), { state } = session;
  expect(state.relationMode).toBe('legacy'); state.player.placeId = 'quiet';
  session.talk('legacy-chat', 'lise', session.buildDialogue('lise').choices[0]);
  state.shop.residents.player = { inventory: { bread: 1 }, energy: 50, appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
  session.giveGift('legacy-gift', 'lise', 'bread'); expect(state.world.relationships.player.lise).toBe(10);
  expect(readBond(state.bonds, 'lise', 'player').affection).toBe(0);
  expect(session.buildDialogue('lise').stage).toBe('아는 사이'); state.world.relationships.player.lise = 90;
  expect(session.confess('legacy-date', 'lise', { playerWantsDating: true, npcWantsDating: true }).accepted).toBe(true);
});
it.each([1, 31])('chooses preferred stock after the first slot and respects catalog tolerance: price %i', price => {
  const prepare = () => {
    const session = createSession(memory(), 123), store = session.state.book.businesses[0]; store.placeId = 'office';
    store.store.stock = [{ itemId: 'tea', backroom: 10, displayed: 5, capacity: 5, price: 1 },
      { itemId: 'lamp', backroom: 10, displayed: 5, capacity: 5, price }];
    return session;
  };
  const session = prepare(), repeated = prepare(); session.tick(360); repeated.tick(360);
  expect(session.state).toEqual(repeated.state);
  const purchases = session.state.book.businesses[0].store.events.filter(e => e.actorId === 'aro' && e.reason === 'purchased');
  expect(purchases.map(e => e.itemId)).toEqual(price === 1 ? ['lamp'] : []);
  expect(Object.values(session.state.world.ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
});

it('buys first-night shelf and reserve stock from producers without creating money', () => {
  const session = createSession(memory(), 123), { state } = session;
  session.tick(30);
  for (const b of state.book.businesses) {
    const stock = b.store.stock[0], orders = state.world.ledger.transactions.filter(t => t.reason.startsWith(`Procurement: ${b.id}:`));
    expect(stock).toMatchObject({ displayed: 5, backroom: 5 });
    expect(orders).toHaveLength(2); expect(orders.every(t => t.from === b.ownerId && t.amount > 0)).toBe(true);
    const visit = visitStore(b.store, state.world.ledger, `first-night:${b.id}`, 'player',
      { itemId: stock.itemId, maxPrice: stock.price }, 1, gameTime(state.world.clock));
    expect(checkoutBusiness(state.book, state.world.people, state.world.ledger, b.id,
      state.purses.player, visit.id, gameTime(state.world.clock)).ok).toBe(true);
  }
  expect(Object.values(state.world.ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
});
it('does not add opening stock to old saves and supplies empty stores at the next settlement', () => {
  const storage = memory(), session = createSession(storage, 123);
  session.tick(1439);
  for (const b of session.state.book.businesses) b.store.stock[0].backroom = b.store.stock[0].displayed = 0;
  session.saveNow(); const before = structuredClone(session.state), next = createSession(storage);
  expect(next.loadResult.ok).toBe(true); expect(next.state).toEqual(before);
  next.tick(1);
  // Midnight customers can buy a paid batch before the daily reserve is supplied.
  for (const b of next.state.book.businesses) {
    const stock = b.store.stock[0];
    const orders = next.state.world.ledger.transactions.slice(before.world.ledger.transactions.length)
      .filter(t => t.reason.startsWith(`Procurement: ${b.id}:`));
    const purchased = b.store.events.filter(e => e.time.day === 2 && e.reason === 'purchased').length;
    expect(stock.displayed).toBe(5); expect(stock.backroom).toBeGreaterThanOrEqual(5);
    expect(orders.every(t => t.from === b.ownerId && t.amount > 0)).toBe(true);
    expect(stock.displayed + stock.backroom + purchased).toBe(orders.length * 5);
  }
  expect(Object.values(next.state.world.ledger.balances).reduce((a, b) => a + b, 0)).toBe(6100);
});
it('drains awake energy, restores at night or home, clamps and preserves food recovery', () => {
  const session = createSession(memory(), 123), { state } = session;
  state.player.placeId = 'park'; session.tick(360);
  expect(state.shop.residents.player.energy).toBeCloseTo(68);
  session.tick(60); expect(state.shop.residents.player.energy).toBeCloseTo(67);
  state.player.placeId = 'nest'; session.tick(60); expect(state.shop.residents.player.energy).toBeCloseTo(70);
  state.shop.residents.player.energy = 99; session.tick(60); expect(state.shop.residents.player.energy).toBe(100);
  state.player.placeId = 'park'; state.shop.residents.player.energy = .5;
  session.tick(60); expect(state.shop.residents.player.energy).toBe(0);
  state.shop.residents.player.inventory.tea = 1; useItem(state.shop, 'player', 'tea');
  expect(state.shop.residents.player.energy).toBe(15);
  state.world.clock.paused = true; session.tick(60); expect(state.shop.residents.player.energy).toBe(15);
});
it('rejects tired work without a shift and charges only actual work minutes across split saved ticks', () => {
  const storage = memory(), whole = createSession(memory(), 123); let split = createSession(storage, 123);
  for (const session of [whole, split]) {
    session.tick(480.5); session.state.player.placeId = 'shop';
    session.state.shop.residents.player.energy = 9;
    expect(session.startWork('exchange-helper')).toEqual({ ok: false, error: '활력이 부족해요 (10 이상 필요)' });
    expect(session.state.work.shifts.some(s => s.actorId === 'player')).toBe(false);
    session.state.shop.residents.player.energy = 10;
    expect(session.startWork('exchange-helper').ok).toBe(true);
  }
  whole.tick(120); split.tick(29.25); split.saveNow(); split = createSession(storage);
  split.tick(30.75); split.tick(60);
  expect(split.state).toEqual(whole.state); expect(whole.state.shop.residents.player.energy).toBe(0);
  expect(whole.state.work.shifts.find(s => s.actorId === 'player')?.paid).toBe(true);
  whole.state.shop.residents.player.energy = 50; whole.tick(60);
  expect(whole.state.shop.residents.player.energy).toBeCloseTo(49);
});

it('compacts 180-day finances with exact totals, retries, stock prices and split/reloaded ticks', () => {
  const storage = memory(), whole = createSession(memory(), 123);
  let split = createSession(storage, 123);
  const transactions = new Map<string, Transaction>(), events = split.state.book.businesses.map(() => new Map());
  whole.tick(180 * 1440);
  for (let day = 1; day <= 180; day++) {
    split.tick(1439);
    split.state.world.ledger.transactions.forEach(t => transactions.set(t.id, t));
    split.state.book.businesses.forEach((b, i) => b.store.events.forEach(e => events[i].set(e.visitId, e)));
    split.tick(1); split = createSession(storage); expect(split.loadResult.ok).toBe(true);
  }
  expect(split.state).toEqual(whole.state);
  const { state } = split, ledger = state.world.ledger;
  ledger.transactions.forEach(t => transactions.set(t.id, t));
  const original = { balances: { ...ledger.balances }, transactions: [...transactions.values()] };
  const before = structuredClone(original); compactLedger(original, 167);
  expect(original).toEqual(ledger); expect(original.balances).toEqual(before.balances);
  expect(Object.values(ledger.balances).reduce((sum, cash) => sum + cash, 0)).toBe(6100);
  const expected = createSession(memory(), 123).state.market;
  for (let day = 1; day <= 180; day++) {
    state.book.businesses.forEach((b, i) => {
      if (companies.some(c => c.npcId === b.ownerId)) recordNpcRevenue(expected, b.ownerId,
        revenueChange({ ...b, store: { ...b.store, events: [...events[i].values()] } }, day));
    });
    advanceDay(expected);
  }
  expect(state.market).toEqual(expected);
  state.book.businesses.forEach((b, i) => {
    for (const [day, revenue] of Object.entries(state.revenueHistory[b.id]))
      expect(revenue).toBe([...events[i].values()].filter(e => e.time.day === Number(day)).reduce((sum, e) => sum + e.amount, 0));
  });
  const retired = before.transactions.find(t => t.time.day === 1)!;
  expect(transfer(ledger, { ...retired, time: gameTime(state.world.clock) })).toEqual({ ok: true, duplicate: true });
  expect(ledger.balances).toEqual(before.balances);
  const unpruned = JSON.parse(storage.getItem(SESSION_KEY)!);
  unpruned.state.world.ledger = before; delete unpruned.state.revenueHistory;
  unpruned.state.book.businesses.forEach((b: typeof state.book.businesses[number], i: number) => b.store.events = [...events[i].values()]);
  const bytes = Buffer.byteLength(storage.getItem(SESSION_KEY)!), withoutPruning = Buffer.byteLength(JSON.stringify(unpruned));
  console.log('C044 180-day save bytes', { bytes, withoutPruning });
  expect(ledger.history!.ids.length).toBeLessThanOrEqual(50);
  expect(bytes).toBeLessThanOrEqual(159 * 1024); expect(bytes).toBeLessThan(withoutPruning);
}, 15000);

function buyHomeLamp(session: ReturnType<typeof createSession>) {
  const { state } = session, b = state.book.businesses.find(b => b.id === 'light-counter')!, time = gameTime(state.world.clock);
  visitStore(b.store, state.world.ledger, 'decor', 'player', { itemId: 'lamp', maxPrice: 30 }, 1, time);
  expect(checkoutBusiness(state.book, state.world.people, state.world.ledger, b.id, state.purses.player, 'decor', time).ok).toBe(true);
  state.shop.residents.player = { inventory: { lamp: 1 }, energy: 50, appearance: 0, atmosphere: 0, clothing: null, decorations: [] };
  useItem(state.shop, 'player', 'lamp');
}
it('C051: completed work rewards only its owner and overlapping coworkers once, even with unpaid wages', () => {
  const storage = memory(), session = createSession(storage, 123), { state } = session;
  session.tick(420); state.player.placeId = 'cafe'; expect(session.startWork('tea-helper').ok).toBe(true);
  state.world.ledger.balances.nuel = 0; session.tick(59);
  expect(readBond(state.bonds, 'nuel', 'player').trust).toBe(0); session.tick(1);
  for (const id of ['nuel', 'generated-123-0']) {
    expect(readBond(state.bonds, id, 'player')).toMatchObject({ trust: 3, respect: 2, comfort: 2, met: true });
    expect(state.dialogue.memories[id].entries.filter(m => m.kind === 'shared-work')).toHaveLength(1);
  }
  expect(readBond(state.bonds, 'generated-123-17', 'player').trust).toBe(0);
  const bonds = structuredClone(state.bonds); session.saveNow(); const next = createSession(storage);
  next.tick(1); expect(next.state.bonds).toEqual(bonds);
}, 60_000); // 180 game days; slow when several worker runs share the server
it('C051: feelings, tea attendance, daily caps, lowering choices and saved event receipts', () => {
  const storage = memory(), session = createSession(storage, 123), { state } = session, id = 'generated-123-0';
  expect(session.expressFeelings(id)).toBe(true); expect(session.expressFeelings(id)).toBe(false);
  expect(readBond(state.bonds, id, 'player')).toMatchObject({ comfort: -3, romance: 0 });
  expect(session.inviteHomeTea('locked', id)).toBe(false);
  state.bonds.edges[edgeKey(id, 'player')] = { ...emptyBond(), affection: 40, trust: 25, comfort: 20, met: true };
  buyHomeLamp(session); session.tick(1440);
  expect(session.inviteHomeTea('tea', id)).toBe(true); expect(session.inviteHomeTea('tea', id)).toBe(false);
  expect(readBond(state.bonds, id, 'player')).toMatchObject({ trust: 27, comfort: 23 });
  expect(state.dialogue.memories[id].entries[0]).toMatchObject({ kind: 'meal', sourceEventId: 'tea' });
  expect(session.expressFeelings(id)).toBe(true); expect(readBond(state.bonds, id, 'player').romance).toBe(5);
  expect(session.setFeeling(id, 'love', 'love')).toBe(true);
  expect(readBond(state.bonds, 'player', id)).toMatchObject({ affection: 40, trust: 25, comfort: 20, romance: 60 });
  expect(session.setFeeling(id, 'crush')).toBe(true); expect(readBond(state.bonds, 'player', id).romance).toBe(40);
  expect(session.setFeeling(id, 'friend')).toBe(true); expect(readBond(state.bonds, 'player', id).romance).toBe(0);
  session.saveNow(); const next = createSession(storage), before = structuredClone(next.state);
  expect(next.expressFeelings(id)).toBe(false); expect(next.inviteHomeTea('tea', id)).toBe(false);
  expect(next.setFeeling(id, 'love', 'love')).toBe(false); expect(next.state).toEqual(before);
  next.tick(420); expect(() => next.inviteHomeTea('absent', id)).toThrow('지금 여기 없어요');
  next.state.player.placeId = whereIs(generate(123, 50)[0], gameTime(next.state.world.clock));
  next.state.relationMode = 'legacy'; const legacy = structuredClone(next.state);
  expect(next.expressFeelings(id)).toBe(false); expect(next.setFeeling(id, 'love')).toBe(false);
  expect(next.inviteHomeTea('legacy', id)).toBe(false); expect(next.state).toEqual(legacy);
}, 60_000); // 180 game days; slow on the shared 2-core server
it('C051: seed 123 reaches mutual dating within 20 days; chat alone remains acquainted', () => {
  const storage = memory(); let session = createSession(storage, 123);
  const chat = createSession(memory(), 123), npc = generate(123, 50)[0], rows = [], stages = new Set();
  const choice = { id: 'liked-topic', topic: npc.likes[0], tone: npc.traits[0] };
  buyHomeLamp(session);
  for (let day = 1; day <= 20; day++) {
    const { state } = session;
    if (day <= 9) session.talk(`chat:${day}`, npc.id, choice);
    else session.expressFeelings(npc.id);
    session.tick(420); state.player.placeId = 'cafe';
    if (whereIs(npc, gameTime(state.world.clock)) === 'cafe') expect(session.startWork('tea-helper').ok).toBe(true);
    session.tick(60); state.player.placeId = 'nest'; session.tick(420);
    session.inviteHomeTea(`tea:${day}`, npc.id);
    if (day > 9) session.talk(`chat:${day}`, npc.id, choice);
    const bond = readBond(state.bonds, npc.id, 'player'), stage = session.buildDialogue(npc.id).stage;
    rows.push({ day, ...bond, stage }); stages.add(stage);
    expect(readBond(state.bonds, 'player', npc.id).romance).toBe(0);
    expect(Object.values(state.bonds.gained).every(value => value <= 10)).toBe(true);
    chat.talk(`chat:${day}`, npc.id, choice); chat.tick(1440);
    if (day < 20) session.tick(540);
    session.saveNow(); session = createSession(storage); expect(session.loadResult.ok).toBe(true);
  }
  expect(stages.has('친구')).toBe(true); expect(stages.has('호감')).toBe(true);
  const { state } = session, consent = { playerWantsDating: true, npcWantsDating: true };
  expect(session.setFeeling(npc.id, 'love')).toBe(true);
  expect(canStartDating(readBond(state.bonds, 'player', npc.id), readBond(state.bonds, npc.id, 'player'), consent)).toBe(true);
  expect(session.confess('dating', npc.id, consent).accepted).toBe(true);
  expect(state.dialogue.memories[npc.id].entries.some(m => m.kind === 'meal')).toBe(true);
  expect(chat.buildDialogue(npc.id).stage).toBe('아는 사이');
  const chatBond = readBond(chat.state.bonds, npc.id, 'player');
  expect(chatBond).toMatchObject({ trust: 0, respect: 0, romance: 0 });
  expect(chatBond.affection).toBeCloseTo(98); expect(chatBond.comfort).toBeCloseTo(42);
  console.table(rows); console.log('C051 chat only', readBond(chat.state.bonds, npc.id, 'player'));
});
