// C100 도로 공사 기본값 (R4-gpt B). 금액·기간은 조정 가능한 설계값이고 계약 시점에 고정된다.
export const roadworks = {
  roadId: 'alley', zoneId: 'alley-front', placeIds: ['cafe', 'shop'],
  budget: 280, reserve: 80, materials: 56, supplierId: 'aro',
  workers: 4, wage: 4, workFrom: 420, mealFrom: 540, mealTo: 600,
  leadDays: 3, days: 14, workerBonus: 15, menuBonus: 10,
} as const;
/** 근처 주차장 제휴: 실제 운영자 계정, 2칸, 하루 2결, 편도 도보 3분. */
export const partnerLot = { id: 'park-lot', operatorId: 'iri', spaces: 2, perDay: 2, walk: 3 } as const;
export const taxRate = 5; // %, 참여 소매점의 완료 판매
/** 새 세계만: 기존 사업자 네 명이 이미 낸 세금(70씩)과 시 운영비 출연(합계 80). */
export const preparedCity = { operating: 80, payers: ['nuel', 'sori', 'iri', 'aro'], paid: 70 } as const;
export const cityLines = {
  rumor: '표지판 보셨어요? 곧 앞길에 차 못 댄대요.', why: '노후 도로 정비 요청이 접수됐고, 세금으로 공사 예산이 확보됐어요.',
  reopened: '앞길 주차가 다시 열렸어요.',
} as const;
