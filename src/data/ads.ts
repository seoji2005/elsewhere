// Ad channels, messages and models (pillar 8). Numbers are first-pass guesses for a neighborhood shop.
export type Segment = 'students' | 'workers' | 'elders' | 'families' | 'affluent';
export type Reach = 'neighborhood' | 'city' | 'national';
export type Fit = Record<Segment, number>;
export const segments: readonly Segment[] = ['students', 'workers', 'elders', 'families', 'affluent'];
export const segmentNames: Record<Segment, string> = {
  students: '학생', workers: '직장인', elders: '어르신', families: '가족', affluent: '부유층',
};
// Share of a campaign's audience that lives too far away to visit a neighborhood shop.
export const reachWaste: Record<Reach, number> = { neighborhood: 0, city: 0.5, national: 0.8 };

export interface AdChannel {
  id: string; name: string; weeklyCost: number; reach: Reach; fit: Fit;
  power: number;    // exposure before reach waste; saturates into visit consideration
  leadDays: number; // days before the ad starts running
  variance: number; // 0..1; hit and dud chances are each variance / 2
}
const fit = (students: number, workers: number, elders: number, families: number, affluent: number): Fit =>
  ({ students, workers, elders, families, affluent });
export const adChannels: readonly AdChannel[] = [
  { id: 'flyer', name: '전단지', weeklyCost: 20, reach: 'neighborhood', fit: fit(0.3, 0.4, 1, 0.9, 0.3), power: 0.25, leadDays: 1, variance: 0.1 },
  { id: 'banner', name: '현수막', weeklyCost: 35, reach: 'neighborhood', fit: fit(0.5, 0.6, 0.8, 0.8, 0.4), power: 0.2, leadDays: 2, variance: 0.15 },
  { id: 'transit', name: '버스 광고', weeklyCost: 90, reach: 'city', fit: fit(0.8, 1, 0.6, 0.5, 0.3), power: 0.5, leadDays: 3, variance: 0.25 },
  { id: 'search', name: '검색광고', weeklyCost: 50, reach: 'neighborhood', fit: fit(0.7, 0.9, 0.2, 0.7, 0.8), power: 0.3, leadDays: 0, variance: 0.2 },
  { id: 'sns', name: 'SNS 광고', weeklyCost: 40, reach: 'city', fit: fit(1, 0.6, 0.1, 0.5, 0.5), power: 0.5, leadDays: 0, variance: 0.6 },
  { id: 'youtuber', name: '유튜버 협찬', weeklyCost: 150, reach: 'national', fit: fit(1, 0.5, 0.1, 0.4, 0.4), power: 1.2, leadDays: 5, variance: 0.7 },
  { id: 'tv', name: 'TV 광고', weeklyCost: 600, reach: 'national', fit: fit(0.4, 0.6, 1, 0.9, 0.7), power: 1.8, leadDays: 7, variance: 0.3 },
  { id: 'sponsor', name: '스포츠팀 후원', weeklyCost: 250, reach: 'city', fit: fit(0.6, 0.8, 0.6, 1, 0.5), power: 0.7, leadDays: 7, variance: 0.35 },
];

export interface AdMessage {
  id: 'price' | 'speed' | 'quality' | 'emotion' | 'buzz'; name: string; fit: Fit;
  buzz: number;     // word-of-mouth weight
  overheat: number; // backlash chance per campaign from overdone hype
}
export const adMessages: readonly AdMessage[] = [
  { id: 'price', name: '가격', fit: fit(1, 0.7, 0.9, 0.9, 0.3), buzz: 0.2, overheat: 0 },
  { id: 'speed', name: '빠름', fit: fit(0.8, 1, 0.4, 0.6, 0.6), buzz: 0.3, overheat: 0 },
  { id: 'quality', name: '품질', fit: fit(0.5, 0.8, 0.7, 0.8, 1), buzz: 0.4, overheat: 0 },
  { id: 'emotion', name: '감성', fit: fit(0.7, 0.6, 0.9, 1, 0.7), buzz: 0.6, overheat: 0 },
  { id: 'buzz', name: '화제성', fit: fit(1, 0.7, 0.3, 0.5, 0.6), buzz: 1, overheat: 0.08 },
];

export interface AdModel {
  id: 'none' | 'local' | 'influencer' | 'celebrity'; name: string; weeklyFee: number;
  boost: number; buzz: number;
  scandal: number; // chance per week of a model incident
}
export const adModels: readonly AdModel[] = [
  { id: 'none', name: '없음', weeklyFee: 0, boost: 1, buzz: 1, scandal: 0 },
  { id: 'local', name: '동네 유명인', weeklyFee: 30, boost: 1.2, buzz: 1.2, scandal: 0.01 },
  { id: 'influencer', name: '인플루언서', weeklyFee: 100, boost: 1.5, buzz: 1.8, scandal: 0.03 },
  { id: 'celebrity', name: '연예인', weeklyFee: 350, boost: 2, buzz: 2.5, scandal: 0.02 },
];
export const scandalHeadlines: readonly string[] = [
  '모델 음주운전 기사로 불매 조짐', '모델 갑질 논란이 가게까지 번졌다', '모델 과거 발언이 다시 퍼져 손님이 등을 돌렸다',
];
