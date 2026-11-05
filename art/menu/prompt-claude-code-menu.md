# Claude Code 적용 프롬프트: 메인 메뉴 배경 (v2 경량 구조)

아래를 Claude Code에 그대로 붙여 넣으세요. 먼저 `gem-guardians-menu.zip`을 풀어서 `assets/menu/`를 프로젝트의 assets 폴더에 덮어쓰세요(예전 `menu_bg_anim.png`, `menu_bg_x3.png`는 지워도 됩니다).

---

메인 메뉴 배경을 "정지 베이스 + 작은 애니 조각 + 코드 입자" 방식으로 넣어줘(이미 전체 화면 시트 방식으로 되어 있으면 이 방식으로 바꿔줘). 에셋은 `assets/menu/`, 설명은 `assets/menu/README.md`와 `manifest.json`에 있어. 타이틀 화면에 만든 `drawLayeredBg(manifest.background, now)` 같은 공용 함수를 그대로 써(없으면 만들어서 둘 다 쓰게).

1. 화면 540x960(네이티브 180x320의 3배), 정수 배율 + 가운데 정렬, 남는 곳 #0d0a10, 스무딩 끔. manifest 좌표는 네이티브 px라 3배(`layoutA_screenPx`만 화면 px).
2. 매 프레임: `menu_base.png` 전체 → `manifest.background.pieces` 각 조각(`f = floor(now / frameMs) % loopFrames`, `k = seq[f % periodFrames]`, 시트에서 `sx = (k % cols) * w`, `sy = floor(k / cols) * h`를 `(x, y)`에) → `particles.sparks` 10개를 공식대로 1px(3x3 fillRect)씩 → 그 위에 UI.
3. 시트 로딩 전에는 `menu_bg.png` 한 장을 그려. 둘 다 없으면 #221c2b 단색.
4. UI는 시안 A(`layoutA_screenPx`)대로: 재화 바, 출석/이벤트, 설정/상점, 플레이 버튼. 가운데 centerpiece 자리의 점선 박스는 지워(배경의 봉인 원석이 그 자리). 팝업이 열려 있어도 배경 애니는 계속.
5. 타이틀 → 터치 → 메인 메뉴 → 플레이 → 일반 모드 → 지금의 게임. 경쟁 모드는 잠금.

끝나면 바꾼 파일과 확인 방법을 알려줘.
