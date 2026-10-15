// C103 범위별 주문 처리(결정론적 시뮬레이션, 외부 AI 호출 없음): 대표 사례 분류·확인 시간·절약 시간·개발자 입력.
import { cases, checkMinutes, devFields, manualMinutes, safetyCases, scopes, type OrderCase, type ScopeId } from '../data/aiContracts';

/** 범위가 맡은 종류이고 필수 정보(주소·상품)가 있을 때만 자동. 없는 정보를 채우거나 추측해 확정하지 않는다. */
export const classify = (scope: ScopeId, c: OrderCase): 'auto' | 'check' =>
  scopes[scope].auto.includes(c.kind) && !!c.address && !!c.item ? 'auto' : 'check';

/** 대표 묶음의 예상치(실제 하루 절약 시간이 아니다). */
export function preview(scope: ScopeId, list: readonly OrderCase[] = cases) {
  const auto = list.filter(c => classify(scope, c) === 'auto').length, check = list.length - auto;
  return { auto, check, checkMinutes: check * checkMinutes, saved: list.length * manualMinutes - check * checkMinutes };
}

/** 개발자가 받는 시험 자료: 조항이 허용한 필드만(주소·연락처 제외). 재사용 목적은 고객이 동의한 경우에만 붙는다. */
export function devInput(reuseApproved: boolean, list: readonly OrderCase[] = cases) {
  return { purpose: reuseApproved ? 'approvedReuse' : 'projectOnly',
    rows: list.map(c => Object.fromEntries(devFields.map(f => [f, c[f]]))) };
}

// C104 검수(R3 A10): 약속(범위 분류)과 결과물(결함 반영)을 사례마다 비교한다. 평균 점수 없음, 하나라도 실패면 납품 불가.
export interface TestResult { id: string; text: string; expected: string; actual: string; feature: string; ok: boolean }
const word = { auto: '자동 확정', check: '사람 확인', lost: '목록에서 사라짐', double: '주문 두 번 생김' } as const;
/** 사례를 맡은 기능군: 자동 처리면 그 종류, 누락 주문의 자동 확정 금지는 정상 처리기, 나머지는 목록 정리. */
const featureOf = (scope: ScopeId, c: OrderCase) => classify(scope, c) === 'auto' ? c.kind
  : c.kind === 'missing' && scopes[scope].auto.includes('normal') ? 'normal' : 'list';
const broken = (feature: string, c: OrderCase) => feature === 'list' ? 'lost' : c.kind === 'missing' || c.kind === 'normal' ? 'auto' : 'double';
/** 같은 범위·결함·동의면 언제나 같은 결과(실행 횟수와 무관). */
export function acceptance(scope: ScopeId, defects: readonly string[], reuseApproved: boolean): TestResult[] {
  const rows = [...cases, ...safetyCases].map(c => {
    const feature = featureOf(scope, c), expected = classify(scope, c), actual = defects.includes(feature) ? broken(feature, c) : expected;
    return { id: c.id, text: c.text, expected: word[expected], actual: word[actual], feature, ok: actual === expected };
  });
  const input = devInput(reuseApproved, []), purpose = reuseApproved ? 'approvedReuse' : 'projectOnly';
  return [...rows, { id: 's2', text: '[안전] 동의 없는 다른 고객 재사용', expected: purpose, actual: input.purpose, feature: 'data', ok: input.purpose === purpose }];
}
