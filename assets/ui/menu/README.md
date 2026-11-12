# 메인 메뉴 UI (ui/menu)

시안 A 배치용. 규칙은 인게임 UI 팩과 같음: 팔레트 25색, 외곽선 #0d0a10, 안티에일리어싱 없음, **파일은 1배, 화면에는 2배**, 글자는 코드(Galmuri11)로. 9-slice는 `../README.md`의 `drawNine` 그대로 사용.

| 파일 | 크기 | 쓰는 곳 |
|---|---|---|
| `plate` 9-slice [8,8,8,8] | 24×24 | 상단 재화 바 바탕 (시안 A: 116×28 원본 = 232×56 화면) |
| `inset` 9-slice [4,4,4,4] | 12×12 | 재화 숫자 칸 |
| (`../icons/gold`, `../icons/diamond`) | 16×16 | 재화 아이콘 (기존 것 재사용) |
| `btn_attendance` `btn_event` `btn_settings` `btn_shop` (+`_pressed`) | 24×24 | 코너 아이콘 버튼 (화면 48×48). 출석=달력, 이벤트=보라 별, 설정=톱니, 상점=금화 주머니 |
| `badge` | 8×8 | 받을 보상 표시. 버튼 왼쪽 위 기준 (+18, −2) 원본 px |
| `btn_play` (+`_pressed`) 9-slice [14,8,14,10] | 40×32 | 플레이 버튼. 시안 A 180×32 원본 (360×64 화면). 눌림은 글자/아이콘 2px(원본) 아래로 |
| `play_glyph` | 10×12 | ▶ 표시, "플레이" 글자 왼쪽 (글자색 #0d0a10) |
| `popup_menu` 9-slice [16,16,16,16] | 48×48 | 설정/모드 선택 팝업 틀 |
| `emblem_settings`, `emblem_mode` | 24×24 | 팝업 윗변 가운데에 반쯤 걸쳐서 |
| `emblem_coupon` | 24×24 | 쿠폰 팝업 문장 (윗변 가운데, 다른 문장과 같은 자리) |
| `icon_coupon` | 16×16 | 설정 쿠폰 버튼 아이콘 (화면 32×32, 버튼 왼쪽에서 8, 위에서 2) |
| `btn_close` (+`_pressed`) | 16×16 | 팝업 오른쪽 위 닫기 (화면 32×32, 터치 영역은 44×44로 넓게) |
| `slider_track` 3-slice [4,0,4,0] | 16×8 | 음량 슬라이더 홈. 채움은 (2,2) 높이 4, 오른쪽 여백 2 |
| `slider_fill` | 4×4 | 채움 (가로로 늘림) |
| `slider_knob` (+`_pressed`) | 10×14 | 손잡이. 채움 끝에 가운데 맞춤 |
| `mode_normal` (+`_pressed`), `mode_locked` 9-slice [8,8,8,8] | 24×24 | 모드 버튼 (시안 A 160×34 원본 정도) |
| `icon_mode_normal` (봉인된 문), `icon_mode_competitive` (교차 검) | 20×20 | 모드 버튼 왼쪽 아이콘. 잠김이면 오른쪽에 `../icons/lock.png` |

도움말/게임 정보 버튼은 기존 `../buttons/btn_secondary` 사용.
미리보기(`art/ui/menu/`): `preview_menu_ui.png` (메뉴 / 설정 팝업 / 모드 선택 팝업), 각 화면 `preview_menu.png`, `preview_settings.png`, `preview_mode.png`, 부품 `overview.png`.
생성기: `art/ui/build_menu_ui.py`.
