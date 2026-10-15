// C102 기회 정의: 세계의 실제 문제(사실)에서 생기는 일감. 잔액·현금은 어떤 조건에도 쓰지 않는다(checkOpportunities).
/** 조건에 쓸 수 있는 사실. record.*는 고객 사업자의 최근 주문 기록 건수. */
export const facts = ['visitsAtMyShop', 'jobOf', 'record.missingOrder', 'record.duplicateOrder', 'record.changedOrder'] as const;
export type Fact = typeof facts[number];
export interface Predicate { fact: string; op: '>=' | 'in'; value: number | readonly string[] }
export interface Need { kind: '사람' | '허가' | '기술' | '거래처'; text: string }
export interface OpportunityDef {
  id: string; industry: string; source: 'customer' | 'inquiry' | 'news' | 'staff'; title: string;
  giver: readonly Predicate[]; trigger: readonly Predicate[];
  /** 단골 경로: 이 조건이면 구매를 마친 뒤 고민을 말한다(주문 습관·사례를 미리 앎). */
  regular: readonly Predicate[];
  worry: string; lines: readonly string[];
  /** 공개 문의 경로의 질문 두 개와 그 답(= 단골 경로에서 미리 아는 정보). */
  questions: readonly (readonly [ask: string, answer: string])[];
  needs: readonly Need[]; lifeDays: number;
  /** 세계에 동시에 열려 있는(아직 아무도 모르는) 기회 수 상한. 화면 노출(최대 3)과 따로 센다. */
  worldCap: number;
  /** 수락 뒤 이어질 카드의 진입점(C103). */
  next: string;
}

// 고객 사업자의 주문 기록은 C103 AI 계약 자료와 함께 쓴다.
import { orderClients } from './aiContracts';
export { orderClients, orderKinds, type OrderKind } from './aiContracts';

export const opportunities: readonly OpportunityDef[] = [{
  id: 'ai-order-cleanup', industry: 'ai', source: 'customer', title: '주문 정리 도와주기',
  giver: [{ fact: 'jobOf', op: 'in', value: orderClients.jobs }],
  trigger: [{ fact: 'record.missingOrder', op: '>=', value: 1 }],
  regular: [{ fact: 'visitsAtMyShop', op: '>=', value: 3 }],
  worry: '요즘 주문이 자꾸 빠져서 큰일이에요.',
  lines: ['메시지로 받은 주문이 목록에서 사라져요. 어제도 한 건 놓쳤어요.', '이런 거 정리해 줄 사람, 혹시 알아요?'],
  questions: [
    ['주문은 어떻게 받으세요?', '전부 메시지로 받아요. 바쁠 땐 나중에 옮겨 적고요.'],
    ['최근에 뭐가 빠졌어요?', '주소 없는 주문, 두 번 온 주문, 중간에 바뀐 주문이 섞여요.'],
  ],
  needs: [
    { kind: '사람', text: '주문 규칙을 같이 만들 개발자 한 명' },
    { kind: '기술', text: '메시지 주문을 목록으로 모으는 처리' },
    { kind: '거래처', text: '확인할 주문을 볼 사장님의 30분' },
  ],
  lifeDays: 5, worldCap: 4, next: 'aiContract.start',
}];

/** 모든 조건이 허용된 사실만 쓰는지 확인한다. 잔액·현금 사실은 언제나 실패. */
export function checkOpportunities(defs: readonly OpportunityDef[]) {
  for (const d of defs) for (const p of [...d.giver, ...d.trigger, ...d.regular]) {
    if (/cash|balance|money|wallet|fund/i.test(p.fact)) throw Error(`Money fact in opportunity ${d.id}: ${p.fact}`);
    if (!(facts as readonly string[]).includes(p.fact)) throw Error(`Unknown fact in opportunity ${d.id}: ${p.fact}`);
  }
}
