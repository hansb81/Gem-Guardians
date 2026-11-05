# 타이틀 화면 (title)

디자인 E "잊혀진 지하 신단". 세로 화면, 네이티브 180x320을 3배(540x960)로 그린다. `imageSmoothingEnabled = false`.

## 파일
- `title_bg.png`: 배경 애니 시트. 프레임 180x320, 64프레임, 8열 x 8행, 100ms, 반복(6.4초, 끊김 없음). 동굴, 봉인된 문, 문 틈에서 새는 금빛, 빛줄기, 먼지, 네온 고대 문자, 촛불, 사슬, 물방울, 로고 뒤 어두운 판이 다 들어 있다.
- `logo.png`: GEM GUARDIANS 로고(빛 없음) 114x56. 위치 네이티브 (33, 21).
- `logo_shine.png`: 로고 위를 금빛 띠가 지나가는 12프레임(114x56, 100ms, 한 번 재생). 3200ms마다 재생하고, 재생 중이 아닐 땐 `logo.png`를 그린다.
- `manifest.json`: 크기, 프레임, 위치, 글자(부제, 터치 안내, 버전) 위치와 색.
- `preview.gif`, `preview.png`: 완성 화면 미리보기(글자는 임시 글꼴 Unifont).

## 그리기 순서
1. 배경 프레임 `i = floor(now / 100) % 64`, `sx = (i % 8) * 180`, `sy = floor(i / 8) * 320`
2. 로고: `t = now % 3200`, `t < 1200`이면 `logo_shine` 프레임 `floor(t / 100)`, 아니면 `logo.png`
3. 글자(코드에서 Galmuri11, 외곽선 #0d0a10 2px): 부제 "잊혀진 지하 신단" #f2d264 16px 가운데 (270, 266) + 양옆 짧은 선 #7a5212, 터치 안내 #f2d264 22px (270, 880) 500ms 깜빡임, 버전 v0.1 오른쪽 아래.
글자 좌표는 manifest `text`에 화면 px(이미 3배)로 들어 있다.

생성기: `art/title/build_title.py` (장면 코드 `art/title/title_v2.py`의 `scene_E`).
