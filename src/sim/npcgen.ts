import { archetypes, type Archetype } from '../data/archetypes';
import { generatedNames } from '../data/names';
import { npcs, type Npc } from '../data/npcs';
import { whereIs } from './npc';

export interface GeneratedNpc extends Npc {
  archetypeId: string;
  speech: Archetype['speech'];
  appearance: {
    hairLength: 'cropped' | 'short' | 'medium' | 'long';
    hairColor: 'ink' | 'ash' | 'copper' | 'sand' | 'silver';
    build: 'slender' | 'average' | 'broad';
    clothingPalette: 'slate' | 'moss' | 'amber' | 'plum' | 'cream';
    height: number; // Relative scale, 0.9–1.1.
  };
}

// Temporary local policy: Place has no capacity field yet. Reserve home beds and
// workplace places all week, including days off. This conservative roster bound
// guarantees simultaneous occupancy without per-minute population searches.
export const placeCapacities: Readonly<Record<string, number>> = {
  nest: 24, quiet: 24, high: 24, cafe: 12, shop: 16, office: 24, park: 24,
};
const homes = ['nest', 'quiet', 'high'];
const occupations = [
  { place: 'cafe', job: '잔향 차 배합사' },
  { place: 'shop', job: '공유물 순환지기' },
  { place: 'office', job: '빛씨 조율사' },
  { place: 'park', job: '떠오름 뜰 돌봄사' },
];

function vacancies(): Record<string, number> {
  const peaks = Object.fromEntries(Object.keys(placeCapacities).map(id => [id, 0]));
  for (let day = 0; day < 7; day++) {
    const boundaries = new Set(npcs.flatMap(npc => npc.schedule[day].map(slot => slot.fromMinute)));
    for (const minute of boundaries) {
      const counts: Record<string, number> = {};
      for (const npc of npcs) {
        const id = whereIs(npc, { day: day + 1, hour: Math.floor(minute / 60), minute: minute % 60 });
        counts[id] = (counts[id] ?? 0) + 1;
        peaks[id] = Math.max(peaks[id], counts[id]);
      }
    }
  }
  return Object.fromEntries(Object.entries(placeCapacities).map(([id, capacity]) => [id, capacity - peaks[id]]));
}

// Seed is an unsigned 32-bit integer; state belongs to this call only.
export function generate(seed: number, count: number): GeneratedNpc[] {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(count) || count < 0) {
    throw Error('Expected uint32 seed and non-negative integer count');
  }
  const free = vacancies();
  const limit = Math.min(homes.reduce((sum, id) => sum + free[id], 0),
    occupations.reduce((sum, job) => sum + free[job.place], 0), generatedNames.length);
  if (count > limit) throw Error(`NPC capacity exceeded: ${count} > ${limit}`);
  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const pick = <T>(values: readonly T[]): T => values[Math.floor(random() * values.length)];
  const names = generatedNames.filter(name => !npcs.some(npc => npc.name === name));
  return Array.from({ length: count }, (_, index) => {
    const archetype = pick(archetypes);
    const name = names.splice(Math.floor(random() * names.length), 1)[0];
    const home = pick(homes.filter(id => free[id] > 0));
    const work = pick(occupations.filter(job => free[job.place] > 0));
    free[home]--; free[work.place]--;
    const start = (6 + Math.floor(random() * 5)) * 60;
    const restDay = Math.floor(random() * 7);
    return {
      id: `generated-${seed}-${index}`, name, age: 18 + Math.floor(random() * 53), job: work.job,
      archetypeId: archetype.id, traits: [...archetype.traits],
      likes: [...archetype.likes], dislikes: [...archetype.dislikes],
      speech: { ...archetype.speech, politeEndings: [...archetype.speech.politeEndings],
        informalEndings: [...archetype.speech.informalEndings] },
      appearance: {
        hairLength: pick(['cropped', 'short', 'medium', 'long'] as const),
        hairColor: pick(['ink', 'ash', 'copper', 'sand', 'silver'] as const),
        build: pick(['slender', 'average', 'broad'] as const),
        clothingPalette: pick(['slate', 'moss', 'amber', 'plum', 'cream'] as const),
        height: (90 + Math.floor(random() * 21)) / 100,
      },
      schedule: Array.from({ length: 7 }, (_, day) => day === restDay
        ? [{ fromMinute: 0, placeId: home }]
        : [{ fromMinute: 0, placeId: home }, { fromMinute: start, placeId: work.place },
          { fromMinute: start + 480, placeId: home }]),
    };
  });
}
