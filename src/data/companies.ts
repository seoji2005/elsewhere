export interface MarketCompany {
  id: string; name: string; industry: string; npcId: string; basePrice: number; volatility: number;
}
export const companies: readonly MarketCompany[] = [
  { id: 'light', name: '빛고리 빛씨', industry: '빛씨 조율', npcId: 'aro', basePrice: 100, volatility: 0.03 },
  { id: 'tea', name: '잔물결 배합', industry: '잔향 차', npcId: 'nuel', basePrice: 80, volatility: 0.02 },
  { id: 'cycle', name: '모아결 순환', industry: '공유물 수선', npcId: 'sori', basePrice: 120, volatility: 0.015 },
];
