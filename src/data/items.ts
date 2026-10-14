import type { Trait } from './npcs';
export interface Item {
  id: string; name: string; category: 'food' | 'clothing' | 'decor'; price: number;
  energy: number; appearance: number; atmosphere: number; topic: string; tone: Trait;
}
export const items: readonly Item[] = [
  { id: 'tea', name: '잔향 차', category: 'food', price: 8,
    energy: 15, appearance: 0, atmosphere: 0, topic: '잔향 차', tone: 'social' },
  { id: 'bread', name: '결빛 빵', category: 'food', price: 10,
    energy: 25, appearance: 0, atmosphere: 0, topic: '약속', tone: 'practical' },
  { id: 'soup', name: '뜰 채소 수프', category: 'food', price: 15,
    energy: 40, appearance: 0, atmosphere: 0, topic: '수선', tone: 'practical' },
  { id: 'scarf', name: '수선한 목도리', category: 'clothing', price: 25,
    energy: 0, appearance: 3, atmosphere: 0, topic: '수선', tone: 'quiet' },
  { id: 'coat', name: '빛결 외투', category: 'clothing', price: 60,
    energy: 0, appearance: 7, atmosphere: 0, topic: '새로운 생각', tone: 'curious' },
  { id: 'lamp', name: '빛씨 등', category: 'decor', price: 30,
    energy: 0, appearance: 0, atmosphere: 5, topic: '빛씨', tone: 'curious' },
  { id: 'chime', name: '잔향 풍경', category: 'decor', price: 20,
    energy: 0, appearance: 0, atmosphere: 3, topic: '잔향', tone: 'playful' },
  { id: 'speaker', name: '울림 상자', category: 'decor', price: 35,
    energy: 0, appearance: 0, atmosphere: 4, topic: '큰 소리', tone: 'social' },
];
