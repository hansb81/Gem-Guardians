# Gem Guardians

Match-3 퍼즐 + 방치형 디펜스. HTML + CSS + JavaScript(ES Modules), 빌드 도구 없음,
렌더링은 Canvas 2D. Capacitor로 Android/iOS 포팅을 염두에 두고 플랫폼 종속 코드를
최소화했다(`src/core`는 DOM/Canvas/타이머 등 브라우저 API를 전혀 사용하지 않는다).

## 실행 방법

ES Modules는 `file://`로 직접 열면 CORS 때문에 동작하지 않는다. 로컬 정적 서버로 띄워야 한다.

```bash
# 아무거나 하나
npx serve .
# 또는
python -m http.server 8000
```

그 다음 브라우저에서 `http://localhost:<port>` 접속.

## 테스트 실행

Node 내장 테스트 러너(`node:test`)만 사용한다. 추가 설치 없이 바로 실행 가능 (Node 18+).

```bash
npm test
# 또는
node --test tests/*.test.js
```

## 구조

```
index.html            캔버스 1개와 main.js 로딩
package.json           "type": "module" + npm test 스크립트 (빌드 도구 아님)
src/
  main.js              엔트리포인트: 초기화, 리사이즈, 입력 연결, requestAnimationFrame 루프
  style.css            풀스크린 캔버스, 터치 스크롤 방지
  core/                보드/규칙 로직. 브라우저 API 사용 금지, 순수 JS만. 전부 단위 테스트 있음.
    rng.js               시드 기반 의사난수(mulberry32). 같은 seed -> 같은 결과
    board.js             그리드 저장/생성(매치 없음 + 가능한 수 보장), 인접 스왑, reshuffle()
    match.js             가로/세로 3+ 매치 탐색, 교차하는 런을 L/T/+ 모양으로 그룹화
    moves.js             인접 스왑 시뮬레이션으로 "가능한 수 있음/없음" 판정
    gravity.js           낙하(압축) + 리필(위에서 새 잼 생성). 특수 잼 메타데이터도 같이 이동.
    specials.js          특수 잼 생성 규칙(매치 그룹 -> 종류 + 생성 칸)과 발동 규칙(종류 ->
                          영향 칸, BFS 연쇄 발동, 중복 방지). resolveSpecialCombo는 4단계용 자리.
    gameState.js         trySwap()이 스왑 -> 매치/특수 잼 생성·발동 -> 제거/낙하/리필 연쇄 ->
                          재배치까지 해소하고 swap/invalidSwap/clear/fall/spawn/shuffle/
                          specialCreate/specialActivate 이벤트 목록을 반환.
                          update(dt)는 전투 틱 등 다음 단계 로직 자리.
  render/              Canvas 그리기
    layout.js            CSS 픽셀 크기 -> 전투 패널/보드 영역 사각형 계산
    canvasRenderer.js    DPR 대응 리사이즈, 전투 패널/보드/잼/특수 잼 표시/이펙트/HUD 그리기
    animator.js          core 이벤트 목록을 큐에 담아 순서대로 재생하는 애니메이션 상태 기계.
                          board.grid/specials와 별개인 visualGrid/visualSpecials를 유지하다가
                          각 이벤트가 끝날 때 반영한다. 렌더러는 매 프레임 getDisplayList()
                          (칸별 잼)와 getEffects()(줄 빔/폭발/색 제거 이펙트)만 그리면 됨.
  input/
    pointerInput.js      Pointer Events로 마우스/터치 통합. 드래그 방향 판정 후 스왑 요청.
                          canInteract()가 false면(애니메이션 중) 입력을 무시해 잠금.
  config/
    board.js             보드 크기(rows/cols)
    gems.js              잼 종류(id/color/image). 배열에 추가만 하면 종류가 늘어남
    specialGems.js        특수 잼 종류별 이름/이미지(라인/폭탄/컬러). 이미지 없으면 임시 도형
    layout.js            화면 분할 비율(전투 1/3, 보드 2/3), 셀 패딩 비율
    scoring.js           칸당 점수
    animation.js         이벤트 타입별 애니메이션 길이(ms)
assets/
  gems/                  잼 이미지를 넣는 곳(없으면 색 원으로 대체됨). README 참고
  towers/                탑 스프라이트(대기/공격/투사체, manifest.json). 없으면 색 도형으로 대체됨. README 참고
tests/                 node:test 기반 단위 테스트
  rng.test.js            시드 결정성, 범위
  match.test.js          가로/세로/L/T/+ 매치 판정
  gravity.test.js        낙하 압축, 리필, 특수 잼 메타데이터 이동
  moves.test.js          가능한 수 있음/없음 판정
  board.test.js          시드 결정성, 초기 매치 없음, 가능한 수 보장, reshuffle
  gameState.test.js      되돌리기(invalidSwap), 매치 해소 후 보드에 매치 없음, 점수/연쇄 집계
  specials.test.js       모양별 생성 종류(4줄→라인, L/T/+/3x4 겹침→폭탄, 5줄→컬러, 5줄+겹침→
                          컬러 우선), 생성 칸(플레이어 스왑 칸 vs 가운데 칸), 라인/폭탄/컬러
                          발동 범위, 컬러 스왑 발동, 체인 밖 컬러 발동(최다색), 연쇄 발동, 중복
                          발동 방지
```

## 현재 단계에서 되는 것 / 안 되는 것

- 됨: 인접 스왑 → 매치 없으면 되돌리기 / 매치 있으면 제거 → 낙하 → 리필 → 재매치를
  매치가 없을 때까지 반복(연쇄, 횟수 집계). 연쇄 후 가능한 수가 하나도 없으면(컬러 잼이 남아
  있지 않은 한) 매치 없음 + 가능한 수 1개 이상 보장된 상태로 재배치. 시드 RNG로 같은 seed면
  같은 보드.
  특수 잼 3종: 가로/세로 4줄 → 라인(수직/수평 줄 삭제), L·T·+·3x4 등 가로+세로 겹침 → 폭탄
  (3x3 삭제, 생성 칸은 교차 칸), 5줄+ → 컬러(스왑한 일반 잼과 같은 색 전부 삭제, 체인으로
  터지면 가장 많은 색 삭제). 매치 그룹마다 하나만 생성하며 우선순위는 컬러 > 폭탄 > 라인.
  생성 칸은 플레이어가 움직인 칸(1단계 연쇄만) 또는 그룹 가운데 칸. 효과 범위 안의 다른 특수
  잼은 BFS로 연쇄 발동하며 한 번만 발동한다(무한 루프 방지).
  화면은 이 모든 단계를 이벤트 기반으로 순서대로 애니메이션하고(생성 펄스, 줄 빔, 폭발 링,
  색 제거 펄스 포함), 애니메이션 중에는 입력을 잠근다. 점수·연쇄 수를 화면 좌상단에 임시 표시.
- 안 됨(다음 단계): 특수 잼끼리 스왑하는 조합 효과(`specials.js`의 `resolveSpecialCombo`가
  자리만 잡고 항상 null을 반환 - 지금은 일반 스왑 흐름으로 처리됨), 연쇄 중 입력 허용, 전투
  로직. `GameState.update(dt)`에 자리를 잡아뒀다.
