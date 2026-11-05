# Gem Guardians 인게임 UI 에셋

압축을 풀어 저장소의 `assets/ui/`에 넣으면 됩니다. 경로와 크기, 9-slice 값은 전부 `manifest.json`에 있습니다.

## 규격
- 잼 25색 팔레트(`../gems/palette.hex`)만 사용, 외곽선 #0d0a10, 안티앨리어싱 없음, 투명 PNG(알파 0/255), 광원 좌상단.
- 파일은 1배. **화면에는 2배로** 그립니다(보드 잼과 같은 배율). `ctx.imageSmoothingEnabled = false` 필수.
- 글자(골드 수, 층수, HP 숫자, 팝업 제목, 버튼 글자)는 이미지에 없습니다. 코드로 그립니다.

## 파일
| 폴더 | 파일 | 쓰는 곳 |
|---|---|---|
| `icons/` | `gold` `diamond` (16×16) | 최상단 재화 |
| | `wall` (16×16) | 성벽 HP 게이지 왼쪽 |
| | `lock` (12×12) | 잠긴 슬롯 |
| `buttons/` | `btn_plus`, `btn_pause` (+`_pressed`) 16×16 | 우측 상단 + 메뉴, 일시정지 |
| | `btn_primary` `btn_secondary` `btn_danger` `btn_gold` (+`_pressed`) | 팝업 버튼, **9-slice** [4,4,4,5]. 눌림 상태는 글자를 1px(화면 2px) 아래로 |
| `panels/` | `panel_iron` 9-slice [8,8,8,8] | 재화 바, 전투 패널, 하단 아이템 바 배경 |
| | `panel_inset` 9-slice [4,4,4,4] | 골드/다이아/점수 숫자 칸 |
| | `box_floor` 9-slice [5,5,5,5] | 층수 표시 박스 |
| | `board_frame` 9-slice [8,8,8,8], 가운데 투명 | 퍼즐 보드 테두리 (보드 바깥으로 5px 크게) |
| `gauges/` | `hp_frame` 가로 3-slice [6,_,6,_], 높이 12 | 성벽 HP 틀 |
| | `fill_red` (+green/yellow/blue/purple), `fill_lag` 높이 6 | 채움. 가로로 늘려 그림. `fill_lag`는 깎인 HP 잔상 |
| | `combo_frame` 3-slice [5,_,5,_], 높이 8 | 콤보 틀 |
| | `combo_fill` (정지), `combo_fill_anim` (4×2 타일 × 4프레임, 90ms 루프) | 콤보 채움 |
| `popups/` | `popup_pause` `popup_win` `popup_lose` 48×48, 9-slice [16,16,16,16] | 팝업 틀 |
| | `emblem_pause` 모래시계, `emblem_win` 왕관, `emblem_lose` 해골 (24×24) | 팝업 윗변 가운데에 반쯤 걸쳐서 |
| `board/` | `tile_a`, `tile_b` 32×32 | 보드 칸 배경, `(행+열)%2`로 체크무늬 |
| `items/` | `slot_normal` `slot_selected` `slot_locked` 22×22 | 하단 아이템 칸(고정 크기). 아이템 아이콘은 안쪽 (4,4) 14×14 |

채움 위치: `manifest.json`의 `fill` = 틀 왼쪽 위 기준 `x, y`, 높이 `h`, 오른쪽 여백 `padRight` (원본 px).
버튼 글자색: `textColor` (골드 버튼만 어두운 글자).

## 9-slice 그리기
가장자리는 길이 방향으로 무늬가 같아서, 늘려도 정수 배율이면 픽셀이 깨지지 않습니다. 목표 크기는 **원본 px 기준 정수**로 정하고 마지막에 2배 합니다.

```js
// s = manifest slice [l, t, r, b], (x, y, w, h) = 화면 좌표, k = 배율(2)
function drawNine(ctx, img, s, x, y, w, h, k = 2) {
  const [l, t, r, b] = s, sw = img.width, sh = img.height;
  const sx = [0, l, sw - r, sw], dx = [0, l * k, w - r * k, w];
  const sy = [0, t, sh - b, sh], dy = [0, t * k, h - b * k, h];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const cw = sx[i + 1] - sx[i], ch = sy[j + 1] - sy[j];
    const dw = dx[i + 1] - dx[i], dh = dy[j + 1] - dy[j];
    if (cw > 0 && ch > 0 && dw > 0 && dh > 0)
      ctx.drawImage(img, sx[i], sy[j], cw, ch, x + dx[i], y + dy[j], dw, dh);
  }
}
// 게이지: drawNine(hp_frame, [6,0,6,0]) 후, 채움을 (x+4k, y+3k)에 폭 (w - 8k) * ratio, 높이 6k로 늘려 그림
```

