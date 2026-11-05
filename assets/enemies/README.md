# 적 이미지

파일 이름은 `config/enemies.json`의 `monsters[id].anim`에서 정한다 - `walk`(필요하면
`idle`) 패턴의 `{i}`를 `frames` 배열 값으로 바꾸고 `.png`를 붙인 이름 그대로 이 폴더에
있어야 한다(예: `goblin_run_anim_f0.png`, `SmallMushroom_Walk_1.png`). 프레임 크기는
몬스터마다 달라 코드가 이미지에서 직접 읽는다 - 이 README에 따로 적지 않는다.

패턴과 실제 파일이 맞는지는 `tools/check_enemy_sprites.py`로 확인한다. 파일이 없거나
로드에 실패하면 렌더러가 색 도형 + 이름 첫 글자로 대체한다(스탯에는 영향 없음).

새 몬스터를 추가하려면: `config/enemies.json`의 `monsters`에 `anim` 패턴을 포함해 항목을
추가하고, 그 패턴에 맞는 프레임 파일들을 이 폴더에 넣으면 된다(코드 수정 불필요).
