# 아이템 아이콘 (assets/items/)

| 파일 | 아이템 (config/items.json id) | 쓰는 곳 |
|---|---|---|
| `hammer.png` | 망치 | hotbar |
| `scythe_h.png` | 가로 낫 | hotbar |
| `scythe_v.png` | 세로 낫 | hotbar |
| `rainbow.png` | 무지개 결정 | hotbar |
| `glove.png` | 교환 장갑 | hotbar |
| `repair.png` | 수리 망치 | hotbar |
| `hourglass.png` | 모래시계 | hotbar |
| `dye.png` | 염료 | hotbar |
| `shuffle.png` | 섞기 부적 | hotbar |
| `barrier.png` | 결계 두루마리 | hotbar |
| `defuse.png` | 해제 부적 | hotbar |
| `drum.png` | 분노의 북 | hotbar |
| `booster_line.png` | 시작 부스터: 라인 잼 | preFloor |
| `booster_bomb.png` | 시작 부스터: 폭탄 잼 | preFloor |
| `gold_coin.png` | 황금 주화 | preFloor |
| `revive.png` | 부활 (불사조 깃털) | onFail |

- 쓰는 곳: hotbar = 하단 슬롯, preFloor = 층 시작 화면(부스터·황금 주화), onFail = 패배 팝업(부활).
- 크기 14x14 네이티브. `ui/items/slot_*.png`(22x22) 안쪽 (4,4)에 그대로 얹는다. 화면 2배(drawScale 2), `imageSmoothingEnabled = false`.
- 기존 팔레트만 사용(새 색 없음), 알파 0/255, 외곽선 #0d0a10.
- 쿨다운/소진 표시(어둡게)는 코드에서: 아이콘 위에 #0d0a10 체커 디더를 덮는다(반투명 알파 쓰지 않기).
- 남은 개수·쿨다운 숫자는 데미지 숫자 폰트(ui/font) 재사용.
