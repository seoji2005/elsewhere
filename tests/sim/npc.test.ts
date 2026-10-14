import { expect, it } from 'vitest';
import { npcs } from '../../src/data/npcs';
import { places } from '../../src/data/places';
import { whereIs } from '../../src/sim/npc';

it('has six complete residents and seven named places with valid weekly schedules', () => {
  expect(npcs).toHaveLength(6);
  expect(new Set(npcs.map(npc => npc.id)).size).toBe(6);
  expect(places).toHaveLength(7);
  expect(new Set(places.map(place => place.id)).size).toBe(7);
  for (const npc of npcs) {
    expect(npc.name && npc.job).toBeTruthy();
    expect(npc.age).toBeGreaterThan(0);
    expect(npc.traits.length).toBeGreaterThanOrEqual(2);
    expect(npc.traits.length).toBeLessThanOrEqual(3);
    expect(npc.likes.length && npc.dislikes.length).toBeGreaterThan(0);
    expect(npc.schedule).toHaveLength(7);
    for (const slots of npc.schedule) {
      expect(slots[0].fromMinute).toBe(0);
      slots.forEach((slot, index) => {
        expect(places.some(place => place.id === slot.placeId)).toBe(true);
        expect(slot.fromMinute).toBeLessThan(1440);
        if (index) expect(slot.fromMinute).toBeGreaterThan(slots[index - 1].fromMinute);
      });
    }
  }
});

it('locates every resident differently in morning and evening', () => {
  for (const npc of npcs) {
    expect(whereIs(npc, { day: 1, hour: 8, minute: 0 }))
      .not.toBe(whereIs(npc, { day: 1, hour: 20, minute: 0 }));
  }
});

it('uses exact slot boundaries, rest days, midnight and repeating weekdays', () => {
  const aro = npcs[0];
  expect(whereIs(aro, { day: 1, hour: 5, minute: 59 })).toBe('quiet');
  expect(whereIs(aro, { day: 1, hour: 6, minute: 0 })).toBe('office');
  expect(whereIs(aro, { day: 6, hour: 10, minute: 0 })).toBe('park');
  expect(whereIs(aro, { day: 8, hour: 6, minute: 0 })).toBe('office');
  expect(whereIs(npcs[3], { day: 1, hour: 0, minute: 0 })).toBe('office');
  expect(() => whereIs(aro, { day: 0, hour: 0, minute: 0 })).toThrow();
  expect(() => whereIs(aro, { day: 1, hour: 24, minute: 0 })).toThrow();
});
