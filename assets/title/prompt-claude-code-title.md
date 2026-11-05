# Claude Code 적용 프롬프트: 타이틀 화면 (v2 경량 구조)

아래를 Claude Code에 그대로 붙여 넣으세요. 먼저 `gem-guardians-title.zip`을 풀어서 `assets/title/`을 프로젝트의 assets 폴더에 덮어쓰세요(예전 `title_bg.png`는 지워도 됩니다).

---

타이틀 화면 배경을 전체 화면 프레임 시트 방식에서 "정지 베이스 + 작은 애니 조각 + 코드 입자" 방식으로 바꿔줘(처음 만든다면 이 방식으로 만들어줘). 에셋은 `assets/title/`, 규칙은 `assets/title/manifest.json`과 `README.md`에 있어.

1. 화면은 세로 540x960(네이티브 180x320의 3배). 실제 캔버스가 다르면 정수 배율 중 가장 큰 걸 쓰고 가운데 정렬, 남는 곳은 #0d0a10. `imageSmoothingEnabled = false`. manifest의 좌표는 전부 네이티브 px라서 3배 해서 그려(단, `text` 블록만 화면 px).
2. 매 프레임 그리기 순서:
   - `title_base.png`를 (0,0)에 전체.
   - `manifest.background.pieces`의 각 조각: `f = floor(now / frameMs) % loopFrames`, `k = seq[f % periodFrames]`, 시트 `file`에서 `sx = (k % cols) * w`, `sy = floor(k / cols) * h` 크기 `w x h`를 `(x, y)`에 drawImage.
   - `manifest.background.particles`: `dust_motes`(14개)와 `water_drops`(6개)를 공식대로 계산해서 1픽셀(화면에선 3x3 fillRect)씩 그려. 공식 안의 `t`는 ms, `%`는 양수 나머지.
   - 로고: 네이티브 (33, 21). `t = now % 3200`이 1200 미만이면 `logo_shine.png`의 `floor(t / 100)`번째 프레임(114x56), 아니면 `logo.png`.
   - 글자(Galmuri11, 외곽선 #0d0a10 2px): manifest `text` 대로 부제 "잊혀진 지하 신단" 16px #f2d264 + 양옆 짧은 선, "화면을 터치하세요" 22px 500ms 깜빡임, 오른쪽 아래 v0.1.
3. 조각 그리기는 범용으로 만들어줘(`drawLayeredBg(manifest.background, now)` 같은 함수). 메인 메뉴 배경도 같은 manifest 구조를 쓸 거야.
4. 이미지 로딩 전이나 실패 시엔 #0d0a10 배경에 글자만 그려서 멈추지 않게. 화면 아무 곳이나 터치/클릭, Enter/Space로 다음 화면(메인 메뉴)으로.

끝나면 바꾼 파일과 확인 방법을 알려줘.
