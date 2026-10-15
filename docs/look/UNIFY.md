# 기준 이미지 하나로 게임 그래픽 전체 통일 (UNIFY.md)
R020 · 2026-10-15 · 리서치(코드 변경 없음). 질문: "Gemini 기준 이미지가 오면 **무엇을 어디서** 바꿔야 모든 화면이 따르고, 그 **최소 손잡이**는 무엇인가?"
근거: DIRECTION.md 2026-10-15 밤(과슈·툰 중 고르지 않고 Gemini 이미지 1장을 기준으로 거리·건물·캐릭터·실내·하늘·UI 통일), STYLE.md §2~§10, palette.json, 현 코드.

## 0. 결론 (먼저)
- 지금도 **시간대 표 하나(`src/render/style.ts:9-16`의 `keys`)** 가 하늘·해·채움광·그늘곱·선 잉크·블룸을 이미 몰고 간다. 통일의 70%는 끝나 있다.
- 남은 30%는 **흩어진 하드코딩 약 40곳**(재질 보정 계수, 창 색, 램프 문턱, 소품·UI hex, 옷 hex, Blender 색)이다. 이것을 `docs/look/tokens.json` 한 파일로 모으면, 새 기준 이미지 = **토큰 파일 1개 교체 + 에셋 재정규화 1회**가 된다.
- 손잡이는 **7묶음·약 30개 값**(§2). 그중 이미지에서 숫자로 뽑히는 것은 팔레트·하늘·그늘곱·선 굵기/색, 눈으로 정해야 하는 것은 질감 종류·음영 단수·블룸 세기.
- "질감(붓/종이/없음)"은 지금 코드에 **없는 유일한 축**이다(C069는 카드만 있고 코드 없음, `b7b9919`). 기준 이미지가 붓질이면 이 축 하나가 새 작업, 아니면 0줄.

## 1. 그림을 정하는 곳 전수 (file:line · 무엇 · 토큰으로 묶였나)
표기: ✅ 시간대 표/palette.json에서 옴 · △ 일부 · ❌ 하드코딩

### 1-1. 시간대·빛·하늘 (이미 중심)
| 위치 | 정하는 것 | 상태 |
|---|---|---|
| `src/render/style.ts:9-16` | 낮/노을/밤 키: sky 3색, glow, sun 색·세기·고도, fill 세기, **shade 곱**, **ink**, band, windows, bloom 문턱, clouds | ✅ (단, palette.json과 **이중 기록** — sky/sun/ink가 두 곳) |
| `style.ts:20-24` `ungraded()` | 최종 채도 +15%를 하늘·안개에서 되돌림 | ❌ 1.15가 `duskLUT.ts:44`와 짝 |
| `style.ts:28` | 채움광 = 하늘 위 / 하늘 아래×0.6 (§10-2 유도) | △ 0.6 하드코딩 |
| `src/main.ts:151-161` | 해 방향(0.45,0,0.9), 조명에 tone 주입 | ✅ |
| `src/main.ts:170` | 안개 48~155m | ❌ |
| `src/main.ts:171-188` | 하늘 셰이더: 띠 폭 .06/.2, 해 번짐 .7·pow4/1.4·pow60 | ❌ |
| `src/anime/clouds.ts:300-310` | 구름 모양(원 6개)·아랫면 그늘 rgba(150,170,210,.55) | △ 틴트만 tone.clouds |
| `src/render/lighting.ts:19-20` | 기본 fill/sun hex | ✅ anime에선 main.ts가 덮음 |
| `src/render/atmosphere.ts` | 안개=배경색 | ✅ 값은 main.ts에서 |

