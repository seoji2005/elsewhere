import { expect, it } from 'vitest';
import { createBonds, edgeKey, emptyBond, readBond } from '../../src/sim/bonds';
import { createRippleState, deliverRipple, noticeLine, type SocialEvent } from '../../src/sim/ripple';
import { createWorld } from '../../src/sim/world';
const time = { day: 1, hour: 9, minute: 0 }, later = (hour: number, minute = 0) => ({ ...time, hour, minute });
function setup(kind: SocialEvent['kind'] = 'help') {
  const world = createWorld(), bonds = createBonds(), state = createRippleState();
  const dating = { dating: [] as { actorId: string; npcId: string }[] };
  for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) {
    world.people[id] = { id, name: id, role: id === 'a' ? 'player' : 'npc', placeId: 'park' };
    if (id !== 'b') bonds.edges[edgeKey(id, 'b')] = { ...emptyBond(), met: true,
      affection: 30, trust: 15, comfort: 10 };
  }
  const event: SocialEvent = { id: 'public-1', actorId: 'a', targetId: 'b', time, placeId: 'park', topic: '도움', kind };
  const send = (id: string, now = time, source?: string) => deliverRipple(state, bonds, world, dating, event, id, now, source);
  return { world, bonds, state, dating, event, send };
}
it('requires actual event-time presence, third-party NPCs and valid events', () => {
  const { world, state, event, send } = setup();
  expect(send('missing')).toBeNull(); expect(send('a')).toBeNull(); expect(send('b')).toBeNull();
  for (const id of ['a', 'b', 'c']) {
    world.people[id].placeId = 'shop'; expect(send('c')).toBeNull(); world.people[id].placeId = 'park';
  }
  expect(send('c', later(8))).toBeNull(); expect(send('c', later(9, 1))).toBeNull();
  world.people.c.role = 'player'; expect(send('c')).toBeNull();
  event.id = ''; expect(() => send('d')).toThrow(); expect(state.notices).toEqual([]);
});
it.each(['help', 'hurt'] as const)('applies %s once, without inventing a meeting, including after restore', kind => {
  const { bonds, state, world, dating, event, send } = setup(kind), value = kind === 'help' ? 1 : -1;
  expect(send('c')).toMatchObject({ mode: 'witness', sourceId: 'c', hops: 0 });
  expect(readBond(bonds, 'c', 'a')).toMatchObject({ affection: value, trust: value, met: false });
  expect(send('c')).toBeNull();
  expect(deliverRipple(JSON.parse(JSON.stringify(state)), JSON.parse(JSON.stringify(bonds)), world, dating, event, 'c', time)).toBeNull();
  expect(readBond(bonds, 'c', 'a')).toMatchObject({ affection: value, trust: value, met: false });
  expect(state.notices).toHaveLength(1); expect(readBond(bonds, 'a', 'c').affection).toBe(0);
});
it('uses directional friendship or dating with the target, while others only receive notices', () => {
  const { bonds, dating, send } = setup();
  bonds.edges[edgeKey('c', 'b')] = emptyBond();
  bonds.edges[edgeKey('b', 'c')] = { ...emptyBond(), met: true, affection: 40, trust: 20, comfort: 20 };
  expect(send('c')).not.toBeNull(); expect(readBond(bonds, 'c', 'a').trust).toBe(0);
  bonds.edges[edgeKey('d', 'b')] = emptyBond(); dating.dating.push({ actorId: 'b', npcId: 'd' });
  send('d'); expect(readBond(bonds, 'd', 'a').trust).toBe(1);
});
it.each(['help', 'hurt'] as const)('spreads %s with trust, delay, two hops, attenuation and listener deduplication', kind => {
  const { bonds, world, state, send } = setup(kind), value = kind === 'help' ? 1 : -1;
  for (const [a, b] of [['d', 'c'], ['e', 'd'], ['f', 'e'], ['e', 'c']]) {
    bonds.edges[edgeKey(a, b)] = { ...emptyBond(), trust: 15 };
  }
  expect(send('d', later(10), 'c')).toBeNull(); send('c');
  expect(send('d', later(9, 59), 'c')).toBeNull();
  bonds.edges[edgeKey('c', 'd')] = { ...emptyBond(), trust: 30 };
  bonds.edges[edgeKey('d', 'c')].trust = 14; expect(send('d', later(10), 'c')).toBeNull();
  bonds.edges[edgeKey('d', 'c')].trust = 15; world.people.d.placeId = 'shop';
  expect(send('d', later(10), 'c')).toBeNull(); world.people.c.placeId = 'shop';
  expect(send('d', later(10), 'c')).toMatchObject({ mode: 'rumor', sourceId: 'c', hops: 1, learned: 600 });
  expect(readBond(bonds, 'd', 'a')).toMatchObject({ affection: value / 2, trust: value / 2, met: false });
  world.people.e.placeId = 'shop'; expect(send('e', later(10, 59), 'd')).toBeNull();
  expect(send('e', later(11), 'd')).toMatchObject({ hops: 2 });
  expect(readBond(bonds, 'e', 'a').trust).toBe(value / 4);
  expect(send('e', later(11), 'c')).toBeNull(); world.people.f.placeId = 'shop';
  expect(send('f', later(12), 'e')).toBeNull(); expect(state.notices).toHaveLength(3);
  expect(noticeLine('c', state, later(11))).toContain('봤어요'); expect(noticeLine('d', state, later(11))).toContain('들었어요');
});
it('expires from the original event at 14 days and lets two residents mention public dating', () => {
  const { state, bonds, dating, send } = setup('dating');
  expect(send('c')).toBeNull(); dating.dating.push({ actorId: 'a', npcId: 'b' });
  send('c'); send('d'); bonds.edges[edgeKey('e', 'c')] = { ...emptyBond(), trust: 15 };
  bonds.edges[edgeKey('f', 'c')] = { ...emptyBond(), trust: 15 };
  for (const id of ['c', 'd']) expect(noticeLine(id, state, later(10), { a: '민수', b: '리세' })).toContain('민수 님과 리세 님이 교제');
  expect(noticeLine('c', state, later(8))).toBeNull(); expect(noticeLine('f', state, time)).toBeNull();
  send('e', { ...time, day: 15, hour: 8, minute: 59 }, 'c');
  expect(noticeLine('e', state, { ...time, day: 15, hour: 8, minute: 59 })).toContain('사귄다고 들었어요');
  expect(send('f', { ...time, day: 15 }, 'c')).toBeNull();
  expect(noticeLine('e', state, { ...time, day: 15 })).toBeNull(); expect(readBond(bonds, 'c', 'a').trust).toBe(0);
});
