export interface ShowScene { id: string; name: string; memory: string }
export interface Show {
  id: string; name: string; hostId: string; placeId: string;
  /** Minutes after midnight, every evening. */
  start: number; end: number; price: number; scenes: readonly ShowScene[];
}

// GDD §2 소비: one evening show, a taste choice and a memory shared with whoever came along.
export const shows: readonly Show[] = [
  { id: 'jazz', name: '저녁 재즈 트리오', hostId: 'nuel', placeId: 'cafe', start: 19 * 60, end: 21 * 60, price: 25, scenes: [
    { id: 'jazz-ballad', name: '느린 발라드', memory: '조명이 낮아지고 색소폰이 숨 쉬듯 흐르던 발라드' },
    { id: 'jazz-swing', name: '빠른 스윙', memory: '다들 발끝으로 박자를 맞추던 빠른 스윙' },
    { id: 'jazz-request', name: '관객 신청곡', memory: '쪽지로 신청한 노래를 즉석에서 연주해 주던 순간' },
  ] },
  { id: 'acoustic', name: '뜰 어쿠스틱 공연', hostId: 'iri', placeId: 'park', start: 19 * 60 + 30, end: 21 * 60, price: 15, scenes: [
    { id: 'acoustic-singalong', name: '다 같이 부르는 노래', memory: '모르는 사람들과 후렴을 같이 부르던 노래' },
    { id: 'acoustic-solo', name: '기타 독주', memory: '바람 소리까지 반주가 되던 기타 독주' },
    { id: 'acoustic-story', name: '노래에 얽힌 이야기', memory: '노래를 만든 사연을 듣고 조용해지던 잔디밭' },
  ] },
  { id: 'comedy', name: '교환소 스탠드업 코미디', hostId: 'sori', placeId: 'shop', start: 20 * 60, end: 21 * 60 + 30, price: 30, scenes: [
    { id: 'comedy-work', name: '출근길 이야기', memory: '만원 버스 출근길 이야기에 다 같이 웃던 장면' },
    { id: 'comedy-crowd', name: '관객과 즉흥 대화', memory: '앞줄 관객과 즉흥으로 주고받던 농담' },
    { id: 'comedy-family', name: '가족 명절 이야기', memory: '명절 잔소리 흉내에 배를 잡고 웃던 순간' },
  ] },
];
