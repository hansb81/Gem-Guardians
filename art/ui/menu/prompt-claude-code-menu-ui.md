# Claude Code 적용 프롬프트: 메인 메뉴 UI

먼저 `gem-guardians-menu-ui.zip`을 프로젝트의 `assets/` 폴더에서 풀어 주세요(`assets/ui/menu/`가 생겨요). 아래를 Claude Code에 붙여 넣으세요.

---

메인 메뉴의 임시 UI(시안 A 자리 박스)를 픽셀 아트 에셋으로 바꿔줘. 에셋은 `assets/ui/menu/`, 설명은 `assets/ui/menu/README.md`, 크기와 9-slice 값은 `assets/ui/menu/manifest.json`에 있어. 그리는 방식은 기존 UI 팩과 같아(1배 파일, 화면 2배, `imageSmoothingEnabled = false`, 9-slice는 `assets/ui/README.md`의 drawNine).

1. 배치는 manifest의 `layoutA_screenPx`(540x960 기준)를 그대로 써. 지금 위치와 같아.
2. 상단 재화 바: `plate`를 232x56으로 9-slice, 안에 `icons/gold`, `icons/diamond`(2배)와 숫자 칸 `inset`. 숫자는 Galmuri11 11px, 오른쪽 정렬, #e8dcc0.
3. 코너 버튼 4개: `btn_attendance`, `btn_event`, `btn_settings`, `btn_shop`(48x48). 누르는 동안 `_pressed`. 보상이 있으면 `badge`를 버튼 오른쪽 위(+36, −4 화면 px)에.
4. 플레이 버튼: `btn_play`를 360x64로 9-slice. 가운데에 `play_glyph` + "플레이"(Galmuri11 22px, #0d0a10). 누르는 동안 `btn_play_pressed`, 글자와 아이콘은 4px(화면) 아래로.
5. 팝업 공통: 뒤를 #0d0a10 75%로 덮고, `popup_menu`를 9-slice. 윗변 가운데에 문장(`emblem_settings` 또는 `emblem_mode`, 48x48)을 반쯤 걸쳐 그리고, 제목은 Galmuri11 22px #ffe14a. 오른쪽 위 `btn_close`(터치 영역 44x44). 바깥 탭으로도 닫힘.
6. 설정 팝업: 효과음/배경음 슬라이더 = `slider_track`(3-slice) + `slider_fill`(값만큼 가로로 늘림) + `slider_knob`(드래그 중 `_pressed`), 오른쪽에 숫자. 값은 localStorage에 저장하고 실제 음량에 연결할 자리만 만들어. 도움말/게임 정보는 `buttons/btn_secondary`.
7. 모드 선택 팝업: 일반 모드 = `mode_normal` + `icon_mode_normal`, 누르면 게임 시작. 경쟁 모드 = `mode_locked` + `icon_mode_competitive`(어둡게) + 오른쪽 `icons/lock.png`, 누르면 "잠김 - 해금 조건 추가 예정" 문구 표시.
8. 상점/출석/이벤트 팝업은 지금 자리 그대로 둬(나중에 만들 거야).

끝나면 바꾼 파일과 확인 방법을 알려줘.
