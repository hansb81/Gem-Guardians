# 메인 메뉴 배경 (menu) v2 — 경량 구조

봉인된 문 너머의 성소. v1의 전체 화면 64프레임 시트(`menu_bg_anim.png`)는 없앴다. 대신 **정지 베이스 한 장 + 움직이는 부분만 잘라낸 작은 시트 + 코드로 그리는 불씨**. 네이티브 180x320, 3배로 그린다, `imageSmoothingEnabled = false`.

- `menu_base.png` 180x320: 배경 전체 정지 그림.
- `menu_p00.png` ~ `menu_p02.png`: 움직이는 부분의 프레임 시트. 위치/프레임/순서는 `manifest.json`의 `background.pieces`. 200ms/프레임, 32프레임 = 6.4초 반복.
  - p00: 아치 위쪽 네온 문자 (39x13)
  - p01: 아치 좌우 문자 + 봉인 원석(둥실거림, 금빛 균열) + 빛기둥 + 촛불 + 제단 룬 (93x126) — 가운데 원석을 석상으로 바꾸면 이 조각만 새로 만든다.
  - p02: 바닥 5색 룬 돌 + 바닥의 따뜻한 빛 (101x24)
- `manifest.json` `background.particles`: 원석 균열에서 올라가는 불씨 10개(1px, 코드로). 석상으로 바꾸면 빼면 된다.
- `menu_bg.png`: 정지 전체 그림(v1 8번 프레임). 로딩 전/저사양 대체용.
- `preview.gif`: 이 구조로 합성한 결과. `preview_with_ui.png`: 시안 A UI 자리를 겹친 미리보기.
- `manifest.json` `layoutA_screenPx`: 시안 A UI 위치(화면 px).

그리기 순서는 타이틀과 같다: 베이스 → 각 piece의 현재 프레임(`f = floor(now/200) % 32`, `k = seq[f % periodFrames]`) → 입자 → UI.
합성 결과는 v1 시트와 픽셀 단위로 동일(검증 완료).

크기: v1 시트 336KB / GPU 텍스처 약 14.7MB → v2 전체 86KB / 약 2.3MB.
생성기: `art/menu/build_menu_layers.py` (장면 코드 `art/menu/menu_bg.py`, 분리 도구 `art/tools/split_anim.py`).
