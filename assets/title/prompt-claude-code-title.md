# Claude Code 적용 프롬프트: 타이틀 화면

아래를 Claude Code에 그대로 붙여 넣으세요. 먼저 `gem-guardians-title.zip`을 풀어서 `assets/title/`을 프로젝트의 assets 폴더에 넣어 두세요.

---

게임을 켜면 먼저 나오는 타이틀 화면을 만들어줘. 에셋은 `assets/title/`에 있고, 규칙은 `assets/title/manifest.json`과 `README.md`에 있어.

1. 화면 상태(scene)에 `title`을 추가하고 시작 상태로 해줘. 화면 아무 곳이나 클릭/터치하거나 Enter/Space를 누르면 지금의 게임 화면으로 넘어가게 해줘(메인 메뉴는 나중에 따로 만들 거라 지금은 바로 게임으로).
2. 화면은 세로 540x960(네이티브 180x320의 3배) 기준이야. 실제 캔버스 크기가 다르면 정수 배율 중 가장 큰 걸 쓰고 가운데 정렬, 남는 곳은 #0d0a10. `imageSmoothingEnabled = false`.
3. 배경: `title_bg.png`는 180x320 프레임 64개가 8열로 들어 있는 시트야. 프레임 `i = floor(now / 100) % 64`, `sx = (i % 8) * 180`, `sy = floor(i / 8) * 320`.
4. 로고: 네이티브 (33, 21)에 그려. `t = now % 3200`이 1200 미만이면 `logo_shine.png`의 `floor(t / 100)`번째 프레임(114x56), 아니면 `logo.png`.
5. 글자는 코드에서 Galmuri11로 그려(locales의 `title.subtitle`, `title.tap` 키 추가). 위치/크기/색은 manifest `text`(화면 px 기준)를 따라: 부제 "잊혀진 지하 신단" 16px 금색 + 양옆 짧은 선, "화면을 터치하세요" 22px 500ms 깜빡임, 오른쪽 아래 v0.1. 외곽선 #0d0a10 2px. 글꼴이 아직 로드 안 됐으면 글자만 로드 후에 그려.
6. 이미지 로딩 전이나 실패 시엔 #0d0a10 배경에 글자만 그려서 멈추지 않게 해줘.
7. 화면 전환은 0.3초 정도 검은색으로 페이드아웃 후 게임 시작.

끝나면 바꾼 파일과 확인 방법을 알려줘.
