// C099 라이벌 도렌 기본값 (R4-gpt A, R6 ③). 금액·확률은 조정 가능한 설계값이다.
export const RIVAL = 'doren';
/** 새 세계 초기 배분: 이웃 여섯(funders)이 100결씩 출자한 개인 계정 600결 → 보증금 40 + 첫 재고 20개×2결 = 영업 시작 520결. 점포 계정 = 도렌 계정. */
export const rivalSpec = {
  name: '도렌', businessId: 'rival:doren', placeId: 'shop', capital: 600, funders: ['aro', 'nuel', 'sori', 'velo', 'iri', 'lise'], deposit: 40, landlordId: 'sori', rent: 4,
  stock: [['tea', 8, 12], ['bread', 10, 8]] as const, // 품목·판매가·첫 재고(원가는 기준가/4, 플레이어와 같은 견적)
  openFrom: 8, openTo: 20, lookAt: [720, 1080], lookChance: 0.8, startDemand: 4, maxOrder: 20, priceDays: 2, queueDays: 1, queueMin: 3,
  cut: 0.85, reviewDays: 3, maxDiscountDays: 21, adCap: 60, adChannels: ['flyer', 'search'], walkHere: 2, walkThere: 4, closeAfter: 3, closeDelay: 2,
  // C109 돈 순환: 가용액이 cashFloor를 넘는 시간엔 그 자리의 가장 가난한 주민을 한 시간 보조로 쓰고(wage), 마감 뒤 cashCap을 넘는 돈은
  // 확장 공사 대금으로 가장 가난한 이웃들에게 workPay씩(하루 최대 workers명). 매입은 같은 직업 중 잔액이 가장 적은 생산자에게서.
  wage: 6, cashFloor: 120, cashCap: 250, workPay: 10, workers: 12,
} as const;
export const rivalLines = {
  look: (price: number, queue: number) => `“${price}결. 줄은 ${queue}명이군요.”`,
  poster: (item: string, price: number) => `📌 ‘내일부터 ${item} ${price}결’ — “줄은 봤습니다. 내일부터 ${price}결입니다.”`,
  restore: '📌 할인 종료 — “숫자가 안 맞으면 접습니다.”',
  ad: (channel: string) => `📌 ${channel} 게시 — “숫자로 보여 드리죠.”`,
  closing: '📌 영업 종료 예고 — “다음 점포는 보류합니다. 이 점포부터 정리하죠.”',
} as const;
