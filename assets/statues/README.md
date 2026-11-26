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

## 레벨 등급 모습 (2026-11-19)
- 등급 = 1 + `config/balance.json` `towerLookTiers`([20, 35, 50]) 중 레벨 이하인 값의 개수(Lv1~19 = 1, 20~34 = 2, 35~49 = 3, 50+ = 4). 이펙트용 `towerFxTiers`와 별개.
- 시트 = 기본 시트 이름 + `_g{등급}`(예: `guardian_idle_red_g2.png`). manifest `look`에 적힌 등급만 로드한다(지금 5색 모두 [2, 3, 4]). 없는 등급은 낮은 등급, 끝내 없으면 기본 시트.
- 등급 idle은 12프레임(시트 너비 / 20), attack은 기본과 같은 7프레임·fireFrame·muzzle. frameMs·위치·배율은 같다.
- 등급 모습을 쓰는 곳: 전투 대기·공격, 층 시작 소환 연출, 강화 팝업 초상(idle 0번).
- 기본 모습 그대로인 곳(결정): 랭킹 팝업 석상(다른 플레이어 레벨을 모름), 강화 팝업의 잠긴 탑 실루엣.

## 수호자 다시 그림 - 몬스터 팩 느낌 (2026-11-26)
- 기본(등급 1) 시트 10장(`guardian_{idle,attack}_{color}.png`)을 큰 고깔 + 후드 얼굴 체형으로 바꿨다. 크기·프레임 수·frameMs는 그대로, `muzzle`만 지팡이 끝 장식 중심(화면 좌표 = 19 - 시트 x)으로 다시 적었다.
- 5색은 얼굴·로브·발·지팡이가 픽셀 단위로 같고 모자, 챙 색, 지팡이 끝만 다르다(빨강 불꽃, 파랑 얼음 결정, 노랑 번개, 초록 새싹 씨앗, 보라 해골 구슬).
- 원본: `art/guardians/monster_style/build_red.py`(빨강), `build_guardians.py`(나머지 4색). 이전 마법사 시트는 `art/guardians/backup_2026-11-26/`.
- 등급 시트(`_g2`~`_g4`)도 같은 체형이다: 등급 1 격자에 장식만 얹는다(2 = 바느질 밑단·소매 금·지팡이 고리 2개·넓은 지팡이 끝, 3 = 앞섶 금 줄·속성 밑단·모자 금 띠·어깨 금·고리 3개, 4 = 크림 심 지팡이 끝·넓은 금 받침·모자 끝 효과·밝은 눈·네온 밑단). 등급 대기도 4프레임이다(위 '12프레임' 설명은 이전 그림 기준). 떠다니는 입자는 시트에 넣지 않는다 - 레벨 이펙트가 맡는다.
- 외곽선 글로우(tier 3+)는 평소엔 안 그리고 2.4초마다 0.36초만 깜빡인다(슬롯마다 0.3초씩 어긋남, 발사 프레임에도 한 번). 값은 `src/render/guardianFx.js`의 `GLOW`.
