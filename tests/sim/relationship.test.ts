import { expect, it } from 'vitest';
import { npcs } from '../../src/data/npcs';
import { createWorld } from '../../src/sim/world';
import { createRelationshipState, dialogueReaction, interact, relationshipStage,
  relationshipStages, DAILY_GAIN_LIMIT } from '../../src/sim/relationship';

const liked = { id: 'share-light', topic: '빛씨', tone: 'curious' as const };
const disliked = { id: 'shout', topic: '큰 소리', tone: 'social' as const };
const time = { day: 1, hour: 9, minute: 0 };

it('responds to both personality and tastes for the same choice', () => {
  expect(dialogueReaction(npcs[0], liked)).toBe(7);
  expect(dialogueReaction(npcs[4], liked)).toBe(4);
  expect(dialogueReaction(npcs[1], liked)).toBe(0);
  expect(dialogueReaction(npcs[0], disliked)).toBe(-5);
  expect(dialogueReaction(npcs[1], disliked)).toBe(7);
});

it('caps cumulative positive gains per pair and day, even after losses', () => {
  const world = createWorld();
  const state = createRelationshipState();
  const talk = (choice = liked, day = 1) =>
    interact(world, state, 'player', npcs[0], { ...time, day }, choice);
  expect(talk().change).toBe(7);
  expect(talk().change).toBe(3);
  expect(talk().change).toBe(0);
  expect(world.relationships.player.aro).toBe(DAILY_GAIN_LIMIT);
  expect(talk(disliked).change).toBe(-5);
  expect(talk().change).toBe(0);
  expect(talk(liked, 2).change).toBe(7);
  expect(interact(world, state, 'other', npcs[0], time, liked).change).toBe(7);
  expect(interact(world, state, 'player', npcs[4], time, liked).change).toBe(4);
});

it('reaches each threshold across days and preserves reverse world values', () => {
  const world = createWorld();
  world.relationships.aro = { player: -2 };
  const state = createRelationshipState();
  expect(relationshipStage(0)).toBe('낯섦');
  for (let day = 1; day <= 9; day++) {
    for (let repeat = 0; repeat < 2; repeat++) {
      interact(world, state, 'player', npcs[0], { ...time, day }, liked);
    }
    const expected = [...relationshipStages].reverse().find(s => day * 10 >= s.threshold)!;
    expect(relationshipStage(world.relationships.player.aro)).toBe(expected.name);
  }
  expect(world.relationships.aro.player).toBe(-2);
  for (const stage of relationshipStages.slice(1)) {
    expect(relationshipStage(stage.threshold)).toBe(stage.name);
    expect(relationshipStage(stage.threshold - 1)).not.toBe(stage.name);
  }
  expect(relationshipStage(-5)).toBe('낯섦');
});

it('records gains, losses and capped interactions with copied input and serializable history', () => {
  const world = createWorld();
  const state = createRelationshipState();
  const inputTime = { ...time };
  const choice = { ...liked };
  const first = interact(world, state, 'player', npcs[0], inputTime, choice);
  inputTime.day = 99;
  choice.topic = 'changed';
  expect(first).toEqual({ actorId: 'player', npcId: 'aro', time,
    choice: liked, requestedChange: 7, change: 7, value: 7 });
  interact(world, state, 'player', npcs[0], time, liked);
  interact(world, state, 'player', npcs[0], time, liked);
  interact(world, state, 'player', npcs[0], time, disliked);
  expect(state.interactions.map(entry => entry.change)).toEqual([7, 3, 0, -5]);
  const restored = JSON.parse(JSON.stringify(state));
  expect(interact(world, restored, 'player', npcs[0], time, liked).change).toBe(0);
});

it('rejects invalid interactions before mutating values or history', () => {
  const world = createWorld();
  const state = createRelationshipState();
  expect(() => interact(world, state, 'player', npcs[0], { ...time, minute: 60 }, liked)).toThrow();
  expect(() => interact(world, state, 'aro', npcs[0], time, liked)).toThrow();
  expect(world.relationships).toEqual({});
  expect(state.interactions).toEqual([]);
});
