# BGM

| key | 파일 | 길이 | 용도 |
|---|---|---|---|
| bgm_title | bgm_title.ogg (1.0MB) / .mp3 (1.3MB) | 82.286초 (3,628,800 프레임), 70BPM 24마디, D단조 | 타이틀 화면 |
| bgm_menu | bgm_menu.ogg (0.9MB) / .mp3 (1.2MB) | 72.000초 (3,175,200 프레임), 80BPM 24마디, F장조↔D단조 | 메인 메뉴 |
| bgm_battle | bgm_battle.ogg (0.9MB) / .mp3 (1.2MB) | 73.143초 (3,225,600 프레임), 105BPM 32마디, D단조 | 인게임 일반 층 |
| bgm_boss | bgm_boss.ogg (0.9MB) / .mp3 (1.1MB) | 68.571초 (3,024,000 프레임), 140BPM 40마디, D화성단조 (Eb 반음 위 화음) | 보스 층 (10층마다) |

- 둘 다 처음과 끝이 이어지는 루프예요. 잔향 꼬리가 이미 곡 앞부분에 들어 있어서 끝 → 처음으로 바로 넘어가면 됩니다. 페이드는 씬 전환 때만.
- `<audio loop>` 는 이음새에서 끊길 수 있어요. Web Audio `AudioBufferSourceNode` 로 `loop = true`, `loopStart = 0`, `loopEnd = manifest.loopEndSec` (mp3는 인코더 여백 때문에 디코딩 길이가 조금 길어서 loopEnd 지정 필수).
- 인게임: 일반 층 = bgm_battle, 보스 층 = bgm_boss. 일반 층끼리 넘어갈 땐 끊지 말고 이어서. 보스 층 진입/클리어 때만 크로스페이드.
- 타이틀 → 메뉴: 문 열림 전환(약 2초) 동안 bgm_title 페이드아웃 + bgm_menu 페이드인 크로스페이드.
- 피크 -3 dBFS (효과음보다 조금 뒤). 기본 bgm 볼륨 0.6.
- 전부 코드로 합성 (샘플 없음) → 상업 이용 문제 없음. 생성기: audio/bgm/tools/build_bgm_title.py, build_bgm_menu.py, build_bgm_battle.py (menu/battle 은 title 의 음색 함수를 가져다 씀).
