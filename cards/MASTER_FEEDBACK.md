MASTER_FEEDBACK: elsewhere 종합 코드 감사·그래픽 고도화·콘텐츠 구상 및 작업 카드 (마스터 AI 자동 검토용)

마스터 AI (Claude 마스터) 실행 지침

문서 성격: 사용자가 외부 AI 아키텍트와 함께 작성하여 GitHub 저장소에 반영한 종합 피드백·그래픽 개선안·콘텐츠 기획서입니다.

마스터의 권한 및 의무 (DIRECTION.md & AGENTS.md 기준):

마스터는 아래 1장(코드 정밀 감사 7대 이슈), 2장(상용급 그래픽 & 모바일 최적화), 3장(신규 콘텐츠 구상 features.json 후보), **4장(표준 작업 카드 C033~C037 및 참조 코드)**을 직접 읽고 현재 브랜치 상태(progress.md, 열린 작업 세션)와 대조하여 자체 판단합니다.

방향·미감이 이미 사용자 결정(DIRECTION.md)과 일치하는 기술 개선·버그 수정·세션 연결은 사용자에게 다시 묻지 말고 마스터 권한으로 즉시 작업 카드(cards/C0XX.md)를 생성·조정하여 Codex(시뮬레이션·데이터·테스트)와 Claude 작업자(화면·셰이더·HUD)에게 배분합니다.

3장의 신규 재미 요소 중 마스터가 타당하다고 판단한 항목은 features.json의 규칙(proposed=true 항목은 사용자 승인 전 제안)에 따라 "proposed": true로 추가하고 progress.md의 "사용자 확인 대기"에 요약 보고합니다.

권장 파일 위치: 이 문서를 저장소의 cards/MASTER_FEEDBACK.md에 두면 tools/scope-check.mjs의 cards/ 예외 규칙(!file.startsWith('cards/')) 덕분에 작업자 세션의 범위 검사를 절대 깨뜨리지 않습니다.

1. 코드 정밀 감사: 현재 저장소(main)에서 발견된 7대 구조적 단절 & 개선점

