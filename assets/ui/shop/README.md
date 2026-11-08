# 상점 아이콘 (assets/ui/shop)

시안 2(왼쪽 레일 + 1열 카드)용. 경로·크기는 `manifest.json`.

- 규격: 네이티브 크기 그대로, 기존 팔레트(gems/palette.hex 25색 + characters.hex 피부 2색)만, 알파 0/255, 외곽선 #0d0a10. 화면에는 2배, `imageSmoothingEnabled = false`.
- `skill_*` 14x14: 색 효과 5(red 범위, blue 감속, purple 독, yellow 경직, green 표식) + 특수 잼 기술 4(spike 가시, lava 용암탄, soul 영혼 불꽃, ult 궁극기). 특수 기술은 몸통이 무채색이고, 슬롯 아래 테두리에 5색 점(4x4 화면 px)을 코드로 찍어 "색에 따라 효과가 바뀜"을 보여준다.
- `totem_unknown` 14x14: 토템 준비 중 실루엣.
- `pack_*` 14x14: starter, boss, slot4, weekly, monthly, chapter, adfree.
- `rail_*` 12x12: items, skills, totem, packs, dia. 레일 버튼(card / card_selected 9-slice) 안 위쪽 가운데, 아래에 글자.
- `banner_*` 60x60: 추천 탭 맨 위 배너. starter(열린 상자 + 아이템), boss(뿔 해골 + 사슬 + 아이템). 기존 아이템 아이콘을 그대로 붙여 만들었다.
- 재화 아이콘, 자물쇠, 배지, 버튼, 카드 틀은 기존 `ui/` 팩을 그대로 쓴다(새 그림 없음).
