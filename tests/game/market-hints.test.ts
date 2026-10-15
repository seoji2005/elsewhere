import { expect, it } from 'vitest';
import { buildDialogue, createDialogueState } from '../../src/sim/dialogue';
import { advanceDay, createMarket } from '../../src/sim/market';
import { createMemoryState, rememberSharedEvent } from '../../src/sim/memory';
import { emptyBond, edgeKey } from '../../src/sim/bonds';
import { npcs } from '../../src/data/npcs';
import { companies } from '../../src/data/companies';
import { createSession, SESSION_KEY } from '../../src/game/session';

const bond = { ...emptyBond(), met: true, affection: 40, trust: 20, comfort: 15 };
const scene = { placeId: 'quiet', atWork: false, peopleCount: 2, bond };
const ctx = { actorId: 'player', npc: npcs[0], time: { day: 1, hour: 23, minute: 0 }, value: 100, scene };
const dialogue = createDialogueState();
it.each(companies)('reads $id schedule without changing prices even after repeated dialogue', company => {
  const delays = new Set<number>(), signs = new Set<number>();
  for (let seed = 0; seed < 6; seed++) {
    const market = createMarket(seed), control = createMarket(seed);
    const context = { ...ctx, npc: npcs.find(n => n.id === company.npcId)! };
    const hint = { ...market.hints!.find(h => h.companyId === company.id)! };
    while (market.day < hint.dueDay - 3) { advanceDay(market); advanceDay(control); }
    signs.add(Math.sign(hint.size));
    while (market.day < hint.dueDay) {
      delays.add(hint.dueDay - market.day);
      const before = structuredClone(market);
      for (let repeat = 0; repeat < 10; repeat++)
        expect(buildDialogue(dialogue, { ...context, market }).line).toContain(company.name);
      expect(market).toEqual(before);
      const price = market.prices[company.id];
      advanceDay(market); advanceDay(control);
      expect(market).toEqual(control);
      if (market.day === hint.dueDay) {
        expect(market.events).toContainEqual({ companyId: company.id, size: hint.size, days: 1 });
        expect(Math.sign(market.prices[company.id] - price)).toBe(Math.sign(hint.size));
      }
    }
    for (let day = 0; day < 20; day++) {
      buildDialogue(dialogue, { ...context, market });
      advanceDay(market); advanceDay(control); expect(market).toEqual(control);
    }
  }
  expect([...delays].sort()).toEqual([1, 2, 3]); expect(signs.size).toBe(2);
});
it('withholds tips without a friendly five-axis bond, privacy, or a connected job', () => {
  const contexts = [
    ...(['met', 'affection', 'trust', 'respect', 'comfort'] as const).map(axis =>
      ({ ...ctx, scene: { ...scene, bond: { ...bond, [axis]: axis === 'met' ? false : -1 } } })),
    { ...ctx, scene: { ...scene, peopleCount: 3 } }, { ...ctx, scene: { ...scene, atWork: true } },
    { ...ctx, scene: { ...scene, bond: undefined } }, { ...ctx, scene: undefined },
    { ...ctx, npc: npcs.find(n => n.id === 'velo')! },
  ];
  for (const context of contexts) {
    const market = createMarket(); market.day = market.hints![0].dueDay - 1;
    const before = structuredClone(market);
    expect(buildDialogue(dialogue, { ...context, market }).line).not.toContain('둘만 있으니');
    expect(market).toEqual(before);
  }
});
it('session requires presence and preserves a pending tip across save/load and day ticks', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); } };
  const session = createSession(storage, 123);
  session.state.market.hints![0].dueDay = 3;
  session.tick(1380); session.state.bonds.edges[edgeKey('lise', 'player')] = { ...bond };
  expect(session.buildDialogue('lise').line).not.toContain('둘만 있으니');
  session.state.player.placeId = 'park';
  expect(session.buildDialogue('lise').line).toContain('빛고리 빛씨');
  const hint = { ...session.state.market.hints![0] }; session.saveNow();
  const loaded = createSession(storage); expect(loaded.state.market.hints).toEqual(session.state.market.hints);
  loaded.tick((hint.dueDay - 1) * 1440 - 1380);
  expect(loaded.state.market.events).toContainEqual({ companyId: hint.companyId, size: hint.size, days: 1 });
  const old = JSON.parse(values.get(SESSION_KEY)!); delete old.state.market.hints;
  values.set(SESSION_KEY, JSON.stringify(old)); const legacy = createSession(storage);
  expect(legacy.loadResult.ok).toBe(true); expect(legacy.state.market.day).toBe(old.state.market.day);
  legacy.tick(1440); expect(legacy.state.market.hints).toHaveLength(companies.length);
});
it('keeps a company tip audible when a shared memory takes the greeting slot', () => {
  const state = createDialogueState(), memories = state.memories.aro = createMemoryState('aro');
  rememberSharedEvent(memories, { id: 'tea', actorId: 'player', kind: 'meal', participants: ['player', 'aro'],
    placeId: 'cafe', placeName: '카페', activityName: '차', time: ctx.time, status: 'completed' });
  const market = createMarket(); market.day = market.hints![0].dueDay - 1;
  const line = buildDialogue(state, { ...ctx, time: { ...ctx.time, day: 2 }, market }).line;
  expect(line).toContain('카페'); expect(line).toContain('빛고리 빛씨');
});
it('has no tip without an imminent schedule and accepts saves without schedules', () => {
  const market = createMarket();
  for (const hints of [market.hints, [], undefined]) {
    market.hints = hints; const before = structuredClone(market);
    expect(buildDialogue(dialogue, { ...ctx, market }).line).not.toContain('둘만 있으니');
    expect(market).toEqual(before);
  }
  advanceDay(market); expect(market.hints).toHaveLength(companies.length);
});
