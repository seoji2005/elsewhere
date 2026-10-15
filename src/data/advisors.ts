// 전문가 고용 데이터: 직종·등급·수수료(주급, 결)·계약 조항·대사. 규칙은 src/sim/advisors.ts.
export type AdvisorKind = 'accountant' | 'lawyer' | 'labor' | 'pr' | 'consultant';
export type Tier = 1 | 2 | 3; // 1 싸고 실수 잦음, 2 보통, 3 비싸고 믿을 만함
export type Situation = 'hire' | 'report' | 'mistake' | 'found' | 'nothing';

export const advisorKinds: Record<AdvisorKind, { name: string; weeklyFee: Record<Tier, number> }> = {
  accountant: { name: '회계사', weeklyFee: { 1: 60, 2: 150, 3: 320 } },
  lawyer: { name: '변호사', weeklyFee: { 1: 90, 2: 220, 3: 480 } },
  labor: { name: '노무사', weeklyFee: { 1: 50, 2: 120, 3: 260 } },
  pr: { name: '홍보 담당', weeklyFee: { 1: 70, 2: 170, 3: 360 } },
  consultant: { name: '컨설턴트', weeklyFee: { 1: 100, 2: 250, 3: 550 } },
};

// mistake: 기본 실수율(근속 충성도로 최대 절반까지 감소). saving: 세금 절감률. detect: 숨은 조항 하나를 찾을 확률.
// embezzle: 주당 횡령 확률(1등급만). 등급 값은 직종 공통.
export const tiers: Record<Tier, { label: string; mistake: number; saving: number; detect: number; embezzle: number }> = {
  1: { label: '저가', mistake: 0.12, saving: 0.03, detect: 0.35, embezzle: 0.005 },
  2: { label: '보통', mistake: 0.05, saving: 0.08, detect: 0.65, embezzle: 0 },
  3: { label: '고급', mistake: 0.01, saving: 0.12, detect: 0.9, embezzle: 0 },
};
export const tax = {
  rate: 0.2, selfMistake: 0.15, // 회계사 없이 직접 신고할 때의 실수율
  underreport: 0.5, // 실수 한 번에 덜 낸 세금 비율
  riskPerWeek: 0.002, riskPerError: 0.08, penalty: 0.4, // 세무조사 확률 누적, 추징 가산 40%
  loyaltyWeeks: 52, loyaltyCut: 0.5, embezzleCut: 0.6, embezzleShare: 0.1,
};

export type ContractKind = 'lease' | 'supply' | 'employment' | 'ad';
export const contractKinds: Record<ContractKind, { name: string; amount: [number, number]; weeks: [number, number] }> = {
  lease: { name: '가게 임대차 계약서', amount: [300, 900], weeks: [26, 104] },
  supply: { name: '물품 납품 계약서', amount: [150, 600], weeks: [8, 52] },
  employment: { name: '직원 고용 계약서', amount: [180, 400], weeks: [12, 52] },
  ad: { name: '광고 대행 계약서', amount: [100, 500], weeks: [4, 26] },
};

// effect: 조항이 게임에 주는 값. 단위는 key 이름을 따른다(Weeks 주, Rate 비율, Share 비율).
export type ClauseKind = 'autoRenew' | 'heavyPenalty' | 'exclusiveSupply' | 'priceHike' |
  'liabilityShift' | 'noEarlyExit' | 'hiddenFee' | 'farCourt' | 'nonCompete';
export const clauses: Record<ClauseKind, { text: string; negotiable: boolean; effect: Record<string, number> }> = {
  autoRenew: { text: '3개월 전 통지 없으면 1년 자동 연장', negotiable: true, effect: { renewWeeks: 52 } },
  heavyPenalty: { text: '중도 해지 시 남은 기간 대금 전액을 위약금으로 지급', negotiable: true, effect: { penaltyRate: 1 } },
  exclusiveSupply: { text: '같은 품목은 이 업체에서만 받아야 함', negotiable: true, effect: { exclusive: 1 } },
  priceHike: { text: '상대가 통지만으로 가격을 올릴 수 있음', negotiable: true, effect: { hikeRate: 0.15 } },
  liabilityShift: { text: '상대 잘못으로 생긴 손해도 우리 쪽이 책임짐', negotiable: true, effect: { liabilityShare: 1 } },
  noEarlyExit: { text: '계약 기간 중에는 어떤 이유로도 해지할 수 없음', negotiable: false, effect: { lockWeeks: 26 } },
  hiddenFee: { text: '관리 수수료가 매주 따로 붙음', negotiable: true, effect: { feeRate: 0.08 } },
  farCourt: { text: '분쟁이 생기면 상대 지역 법원에서만 다툼', negotiable: false, effect: { disputeCostRate: 0.2 } },
  nonCompete: { text: '계약 종료 뒤 1년간 같은 업종 영업 금지', negotiable: true, effect: { banWeeks: 52 } },
};

