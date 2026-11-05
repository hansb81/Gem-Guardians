# Gem Guardians 퍼즐 효과음 (v1)

- 29개, 44.1kHz 모노. `ogg/`(기본) + `mp3/`(ogg 못 여는 기기용). 원본 wav는 저장소에 넣지 않아도 됨.
- 모두 코드로 합성 (tools/build_sfx.py). 외부 소스 없음, 상업적 이용 자유.
- 음량은 미리 맞춰 둠. manifest.json `volume`은 기본 배율(1.0).
- `gem_pop`은 연쇄 단계별 8개 (`gem_pop_1`~`gem_pop_8`, 단조 5음계로 점점 높아짐). 9단계 이상은 8 재사용.
- `maxInstances`: 같은 소리가 동시에 울릴 수 있는 최대 수. 넘으면 가장 오래된 것을 끊거나 새 것을 무시.
- `minGapMs`: 같은 소리를 이 간격 안에 다시 재생하지 않음 (한 프레임에 보석 20개가 터져도 소리가 뭉개지지 않게).

## 이벤트 연결
| 키 | 언제 |
|---|---|
| gem_select | 보석을 처음 탭/드래그 시작 |
| gem_swap | 스왑 시작 (유효/무효 모두) |
| gem_swap_fail | 매치가 없어 되돌아갈 때 |
| gem_pop | 일반 매치 제거. 연쇄(cascade) 단계 n에 gem_pop_n (8 이상은 8) |
| gem_land | 낙하한 보석이 자리에 멈출 때 (열마다 1번, 같은 프레임엔 1번만) |
| special_create | 특수 보석(line/bomb/box/color) 생성 순간 |
| line_fire | line 보석 발동 (가로/세로 공통) |
| bomb_explode | bomb 보석 발동 |
| box_open | box 보석 발동 시작 |
| box_zap | box 번개가 대상 보석에 맞을 때마다 |
| color_charge | color 보석 발동 시작 (소용돌이 수축) |
| color_burst | color 보석 폭발 (color_origin 터지는 프레임, charge 끝나고 바로) |
| color_hit | color_wisp 가 대상 보석에 도착할 때마다 |
| combo_great | 한 번의 이동에서 연쇄 5단계 이상 도달 시 1번 |
| shuffle | 움직일 수 있는 수가 없어 보드를 섞을 때 |
| hint | 힌트 표시 시작 |
| crate_break | 나무 상자 장애물 파괴 |
| stone_hit | 돌 장애물 HP 감소 (파괴 아님) |
| stone_break | 돌 장애물 파괴 |
| timebomb_tick | 시한폭탄 남은 수 감소 (매 이동) |
| timebomb_warn | 시한폭탄 남은 수 1 |
| timebomb_explode | 시한폭탄 0 -> 성벽 피해 |

## 타이밍 (이펙트 manifest와 맞춤)
- line: `line_fire`는 발동 순간, 각 칸 pop 소리는 그 칸 pop 이펙트와 같은 지연(stepMs × 거리)에 `gem_pop_n`.
- bomb: `bomb_explode`는 발동 순간, 주변 칸 pop은 effects manifest `bomb.hitMs` 뒤.
- box: `box_open`은 발동 순간, 번개가 꽂히는 순간마다 `box_zap`.
- color: `color_charge` 시작 -> color_origin이 터지는 프레임에 `color_burst` -> wisp가 도착할 때마다 `color_hit`.
- 특수 보석끼리 조합은 아직 전용 소리가 없음. 두 소리를 같이 재생.
