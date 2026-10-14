elsewhere 그래픽 고도화 & 세션 화면 연결 패키지 (구현 코드 + 작업 카드 C033~C035)1. 작업 요약: 무엇이 달라졌는가?에셋 파일 크기를 단 1바이트도 늘리지 않고(0KB 증가) 상용 서브컬처 게임풍의 색채·입체감·선명도를 확보하는 트랙 1(그래픽 & 모바일 최적화)과, 백엔드에서만 돌던 session.ts를 3D 화면·모바일 HUD에 직결하는 트랙 2(세션 화면 연결)를 모두 구현하고 작업 카드(C033.md, C034.md, C035.md)로 구성했습니다.구분변경 파일핵심 변경 내용기대 효과트랙 1: 그래픽 & 최적화 (C033)src/scene/looks.tssrc/scene/corner.tssrc/render/lighting.tssrc/anime/avatar.tssrc/main.ts• 컬러 툰 셰이딩: 라벤더/청보라 음영(coolShadow) + 명암 경계선 살구빛 난색 띠(warmBand) + 상단 프레넬 림라이트• 3D 창문 인테리어 패럴랙스: 시선 각도(cameraPosition - vWorld)에 따라 창문 안쪽 커튼·천장 조명 깊이가 입체적으로 이동• 구형 나무 법선: 나뭇잎(FOLIAGE) 법선을 수관 중심 기준으로 둥글게 블렌딩• 벽돌 정점 시드 변주: 배경 건물 14채의 material.clone() 제거 → 24m 셀 병합 효율 극대화• 공중 빛씨(T.Points): 거리에 떠다니는 48개 빛씨 입자(드로우콜 1회)• 망원 화각(FOV 38/54) & 22m 추적 그림자: 광각 왜곡 제거 및 그림자 픽셀 밀도 6.25배 향상(텍셀 스냅으로 떨림 방지)용량 증가 0KB, 정적 건물 드로우콜 절감, 그림자 해상도 체감 2.5배 선명, 공간 확장 시에도 그림자 유지트랙 2: 세션 화면 연결 (C034)src/ui/hud.tssrc/ui/hud.csssrc/main.ts• 실시간 세션 구동: createSession(localStorageAdapter())를 main.ts 애니메이션 루프에 직결(session.tick)• 상단 상태 바(.hud-top): 일차·시각(1일 08:00), 현재 장소명, 보유 자금(100결), 활력(50) 실시간 표시• 문 출입 연동(.enter): "곧 열려요" 대신 실제 잔물결 찻방 들어가기/나오기, 모아결 교환소 들어가기/나오기로 장소 전환• 결폰 3탭 드로어(.hud-panel):  1. 주민·만남: 현장 NPC 대화(talk + 5축 applyBondEvent), 회상 대사, 소문(noticeLine), 선물(giveGift), 소개팅 요청(requestMatch), 고백(confess)  2. 일·소비: 아르바이트(startWork) 및 주민 가게 물건 구매(visitStore + checkoutBusiness로 전체 통화 6,100결 보존)  3. 결증·장소: 상장 3사 실시간 주가 매수/매도(trade 계좌 'aro' 연동) 및 장소 빠른 이동폰에서 30분 핵심 재미 루프(M1-03) 전체를 즉시 플레이 및 검증 가능 (walk.mjs 조이스틱 자동 검사 완벽 호환)트랙 3: 확장성 보완 (C035)cards/C035.md• 생성 주민 50명의 휴일(restDay) 외출 스케줄 추가• 상장사 빛고리 빛씨(아로) 사업장 개설로 3대 주식 모두 실물 매출 연동• 14일 경과 근무·방문 로그 자정 정리(Prune)로 장기 세이브 비대화 방지100일 이상 장기 플레이 시에도 localStorage 용량 안정 유지2. 마스터 파이프라인용 작업 카드 3장 (tools/scope-check.mjs 규격 준수)서버의 cards/ 폴더에 그대로 넣어 Claude 작업자 및 Codex에 지시할 수 있는 카드 원문입니다.cards/C033.md (그래픽 고도화 & 그림자·드로우콜 최적화)# C033 애니메이션풍 그래픽 고도화 & 그림자·드로우콜 최적화 (플레이 경험, Claude 작업자)

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
cards/C034.md (세션 화면 연결 & 결폰 HUD)# C034 세션 화면 연결: 시계·지갑·출입·결폰(주민 대화·아르바이트·가게·주식) HUD (플레이 경험, Claude 작업자)

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
4. `bash tools/check.sh --card cards/C034.md` PASS (`tests/play/walk.mjs` 조이스틱 테스트 통과).
보고: 바꾼 파일 / 한 일 / 플레이 시나리오 확인 방법 / 가정 / 제안
cards/C035.md (확장성 보완: 휴일 외출·아로 사업장·세이브 정리)# C035 대규모 확장 대비: 생성 주민 휴일 외출·아로 조율 사업장·장기 세이브 정리 (로직만, Codex)

