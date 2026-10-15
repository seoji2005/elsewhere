// C097 첫 직원 위임: R3-gpt.md B4 정책 다섯 개(추천값·선택지·설명)와 마감 보고 문장 틀.
export interface StaffPolicy {
  version: number; dailyBudget: number; reservationPriority: 'arrival' | 'appointment';
  maxDiscountPercent: 0 | 5 | 10; orderApprovalLimit: number; taskPriority: 'checkout' | 'balanced' | 'stocking';
}
export const recommendedPolicy: StaffPolicy = { version: 1, dailyBudget: 80, reservationPriority: 'appointment',
  maxDiscountPercent: 5, orderApprovalLimit: 20, taskPriority: 'balanced' };
type Key = Exclude<keyof StaffPolicy, 'version'>;
/** One row per policy: label, the choices in tap order, how each choice reads. */
export const policyRows: { key: Key; label: string; values: readonly (string | number)[]; show: (v: never) => string }[] = [
  { key: 'dailyBudget', label: '오늘 새 발주에 쓸 수 있는 돈', values: [0, 40, 80, 120], show: (v: number) => `${v}결` },
  { key: 'orderApprovalLimit', label: '발주 한 번에 혼자 정해도 되는 돈', values: [0, 20, 40], show: (v: number) => `${v}결` },
  { key: 'maxDiscountPercent', label: '흥정 손님에게 깎아 줄 수 있는 만큼', values: [0, 5, 10], show: (v: number) => v ? `최대 ${v}%` : '할인 없음' },
  { key: 'taskPriority', label: '계산과 진열 중 먼저', values: ['checkout', 'balanced', 'stocking'],
    show: (v: string) => ({ checkout: '계산 우선', balanced: '균형', stocking: '진열 우선' })[v]! },
  { key: 'reservationPriority', label: '예약 손님', values: ['appointment', 'arrival'],
    show: (v: string) => v === 'arrival' ? '도착 순서' : '약속 시각이 된 예약 먼저' },
];
export const trialMinutes = 60, applicantWages = [12, 15] as const;

/** Closing report kinds in R3 B14 priority order. */
export const reportLines = {
  restock: (n: number) => `사장님 없는 동안 떨어진 물건 ${n}번 채워서 팔았어요`,
  haggle: (n: number) => `사장님 없는 동안 흥정 손님 ${n}명에게 정한 만큼만 깎아 팔았어요`,
  checkout: (n: number) => `사장님 없는 동안 손님 ${n}명 계산했어요`,
  together: '오늘은 함께 근무했어요', none: '혼자 처리할 주문은 없었어요',
};
