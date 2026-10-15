// C103 범위별 주문 처리(결정론적 시뮬레이션, 외부 AI 호출 없음): 대표 사례 분류·확인 시간·절약 시간·개발자 입력.
import { cases, checkMinutes, devFields, manualMinutes, scopes, type OrderCase, type ScopeId } from '../data/aiContracts';

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
