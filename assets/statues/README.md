# 보석 석상 (statues)

5색 보석 탑을 대신하는 석상 스프라이트. 머리만 있는 석상, 완전한 옆모습, **왼쪽을 봄**.
적이 오른쪽에서 오면 코드에서 좌우 반전(`ctx.scale(-1,1)`)해서 그린다.

| 색 | 석상 | 네온 |
|---|---|---|
| red | 루비 모아이 | #ff2b4e / #ffb3c0 |
| blue | 사파이어 포세이돈 | #3ff0ff / #c8fbff |
| yellow | 토파즈 파라오 | #ffe14a / #fff3b8 |
| green | 에메랄드 나무정령 | #b8ff3c / #eaffb0 |
| purple | 자수정 메두사 | #d94dff / #f2c4ff |

- 크기: 16x20 투명 PNG, 바닥 기준(bottom-center) 정렬, 외곽선 #0d0a10.
- 표시: 정수 배율(기본 3배), `imageSmoothingEnabled = false`.
- 애니메이션: `sheets/statue_idle_{color}.png` 가로 4프레임, 150ms, 반복. 석상은 움직이지 않고 네온 룬/눈만 맥동한다.
- 공격 프레임 없음 (발사는 기존 투사체 사용).
- 색: 보석 팔레트(characters.hex) + 색마다 네온 2색 추가.
- 원본 생성 스크립트: art/statues/build_statues.py (각 석상 .py 포함).
