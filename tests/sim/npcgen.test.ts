import { expect, it } from 'vitest';
import { archetypes } from '../../src/data/archetypes';
import { generatedNames } from '../../src/data/names';
import { npcs, type Npc } from '../../src/data/npcs';
import { places } from '../../src/data/places';
import { generate, placeCapacities } from '../../src/sim/npcgen';
import { whereIs } from '../../src/sim/npc';
import { dialogueReaction } from '../../src/sim/relationship';

it('defines distinct archetypes with complete speech rules and opposing preferences', () => {
  expect(archetypes.length).toBeGreaterThanOrEqual(10);
  expect(new Set(archetypes.map(a => a.id)).size).toBe(archetypes.length);
  for (const a of archetypes) {
    expect(a.traits.length).toBeGreaterThanOrEqual(2);
    expect(a.likes.length && a.dislikes.length).toBeGreaterThan(0);
    expect(a.likes.some(like => a.dislikes.includes(like))).toBe(false);
    expect(a.speech.informalAt).toBeGreaterThan(0);
    expect(a.speech.publicPolite && a.speech.requiresAgreement).toBe(true);
    expect(a.speech.politeEndings.length && a.speech.informalEndings.length).toBeGreaterThan(0);
    expect(a.speech.politeAddress && a.speech.informalAddress).toBeTruthy();
    expect(a.speech.maxSentences).toBeGreaterThan(0);
  }
});

it('is deterministic, independent of other calls and different across seeds', () => {
  const first = generate(21, 50);
  expect(generate(22, 50)).not.toEqual(first);
  expect(generate(21, 50)).toEqual(first);
  expect(generate(21, 3)).toEqual(first.slice(0, 3));
  expect(generate(0xffffffff, 50)).toHaveLength(50);
  expect(generate(0, 0)).toEqual([]);
  const changed = generate(21, 50);
  changed[0].schedule[0][0].placeId = 'changed';
  changed[0].speech.informalAt = 999;
  expect(generate(21, 50)).toEqual(first);
});

it('creates unique fictional names, usable NPC profiles and varied appearance', () => {
  const generated = generate(21, 50);
  expect(new Set(generated.map(npc => npc.name)).size).toBe(50);
  expect(new Set([...npcs, ...generated].map(npc => npc.id)).size).toBe(50 + npcs.length);
  expect(new Set(generated.map(npc => npc.archetypeId)).size).toBe(10);
  expect(new Set(generated.map(npc => JSON.stringify(npc.appearance))).size).toBeGreaterThan(40);
  for (const npc of generated) {
    const compatible: Npc = npc;
    expect(generatedNames).toContain(npc.name);
    expect([...npcs.map(core => core.name), '리세']).not.toContain(npc.name);
    expect(npc.age).toBeGreaterThanOrEqual(18);
    expect(npc.appearance.height).toBeGreaterThanOrEqual(0.9);
    expect(npc.appearance.height).toBeLessThanOrEqual(1.1);
    expect(dialogueReaction(compatible, { id: 'test', topic: npc.likes[0], tone: npc.traits[0] })).toBe(7);
  }
});

it('keeps all weekly intervals within capacity including core residents', () => {
  for (const seed of [0, 1, 21, 42, 0xffffffff]) {
    const generated = generate(seed, seed === 42 ? 66 : 50); // 42: fill to capacity (66 with 6 core residents)
    const residents: Npc[] = [...npcs, ...generated];
    for (const npc of generated) {
      expect(npc.schedule).toHaveLength(7);
      expect(npc.schedule.filter(day => day.length === 1)).toHaveLength(1);
      expect(new Set(npc.schedule.flat().map(slot => slot.placeId)).size).toBe(2);
      for (const day of npc.schedule) {
        expect(day[0].fromMinute).toBe(0);
        day.forEach((slot, i) => {
          expect(places.map(place => place.id)).toContain(slot.placeId);
          expect(slot.fromMinute).toBeLessThan(1440);
          if (i) expect(slot.fromMinute).toBeGreaterThan(day[i - 1].fromMinute);
        });
      }
    }
    for (let day = 1; day <= 7; day++) {
      // Occupancy is constant between these boundaries, covering every minute.
      const boundaries = new Set(residents.flatMap(npc => npc.schedule[day - 1].map(slot => slot.fromMinute)));
      for (const minute of boundaries) {
        const counts: Record<string, number> = {};
        for (const npc of residents) {
          const place = whereIs(npc, { day, hour: Math.floor(minute / 60), minute: minute % 60 });
          counts[place] = (counts[place] ?? 0) + 1;
        }
        for (const [place, count] of Object.entries(counts)) expect(count).toBeLessThanOrEqual(placeCapacities[place]);
      }
    }
  }
});

it('rejects invalid inputs and excess population instead of overflowing places', () => {
  for (const seed of [-1, 1.5, NaN, Infinity, 0x100000000]) expect(() => generate(seed, 50)).toThrow();
  for (const count of [-1, 1.5, NaN, Infinity, 68, 10000]) expect(() => generate(21, count)).toThrow();
});

it('generates 50 residents within the 50ms target on this host (phone requires device measurement)', () => {
  const start = performance.now();
  const result = generate(21, 50);
  const elapsed = performance.now() - start;
  console.info(`generate(21, 50): ${elapsed.toFixed(2)}ms`);
  expect(result).toHaveLength(50);
  expect(elapsed).toBeLessThan(50);
});