// 직종 × 등급 × [고용, 정기 보고, 실수, 발견, 없음]. 현대 한국어, 통화 결.
type Lines = Record<Tier, [string, string, string, string, string]>;
export const advisorLines: Record<AdvisorKind, Lines> = {
  accountant: {
    1: ['싸게 해 드릴게요. 장부는 대충 주시면 제가 알아서 맞춰요.', '이번 주 세금 냈어요. 조금은 아꼈을 거예요, 아마도.', '아, 숫자 하나를 잘못 옮겼네요… 큰일은 아닐 거예요.', '영수증 사이에 이상한 게 하나 있던데요?', '특별한 건 없어요. 그냥 내면 돼요.'],
    2: ['장부 정리부터 같이 해 보죠. 매주 보고드릴게요.', '이번 주 세금 신고 끝났습니다. 공제받을 건 다 받았어요.', '죄송합니다, 신고서에 오류가 있었어요. 바로 수정 신고할게요.', '경비 처리 안 된 항목이 있어서 챙겨 두었습니다.', '이번 주는 문제없습니다.'],
    3: ['세금은 제가 맡겠습니다. 사장님은 장사만 하세요.', '신고 마쳤습니다. 절세 가능한 부분은 전부 반영했습니다.', '드문 일이지만 제 실수가 있었습니다. 가산세 전에 정정했습니다.', '세무조사 때 걸릴 만한 부분을 미리 정리해 두었습니다.', '장부 깨끗합니다. 걱정 안 하셔도 됩니다.'],
  },
  lawyer: {
    1: ['계약서요? 금방 봐 드려요. 너무 기대는 마시고요.', '훑어봤는데 대충 괜찮은 것 같아요.', '어, 이 조항을 제가 놓쳤네요.', '여기 좀 이상한 문장이 있어요.', '딱히 눈에 띄는 건 없네요.'],
    2: ['계약서는 서명 전에 꼭 저한테 먼저 보여 주세요.', '이번 주 계약 검토 끝났습니다.', '죄송합니다, 조항 하나를 늦게 확인했습니다.', '불리한 조항이 있습니다. 빼 달라고 해 볼까요?', '이 계약은 서명하셔도 됩니다.'],
    3: ['어떤 계약이든 서명 전에 한 줄씩 다 보겠습니다.', '검토 마쳤습니다. 협상할 부분을 정리해 두었습니다.', '제 판단이 틀렸습니다. 상대와 다시 협상하겠습니다.', '숨은 조항을 찾았습니다. 이건 반드시 빼야 합니다.', '깨끗한 계약입니다. 이 정도면 서명하셔도 됩니다.'],
  },
  labor: {
    1: ['근로계약서 양식은 제가 하나 드릴게요.', '이번 주 급여 대장 봤어요. 대충 맞아요.', '주휴수당 계산을 빼먹었네요…', '야근 수당이 빠진 것 같은데요?', '별일 없어요.'],
    2: ['직원 관리 문제는 저랑 상의하세요.', '급여와 근무 시간 점검 끝났습니다.', '보험 신고가 하루 늦었습니다. 바로 처리할게요.', '근로 시간이 법정 기준을 넘는 직원이 있습니다.', '이번 주는 노무 문제 없습니다.'],
    3: ['직원 분쟁은 생기기 전에 막겠습니다.', '급여·보험·근로 시간 모두 점검했습니다.', '제 실수입니다. 직원분께 직접 설명드리겠습니다.', '나중에 분쟁이 될 만한 계약 문구를 찾았습니다.', '노무 쪽은 깨끗합니다.'],
  },
  pr: {
    1: ['동네에 소문 좀 내 볼게요.', '전단 돌렸어요. 반응은 두고 봐야죠.', '가게 이름을 잘못 적어서 뿌렸네요…', '안 좋은 후기가 하나 올라왔어요.', '조용한 한 주였어요.'],
    2: ['가게 이미지는 제가 관리할게요.', '이번 주 홍보 결과 정리했습니다.', '게시물 시간을 잘못 잡았습니다. 다시 올리겠습니다.', '사장님 가게 이야기가 동네에 돌고 있어요.', '특별한 반응은 없었습니다.'],
    3: ['손님이 먼저 찾아오는 가게로 만들겠습니다.', '홍보 성과와 다음 주 계획을 보고드립니다.', '제 판단 착오였습니다. 바로 정정 공지를 내겠습니다.', '평판에 영향 줄 소문을 미리 잡았습니다.', '평판 안정적입니다.'],
  },
  consultant: {
    1: ['요즘 뜨는 장사 방법 알려 드릴게요.', '이번 주 매출 보고서예요. 감으로 썼어요.', '계산을 반대로 했네요. 다시 볼게요.', '손해 보는 메뉴가 하나 있는 것 같아요.', '그냥 하던 대로 하세요.'],
    2: ['숫자부터 보고 방향을 같이 잡죠.', '이번 주 매출과 비용을 분석했습니다.', '수요 예측이 틀렸습니다. 재고를 조정하겠습니다.', '원가가 판매가보다 높은 품목이 있습니다.', '지금 운영은 무난합니다.'],
    3: ['사장님 가게를 이 동네 일등으로 만들어 보겠습니다.', '주간 경영 보고입니다. 개선안 세 가지를 준비했습니다.', '제 분석에 빈틈이 있었습니다. 수정안을 드리겠습니다.', '경쟁 가게가 가격을 내릴 조짐이 있습니다.', '현재 전략 그대로 가시면 됩니다.'],
  },
};
