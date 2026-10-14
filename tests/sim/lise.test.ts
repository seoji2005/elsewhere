import { expect, it } from 'vitest';
import { npcs } from '../../src/data/npcs';
import { dialogueTemplates } from '../../src/data/dialogue';
import { buildDialogue, confess, createDialogueState, talk } from '../../src/sim/dialogue';
import { whereIs } from '../../src/sim/npc';
import { createWorld } from '../../src/sim/world';
import { createRelationshipState } from '../../src/sim/relationship';

const lise = npcs.find(npc => npc.id === 'lise')!;
const lines = dialogueTemplates.lise;
const time = { day: 1, hour: 9, minute: 0 };
const polite = /(요|니다)[.?…]*$/;
const sentences = (line: string) => line.split(/(?<=[.?])\s+/);

it('is an ordinary busy resident with one late solo round', () => {
  expect(lise.job).toBe('빛고리 조율실 수석 조율사');
  expect(whereIs(lise, time)).toBe('office');
  expect(whereIs(lise, { ...time, hour: 23 })).toBe('park');
  expect(whereIs(lise, { day: 5, hour: 12, minute: 0 })).toBe('cafe');
});

it('drops public politeness to short 반말 as the stage rises', () => {
  const ctx = { actorId: 'player', npc: lise, time, value: 0 };
  for (const value of [0, 10]) {
    const line = buildDialogue(createDialogueState(), { ...ctx, value }).line;
    expect(sentences(line).every(part => polite.test(part))).toBe(true);
  }
  for (const value of [30, 60]) {
    const line = buildDialogue(createDialogueState(), { ...ctx, value }).line;
    expect(sentences(line).some(part => polite.test(part))).toBe(false);
  }
  const { greeting, ...casual } = lines;
  expect(greeting).toBe(buildDialogue(createDialogueState(), ctx).line);
  for (const line of Object.values(casual)) {
    expect(sentences(line).some(part => polite.test(part))).toBe(false);
  }
  expect(Object.values(lines).some(line => line.includes('!'))).toBe(false);
});

it('says the name only after mutual consent at the dating stage', () => {
  const ctx = { actorId: 'player', npc: lise, time, value: 89 };
  const { accept, ...before } = lines;
  expect(Object.values(before).some(line => line.includes('이름'))).toBe(false);
  const state = createDialogueState();
  expect(confess(state, ctx, { playerWantsDating: true, npcWantsDating: true }).line)
    .not.toContain('이름');
  const answer = confess(state, { ...ctx, value: 90 },
    { playerWantsDating: true, npcWantsDating: true });
  expect(answer.accepted).toBe(true);
  expect(answer.line).toBe(accept);
  expect(answer.line).toContain('이름');
});

it('answers a repeated question differently', () => {
  const state = createDialogueState(), world = createWorld(), relationships = createRelationshipState();
  const ctx = { actorId: 'player', npc: lise, time, value: 0 };
  const [rain, promise] = buildDialogue(state, ctx).choices;
  const said = ['a', 'b'].map(id => talk(world, relationships, state, id, ctx, rain).line);
  expect(said).toEqual([lines.chat, lines.repeat]);
  expect(talk(world, relationships, state, 'c', ctx, promise).line).toBe(lines.chat);
});
