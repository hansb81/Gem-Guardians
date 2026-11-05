# 석상 소환 빛기둥 (summon)

인게임 첫 진입 / 다음 층 시작 때 석상 5개 자리에 빛기둥이 꽂히고 석상이 나타나는 연출.

## 파일
- `sheets/pillar_back_{color}.png`: 32x48 프레임 16개 가로 시트. 석상 **뒤**에 그림 (바닥 룬 고리 뒤쪽 절반, 기둥 바깥 빛).
- `sheets/pillar_front_{color}.png`: 32x48 x16. 석상 **앞**에 그림 (기둥 중심, 고리 앞쪽 절반, 불티). 테두리는 체커 디더라 석상이 비쳐 보임.
- `sheets/statue_summon_{color}.png`: 16x20 x16. 소환되는 석상 (0~5 안 보임, 6~7 네온 실루엣, 8~11 아래에서 위로 드러남, 12~15 원래 석상).
- `manifest.json`: 프레임 시간(`frameMs` 배열, 총 920ms), 오프셋, 순서, 시차.
- `preview.gif`(폐신전), `preview_lava.gif`, `frames_x4.png`: 미리보기.

## 그리기
- 정수 배율(기본 3배), `imageSmoothingEnabled = false`. 색 = 보석 팔레트 + 석상 네온 2색(석상과 같음).
- 위치(네이티브 px): 빛기둥 시트 = 석상 왼쪽 위에서 `(-8, -24)`. 석상 소환 시트 = 석상 위치 그대로.
- 순서: 배경 → 받침 → pillar_back → statue_summon → pillar_front → 적/투사체 → UI.
- 5개는 위에서부터 red, blue, yellow, green, purple 순으로 120ms씩 늦게 시작 (전체 약 1.4초).
- 프레임 4 = 기둥이 바닥에 닿는 순간 (효과음/약한 흔들림 타이밍). 끝나면 `statue_idle_{color}`로 바꿈.
- 빛기둥 윗부분은 전투 패널 밖으로 나가면 잘라서 그림(clip).
- 생성기: `art/summon/build_summon.py` (summon.py, preview.py).