## 미리보기
`art/ui/preview_screens.png` (HUD / 일시정지 / 승리 / 패배, 432×768 화면), `overview.png` (에셋 6배).

## 데미지 숫자 폰트 (`font/`)
- 글자: `0123456789+-x!,/` (순서는 `font.json`의 `chars`). 굵은 5×7 글자 + 외곽선 1px = 칸 8×9, 시트는 가로 1줄.
- 색: `damage_white`(기본), `damage_crit`(치명타, 밝은 금 + 붉은 아랫줄), `damage_red/blue/yellow/green/purple`(쏜 탑 색). 회복은 green에 `+`, 성벽 피해는 red에 `-`, 콤보는 crit에 `x`.
- 크기: 평소 2배, 치명타 3배. 글자 폭은 `widths`(외곽선 포함), 다음 글자는 `폭 - 1`만큼 옆으로(외곽선 1px 겹침).

```js
function drawDamage(ctx, img, font, text, cx, y, k = 2) {   // cx = 가운데 x
  let w = 1; for (const c of text) w += font.widths[c] - 1;
  let x = Math.round(cx - (w * k) / 2);
  for (const c of text) {
    const i = font.chars.indexOf(c), gw = font.widths[c];
    ctx.drawImage(img, i * font.cellW, 0, gw, font.cellH, x, y, gw * k, font.cellH * k);
    x += (gw - 1) * k;
  }
}
```
추천 움직임: 생길 때 0.1초 동안 1px 튀어 오르고, 0.6초 동안 위로 떠오르다 마지막 0.2초에 사라짐(알파는 globalAlpha로).

## 타워 강화 팝업 (`upgrade/`)
| 파일 | 쓰는 곳 |
|---|---|
| `tab_on`, `tab_off` 9-slice [6,6,6,3] | 탭. 켜진 탭은 본문 윗변을 3px(원본) 덮게 그려서 본문과 이어지게 |
| `tab_body` 9-slice [4,4,4,4] | 탭 본문 바탕 |
| `card`, `card_selected` 9-slice [4,4,4,4] | 타워 한 줄 / 장착 칸 열. selected = 터치해서 연 타워 |
| `btn_disabled` 9-slice [4,4,4,5] | 골드 부족 시 강화/MAX 버튼 (가격은 빨강 글자) |
| `btn_close` (+`_pressed`) 16×16 | 팝업 닫기 |
| `coin_small` 8×8 | 버튼 안 가격 옆 |
| `emblem_upgrade` 24×24 | 팝업 윗변 문장 (모루 + 화살표) |

틀은 `popups/popup_win`(금테), 강화 버튼은 `buttons/btn_gold`, MAX는 `buttons/btn_primary`, 레벨 배지는 `panels/box_floor`, 장착/보유 칸은 `items/slot_*`를 그대로 씁니다. 배치는 `art/ui/upgrade/preview_upgrade.png` 참고.

## 몬스터 HP 게이지 (`enemy/`)
| 파일 | 쓰는 곳 |
|---|---|
| `bar_normal` 가로 3-slice [1,_,1,_], 높이 4 | 일반 적 머리 위. 채움 x1 y1 h2, 오른쪽 여백 1 |
| `bar_elite` 3-slice [2,_,2,_], 높이 6 (금선) | 엘리트 적. 채움 x2 y2 h2, 오른쪽 여백 2 |
| `bar_boss` 3-slice [14,_,4,_], 높이 12 (왼쪽 해골) | 보스. 채움은 `gauges/fill_red`/`fill_lag`(h6) 를 x14 y3, 오른쪽 여백 3. 이름은 바 위에 코드로 |
| `fill_red`, `fill_lag`, `fill_blue` 높이 2 | 적 HP 채움 / 깎인 잔상 / 예비(보호막) |

- UI처럼 **2배**로 그립니다. 적도 2배라서 바 원본 폭 = 적 원본 폭 그대로. 16px 적 → 폭 16, 24px 엘리트 → 24, 32px 보스는 화면 위쪽에 넓게.
- 위치: 바 아래쪽이 적 머리(스프라이트 맨 위)보다 화면 2px 위. 가운데 정렬.
- 잔상: 맞으면 `fill_red`는 즉시 줄이고, `fill_lag`는 0.3초 뒤 0.25초 동안 따라 줄어듦.
- 체력이 가득 찬 적은 바를 숨기고 처음 맞을 때부터 보여 주면 화면이 덜 복잡합니다(보스는 항상 표시).