### 1-2. 셰이딩·선·후처리
| 위치 | 정하는 것 | 상태 |
|---|---|---|
| `src/scene/looks.ts:106-124` | 도시 2단 셀: 경계 `smoothstep(.1,.16,d)`, 그림자 판정 .4~.6 | ❌ 경계각 하드코딩 |
| `looks.ts:93-94` | 그늘 = ×shadeMul, 따뜻한 띠 색 (1.14,.98,.84) | △ 곱은 tone, 띠 색 ❌ |
| `looks.ts:66` | 벽돌 3종 틴트 (.92,.82,.78)… | ❌ palette 밖 색 |
| `looks.ts:68-70` | 줄눈선 간격·세기 .14·12~30m 페이드 | ❌ (질감 축) |
| `looks.ts:74` | 접지 어둡기 0.4→1, 위층 +16% | ❌ |
| `looks.ts:78-82` | 창 패턴·켜짐 문턱 .45·창 2톤 색 3개·틀색 | ❌ (palette의 window_warm 안 씀) |
| `looks.ts:175-176` | 창 발광색 #ffc178 | ❌ |
| `looks.ts:180-188` | 사진 텍스처→평균색, 채도 +.12/+.05, 명도 ×1.1 | ❌ **보정 계수 3개가 팔레트를 비튼다** |
| `looks.ts:148-154` | 램프 텍스처(3단/소프트) | ❌ toon=a 경로에선 실질 미사용 |
| `src/anime/wardrobe.ts:281-286` | MToon: shade=색×tone.shade, toony .95, shift -.13, 림·matcap 끔 | ✅ 곱은 tone, 경계 ❌ (도시 .13과 손으로 맞춤) |
| `wardrobe.ts:243` | 옷 재채색 주름 세기 .35/.8, 밝기 .6~1.2 | ❌ |
| `src/render/outline.ts:17,31-34,43` | 선 세기 .75, 굵기 0.75 CSS px 탭, 거리 12/18·25/35·60/90, 발광 제외 1.4 | △ ink만 tone |
| `src/render/duskLUT.ts:27,40-45` | 노출 1.15(anime 1), Neutral 어깨 .76, 채도 1.15 | ❌ |
| `duskLUT.ts:16-17` | LUT 그늘 푸른 틴트·하이라이트 따뜻 (anime는 grade 꺼짐) | — anime 미사용 |
| `src/render/cheapBloom.ts:11` | 문턱(tone.bloom이 덮음)·knee .3, 1/4 해상도 | △ |
| `main.ts:73` | 발밑 그림자 #000·0.5 | ❌ (§4 "그늘색=곱"과 어긋남) |
| `src/scene/corner.ts:50-70` | 건물 둘레 접지 그림자 검정 .65 | ❌ |

