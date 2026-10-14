import { expect, it } from 'vitest';
import { createMemoryState, MEMORY_LIMIT, minuteOf, recall, remember } from '../../src/sim/memory';
import type { Interaction } from '../../src/sim/relationship';

const time = { day: 1, hour: 9, minute: 0 };
function event(overrides: Partial<Interaction> = {}): Interaction {
  return { actorId: 'player', npcId: 'aro', time, choice: {
    id: 'gift:light', topic: '빛씨', tone: 'curious',
  }, requestedChange: 7, change: 0, value: 10, ...overrides };
}
it('copies committed events, deduplicates and isolates NPCs and actors', () => {
  const state = createMemoryState('aro'), entry = event();
  expect(remember(state, 'one', entry)).toBe(true);
  expect(remember(state, 'one', entry)).toBe(false);
  entry.choice.topic = 'changed';
  expect(recall(state, time, { subjectId: 'player' })[0].topic).toBe('빛씨');
  expect(recall(state, time, { subjectId: 'other' })).toEqual([]);
  expect(() => remember(state, 'wrong', event({ npcId: 'iri' }))).toThrow();
  const copy = recall(state, time, { subjectId: 'player' })[0];
  copy.topic = 'modified';
  expect(state.entries[0].topic).toBe('빛씨');
});
it('ranks relevant memories, excludes future and expired records, bounds storage', () => {
  const state = createMemoryState('aro');
  remember(state, 'gift', event());
  remember(state, 'chat', event({ choice: { id: 'chat:0', topic: '수선', tone: 'quiet' }, change: 7 }));
  expect(recall(state, time, { subjectId: 'player', topic: '빛씨' }, 1)[0].id).toBe('gift');
  expect(recall(state, { ...time, hour: 8 }, { subjectId: 'player' })).toEqual([]);
  expect(recall(state, { ...time, day: 15 }, { subjectId: 'player' })).toEqual([]);
  for (let i = 0; i < MEMORY_LIMIT; i++) remember(state, `new-${i}`, event());
  expect(state.entries).toHaveLength(MEMORY_LIMIT);
  expect(state.entries.some(memory => memory.id === 'gift')).toBe(false);
  expect(() => recall(state, time, { subjectId: 'player' }, -1)).toThrow();
  expect(() => minuteOf({ ...time, minute: 60 })).toThrow();
  expect(() => minuteOf({ ...time, day: Number.MAX_SAFE_INTEGER })).toThrow();
});
