# Gem Guardians 퍼즐 방해요소 에셋

압축을 풀어 저장소의 `assets/obstacles/`에 넣으면 됩니다. 경로는 `manifest.json` 기준 상대경로입니다.
규격은 잼과 같습니다: 48×48 투명 PNG, 몸통은 가운데 32×32, **화면에는 2배(96px)로 칸(64px) 중심에 맞춰** 그립니다. 늘리거나 줄이지 마세요. `ctx.imageSmoothingEnabled = false`.

## 파일
| 파일 | 쓰임 |
|---|---|
| `crate.png` | 나무상자 (occupant, HP 1) |
| `stone.png` / `stone_cracked.png` | 돌덩이 HP 2 / HP 1 (`manifest.obstacles.stone.hpImages`) |
| `time_bomb.png` | 시한폭탄 정지 이미지 (로딩 실패·아이콘용) |
| `sheets/time_bomb_idle.png` | 시한폭탄 **오버레이**, 심지 불꽃 4프레임. 잼을 먼저 그리고 그 위에 같은 위치·배율로 그림 |
| `sheets/time_bomb_warn.png` | 남은 횟수 ≤ 2일 때 (붉은 테두리 깜빡임) |
| `timer_digits.png` | 남은 횟수 숫자 0~9, 글리프 5×7. 1행 = 기본(뼈색), 2행 = 경고(붉은색) |
| `sheets/crate_break.png` | 나무상자 부서짐 6f |
| `sheets/stone_hit.png` | 돌이 한 번 맞음(HP 2→1) 조각 튐 5f. `stone_cracked.png` 위에 겹쳐 재생 |
| `sheets/stone_break.png` | 돌 부서짐 6f |
| `sheets/time_bomb_explode.png` | 시한폭탄 폭발 8f |
| `sheets/time_bomb_bolt.png` | 폭발 후 성벽으로 날아가는 붉은 빛 16×16, 4f 루프. **오른쪽을 보게** 그려져 있으니 목표 방향으로 회전, 회전 중심 `pivot` |
| `sheets/wall_hit.png` | 붉은 빛이 성벽에 닿을 때 32×32, 6f |
| `overview.png` | 미리보기 |

## 시한폭탄 숫자 그리기
폭탄 가운데 = 48 프레임 좌표 `digits.center` (34, 14). 두 자리면 글리프를 4px 간격으로 겹쳐 그립니다(외곽선 1px 공유).
```js
// cx, cy = 칸 중심, s = drawScale(2), n = 남은 횟수
const t = String(n), row = n <= warnAt ? 1 : 0;
const w = 5 + (t.length - 1) * 4;
const ox = cx - 24 * s + (center[0] - Math.floor(w / 2)) * s;
const oy = cy - 24 * s + (center[1] - 3) * s;
[...t].forEach((ch, i) => ctx.drawImage(digits, +ch * 5, row * 7, 5, 7, ox + i * 4 * s, oy, 5 * s, 7 * s));
```

## 순서 (권장)
타일 → 잼 → occupant(상자·돌) → 시한폭탄 오버레이 → 숫자 → 특수 잼 효과 → 부서짐/폭발 이펙트.
폭발 순서: `time_bomb_explode`(칸 위) → `time_bomb_bolt`가 칸에서 성벽으로 날아감(약 0.35초) → 닿으면 `wall_hit` + 성벽 피해 + 화면 흔들림(기존 설정).

## 애니메이션
| 키 | 프레임 | ms | 루프 |
|---|---|---|---|
| time_bomb_idle | 4 | 120 | O |
| time_bomb_warn | 4 | 90 | O |
| crate_break | 6 | 60 | X |
| stone_hit | 5 | 60 | X |
| stone_break | 6 | 60 | X |
| time_bomb_explode | 8 | 70 | X |
| time_bomb_bolt | 4 | 60 | O |
| wall_hit | 6 | 60 | X |

생성기: `art/obstacles/build_obstacles.py` (25색 팔레트 검사 포함), 미리보기 `art/obstacles/preview.py`.
