import { expect, it } from 'vitest';
import { commonBarks, personaBarks, personas, situations, type PersonaId } from '../../src/data/personas';
import { applyPersona, assignPersona, bark, decideWithPersona, groupSize, parkingEffect,
  parkingHogMinutes, promotePersona, reputationChange, visitWeight } from '../../src/sim/persona';
import { chooseNeed, decide } from '../../src/sim/customer';

it.each([{}, { age: 18, job: '학생', traits: ['practical', 'curious'] as const },
  { age: 70, job: '사무직', traits: ['quiet'] as const }])(
  'assigns deterministically and keeps 100,000 samples within two percentage points: %j', npc => {
    const counts = Object.fromEntries(Object.keys(personas).map(id => [id, 0]));
    let deterministic = true;
    for (let i = 0; i < 100000; i++) {
      const sample = i / 100000;
      const id = assignPersona(npc, sample);
      deterministic = assignPersona(npc, sample) === id && deterministic;
      counts[id]++;
    }
    for (const p of Object.values(personas)) expect(Math.abs(counts[p.id] / 1000 - p.assignmentWeight)).toBeLessThanOrEqual(2);
    expect(counts.regular).toBe(0);
    expect(deterministic).toBe(true);
  expect(assignPersona({}, 0)).toBe('bigSpender');
  expect(assignPersona({}, 0.999999)).toBe('reviewer');
  expect(assignPersona({ age: 70 }, 0.96)).toBe('elder');
  expect(() => assignPersona({}, 1)).toThrow();
});

it('copies customers and produces usable integer patience without mutating their likes', () => {
  const original = Object.freeze({ likes: Object.freeze(['tea']), priceTolerance: 1, patienceMinutes: 5 });
  for (const p of Object.values(personas)) {
    const result = applyPersona(original, p.id);
    expect(result).not.toBe(original);
    expect(result.likes).not.toBe(original.likes);
    expect(result.priceTolerance).toBe(p.priceTolerance);
    expect(result.patienceMinutes).toBe(Math.round(5 * p.patienceMinutes));
    expect(() => chooseNeed(result, [{ id: 'tea', topic: 'tea', price: 10 }], 0)).not.toThrow();
    expect(p.basket).toBeGreaterThanOrEqual(1);
    expect(p.basket).toBeLessThanOrEqual(4);
  }
  expect(original).toEqual({ likes: ['tea'], priceTolerance: 1, patienceMinutes: 5 });
  expect(personas.bigSpender.basket).toBe(4);
  expect(promotePersona('browser', 2)).toBe('browser');
  expect(promotePersona('browser', 3)).toBe('regular');
  expect(visitWeight('regular', 5)).toBeGreaterThan(visitWeight('regular', 3));
  expect(visitWeight('browser', 5)).toBe(visitWeight('browser', 0));
});

it('offers haggling through exactly 10%, preserving normal decisions and budget checks', () => {
  const need = { itemId: 'tea', maxPrice: 100 };
  const offer = { itemId: 'tea', price: 110, available: 1 };
  expect(decideWithPersona(need, offer, 100, 'haggler')).toBe('haggle');
  expect(decideWithPersona(need, { ...offer, price: 109 }, 100, 'haggler')).toBe('haggle');
  expect(decideWithPersona(need, { ...offer, price: 111 }, 200, 'haggler')).toBe('expensive');
  expect(decideWithPersona({ ...need, maxPrice: 10 }, { ...offer, price: 11 }, 10, 'haggler')).toBe('haggle');
  expect(decideWithPersona(need, offer, 99, 'haggler')).toBe('expensive');
  for (const id of Object.keys(personas) as PersonaId[]) {
    for (const candidate of [undefined, offer, { ...offer, available: 0 }, { ...offer, price: 100 },
      { ...offer, itemId: 'other' }]) {
      if (id !== 'haggler' || candidate !== offer) expect(decideWithPersona(need, candidate, 100, id)).toBe(decide(need, candidate, 100));
    }
  }
});

it('returns parking occupancy and reduced visits until the exact release minute', () => {
  expect(parkingEffect('parkingHog', 10, 10, 2)).toEqual({ occupiedUntil: 10 + parkingHogMinutes, occupiedSlots: 1, visitProbabilityMultiplier: 0.5 });
  expect(parkingEffect('parkingHog', 10, 29, 1).visitProbabilityMultiplier).toBe(0);
  expect(parkingEffect('parkingHog', 10, 30, 1).occupiedSlots).toBe(0);
  expect(parkingEffect('parkingHog', 10, 30, 1).visitProbabilityMultiplier).toBe(1);
  expect(parkingEffect('browser', 10, 10, 2).visitProbabilityMultiplier).toBe(1);
  expect(parkingEffect('parkingHog', 10, 10, 0).occupiedSlots).toBe(0);
  expect(parkingEffect('parkingHog', 10, 10, 0).visitProbabilityMultiplier).toBe(0);
});

it('handles groups and signed reputation effects', () => {
  expect([0, 0.34, 0.999].map(s => groupSize('students', s))).toEqual([2, 3, 4]);
  expect(groupSize('browser', 0.99)).toBe(1);
  expect(reputationChange('complainer', -2)).toBe(-4);
  expect(reputationChange('complainer', 2)).toBe(2);
  expect(reputationChange('reviewer', -2)).toBe(-6);
  expect(reputationChange('reviewer', 2)).toBe(6);
  expect(reputationChange('browser', -2)).toBe(-2);
});

it('covers every persona and situation with at least three short, nonempty lines', () => {
  for (const id of Object.keys(personas) as PersonaId[]) for (const situation of situations) {
    const lines = personaBarks[id][situation] ?? commonBarks[situation];
    expect(new Set(lines).size).toBeGreaterThanOrEqual(3);
    for (const line of lines) { expect(line.trim()).not.toBe(''); expect([...line].length).toBeLessThanOrEqual(30); }
    for (const sample of [0, 0.34, 0.999]) expect(bark(id, situation, sample)).toBe(lines[Math.floor(sample * lines.length)]);
  }
});

it('rejects invalid samples, counts and reversed time', () => {
  for (const sample of [-0.1, 1, NaN, Infinity]) {
    expect(() => bark('regular', 'enter', sample)).toThrow();
    expect(() => groupSize('students', sample)).toThrow();
  }
  expect(() => promotePersona('browser', -1)).toThrow();
  expect(() => visitWeight('regular', 0.5)).toThrow();
  expect(() => parkingEffect('parkingHog', 10, 9, 1)).toThrow();
  expect(() => parkingEffect('parkingHog', 0, 1, -1)).toThrow();
});
