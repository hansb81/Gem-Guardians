# 메인 메뉴 배경 (menu)

봉인된 문 너머의 성소. 애니메이션 시트 + 정지 이미지.

- `menu_bg_anim.png`: 애니 시트. 프레임 180x320, 64프레임, 8열 x 8행, 100ms, 반복(6.4초, 끊김 없음). 원석 둥실거림/금빛 균열/불씨, 아치의 네온 고대 문자, 촛불, 제단 금빛 룬, 바닥 5색 룬 돌.
  프레임 `i = floor(now / 100) % 64`, `sx = (i % 8) * 180`, `sy = floor(i / 8) * 320`.
- `preview.gif`: 움직이는 미리보기.
- `menu_bg.png`: 정지 버전(애니 8번 프레임), 네이티브 180x320. 로딩 전/저사양용. 3배(540x960)로 그린다, `imageSmoothingEnabled = false`.
- `menu_bg_x3.png`: 이미 3배로 키운 540x960 (DOM/CSS 배경으로 쓸 때 편함, `image-rendering: pixelated`).
- `preview_with_ui.png`: 시안 A UI 자리를 겹친 미리보기.
- `manifest.json`: 크기와 시안 A UI 위치(화면 px). 배경의 기둥/제단/원석은 이 UI 자리를 피해서 배치돼 있다.

생성기: `art/menu/build_menu.py` (장면 코드 `art/menu/menu_bg.py`).
