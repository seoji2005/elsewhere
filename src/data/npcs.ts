export type Trait = 'curious' | 'quiet' | 'social' | 'practical' | 'playful';
export interface ScheduleSlot { fromMinute: number; placeId: string }
export interface Npc {
  id: string;
  name: string;
  age: number;
  job: string;
  traits: readonly Trait[];
  likes: readonly string[];
  dislikes: readonly string[];
  // Seven local weekdays; each day's slots start at midnight, in ascending order.
  schedule: readonly (readonly ScheduleSlot[])[];
}

function week(home: string, work: string, start: number, end: number, restDay: number): Npc['schedule'] {
  return Array.from({ length: 7 }, (_, day) => day === restDay
    ? [{ fromMinute: 0, placeId: home }, { fromMinute: 600, placeId: 'park' },
      { fromMinute: 960, placeId: 'cafe' }, { fromMinute: 1200, placeId: home }]
    : [{ fromMinute: 0, placeId: home }, { fromMinute: start, placeId: work },
      { fromMinute: end, placeId: 'park' }, { fromMinute: end + 90, placeId: home }]);
}

// Residents of the fictional Gyeol society: light, echoes and shared objects shape their work.
export const npcs: readonly Npc[] = [
  { id: 'aro', name: '아로', age: 26, job: '빛씨 조율사',
    traits: ['curious', 'quiet'], likes: ['빛씨', '새로운 생각'], dislikes: ['큰 소리'],
    schedule: week('quiet', 'office', 360, 900, 5) },
  { id: 'nuel', name: '누엘', age: 31, job: '잔향 차 배합사',
    traits: ['social', 'playful'], likes: ['잔향 차', '큰 소리'], dislikes: ['서두르기'],
    schedule: week('nest', 'cafe', 420, 1080, 1) },
  { id: 'sori', name: '소리안', age: 44, job: '공유물 순환지기',
    traits: ['practical', 'quiet'], likes: ['수선', '약속'], dislikes: ['낭비'],
    schedule: week('high', 'shop', 480, 1020, 6) },
  { id: 'velo', name: '벨로', age: 23, job: '밤결 기록사',
    traits: ['curious', 'playful'], likes: ['새로운 생각', '잔향'], dislikes: ['약속'],
    schedule: Array.from({ length: 7 }, (_, day) => day === 3
      ? [{ fromMinute: 0, placeId: 'nest' }, { fromMinute: 840, placeId: 'park' }]
      : [{ fromMinute: 0, placeId: 'office' }, { fromMinute: 240, placeId: 'nest' },
        { fromMinute: 900, placeId: 'cafe' }, { fromMinute: 1200, placeId: 'office' }]) },
  { id: 'iri', name: '이리', age: 38, job: '떠오름 뜰 돌봄사',
    traits: ['social', 'practical'], likes: ['빛씨', '수선'], dislikes: ['큰 소리'],
    schedule: week('high', 'park', 300, 780, 2) },
];
