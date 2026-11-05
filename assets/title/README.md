# 타이틀 화면 (title) v2 — 경량 구조

디자인 E "잊혀진 지하 신단". 세로 화면, 네이티브 180x320을 3배(540x960)로 그린다. `imageSmoothingEnabled = false`.
v1의 전체 화면 64프레임 시트(`title_bg.png`, 1440x2560)는 없앴다. 대신 **정지 베이스 한 장 + 움직이는 부분만 잘라낸 작은 시트 + 코드로 그리는 입자**.

## 파일
- `title_base.png` 180x320: 배경 전체 정지 그림(동굴, 문, 문자, 촛불, 사슬, 로고 뒤 어두운 판 포함).
- `title_p00.png` ~ `title_p03.png`: 움직이는 부분의 프레임 시트. 각 조각의 위치(x, y, w, h), 프레임 수, 열 수, 재생 순서(`seq`)는 `manifest.json`의 `background.pieces`에 있다. 200ms/프레임, 32프레임 = 6.4초 끊김 없는 반복.
  - p00: 문 + 문틈 빛 + 빛줄기 + 제단 룬 깜빡임 (83x147)
  - p01, p02: 좌우 벽의 네온 고대 문자 숨쉬기 (12x77, 11x73)
  - p03: 촛불 불꽃 하나 (2x3)
- `manifest.json` `background.particles`: 먼지(14개)와 물방울(6개)은 1픽셀짜리라 코드로 그린다. 공식과 상수가 그대로 들어 있다(네이티브 px 기준).
- `logo.png` 114x56 네이티브 (33, 21), `logo_shine.png` 12프레임(100ms, 3200ms마다 한 번) — v1과 같다.
- 미리보기는 `art/title/`: `preview.gif`(이 구조로 합성한 결과), `preview.png`(정지), `door_transition_preview.gif`(문 열림 전환).

## 그리기 순서 (매 프레임, `now` = ms)
1. `title_base.png`를 (0,0)에.
2. 각 piece: `f = floor(now / 200) % 32`, `k = seq[f % periodFrames]`, 시트에서 `sx = (k % cols) * w`, `sy = floor(k / cols) * h` 영역을 `(x, y)`에.
3. 입자: manifest의 `particles` 공식대로 1px씩(`fillRect(x*3, y*3, 3, 3)`).
4. 로고(+shine), 글자(manifest `text`, 화면 px) — v1과 동일.
- 모든 좌표는 네이티브 px이므로 3배. 합성 결과는 v1 시트와 픽셀 단위로 같다(물방울이 밝은 돌 위를 지날 때 1px 차이뿐).

크기: v1 시트 363KB / GPU 텍스처 약 14.7MB → v2 전체 111KB / 약 2.2MB.
생성기: `art/title/build_title_layers.py` (장면 코드 `art/title/title_v2.py` `scene_E`, 분리 도구 `art/tools/split_anim.py`).
