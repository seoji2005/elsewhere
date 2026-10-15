import { commonBarks, personaBarks, personas, type PersonaId, type Situation } from '../data/personas';
import type { Npc } from '../data/npcs';
import { decide, type Customer, type Need, type Offer } from './customer';

function checkSample(sample: number): void {
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1) throw Error('Invalid sample');
}
function checkNatural(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw Error('Invalid count or minute');
}
// Mild affinities preserve the overall mix; traits never force a persona.
export function assignPersona(npc: Partial<Pick<Npc, 'traits' | 'job' | 'age'>>, sample: number): PersonaId {
  checkSample(sample);
  const weights = Object.values(personas).map(p => {
    const affinity = (p.id === 'elder' && (npc.age ?? 0) >= 65) ||
      (p.id === 'students' && (/학생/.test(npc.job ?? '') || (npc.age ?? 99) < 20)) ||
      (p.id === 'rusher' && /직장인|사무|회사/.test(npc.job ?? '')) ||
      (p.id === 'haggler' && npc.traits?.includes('practical')) ||
      (p.id === 'reviewer' && npc.traits?.includes('curious'));
    return { id: p.id, weight: p.assignmentWeight * (affinity ? 1.1 : 1) };
  });
  let remaining = sample * weights.reduce((sum, p) => sum + p.weight, 0);
  for (const p of weights) {
    remaining -= p.weight;
    if (remaining < 0) return p.id;
  }
  return 'reviewer';
}
// visits is this NPC's completed visit count at this store, not the city total.
export function promotePersona(id: PersonaId, visits: number): PersonaId {
  checkNatural(visits);
  return visits >= 3 ? 'regular' : id;
}
export function visitWeight(id: PersonaId, visits: number): number {
  checkNatural(visits);
  return personas[id].visitWeight * (id === 'regular' ? 1 + Math.min(visits, 10) * 0.1 : 1);
}
export function applyPersona(customer: Customer, id: PersonaId): Customer {
  checkNatural(customer.patienceMinutes);
  if (!Number.isFinite(customer.priceTolerance) || customer.priceTolerance <= 0) throw Error('Invalid customer');
  const p = personas[id];
  const priceTolerance = customer.priceTolerance * p.priceTolerance;
  const patienceMinutes = Math.round(customer.patienceMinutes * p.patienceMinutes);
  if (!Number.isFinite(priceTolerance)) throw Error('Price tolerance overflow');
  checkNatural(patienceMinutes);
  return { ...customer, likes: [...customer.likes], priceTolerance, patienceMinutes };
}
export function decideWithPersona(need: Need, offer: Offer | undefined, budget: number,
  id: PersonaId): ReturnType<typeof decide> | 'haggle' {
  const result = decide(need, offer, budget);
  // Integer currency: subtract first to include exactly 10% without float overshoot.
  if (id === 'haggler' && result === 'expensive' && offer && need.maxPrice > 0 &&
      offer.price - need.maxPrice <= need.maxPrice / 10 && budget >= need.maxPrice) return 'haggle';
  return result;
}
export function groupSize(id: PersonaId, sample: number): number {
  checkSample(sample);
  return id === 'students' ? 2 + Math.floor(sample * 3) : 1;
}
export function reputationChange(id: PersonaId, delta: number): number {
  if (!Number.isFinite(delta)) throw Error('Invalid reputation delta');
  return delta * (id === 'reviewer' ? 3 : id === 'complainer' && delta < 0 ? 2 : 1);
}
export const parkingHogMinutes = 20;
// One hog occupies one space on [parkedMinute, occupiedUntil); caller combines simultaneous visits.
// Zero spaces means no parking-dependent visits, even when this visitor is not a hog.
export function parkingEffect(id: PersonaId, parkedMinute: number, nowMinute: number, parkingSlots: number) {
  [parkedMinute, nowMinute, parkingSlots].forEach(checkNatural);
  if (nowMinute < parkedMinute) throw Error('Reversed parking time');
  const occupiedUntil = parkedMinute + (id === 'parkingHog' ? parkingHogMinutes : 0);
  checkNatural(occupiedUntil);
  const occupiedSlots = parkingSlots > 0 && nowMinute < occupiedUntil ? 1 : 0;
  return { occupiedUntil, occupiedSlots,
    visitProbabilityMultiplier: parkingSlots === 0 ? 0 : (parkingSlots - occupiedSlots) / parkingSlots };
}
export function bark(id: PersonaId, situation: Situation, sample: number): string {
  checkSample(sample);
  const lines = personaBarks[id][situation] ?? commonBarks[situation];
  return lines[Math.floor(sample * lines.length)];
}