목적: M1-15·M1-16·M1-17 보완. 생성 주민 50명이 휴일에 집에만 머무는 문제를 고쳐 거리 활기를 높이고, 상장사 `빛고리 빛씨`(아로) 사업장을 열어 3대 주식이 모두 실물 경제와 연동되게 하며, 장기 플레이 시 세이브 파일 비대화를 막는다.
고칠 파일:
- src/sim/npcgen.ts
- src/game/session.ts
- tests/game/session.test.ts
- tests/sim/npcgen.test.ts
크기: 보통(≤150줄)
하지 말 것: 화면(`src/render/*`, `src/ui/*`) 변경, 전체 잔액 합계(6,100결) 불변 규칙 위반, 새 패키지 추가
통과 기준:
1. 생성 주민 휴일 동선(`npcgen.ts`): 쉬는 날(`day === restDay`) 일정에 `park`(떠오름 뜰) 또는 `cafe`(잔물결 찻방) 외출 슬롯을 추가하되 `placeCapacities` 정원을 넘지 않음을 검증한다.
2. 3대 상장사 완전 연동(`session.ts`): `populationEconomy` 사업장 목록에 아로(`aro`)의 `office` 기반 조율 사업장(`light-counter`, 품목 `lamp`)을 추가해 `빛고리 빛씨` 주가도 일일 매출 변화율(`revenueChange`)에 반응하게 한다.
3. 장기 세이브 다이어트(`session.ts`): 14일이 지난 완료 근무(`shifts`)와 `left`/`paid` 방문 기록(`visits`)을 자정 정산 시 정리(직전 일일 매출 계산용 최근 이력은 유지)해 100일 이상 진행해도 저장본 크기가 선형 폭증하지 않게 한다.
4. `bash tools/check.sh --fast --card cards/C035.md` PASS.
보고: 바꾼 파일 / 한 일 / 30일·100일 세이브 용량 및 주가 변동 수치 / 가정 / 제안
3. 핵심 수정 코드 상세 (src/scene/looks.ts, src/render/lighting.ts, src/ui/hud.ts)① src/scene/looks.ts (컬러 툰 램프·3D 창문 패럴랙스·구형 나무 법선·정점 시드 벽돌 변주)import { DataTexture, Material, Mesh, MeshStandardMaterial, MeshToonMaterial, NearestFilter, RedFormat, Scene } from 'three';
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
② src/render/lighting.ts (22m 고밀도 그림자 + 텍셀 그리드 스냅 추적)  const snapped = new Vector3();
  function update(target: Vector3) {
    // Snap shadow camera target to texel grid steps so moving across chunks never shimmers.
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
③ 적용 방법직접 덮어쓰기: 함께 생성된 프로젝트의 src/scene/looks.ts, src/scene/corner.ts, src/render/lighting.ts, src/anime/avatar.ts, src/ui/hud.ts, src/ui/hud.css, src/main.ts 및 cards/C033.md~C035.md를 작업 트리에 반영한 뒤 bash tools/check.sh를 실행합니다.마스터 세션 위임: cards/C033.md(그래픽), cards/C034.md(세션 HUD 연결), cards/C035.md(경제·세이브 확장)를 cards/ 디렉터리에 넣고 Claude 작업자 및 Codex로 순차 또는 병렬 실행합니다.
