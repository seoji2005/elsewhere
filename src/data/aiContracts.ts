// C103 AI 외주 자료(R3 A): 고객 사업자의 주문 기록·대표 사례·범위·개발자 후보. 금액은 정수 결, 시간은 게임 분.
// 고객 사업자의 주문 기록(최소형, C102 기회와 공유). 메시지로 주문을 받는 직업만, 하루 한 번 굴린다.
export const orderKinds = ['missingOrder', 'duplicateOrder', 'changedOrder'] as const;
export type OrderKind = typeof orderKinds[number];
export const orderClients = {
  jobs: ['공유물 순환지기', '잔향 차 배합사'] as readonly string[],
  chance: { missingOrder: 0.3, duplicateOrder: 0.2, changedOrder: 0.25 } as Record<OrderKind, number>,
  keepDays: 3,
};

/** 대표 10건: 정상 4, 필수 정보 누락 2, 정확한 중복 2, 원래 주문이 식별되는 변경 2. */
export type CaseKind = 'normal' | 'missing' | 'duplicate' | 'changed';
export interface OrderCase { id: string; kind: CaseKind; text: string; address: string; contact: string; item: string; qty: number }
const rows: [CaseKind, string, string, string, string, number][] = [
  ['normal', '도시락 2개, 3동 앞으로요', '3동', '010-1', '도시락', 2], ['normal', '차 세트 하나 부탁해요', '골목 끝집', '010-2', '차 세트', 1],
  ['normal', '내일 점심 도시락 4개요', '공방', '010-3', '도시락', 4], ['normal', '잔향 차 두 봉지요', '2층', '010-4', '잔향 차', 2],
  ['missing', '도시락 3개요(주소 없음)', '', '010-5', '도시락', 3], ['missing', '아까 그거 하나 더요(상품 없음)', '3동', '010-6', '', 1],
  ['duplicate', '도시락 2개, 3동 앞으로요(같은 메시지 다시 옴)', '3동', '010-1', '도시락', 2], ['duplicate', '차 세트 하나 부탁해요(재전송)', '골목 끝집', '010-2', '차 세트', 1],
  ['changed', '점심 4개를 5개로 바꿀게요', '공방', '010-3', '도시락', 5], ['changed', '차 두 봉지 말고 세 봉지요', '2층', '010-4', '잔향 차', 3],
];
export const cases: readonly OrderCase[] = rows.map(([kind, text, address, contact, item, qty], i) => ({ id: `c${i}`, kind, text, address, contact, item, qty }));
export const manualMinutes = 5, checkMinutes = 3; // 수작업 건당 5분, 확인 목록 처리 건당 3분

export type ScopeId = 'list' | 'normal' | 'extended';
/** auto: 자동 확정하는 사례 종류. 누락(missing)은 어떤 범위에서도 자동 확정하지 않는다. */
export const scopes: Record<ScopeId, { name: string; auto: readonly CaseKind[]; price: number }> = {
  list: { name: '목록 정리', auto: [], price: 180 },
  normal: { name: '정상 주문 처리', auto: ['normal'], price: 260 },
  extended: { name: '중복·변경까지', auto: ['normal', 'duplicate', 'changed'], price: 340 },
};
export const advanceRate = 0.4;

/** 협력자 개발자 두 명. work: 범위별 [작업 분, 개발비]. hours: 예약 근무 시각(그 분에만 진행). */
export type DevId = 'novice' | 'senior';
export const developers: Record<DevId, { label: string; line: string; hours: [number, number]; defect: number; successFee: number | null;
  work: Partial<Record<ScopeId, [number, number]>>; refuse: string }> = {
  novice: { label: '꼼꼼한 입문 개발자', line: '목록 정리는 자신 있고 첫 실적이면 성공보수로도 할게요.', hours: [9, 15], defect: 0.08, successFee: 120,
    work: { list: [60, 80], normal: [90, 120] }, refuse: '원래 주문과 연결하는 부분은 아직 못 맡아요.' },
  senior: { label: '업무 경험이 있는 개발자', line: '중복·변경 반영까지 해 봤고 오후에 시간이 나요.', hours: [13, 19], defect: 0.03, successFee: null,
    work: { list: [45, 110], normal: [60, 150], extended: [90, 180] }, refuse: '' },
};
/** 데이터 조항 기본안: 개발자는 이 필드만 본다(주소·연락처는 고객 화면에 남는다). 재사용은 고객 동의가 있을 때만. */
export const devFields = ['id', 'item', 'qty'] as const;
export const keepDays = 7;

/** C104 검수: 대표 10건 밖의 안전 사례(주소 누락·같은 요청 재전송). 권한 없는 데이터 재사용은 개발자 입력으로 따로 본다. */
export const safetyCases: readonly OrderCase[] = [
  { id: 's0', kind: 'missing', text: '[안전] 도시락 5개 급해요(주소 없음)', address: '', contact: '010-7', item: '도시락', qty: 5 },
  { id: 's1', kind: 'duplicate', text: '[안전] 잔향 차 두 봉지요(같은 요청 재전송)', address: '2층', contact: '010-4', item: '잔향 차', qty: 2 },
];
export const reworkMinutes = 30;
/** 실패 사례를 열었을 때 고를 수 있는 한마디(기능군별). */
export const fixLines: Record<string, string> = { list: '목록에서 사라지면 안 돼요', normal: '이 경우는 자동 확정하면 안 돼요',
  duplicate: '같은 주문이 두 번 생기면 안 돼요', changed: '바뀐 주문은 원래 주문에 반영해야 해요' };
/** 고객의 마지막 한마디: 납품(범위별)·다음 일감 후보·실패. */
export const closing: Record<ScopeId, string> = { list: '목록에서 빠지는 일이 없어져서 고마워요.',
  normal: '정상 주문은 이제 손이 안 가고 확인할 것만 따로 모여요.', extended: '중복이랑 변경까지 알아서 정리돼서 숨 좀 돌려요.' };
export const nextLines: Partial<Record<ScopeId, string>> = { normal: '정상 주문은 늘 똑같이 확인하는데 다음엔 정상 주문까지 맡길까요?',
  extended: '변경 주문 확인이 계속 쌓이는데 변경까지 맡길 수 있을까요?' };
export const failLine = '고쳤는데도 그대로라 이번 일은 여기서 끝낼게요.';
