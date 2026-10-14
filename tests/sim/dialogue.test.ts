import { expect, it } from 'vitest';
import { npcs } from '../../src/data/npcs';
import { dialogueTemplates } from '../../src/data/dialogue';
import { buildDialogue, confess, createDialogueState, isDating, recordDialogue, talk } from '../../src/sim/dialogue';
import { createWorld } from '../../src/sim/world';
import { createRelationshipState, interact } from '../../src/sim/relationship';

const time = { day: 1, hour: 9, minute: 0 };
it.each(npcs)('$name has original greetings, chats, gift reactions and consent responses', npc => {
  const state = createDialogueState(), world = createWorld(), relationships = createRelationshipState();
  const ctx = { actorId: 'player', npc, time, value: 0 };
  expect(Object.values(dialogueTemplates[npc.id]).every(line => line.length > 0)).toBe(true);
  const opening = buildDialogue(state, ctx);
  expect(opening.line).toBe(dialogueTemplates[npc.id].greeting);
  const choice = opening.choices[0];
  expect(choice.tone).toBe(npc.traits[0]);
  const first = talk(world, relationships, state, 'first', ctx, choice);
  const second = talk(world, relationships, state, 'second', ctx, choice);
  expect(first.line).not.toBe(second.line);
  const value = world.relationships.player[npc.id];
  expect(() => talk(world, relationships, state, 'second', ctx, choice)).toThrow();
  expect(world.relationships.player[npc.id]).toBe(value);
  expect(confess(state, { ...ctx, value: 100 }, {
    playerWantsDating: true, npcWantsDating: false,
  }).accepted).toBe(false);
  expect(isDating(state, 'player', npc.id)).toBe(false);
  expect(buildDialogue(state, { ...ctx, value: 100 }).stage).toBe('호감');
  expect(confess(state, { ...ctx, value: 100 }, {
    playerWantsDating: false, npcWantsDating: true,
  }).accepted).toBe(false);
  expect(confess(state, { ...ctx, value: 89 }, {
    playerWantsDating: true, npcWantsDating: true,
  }).accepted).toBe(false);
  expect(confess(state, { ...ctx, value: 90 }, {
    playerWantsDating: true, npcWantsDating: true,
  }).accepted).toBe(true);
  expect(buildDialogue(state, { ...ctx, value: 90 }).stage).toBe('연인 첫 단계');
  expect(isDating(state, 'other', npc.id)).toBe(false);
  expect(buildDialogue(createDialogueState(), { ...ctx, value: 30 }).line)
    .toBe(dialogueTemplates[npc.id].familiar);
});

it('remembers a capped gift later without awarding more points or leaking to another actor', () => {
  const npc = npcs[0], world = createWorld(), relationships = createRelationshipState();
  const state = createDialogueState();
  const gift = { id: 'gift:light', topic: '빛씨', tone: 'curious' as const };
  for (let i = 0; i < 3; i++) {
    const entry = interact(world, relationships, 'player', npc, time, gift);
    recordDialogue(state, `gift-${i}`, npc, entry);
  }
  expect(relationships.interactions[2].change).toBe(0);
  expect(world.relationships.player.aro).toBe(10);
  const ctx = { actorId: 'player', npc, time: { ...time, day: 2 }, value: 30 };
  expect(buildDialogue(state, ctx).line).toContain('전에 준 빛씨');
  expect(buildDialogue(state, { ...ctx, actorId: 'other' }).line).not.toContain('전에 준');
  const bad = interact(world, relationships, 'player', npc, time,
    { ...gift, id: 'gift:noise', topic: '큰 소리' });
  expect(recordDialogue(state, 'bad', npc, bad)).toBe(dialogueTemplates.aro.dislikedGift);
  const restored = JSON.parse(JSON.stringify(state));
  expect(buildDialogue(restored, ctx).line).toContain('기억');
});

import { createMemoryState, rememberSharedEvent, type SharedEvent } from '../../src/sim/memory';
const completed: SharedEvent = { id: 'shared:1', actorId: 'player', kind: 'meal',
  participants: ['player', 'aro'], placeId: 'cafe', placeName: '잔물결 찻방',
  activityName: '잔향 차 식사', time, status: 'completed' };
it.each(['meal', 'shared-work'] as const)('initiates %s recall after a day, once across reloads, without score', kind => {
  const state = createDialogueState(), npc = npcs[0], world = createWorld();
  const before = JSON.stringify(world.relationships);
  const memory = state.memories[npc.id] = createMemoryState(npc.id);
  rememberSharedEvent(memory, { ...completed, kind });
  const ctx = { actorId: 'player', npc, time, value: 0 };
  expect(buildDialogue(state, ctx).line).toBe(dialogueTemplates.aro.greeting);
  expect(buildDialogue(state, { ...ctx, time: { ...time, day: 2, hour: 8 } }).line)
    .toBe(dialogueTemplates.aro.greeting);
  const later = { ...ctx, time: { ...time, day: 4 } };
  expect(buildDialogue(state, { ...later, actorId: 'other' }).line).toBe(dialogueTemplates.aro.greeting);
  expect(buildDialogue(state, { ...later, npc: npcs[1] }).line).toBe(dialogueTemplates.nuel.greeting);
  expect(buildDialogue(state, later).line).toContain('잔물결 찻방');
  expect(memory.entries[0].mentionedAt).toBeDefined();
  const restored = JSON.parse(JSON.stringify(state));
  expect(rememberSharedEvent(restored.memories.aro, { ...completed, kind })).toBe(false);
  expect(buildDialogue(restored, later).line).toBe(dialogueTemplates.aro.greeting);
  expect(JSON.stringify(world.relationships)).toBe(before);
});
it('uses distinct speech styles and includes the actual activity and place', () => {
  const lines = ['aro', 'nuel', 'sori', 'lise'].map(id => {
    const npc = npcs.find(npc => npc.id === id)!, state = createDialogueState();
    const memory = state.memories[id] = createMemoryState(id);
    rememberSharedEvent(memory, { ...completed, participants: ['player', id] });
    const line = buildDialogue(state, { actorId: 'player', npc, time: { ...time, day: 4 }, value: 30 }).line;
    expect(line).toContain('잔물결 찻방');
    expect(line).toContain('잔향 차 식사');
    return line;
  });
  expect(new Set(lines).size).toBe(4);
});
it('reads a legacy gift once without granting more relationship points', () => {
  const npc = npcs[0], world = createWorld(), relationships = createRelationshipState();
  const state = createDialogueState();
  recordDialogue(state, 'legacy', npc, interact(world, relationships, 'player', npc, time,
    { id: 'gift:light', topic: '빛씨', tone: 'curious' }));
  const before = JSON.stringify(world.relationships);
  const ctx = { actorId: 'player', npc, time: { ...time, day: 4 }, value: 30 };
  expect(buildDialogue(state, ctx).line).toContain('전에 준 빛씨');
  expect(buildDialogue(JSON.parse(JSON.stringify(state)), ctx).line).toBe(dialogueTemplates.aro.familiar);
  expect(JSON.stringify(world.relationships)).toBe(before);
});