### 1-3. 색이 박힌 에셋·소품
| 위치 | 정하는 것 | 상태 |
|---|---|---|
| `docs/look/palette.json` | 63색: 하늘·빛·잉크 + 재질 albedo + 강조·발광·옷 | ✅ 원천 |
| `tools/blender/normalize.py:7-9,71-80` | GLB 재질을 palette 최근접색으로 **양자화**, 재질 이름 = 팔레트 이름 | ✅ 가장 좋은 고리 |
| `tools/blender/buildings.py:12-16` | 건물 키트 재질→팔레트 이름, 단 9개는 raw hex(#b08660, #46536a, #d8b98c…) | △ |
| `tools/blender/lise_vroid.py:18,210,228` | 리세 옷 hex, shade=0.62×lit, 머리 그늘 (.66,.68,.78) | ❌ **§10-6 위반**(절대 그늘색) |
| `src/anime/wardrobe.ts:208-216` | NPC 7벌×7슬롯 hex | ❌ palette 옷색과 별도 |
| `src/render/palette.ts:6-7` | cornerPalette 6색 (look b 전용) | ❌ anime 무관, 남은 코드 |
| `src/scene/corner.ts:148-150`, `block.ts:83-85` | 차도 #414750·보도 #b8b2a4·도색 #e1d8be | ❌ palette(road #8e8a86 등)와 **불일치** |
| `src/scene/props.ts:38-46,67,73,79,91` | 간판판·글자·가로등·전구·빛웅덩이·차양 줄무늬 hex, 폰트 `bold 64px sans-serif` | ❌ |
| `corner.ts:88` | 반딧불/먼지 점 #ffd9a0 | ❌ |
| `src/assets/*.glb` (city·street·cars·people·nature, 6.6MB 전체) | 키트 원본 사진 텍스처 → looks.ts가 평균색으로 뭉갬 | △ normalize.py 통과분만 ✅ |
| `tools/assets.mjs` | 압축(webp·meshopt)만, 색 관여 없음 | — |

### 1-4. UI
| 위치 | 정하는 것 | 상태 |
|---|---|---|
| `src/ui/hud.css` 전체(113줄) | 강조 #ffc178(12곳), 패널 rgba(20,24,32,.6~.88), 글자 #fff/#9aa3b5/#c7cdd8, 갈색 글자 #2b2018, 모서리 10~20px, `system-ui` 굵기 500~800 | ❌ CSS 변수 0개 |
| `src/ui/hud.ts`, `talk.ts` | 인라인 색 없음(클래스만) | ✅ |

### 1-5. 과슈 분기
- `?look=gouache`는 **코드가 없다**. `b7b9919`는 `cards/C069.md`(16줄)만 추가. 원격 `cl/c069` 브랜치 없음.
- 카드가 그린 구조(재질 이름별 텍스처 매핑, 외곽선 끔, 3단 음영, 반해상도 Kuwahara+종이결)는 아래 "질감" 토큰의 한 값(`texture: brush`)으로 흡수하면 된다. 따로 분기를 만들 필요 없음.

## 2. 최소 스타일 토큰 설계
원칙: **한 파일**(`docs/look/tokens.json`, palette.json을 흡수·대체), 코드는 이름으로만 읽는다(§10-1). 시간대 표는 style.ts에 두되 값은 이 파일에서 온다.
값 수를 늘리지 않는다 — 아래에 없는 계수(채도 +.12, ×1.1 등)는 **없애고 팔레트를 바로 맞춘다**.

| 묶음 | 토큰 | 개수 | 이미지에서 뽑는 법 | 측정/눈 |
|---|---|---|---|---|
| A. 팔레트 | 재질 albedo(벽 5·장식 2·지면 5·강조 10·잎/줄기 2), 옷 12, 발광 8 | ~45색(지금과 같은 이름) | 영역별 마스크(벽·길·옷) 안 **k-means k=3~5**, 가장 큰 군집 = 밝은 면, 두 번째 어두운 군집 = 그늘 → 밝은 면을 albedo로. 이름은 지금 palette.json 그대로, 값만 교체 | 측정 |
| B. 하늘 | 시간대×{위·띠·아래(=안개)}, 해 번짐 색, 구름 색·구름 그늘 | 3×5 | 하늘 영역 세로 3구간 패치 평균. 기준 이미지가 한 시간대뿐이면 나머지 둘은 **같은 색상환 회전량**으로 유도(낮→노을 = 기준 대비 Hue/명도 차를 현 표에서 복사) | 측정 1 + 유도 2 |
| C. 음영 | `shade` 곱(시간대 3), `steps` 2\|3, `terminator`(N·L 경계 중심·폭), `band`(따뜻한 띠 색·세기), `ground`(접지 어둡기) | 7 | 같은 재질 밝은/그늘 패치 비 = shade 곱(채널별). 경계 폭은 확대해 px로. 단수는 눈 | 측정 + 눈 |
| D. 선 | `ink`(시간대 3), `width_px`(실루엣·접힘), `strength`, `fade_m`(시작·끝), `on`(true/false) | 7 | 선 중심 픽셀 색 = ink, 법선 방향 프로파일로 굵기(852폭 환산), 인물 선 vs 건물 선 따로 재서 같으면 하나 | 측정 |
| E. 질감 | `texture`: none \| paper \| brush, `grain`(0~1), `wash`(평면 내 명도 흔들림 %) | 3 | 평면 영역 명도 표준편차(σ) — σ<2% none, 2~6% paper, >6%+방향성 brush | 측정+눈 |
| F. 후처리 | `bloom`(시간대 문턱·세기), `exposure`, `saturation`(지금 1.15), `fog_m`(near·far), `far_desat` | 6 | 블룸은 눈. 채도·노출은 **A를 맞춘 뒤 0.5단계 내 미세조정**만 | 눈 |
| G. UI | `--ui-accent`, `--ui-panel`, `--ui-panel-alpha`, `--ui-text`, `--ui-text-dim`, `--ui-ink`(밝은 바탕 위 글자), `--ui-radius`, `--ui-font` | 8 | 기준 이미지 강조색 1(A 강조 중 채도 최고) + 그늘색 최암 = 패널, 글자 = 창 크림. 폰트는 눈(그림 속 간판 서체 계열) | 측정+눈 |

합계 손잡이: A·B는 "색 표", 그 밖 **C~G 약 30개 숫자**. 기준이 바뀌어도 코드가 바뀌는 곳은 E(질감)뿐.

### 2-1. 추출 도구(작게)
- `tools/look-extract.mjs`(새, ~120줄, Codex): 입력 기준 PNG + 사람 손으로 그린 영역 사각형 JSON(벽·길·하늘·옷·선 위치, 10~20개) → 패치 k-means·하늘 3구간·명도 σ·선 굵기 → `tokens.candidate.json` + 비교 시트(기준 패치 | 현재 값 | ΔE).
- 자동 분할(세그멘테이션)은 하지 않는다. 사각형 20개를 눈으로 찍는 게 더 빠르고 정확.
- 이미지 조명이 섞인 값이므로 albedo = 밝은 면 ÷ (해 색×세기의 정규화) 한 번 보정. 오차 ±10%는 STYLE.md와 같은 허용.

### 2-2. 질감 축이 붓질일 때만
- 셰이더 쪽: 재질 이름 → 작은 과슈 텍스처(≤256px WebP, 월드 UV 반복) 곱하기 1줄 + 화면 공간 종이 결(타일 128px) 1줄. **Kuwahara는 쓰지 않는 쪽을 기본**(폰 비용 §4).
- 텍스처는 재질 12장 × ~15KB = ~180KB. palette 이름이 이미 재질 이름이라 매핑 표가 따로 필요 없다.

## 3. 적용 계획 (카드, 각 ≤150줄)
기준 이미지 도착 전에 할 수 있는 것(①~④)과 도착 후(⑤~⑨)로 나눈다. 도착 전 카드는 **화면 결과가 지금과 픽셀 동일**이어야 통과(리팩터 안전).

| # | 카드 | 고칠 파일 | 크기 | 담당 | 병렬 |
|---|---|---|---|---|---|
| ① | **토큰 파일 만들기**: palette.json + style.ts `keys` + 흩어진 계수(§1 ❌ 중 C·D·F)를 `docs/look/tokens.json`으로. style.ts가 import(vite JSON). palette.json은 normalize.py·buildings.py 호환 위해 tokens.json에서 생성하거나 그대로 키 유지 | style.ts, tokens.json(새), palette.json | 보통 | Codex low | 단독 선행 |
| ② | **셰이더 계수 → 토큰**: looks.ts 경계·띠색·접지·창색·벽돌 틴트, outline.ts 굵기·거리, duskLUT 채도·노출, main.ts 하늘 띠·안개, wardrobe.ts toony/shift(도시 경계와 **같은 값 하나**에서). 보정 계수(+.12, ×1.1)는 팔레트를 그만큼 바꿔 제거 | looks.ts, outline.ts, duskLUT.ts, main.ts, wardrobe.ts | 보통 | Claude opus | ① 뒤 |
| ③ | **에셋 색 → 이름**: corner/block 지면 3재질·props hex·발밑/접지 그림자색을 palette 이름으로(그림자 = 땅 albedo × shade 곱, 검정 금지). buildings.py raw hex 9개 팔레트에 추가 | corner.ts, block.ts, props.ts, buildings.py | 보통 | Codex medium | ②와 병렬 |
| ④ | **UI 토큰**: hud.css 상단 `:root` 변수 8개, 하드코딩 색 치환(같은 값, 화면 불변). main.ts에서 tokens.json의 UI 묶음을 CSS 변수로 주입(5줄) | hud.css, main.ts | 작음 | Codex low | ②·③과 병렬(main.ts는 ②와 충돌 → ② 뒤 또는 주입만 ⑥에서) |
| — | **이미지 도착** | | | | |
| ⑤ | **추출**: look-extract.mjs + 사각형 JSON → tokens.candidate.json, 비교 시트 | tools/look-extract.mjs(새) | 보통 | Codex medium | ④와 병렬 가능(도착 전 작성, 기존 target-*.png로 검증) |
| ⑥ | **토큰 적용 1차**: candidate 값을 tokens.json에 넣고 §9 16장 시트, 마스터가 기준 이미지 옆에 놓고 판정 | tokens.json | 작음 | 마스터 | ⑤ 뒤 |
| ⑦ | **에셋 재정규화**: normalize.py를 새 팔레트로 GLB 재실행(Blender, 서버 1개씩), 리세·NPC 옷 hex를 팔레트 이름으로(lise_vroid.py 그늘 0.62·머리 그늘 → tone.shade 사용, §10-6) | src/assets/*.glb, wardrobe.ts, lise_vroid.py | 보통 | Codex + 서버 Blender | ⑥과 병렬 |
| ⑧ | **질감 축**(기준이 paper/brush일 때만): §2-2, 텍스처 12장 + 셰이더 2줄 + 종이결 | looks.ts, wardrobe.ts, src/assets/paint/(새) | 보통~큼 | Claude opus | ⑥ 뒤 |
| ⑨ | **2·3차 맞춤**: 시트 보고 토큰만 조정(코드 변경 금지), 2안+둘 다 반려로 사용자에게 | tokens.json | 작음 | 마스터/Claude sonnet | 반복 |

- 실내: 지금 실내 장면 코드가 없다(창 안 평면 2톤만). 실내가 생기면 **같은 tokens.json·같은 looks/wardrobe 경로로 만들기만** 하면 따로 맞출 게 없다 → 실내 카드에 "새 재질은 applyLook 경유, 팔레트 이름만" 한 줄을 넣는다.
- 검사 추가(①에 포함, ~20줄): `tools/check.sh`에 `src/**/*.ts`·`*.css`의 새 hex 리터럴 개수 상한(현재 값 고정, 늘면 실패). STYLE §10-1 "임의 hex 금지"의 자동판.

순서 요약: ① → (② ∥ ③ ∥ ⑤) → ④ → [이미지] → ⑥ → (⑦ ∥ ⑧) → ⑨. 도착 전 ①~⑤를 끝내면 도착 당일 ⑥ 한 번에 첫 시트.

## 4. 폰 성능 위험 (60fps, 아이폰 16 사파리 dpr 2~3)
| 위험 | 비용 | 판단 |
|---|---|---|
| 토큰화 자체 | 유니폼 몇 개, 0 | 없음. 단 tokens.json을 **빌드 때 상수로**(vite JSON import) — 런타임 fetch 금지(첫 화면 지연) |
| 질감 brush: Kuwahara 후처리 | 반해상도에서도 픽셀당 16~32탭, dpr 2 가로 852 → 약 70~140만 탭/프레임. 폰에서 4~8ms 추정 = 예산의 25~50% | **기본 금지**. 재질 텍스처 곱(탭 1)+종이결(탭 1)로 대신. Kuwahara는 사진 모드 전용 |
| 재질 텍스처 추가 | 12장×256² WebP ≈ 180KB, GPU 메모리 ~3MB | 안전. 텍스처 샘플 1회 추가 |
| 음영 3단(steps=3) | 셰이더 분기 1개 | 비용 없음. 단 STYLE §4·§8의 2단 규칙과 충돌 → 사용자 결정으로만 |
| 선 끄기(D.on=false) | ToonEdges 패스 1개 절약(가장 비싼 전체화면 패스, 깊이 5탭+법선 재구성) | 오히려 이득 |
| 블룸 세기↑ | 1/4 해상도라 작음 | 안전. 품질 사다리 1~2단에 이미 있음 |
| 하늘·구름 그림풍 변경 | 카드 인스턴스 1 draw | 안전. 구름을 메시로 바꾸면 삼각형 확인 |
| 용량 | `tools/check.sh:23-25`는 여전히 단일 파일 ≤10240KB 검사. 현재 src/assets 6.6MB. 사용자는 2026-10-15에 제한 해제 승인(나눠 받기+캐시) | 질감 텍스처 180KB까진 여유. GLB 재정규화로 사진 텍스처를 떼면 **오히려 줄어든다**(평면색 재질). check.sh 기준을 아이폰 fps로 바꾸는 건 별도 카드 |
| 재정규화 회귀 | 팔레트 최근접 양자화라 색이 한 칸씩 튈 수 있음 | ⑦ 뒤 §9 시트 필수 |
| 캐릭터 | VRM 원본 맵 재채색은 로드 시 캔버스(512px)·인물당 수십 ms | 그대로. 옷을 팔레트 평면색으로 바꾸면 더 빨라짐 |

## 5. 가정 · 제안
- 가정: 기준 이미지는 1장(한 시간대·한 장면). 나머지 시간대·장소는 현 시간대 표의 **차이**를 유지해 유도한다. 사용자가 시간대별 이미지를 더 주면 B를 측정으로 교체.
- 가정: 기준이 무엇이든 "평면색 + 셀 + 선 유무 + 질감" 4축 안에 든다(사실적 PBR·SSR은 STYLE §8과 폰 비용으로 제외).
- 제안: `src/render/palette.ts`(cornerPalette)와 look a/b·toon b 분기, `looks.ts:148-154` 소프트 램프는 anime 기본에서 쓰이지 않는다 → ② 때 같이 정리하면 토큰 대상이 줄어든다(마스터 승인 필요).
- 제안: STYLE.md §2 표는 tokens.json을 사람이 읽는 판으로 남기고, 값의 원천은 tokens.json 하나로(지금 palette.json·style.ts·STYLE.md 세 곳에 같은 하늘색이 있다).
- 제안: 기준 이미지 요청 시 Gemini에 **같은 프롬프트로 낮/노을/밤 + 캐릭터 정면 1장 + UI 목업 1장**을 함께 뽑으면 B·G 묶음을 유도 대신 측정할 수 있다.
