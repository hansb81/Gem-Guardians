# Gem Guardians 탑 에셋 (첫 목업 디자인 · 받침 위에 떠 있는 잼 수정)

> 2026-11-12: 탑 그림(`{색}.png`, `sheets/tower_idle·attack_*`)은 `assets/statues`(수호자)로 바뀌어 지웠다. 지금 이 폴더에서 게임이 쓰는 것은 투사체 `sheets/projectile_{색}.png`뿐이다. 아래 규격·쓰는 법은 옛 탑 기준 기록이다.

압축을 풀어 저장소의 `assets/towers/`에 넣으면 됩니다. 경로는 `manifest.json` 기준 상대경로입니다.

## 규격
- 프레임 16×20 px, 투명 PNG, 외곽선 #0d0a10, 팔레트는 잼 25색(`../gems/palette.hex`).
- 위쪽은 보드 잼과 같은 모양의 수정, 아래는 철 받침(발톱 + 그 색으로 빛나는 룬).
- **발 기준(bottom-center)**: 탑의 맨 아래 줄이 바닥. 모든 프레임에서 위치가 같습니다.
- 화면에는 **3배**(48×60 px)로 그립니다(캐릭터와 같은 배율). `ctx.imageSmoothingEnabled = false` 필수.
- 좌우 대칭이라 반전할 필요 없습니다.

## 파일
| 파일 | 내용 |
|---|---|
| `sheets/projectile_{색}.png` | 투사체 8×8, 4프레임, 60ms, 루프, 중심 기준 |

## 쓰는 법
- 평소엔 idle 루프, 쏠 때 attack을 한 번 재생하고 끝나면 idle로 돌아갑니다.
- 투사체 출발점은 잼 가운데: 원본 좌표 (8, 5) → 화면 좌표 = 탑 왼쪽 위 + 좌표 × 3.
- 탑 5개 배치: 왼쪽 2열 지그재그, 안 겹치게(왼쪽 열 = 1·3·5번째, 오른쪽 열 = 2·4번째). 위에서부터 빨강, 파랑, 노랑, 녹색, 보라.

```js
// 발 기준으로 그리기: fx = 탑 가운데 x, fy = 바닥 y
const w = a.frameW * 3, h = a.frameH * 3;
ctx.drawImage(img, frame * a.frameW, 0, a.frameW, a.frameH, fx - w / 2, fy - h, w, h);
```

미리보기(`art/towers/`): `preview.png`(줄마다 대기 4 + 발사 6), `preview.gif`.