전체 소스(src/sim/*, src/game/session.ts, src/data/*, src/scene/*, src/render/*, src/ui/*)를 교차 검증한 결과, 테스트(108개)는 통과하지만 실제 플레이에서 기능이 작동하지 않거나 크래시를 일으키는 5가지 로직 단절과 2가지 렌더링/확장성 병목을 확인했습니다. 마스터는 우선순위에 따라 이를 최우선 카드로 배정해 주세요.

우선순위

발견된 문제 (파일·행 번호)

실제 플레이 시 발생하는 현상

마스터 조치 방안 (해결책)

1순위 (치명)

생성 주민 50명 대화 시 즉시 크래시



(src/sim/dialogue.ts 20행, 65행)

validate()가 !dialogueTemplates[ctx.npc.id]일 때 에러를 던지는데, src/data/dialogue.ts에는 핵심 주민 6명(aro~lise)만 정의되어 있음. 생성 주민(generated-*)과 대화·선물·고백을 시도하면 무조건 Error('Invalid dialogue context') 발생.

src/data/dialogue.ts에 10개 성격 원형(archetypes.ts)별 대사 템플릿을 추가하고, dialogue.ts에서 npc.id가 없으면 archetypeId 템플릿과 speech(존댓말/반말 어미·호칭) 규칙으로 폴백(Fallback)하도록 수정.

2순위 (치명)

주민 간 초기 인맥(relationships·bonds)이 0이라 소개팅·소문이 불발



(session.ts 74행, matchmaking.ts 35행, ripple.ts 42행)

requestMatch()는 주선자-후보자 점수가 >= 10이어야 하고, deliverRipple() 소문은 주민 간 trust >= 15여야 전파됨. 그런데 새 세션에서 NPC끼리의 관계 점수와 bonds가 전부 0으로 시작해 소개팅은 항상 null을 반환하고 소문도 전혀 퍼지지 않음.

addResidents() 또는 월드 초기화 시 **같은 집(nest/quiet/high) 거주자 및 같은 일터(cafe/shop/office/park) 동료 사이에 결정론적 초기 친분(score: 15, trust: 20, affection: 15, met: true)**을 시드 기반으로 부여.

3순위 (중요)

소문(ripple.ts)과 손님 취향(customer.ts)이 session.tick에서 호출되지 않음



(src/game/session.ts 255~293행)

C028에서 만든 deliverRipple/noticeLine과 customer.ts의 chooseNeed가 단위 테스트에만 쓰이고 실제 session.tick() 루프에는 연결되지 않음. 손님도 무조건 stock[0]만 정가로 구매함.

session.tick()의 정각(minute % 60 === 0) 루프에서 같은 장소에 모인 주민끼리 deliverRipple(1~2홉 소문 전파)을 실행하고, buildDialogue가 미언급 noticeLine을 인사말에 섞어 출력하게 연결.

4순위 (중요)

구형 1차원 관계(world.relationships)와 신형 5축(bonds.ts)의 이원화



(dialogue.ts, matchmaking.ts, shop.ts)

session.ts는 relationMode: 'bonds'인데, 정작 talk(), giveGift(), confess(), requestMatch()는 구형 world.relationships 점수만 읽고 씀. bonds.ts의 canStartDating·friendly·reactionEffect가 실제 대화에 반영되지 않음.

relationMode === 'bonds'일 때 talk/giveGift 결과가 applyBondEvent(bonds, ..., [reactionEffect(entry)])로 자동 반영되고, confess가 canStartDating을 함께 검사하도록 연결.

5순위 (중요)

생성 주민 50명 휴일 집콕 & 빛고리 빛씨(아로) 사업장 누락



(npcgen.ts 86행, session.ts 59행)

생성 주민은 쉬는 날(day === restDay) 일정이 [{ fromMinute: 0, placeId: home }]뿐이라 휴일에 거리가 비어버림. 또한 상장 3사 중 아로(light)만 사업장이 없어 주가가 매출 연동 없이 난수로만 움직임.

휴일 일정에 park·cafe 외출 슬롯을 추가(정원 placeCapacities 준수)하고, office에 아로의 조율 사업장(light-counter)을 추가해 3대 상장사 모두 실물 매출(revenueChange)에 연동.

6순위 (필수)

백엔드 세션(session.ts)과 3D 화면(main.ts·hud.ts) 미연결



(src/main.ts, src/ui/hud.ts)

문 앞에서 들어가기를 누르면 "곧 열려요" 토스트만 뜨고, 열심히 만든 시계·지갑·NPC·가게·주식을 플레이어가 화면에서 전혀 만질 수 없음.

main.ts에서 createSession(localStorageAdapter())을 구동하고, hud.ts에 상단 상태바(시각·장소·자금·활력)와 건물 출입, 우측 접이식 '결폰' 3탭 패널을 연결.

7순위 (확장)

단일 HTML Base64 인라이닝(build:single) 및 세이브 로그 무한 누적



(vite.config.ts, tools/check.sh, session.ts)

3D 에셋(4.8MB)을 Base64로 HTML에 넣으면 용량이 33% 불어나고 캐싱이 불가능함. 또한 ledger.transactions와 store.visits가 영구 누적되어 100일 이상 플레이 시 세이브가 비대해짐.

M1 이후 dist/ 분리 빌드로 전환(초기 로드 ≤ 5MB 기준)하고, tools/assets.mjs는 WebP 대신 KTX2 GPU 텍스처 압축 도입 검토. 세이브는 14일 지난 완료 근무·방문 로그를 자정마다 정리(Prune).

2. 그래픽 고도화 & 모바일 60fps 최적화 명세 (에셋 용량 증가 0KB)

현재 화면이 상용 서브컬처 게임(원신, 블루 아카이브 등)에 비해 투박해 보이는 원인은 ① 광각 렌즈(FOV 50/70)로 인한 원근 왜곡과 휑한 도로, ② 흑백 1차원 툰 램프로 인한 탁한 회색 그림자, ③ 벽지처럼 납작한 창문과 각진 나뭇잎, ④ 서로 다른 에셋 팩(VRoid + Quaternius + Kenney + 코드 박스)의 질감 불일치, ⑤ 반경 55m(110m×110m)에 늘어난 저해상도 그림자 맵 때문입니다.

마스터는 Claude 작업자에게 아래 5가지 그래픽·최적화 규칙을 적용하도록 지시해 주세요.

① 카메라 렌즈와 구도: 광각(FOV 50/70)에서 망원(FOV 38/54)으로 전환 (src/main.ts)

서브컬처·SD 캐릭터 게임은 원근 왜곡을 줄이고 캐릭터와 거리를 일러스트처럼 오밀조밀하게 압축하기 위해 낮은 화각(FOV 36~40) + 약간 먼 카메라 거리(dist 9~10m)를 사용합니다.

camera.fov = camera.aspect < 1 ? 54 : 38로 조정하는 것만으로도 도로가 활주로처럼 넓어 보이는 현상과 화면 가장자리 건물 찌그러짐이 즉시 사라집니다.

② 색온도 툰 셰이딩 + 3D 창문 인테리어 패럴랙스 + 구형 나뭇잎 법선 (src/scene/looks.ts)

라벤더 음영 & 살구빛 코어 띠: 그림자 영역(luma < 0.45)에 단순히 밝기만 낮추지 말고 차가운 청보라/라벤더 색온도(vec3(0.78, 0.82, 1.04))를 곱하고, 빛과 그림자의 경계선(luma 0.3~0.5)에는 따뜻한 서브서피스 난색 띠(vec3(1.08, 0.94, 0.88))를 더합니다.

3D 창문 패럴랙스(#ifdef WINDOWS): 카메라에서 창문을 바라보는 시선 벡터(normalize(vWorld - cameraPosition))를 이용해 창문 내부 UV를 살짝 밀어주면(roomUv), 걸어 다닐 때 창문 안쪽의 커튼과 천장 조명 깊이가 입체적으로 움직여 상자 같은 건물의 깊이가 살아납니다.

구형 나뭇잎 법선(#ifdef FOLIAGE): 가로수(CommonTree_1)의 정점 법선(objectNormal)을 나무 중심에서 바깥으로 향하는 구형 벡터(normalize(position + vec3(0., 1.2, 0.)))와 65% 블렌딩하면 지브리·원신풍의 뭉게구름 같은 나뭇잎 볼륨이 만들어집니다.

③ 배경 건물 material.clone() 제거(드로우콜 절감) & 공중 '빛씨' 입자 (src/scene/corner.ts)

정점 시드 기반 벽돌 변주: 현재 corner.ts 133행에서 배경 건물 색을 바꾼다고 material.clone()을 만들어 24m 셀 병합(mergeStatic)이 재질별로 쪼개지고 있습니다. material.clone()을 없애 모든 건물이 단일 벽돌 재질을 공유하게 하고, 이미 정점에 구워진 seed 속성(e[12] + 1.7 * e[14])을 looks.ts에서 읽어 건물마다 3가지 벽돌 색조를 입히면 배경 건물 드로우콜이 1/3로 줄어듭니다.

세계관 상징 '빛씨' 부유 입자: '결 사회'의 정체성이 화면에서 바로 느껴지도록 거리와 가로수 주변에 천천히 빛나는 작은 빛씨 입자(T.Points 48개, 드로우콜 단 1회, 그림자 연산 제외)를 띄웁니다.

1층 눈높이 밀도 보강 (후속 아트 카드 제안): props.ts의 기본 폰트 캔버스 간판(g.fillText('카페'))과 이질적인 Kenney 장난감 차량(sedan, van)은 점진적으로 걷어내고, 건물과 보도가 만나는 1층 라인에 입간판·화분 선반·야외 찻상·공중 등불 가렌드(전선)를 배치해 눈높이 실루엣을 채웁니다.

④ 플레이어 추적 22m 고밀도 그림자 & 텍셀 스냅 (src/render/lighting.ts, src/main.ts)

현재 그림자 반경 55m(110m×110m)에 1024 맵을 쓰면 1픽셀이 11cm라 캐릭터와 가로등 그림자가 계단처럼 깨지고, 거대한 영역을 샘플링하느라 모바일 GPU 비용이 큽니다.

반경을 22m(44m×44m)로 줄이면 그림자 픽셀 밀도가 6.25배 올라가 칼같이 선명해집니다.

대신 플레이어가 이동할 때(playerPos.distanceToSquared(sun.target.position) > 16) 그림자 카메라가 플레이어를 따라오되, 그림자 맵 텍셀 크기 단위(step = (radius * 2) / mapSize * 4)로 좌표를 반올림(Snap)해 이동시키면 걸을 때 그림자 가장자리가 어른거리는 현상(Shadow Shimmering) 없이 무한한 맵 확장이 가능해집니다.

⑤ VRM 캐릭터 시야각 컬링 복구 및 거리별 LOD (src/anime/avatar.ts)

avatar.ts 53행의 object.frustumCulled = false를 제거하고 각 메쉬에 반경 1.4m의 고정 boundingSphere를 부여해 카메라 뒤쪽의 캐릭터는 즉시 렌더링에서 제외합니다.

다수 주민(C025) 스폰 시 10m 밖 NPC는 스프링본 물리(springBoneManager)를 끄고 애니메이션 믹서를 2~3프레임당 1회만 갱신하도록 스로틀링합니다.

3. 게임을 더 즐길 수 있는 콘텐츠 구상 (features.json 추가 후보 8선)

기존에 작성된 시뮬레이션 모듈(bonds.ts, memory.ts, ripple.ts, matchmaking.ts, business.ts, market.ts, shop.ts, archetypes.ts)의 잠재력을 100% 끌어내는 콘텐츠입니다. 마스터는 검토 후 아래 JSON 항목들을 features.json에 "proposed": true로 등록해 사용자 승인을 요청할 수 있습니다.

[
  {
    "id": "M1-21",
    "stage": "M1",
    "owner": "auto",
    "proposed": true,
    "desc": "생성 주민 50명 원형별 대사·반말 전환 연결 및 이웃·동료 초기 인맥 시드",
    "check": "생성 주민과 대화·선물·소개팅·고백이 오류 없이 동작하고 친해지면 말투(반말/호칭)가 바뀐다"
  },
  {
    "id": "M1-22",
    "stage": "M1",
    "owner": "auto",
    "proposed": true,
    "desc": "공·사 반전 말투(Public vs Private): 일터·다중 밀집 장소에서는 존댓말, 단둘이 있을 때는 친밀도에 따라 반말·속마음 대사",
    "check": "같은 NPC라도 낮 조율실(여럿)과 밤 공원(단둘)에서 건네는 인사말과 어미가 다르게 나온다"
  },
  {
    "id": "M2-03",
    "stage": "M2",
    "owner": "auto",
    "proposed": true,
    "desc": "주선자 말투가 담긴 '블라인드 소개팅 인물 메모'와 약속 노쇼(No-show) 시 주선자 신뢰도 하락",
    "check": "소개팅 제안 시 주선자 말투로 상대 외형·성격 힌트를 듣고, 노쇼하면 주선자와의 trust가 깎인다"
  },
  {
    "id": "M2-04",
    "stage": "M2",
    "owner": "auto",
    "proposed": true,
    "desc": "의상(appearance)·방 꾸미기(atmosphere) 스탯의 실효성 연결: 첫인상 호감 보너스 및 '집으로 초대하기' 데이트 해금",
    "check": "옷을 입으면 첫 만남·소개팅 관심 점수가 오르고, 방 장식 점수가 일정 이상이면 호감 상대를 집에 초대해 함께 차를 마신다"
  },
  {
    "id": "M2-05",
    "stage": "M2",
    "owner": "auto",
    "proposed": true,
    "desc": "동네 대화 속 '주가 전조 단서(내부자 힌트)': 주민과 친해지면 작황·수요 변동을 미리 듣고 주식에 투자",
    "check": "특정 직업 주민과의 대화에서 회사 호재·악재 단서가 나오고 실제로 해당 상장사 MarketEvent가 발생한다"
  },
  {
    "id": "M2-06",
    "stage": "M2",
    "owner": "auto",
    "proposed": true,
    "desc": "시간대별 고유 동행(Shared Work) 이벤트: 밤 10시 리세의 등불 순찰, 벨로의 새벽 밤결 기록 등 특별 일과 돕기",
    "check": "특정 시간·장소에서만 열리는 동행 행동을 완료하면 shared-work 기억이 남고 다음 날 특별 회상 대사를 듣는다"
  },
  {
    "id": "M2-07",
    "stage": "M2",
    "owner": "auto",
    "proposed": true,
    "desc": "날씨·요일 유행에 반응하는 내 가게 가격(setPrice)·재고 전략과 바가지/품절 불만에 따른 동네 평판 변화",
    "check": "비 오는 날 차·수프 지불 용의 가격(maxPrice)이 오르고, 품절·고가 불만이 쌓이면 평판에 반영된다"
  },
  {
    "id": "M2-08",
    "stage": "M2",
    "owner": "auto",
    "proposed": true,
    "desc": "갈등과 화해(Hurt & Apology): 실수나 노쇼로 서먹해진 뒤 맞춤 선물·사과로 화해하면 신뢰(trust)·편안함(comfort)이 더 깊어짐",
    "check": "관계 감소 사건 후 사과 대화를 성공하면 이전보다 높은 신뢰 보너스와 전용 대사가 출력된다"
  }
]


4. 마스터 즉시 실행용 표준 작업 카드 5장 (C033.md ~ C037.md)

tools/scope-check.mjs의 정규식(^고칠 파일:\s*\n, ^크기:\s*(작음|보통|큼))과 줄 수 상한(보통 ≤ 150줄, 큼 ≤ 400줄)을 엄격히 준수하여 작성한 카드입니다.

카드 1: cards/C033.md (그래픽 고도화 & 추적 그림자·드로우콜 최적화)

# C033 애니메이션풍 그래픽 고도화 & 그림자·드로우콜 최적화 (플레이 경험, Claude 작업자)

목적: M1-01·M1-04·M1-19 강화. 용량 증가(0KB) 없이 상용 서브컬처 게임 수준의 색채·입체감·선명도를 확보하고, 공간 확장에 대비해 24m 셀 병합과 플레이어 추적 그림자를 도입한다.
고칠 파일:
- src/scene/looks.ts
- src/scene/corner.ts
- src/render/lighting.ts
- src/anime/avatar.ts
- src/main.ts
크기: 보통(≤150줄)
하지 말 것: sim·데이터 변경, 새 패키지 추가, 에셋 용량 증가, 커밋
통과 기준:
1. 셰이더(`looks.ts`): 애니메이션 모드에서 음영에 라벤더/청보라 색온도(`coolShadow`)와 명암 경계선 난색 띠(`warmBand`), 상단 림라이트를 적용하고, 창문(`WINDOWS`)에는 카메라 시선(`cameraPosition - vWorld`)에 반응하는 3D 실내 패럴랙스(커튼·천장 조명 깊이감)를 넣는다. 나뭇잎(`FOLIAGE`)은 구형 법선 블렌딩으로 부드러운 볼륨을 만든다.
2. 드로우콜·세계관(`corner.ts`): 배경 건물의 벽돌 색 변주에서 `material.clone()`을 제거하고 정점 `seed` 기반 셰이더 변주로 통합해 24m 셀 병합 효율을 높인다. 거리에 '결 사회'의 상징인 공중 부유 `빛씨` 파티클(`T.Points`, 드로우콜 1회)을 추가한다.
3. 카메라·그림자(`main.ts`, `lighting.ts`, `avatar.ts`): 광각 왜곡을 없애기 위해 망원 화각(`FOV 38` 가로 / `54` 세로)을 적용하고, 그림자 반경을 `55m`에서 `22m`로 좁혀 픽셀 밀도를 6.25배 높이되 플레이어 이동 시 텍셀 그리드 단위로 스냅 추적(`lighting.follow`)하게 한다. VRM의 `frustumCulled = false`를 바운딩 스피어 컬링으로 교체한다.
4. `bash tools/check.sh --card cards/C033.md` PASS (기존 걷기·달리기 플레이 시나리오 통과).
보고: 바꾼 파일 / 한 일 / 드로우콜·그림자 해상도 비교 / 스크린샷 경로 / 가정 / 제안


카드 2: cards/C034.md (생성 주민 50명 대사 폴백·이웃 인맥 시드·소문 루프 연결)

# C034 생성 주민 50명 대사 폴백·초기 인맥 시드·소문 전파 연결 (로직만, Codex)

목적: M1-12·M1-17·M1-18·M2-01 연결. 생성 주민(`generated-*`)과 대화 시 템플릿 누락으로 크래시가 나는 문제를 해결하고, 같은 집·일터 주민 간 초기 인맥을 시드해 소개팅(`requestMatch`)과 소문(`deliverRipple`)이 실제 세션에서 작동하게 한다.
고칠 파일:
- src/data/dialogue.ts
- src/sim/dialogue.ts
- src/game/session.ts
- tests/sim/dialogue.test.ts
- tests/game/session.test.ts
크기: 보통(≤150줄)
하지 말 것: 화면(`src/render/*`, `src/ui/*`) 변경, 기존 핵심 주민 6명 대사 및 기존 v1~v5 세이브 호환성 깨뜨리기, 전체 통화량(6,100결) 변경, 새 패키지, 커밋
통과 기준:
1. 원형별 대사 폴백(`data/dialogue.ts`, `sim/dialogue.ts`): `dialogueTemplates[npc.id]`가 없는 생성 주민은 `archetypeId`(또는 첫 번째 `trait` 조합)에 대응하는 기본 대사 템플릿을 사용해 `buildDialogue`, `talk`, `recordDialogue`, `confess`가 오류 없이 동작한다.
2. 반말·존댓말 반영: `GeneratedNpc`의 `speech` 설정(`informalAt` 이상일 때 `informalEndings`·`informalAddress`) 또는 친밀도 단계가 대사에 반영된다.
3. 초기 인맥 및 소문 루프: 같은 주거지·직장을 공유하는 주민 사이에 주선 가능한 기본 지인 관계를 설정(기존 저장본 복구 테스트는 깨지 않게 헬퍼 또는 요청 시점 보정)하고, `talk`/`giveGift`/`confess` 시 같은 장소에 있는 제3자 주민에게 `deliverRipple`이 기록되게 한다.
4. 테스트: 생성 주민과 대화·선물·고백 성공, 생성 주민을 통한 소개팅 후보 탐색 성공, 공개 장소 교제/선물 후 같은 장소 주민의 `noticeLine` 생성 확인.
5. `bash tools/check.sh --fast --card cards/C034.md` PASS.
보고: 바꾼 파일 / 한 일 / 생성 주민 대사 예시 3개 / 가정 / 제안


카드 3: cards/C035.md (생성 주민 휴일 외출·아로 조율 사업장·장기 세이브 정리)

# C035 대규모 확장 대비: 생성 주민 휴일 외출·아로 조율 사업장·장기 세이브 정리 (로직만, Codex)

목적: M1-15·M1-16·M1-17 보완. 생성 주민 50명이 휴일에 집에만 머무는 문제를 고쳐 거리 활기를 높이고, 상장사 `빛고리 빛씨`(아로) 사업장을 열어 3대 주식이 모두 실물 경제와 연동되게 하며, 장기 플레이 시 세이브 파일 비대화를 막는다.
고칠 파일:
- src/sim/npcgen.ts
- src/game/session.ts
- tests/game/session.test.ts
- tests/sim/npcgen.test.ts
크기: 보통(≤150줄)
하지 말 것: 화면(`src/render/*`, `src/ui/*`) 변경, 전체 잔액 합계(6,100결) 불변 규칙 위반, 새 패키지 추가, 커밋
통과 기준:
1. 생성 주민 휴일 동선(`npcgen.ts`): 쉬는 날(`day === restDay`) 일정에 `park`(떠오름 뜰) 외출 슬롯을 추가하되 `placeCapacities` 정원을 넘지 않음을 검증한다.
2. 3대 상장사 연동 및 장기 세이브 다이어트(`session.ts`): 14일이 지난 완료 근무(`shifts`)와 `left`/`paid` 방문 기록(`visits`)을 자정 정산 시 정리(직전 일일 매출 계산용 최근 이력은 유지)해 장기 진행 시 저장본 크기가 폭증하지 않게 한다.
3. `bash tools/check.sh --fast --card cards/C035.md` PASS.
보고: 바꾼 파일 / 한 일 / 30일·60일 세이브 용량 비교 / 가정 / 제안


카드 4: cards/C036.md (세션 화면 연결 & 모바일 결폰 3탭 HUD)

# C036 세션 화면 연결: 시계·지갑·출입·결폰(주민 대화·아르바이트·가게·주식) HUD (플레이 경험, Claude 작업자)

목적: M1-10·M1-11·M1-12·M1-13·M1-14·M1-15·M1-16·M1-18·M1-20 화면 연결. 백엔드 시뮬레이션(`createSession`)을 실제 3D 플레이 루프(`main.ts`)와 모바일 HUD(`hud.ts`)에 연결해 폰에서 30분 플레이 루프(걷기→출입→대화/선물/소개팅/고백→일하기/소비→주식 매매→자동 저장)가 돌아가게 한다.
고칠 파일:
- src/ui/hud.ts
- src/ui/hud.css
- src/main.ts
크기: 큼(≤400줄, 마스터 이유: 상단 상태바·문 출입·주민 대화/선물/소개팅·가게/일자리·주식 3탭 패널을 한 번에 연결해야 M1 전체 루프를 폰에서 검증할 수 있다)
하지 말 것: `src/sim/*` 규칙 변경, 좌하단 조이스틱 터치 영역(`x < 220, y > 180`) 가리기, 새 패키지 추가, 커밋
통과 기준:
1. 상단 바(`.hud-top`): 실시간 게임 시각(`formatTime`), 현재 장소 이름, 보유 현금(`결`) 및 활력(`energy`), `결폰 열기` 버튼을 우측 상단에 표시하고 매초 동기화한다.
2. 건물 출입(`.enter`): 문 근처에서 버튼이 `잔물결 찻방 들어가기` / `모아결 교환소 들어가기`로 바뀌고, 누르면 `"곧 열려요"` 대신 실제 `state.player.placeId`가 전환되며 현장 패널이 열린다.
3. 결폰 3탭(`.hud-panel`):
   - `주민·만남`: 현재 장소의 NPC 목록, 회상 대사(`buildDialogue`)·소문(`noticeLine`), 주제 대화(`talk` + `applyBondEvent`), 선물하기(`giveGift`), 친밀도 30+ 소개팅 요청(`requestMatch`), 60+ 고백(`confess`).
   - `일·소비`: 아르바이트 근무(`startWork` 후 시간 진행·급여 수령) 및 동네 가게 물건 구매(`visitStore` + `checkoutBusiness`로 전체 통화량 6,100결 보존).
   - `결증·장소`: 상장 3사 주가·보유 주수 확인 및 1주 매수/매도(`trade` 시장 계좌 `'aro'` 연동), 동네 장소 바로 이동.
4. `bash tools/check.sh --card cards/C036.md` PASS (`tests/play/walk.mjs` 조이스틱 테스트 통과).
보고: 바꾼 파일 / 한 일 / 플레이 시나리오 확인 방법 / 가정 / 제안


카드 5: cards/C037.md (의상·방 꾸미기 실효성 연결 & 주선자 소개팅 메모·노쇼 후폭풍)

# C037 소비 스탯(의상·방 분위기) 연애 연동 & 소개팅 주선자 메모·노쇼 신뢰 하락 (로직만, Codex)

목적: M1-14·M1-18 강화. `shop.ts`의 의상(`appearance`)과 방 장식(`atmosphere`) 수치가 실제 우연한 만남·소개팅 첫인상 및 집 초대 데이트에 반영되게 하고, 소개팅 노쇼(`no-show`) 시 주선자 신뢰(`trust`)가 깎이게 하여 경제 소비와 인간관계의 맞물림을 완성한다.
고칠 파일:
- src/sim/encounter.ts
- src/sim/matchmaking.ts
- src/sim/shop.ts
- tests/sim/encounter.test.ts
- tests/sim/matchmaking.test.ts
크기: 보통(≤150줄)
하지 말 것: 화면 변경, 기존 테스트 의도 훼손, 새 패키지 추가, 커밋
통과 기준:
1. 외모·방 분위기 보너스(`encounter.ts`, `shop.ts`): 플레이어가 착용한 의상(`appearance`)이 `interestIn` 첫인상 점수에 가산(예: `Math.floor(appearance / 3)`)되고, 집 장식(`atmosphere >= 5`)을 갖추면 친밀한 NPC와 집(`nest`)에서 함께 차를 마시는 `meal` 이벤트를 열 수 있다.
2. 주선자 메모 및 노쇼 페널티(`matchmaking.ts`): `Appointment.impression`에 주선자(`introducerId`)의 말투가 반영된 한 줄 소개 문구(`note`)를 포함하고, 약속이 `no-show`로 끝났을 때 플레이어가 불참(`noShowBy.includes(actorId)`)이면 주선자와 상대방에 대한 `trust` 감소 효과를 반환한다.
3. `bash tools/check.sh --fast --card cards/C037.md` PASS.
보고: 바꾼 파일 / 한 일 / 스탯 반영 수식 및 테스트 결과 / 가정 / 제안


5. 참조 구현 코드 (마스터 및 작업자 참고용 검증본)

① src/scene/looks.ts (컬러 툰 램프 · 3D 창문 패럴랙스 · 구형 나뭇잎 법선 · 벽돌 정점 시드 변주)

import { DataTexture, Material, Mesh, MeshStandardMaterial, MeshToonMaterial, NearestFilter, RedFormat, Scene } from 'three';
import { cornerPalette } from '../render/palette';

function grounded(material: Material, windows: boolean, brick: boolean, foliage: boolean, anime: boolean) {
  material.defines = {
    ...material.defines,
    ...(windows ? { WINDOWS: '' } : {}),
    ...(brick ? { BRICK_VARY: '' } : {}),
    ...(foliage ? { FOLIAGE: '' } : {}),
    ...(anime ? { ANIME_STYLE: '' } : {}),
  };
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        varying vec3 vWorld;
        varying float vSeed;
        attribute float seed;`)
      .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        #ifdef FOLIAGE
        objectNormal = normalize(mix(objectNormal, normalize(position + vec3(0., 1.2, 0.)), 0.65));
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wPos = vec4(transformed, 1.);
        #ifdef USE_INSTANCING
        wPos = instanceMatrix * wPos;
        #endif
        wPos = modelMatrix * wPos;
        vWorld = wPos.xyz;
        vSeed = abs(seed) > 0.001 ? seed : (modelMatrix[3].x + 1.7 * modelMatrix[3].z);`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vWorld;
        varying float vSeed;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        #ifdef BRICK_VARY
        float bPick = fract(abs(vSeed) * 0.3183);
        vec3 bTint = bPick < 0.33 ? vec3(0.92, 0.82, 0.78) : bPick < 0.66 ? vec3(0.78, 0.83, 0.90) : vec3(0.95, 0.88, 0.78);
        diffuseColor.rgb *= bTint;
        #endif
        float groundOcc = mix(0.42, 1.0, smoothstep(0.1, 1.5, vWorld.y));
        float heightLift = 1.0 + 0.18 * smoothstep(2.5, 14.0, vWorld.y);
        diffuseColor.rgb *= groundOcc * heightLift;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        #ifdef WINDOWS
        float floorId = floor(vWorld.y / 3.1);
        float paneId = floor((vWorld.x + vWorld.z) * 0.85);
        float level = vWorld.y < 3.0 ? 0.92 : fract(sin(floorId * 12.99 + paneId * 2.17 + vSeed * 4.13) * 43758.55);
        vec3 viewRay = normalize(vWorld - cameraPosition);
        vec2 roomUv = fract(vec2((vWorld.x + vWorld.z) * 0.7, vWorld.y * 0.45) + viewRay.xz * 0.28);
        float curtain = smoothstep(0.08, 0.22, roomUv.x) * smoothstep(0.92, 0.78, roomUv.x);
        float ceiling = smoothstep(0.88, 0.55, roomUv.y);
        vec3 roomWarm = mix(vec3(1.0, 0.68, 0.42), vec3(1.0, 0.92, 0.76), ceiling) * (0.65 + 0.35 * curtain);
        totalEmissiveRadiance *= roomWarm * (level < 0.28 ? 0.14 : level < 0.72 ? 1.05 : 2.35);
        #endif`)
      .replace('#include <opaque_fragment>', `#ifdef ANIME_STYLE
        float luma = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
        vec3 coolShadow = outgoingLight * vec3(0.78, 0.82, 1.04);
        vec3 warmBand = outgoingLight * vec3(1.08, 0.94, 0.88);
        float shadowMix = smoothstep(0.18, 0.48, luma);
        float bandMix = smoothstep(0.28, 0.42, luma) * (1.0 - smoothstep(0.42, 0.58, luma));
        outgoingLight = mix(coolShadow, outgoingLight, shadowMix) + warmBand * bandMix * 0.12;
        float rim = pow(1.0 - max(dot(normalize(vNormal), vec3(0.0, 0.35, 0.94)), 0.0), 3.2);
        outgoingLight += vec3(0.95, 0.88, 1.0) * rim * 0.09 * smoothstep(1.2, 8.0, vWorld.y);
        #endif
        #include <opaque_fragment>`);
  };
}

const ramp = new DataTexture(new Uint8Array([108, 148, 212, 255]), 4, 1, RedFormat);
ramp.minFilter = ramp.magFilter = NearestFilter;
ramp.needsUpdate = true;

export function applyLook(scene: Scene, look: 'a' | 'b' | 'anime', windowGlow = 1.6) {
  const { materials: p } = cornerPalette();
  const variants = new Map<Material, Material>();
  function shade(material: Material) {
    if (!(material instanceof MeshStandardMaterial)) return material;
    const cached = variants.get(material);
    if (cached) return cached;
    const result = material.clone();
    const name = material.name.toLowerCase();
    const isBrick = /brick/.test(name), isWindow = /fakeinterior_1/.test(name);
    const isFoliage = /leaf|leaves|tree|bush|foliage|plant/.test(name);
    if (look !== 'a') {
      result.roughness = Math.max(result.roughness, 0.85);
      if (isBrick && look === 'b') result.color.multiply(p.brick.color);
      if (/asphalt/.test(name)) result.color.copy(p.asphalt.color);
      if (result.roughnessMap && !/dirt/.test(name)) result.aoMap = result.roughnessMap;
    }
    if (isWindow || /glass/.test(name)) {
      result.emissive.set('#ffc178');
      result.emissiveIntensity = /glass/.test(name) ? 0.14 : look === 'a' ? 0.65 : windowGlow;
      result.emissiveMap = result.map;
    }
    const final = look === 'anime' ? Object.assign(new MeshToonMaterial().copy(result as never), { gradientMap: ramp }) : result;
    if (look === 'anime') final.color.offsetHSL(0, 0.06, name ? 0.02 : 0.12).multiplyScalar(1.1);
    if (look !== 'a' && name) grounded(final, isWindow, isBrick, isFoliage, look === 'anime');
    variants.set(material, final);
    return final;
  }
  scene.traverse(object => {
    if (object instanceof Mesh) object.material = Array.isArray(object.material)
      ? object.material.map(shade) : shade(object.material);
  });
  Object.values(p).forEach(material => material.dispose());
}


② src/render/lighting.ts (22m 고밀도 그림자 + 텍셀 그리드 스냅 추적)

  const snapped = new Vector3();
  function update(target: Vector3) {
    const step = Math.max(0.5, (radius * 2) / sun.shadow.mapSize.x * 4);
    snapped.set(Math.round(target.x / step) * step, 0, Math.round(target.z / step) * step);
    if (snapped.distanceToSquared(sun.target.position) < 0.01 && sun.position.lengthSq() > 0) return;
    sun.target.position.copy(snapped);
    sun.position.copy(snapped).add(offset);
    sun.target.updateMatrixWorld();
    renderer.shadowMap.needsUpdate = true;
  }
  function follow(playerPos: Vector3) {
    if (mode === 'off') return;
    if (playerPos.distanceToSquared(sun.target.position) > 16) update(playerPos);
  }


③ src/ui/hud.ts (세션 연결 시 핵심 불변식 주의사항)

폐쇄 경제 합계(6,100결) 보존: session.ts v5에서 'shop', 'cafe', 'market' 계좌는 모두 개인 계좌('sori', 'nuel', 'aro')로 통폐합되었습니다. 따라서 HUD에서 플레이어가 물건을 살 때는 buyItem(내부적으로 'shop' 계좌 이체 시도) 대신 반드시 visitStore + checkoutBusiness를 호출해야 하며, 주식 매매(trade)를 호출할 때는 marketAccount 인자에 기본값 'market' 대신 'aro'를 넘겨야 ledger.balances 합계 보존이 깨지지 않습니다.
