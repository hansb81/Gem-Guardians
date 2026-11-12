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

## 수호자 교체(확인용, 2026-11-11)

- 전투 화면의 석상 5개는 지금 `sheets/guardian_idle_{color}.png`(4프레임, 160ms)와 `sheets/guardian_attack_{color}.png`(7프레임, 80ms, fireFrame 3)를 쓴다. 20x26, `drawScale` 1.5.
- 원본은 `art/guardians/mockup/build_mockup.py`. `--export-statues`로 시트와 manifest 항목을 다시 내보낸다(왼쪽을 보게 뒤집어 저장).
- 기존 석상 파일(`{color}.png`, `sheets/statue_idle_{color}.png`)은 지우지 않았다. 도움말 그림은 아직 기존 석상을 쓴다. 랭킹·닉네임 화면은 수호자 idle 첫 프레임을 1.5배로 그린다. 소환 연출은 빛기둥 속에 수호자 idle 첫 프레임을 그린다(석상 소환 시트는 안 씀).
