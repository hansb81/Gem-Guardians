# 영웅 이미지

경로는 `assets/manifest.json`의 `heroes` 맵(키 = `src/config/heroes.json`의 `id`)에서 읽는다.
같은 파일명으로 교체하면(PNG든 SVG든, 투명 배경 권장) 바로 반영된다. 파일이 없거나 로드에
실패하면 렌더러가 `hero.color`(연결된 잼 색)로 원을 그려 대체한다.

새 영웅을 추가하려면: `src/config/heroes.json`에 항목 추가 + `assets/manifest.json`의
`heroes`에 같은 id로 경로 한 줄 추가만 하면 된다(코드 수정 불필요).

현재 들어있는 파일(임시 SVG, 연결된 잼과 같은 그라데이션 팔레트 + 그 잼 모양을 문장으로
단 방패형 수호자):

- hero_red.svg (빨강 잼/육각형)
- hero_blue.svg (파랑 잼/다이아몬드)
- hero_yellow: `assets/manifest.json`에서 `assets/characters/elf/elf.png`를 가리키도록 교체됨(임시 SVG 아님)
- hero_green.svg (초록 잼/오각형)
- hero_purple.svg (보라 잼/별모양)
