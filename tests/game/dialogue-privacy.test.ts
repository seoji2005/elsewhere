import { expect, it } from 'vitest';
import { createSession } from '../../src/game/session';
import { npcs } from '../../src/data/npcs';
import { generate } from '../../src/sim/npcgen';
import { buildDialogue, createDialogueState, talk } from '../../src/sim/dialogue';
import { emptyBond, edgeKey } from '../../src/sim/bonds';
import { createWorld } from '../../src/sim/world';
import { createRelationshipState } from '../../src/sim/relationship';
import { createMemoryState, rememberSharedEvent } from '../../src/sim/memory';

const friendly = { ...emptyBond(), met: true, affection: 60, trust: 25, comfort: 20 };
const lise = npcs.find(n => n.id === 'lise')!;
const polite = /(요|니다)[.!?…]*$/;
const scene = { placeId: 'park', peopleCount: 2, atWork: false, bond: friendly };
const ctx = { actorId: 'player', npc: lise, time: { day: 1, hour: 23, minute: 0 }, value: 60, scene };
it.each([lise, npcs[0], generate(123, 1)[0]])('changes public/private greeting and response for $id', npc => {
  const state = createDialogueState(), privateCtx = { ...ctx, npc };
  const privateLine = buildDialogue(state, privateCtx).line;
  expect(polite.test(privateLine)).toBe(false);
  for (const publicScene of [{ ...scene, placeId: 'office', atWork: true, peopleCount: 3 },
    { ...scene, atWork: true }, { ...scene, peopleCount: 3 }]) {
    const publicCtx = { ...privateCtx, time: { day: 1, hour: 9, minute: 0 }, scene: publicScene };
    const line = buildDialogue(state, publicCtx).line;
    expect(line).not.toBe(privateLine); expect(polite.test(line)).toBe(true);
    const choice = buildDialogue(state, publicCtx).choices[0];
    expect(polite.test(talk(createWorld(), createRelationshipState(), state,
      `public:${npc.id}:${JSON.stringify(publicScene)}`, publicCtx, choice).line)).toBe(true);
  }
});
it.each(['affection', 'trust', 'comfort', 'respect', 'met'] as const)('requires friendly %s even alone with high legacy score', axis => {
  const bond = { ...friendly, [axis]: axis === 'met' ? false : -1 };
  expect(polite.test(buildDialogue(createDialogueState(), { ...ctx, value: 100,
    scene: { ...scene, bond } }).line)).toBe(true);
});
it('session supplies current schedules and the NPC directional bond', () => {
  const session = createSession({ getItem: () => null, setItem: () => {} }, 123), { state } = session;
  state.bonds.edges[edgeKey('lise', 'player')] = { ...friendly };
  state.world.clock.totalMinutes = 9 * 60; state.player.placeId = 'office';
  expect(polite.test(session.buildDialogue('lise').line)).toBe(true);
  state.world.clock.totalMinutes = 23 * 60; state.player.placeId = 'park';
  const privateLine = session.buildDialogue('lise').line;
  expect(polite.test(privateLine)).toBe(false);
  state.bonds.edges[edgeKey('lise', 'player')] = emptyBond();
  state.bonds.edges[edgeKey('player', 'lise')] = { ...friendly };
  expect(polite.test(session.buildDialogue('lise').line)).toBe(true);
});
it('keeps generated NPC informal thresholds in private, using affection rather than legacy points', () => {
  const npc = generate(123, 50).find(n => n.speech.informalAt === 60)!;
  for (const affection of [59, 60]) {
    const line = buildDialogue(createDialogueState(), { ...ctx, npc, value: 100,
      scene: { ...scene, bond: { ...friendly, affection } } }).line;
    expect(polite.test(line)).toBe(affection < 60);
  }
});
it.each(['aro', 'lise'])('recalls shared work politely in public for %s, only once', id => {
  const session = createSession({ getItem: () => null, setItem: () => {} }, 123), { state } = session;
  const memories = state.dialogue.memories[id] = createMemoryState(id);
  rememberSharedEvent(memories, { id: 'work', actorId: 'player', kind: 'shared-work', participants: ['player', id],
    placeId: 'office', placeName: '조율실', activityName: '공동 조율', time: { day: 1, hour: 9, minute: 0 }, status: 'completed' });
  state.world.clock.totalMinutes = 1440 + 9 * 60; state.player.placeId = 'office';
  const line = session.buildDialogue(id).line;
  expect(line).toContain('공동 조율'); expect(polite.test(line)).toBe(true);
  expect(session.buildDialogue(id).line).not.toContain('공동 조율');
});
it.each([9, 10])('preserves legacy NPC speech threshold at %i in private and stays polite in public', value => {
  const session = createSession({ getItem: () => null, setItem: () => {} }, 123), { state } = session;
  const npc = generate(123, 50).find(n => n.id === 'generated-123-21')!;
  expect(npc.speech.informalAt).toBe(10); state.relationMode = 'legacy';
  (state.world.relationships.player ??= {})[npc.id] = value;
  state.world.clock.totalMinutes = 1440 + 12 * 60; state.player.placeId = 'quiet';
  expect(polite.test(session.buildDialogue(npc.id).line)).toBe(value < 10);
  expect(polite.test(buildDialogue(state.dialogue, { ...ctx, npc, value,
    scene: { placeId: 'office', peopleCount: 3, atWork: true } }).line)).toBe(true);
});
