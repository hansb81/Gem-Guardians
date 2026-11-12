# 안 쓰는 리소스 후보 (2026-11-12)

`assets/` 아래 1088개 파일을 `src/`, `config/`, `index.html`, 각 폴더 manifest와 대조한 결과다. 삭제는 하지 않았다.
후보는 225개, 230.0 KB다.

| 구분 | 파일 수 | 크기 | 지워도 되는 정도 |
| --- | --- | --- | --- |
| 1. 어디에서도 참조 안 함 (삭제함) | 20 | 175.9 KB | 높음 |
| 2. 옛 탑 그림 (삭제함) | 15 | 4.5 KB | 높음 |
| 3. 옛 석상 대기 시트 (삭제함) | 5 | 1.5 KB | 높음 |
| 4. 적 idle·hit 프레임(로더는 walk만 읽음) | 180 | 47.6 KB | 결정 필요 |
| 5. 로드는 되지만 그리는 코드가 없는 UI | 5 | 0.5 KB | 결정 필요 |

## 1. 어디에서도 참조 안 함 (2026-11-12 삭제함)

아래 20개와 `assets/heroes/README.md`를 지웠다(git rm, 미커밋). 빈 폴더 `assets/heroes`, `assets/characters/{elf,knight,orc,reference,slime}`도 없어졌다. `assets/characters/characters.hex`는 공유 팔레트라(docs/ART_DIRECTION.md 15장) 남겼다.

코드, config, manifest 어디에도 파일 이름이 없다. `overview.png`는 에셋 한눈에 보기용 그림, `assets/characters`·`assets/heroes`는 초기 시안이다.

| 파일 | 크기(바이트) |
| --- | --- |
| `assets/backgrounds/overview.png` | 116,579 |
| `assets/characters/elf/elf.png` | 266 |
| `assets/characters/elf/elf_idle.png` | 344 |
| `assets/characters/knight/knight.png` | 234 |
| `assets/characters/orc/orc.png` | 267 |
| `assets/characters/reference/ref_knight_dark.png` | 229 |
| `assets/characters/reference/ref_knight_native.png` | 240 |
| `assets/characters/reference/ref_wizard_dark.png` | 196 |
| `assets/characters/reference/ref_wizard_native.png` | 209 |
| `assets/characters/slime/slime.png` | 181 |
| `assets/gems/overview.png` | 6,922 |
| `assets/heroes/hero_blue.svg` | 1,176 |
| `assets/heroes/hero_green.svg` | 1,195 |
| `assets/heroes/hero_purple.svg` | 917 |
| `assets/heroes/hero_red.svg` | 1,180 |
| `assets/obstacles/overview.png` | 11,600 |
| `assets/statues/overview.png` | 3,228 |
| `assets/summon/frames_x4.png` | 20,133 |
| `assets/ui/menu/overview.png` | 2,776 |
| `assets/ui/overview.png` | 12,281 |

## 2. 옛 탑 그림 (2026-11-12 삭제함)

아래 15개를 지우고 `assets/towers/manifest.json`의 `towers`·`anims` 항목, README의 파일 표를 정리했다.

`assets/towers/manifest.json`에는 적혀 있지만 로더(`src/render/assetLoader.js:185`)는 이 manifest에서 `projectiles`만 읽는다. 탑 그림은 `assets/statues`가 대신한다. `sheets/projectile_*.png` 5개는 쓰는 중이니 남긴다. 지울 때는 manifest의 `towers`·`anims` 항목도 같이 정리해야 한다.

| 파일 | 크기(바이트) |
| --- | --- |
| `assets/towers/blue.png` | 243 |
| `assets/towers/green.png` | 253 |
| `assets/towers/purple.png` | 251 |
| `assets/towers/red.png` | 243 |
| `assets/towers/yellow.png` | 241 |
| `assets/towers/sheets/tower_attack_blue.png` | 367 |
| `assets/towers/sheets/tower_attack_green.png` | 385 |
| `assets/towers/sheets/tower_attack_purple.png` | 382 |
| `assets/towers/sheets/tower_attack_red.png` | 395 |
| `assets/towers/sheets/tower_attack_yellow.png` | 383 |
| `assets/towers/sheets/tower_idle_blue.png` | 301 |
| `assets/towers/sheets/tower_idle_green.png` | 305 |
| `assets/towers/sheets/tower_idle_purple.png` | 297 |
| `assets/towers/sheets/tower_idle_red.png` | 305 |
| `assets/towers/sheets/tower_idle_yellow.png` | 307 |

## 3. 옛 석상 대기 시트 (2026-11-12 삭제함)

`assets/statues/manifest.json`의 `statue_idle_{색}` 항목이 지금은 `sheets/guardian_idle_{색}.png`를 가리킨다. 아래 파일을 가리키는 곳은 없다.

| 파일 | 크기(바이트) |
| --- | --- |
| `assets/statues/sheets/statue_idle_blue.png` | 297 |
| `assets/statues/sheets/statue_idle_green.png` | 311 |
| `assets/statues/sheets/statue_idle_purple.png` | 337 |
| `assets/statues/sheets/statue_idle_red.png` | 300 |
| `assets/statues/sheets/statue_idle_yellow.png` | 304 |

## 4. 적 idle·hit 프레임

`config/enemies.json`의 `anim.idle`·`anim.hit`에 이름은 적혀 있지만, 로더(`src/render/assetLoader.js:158-166`)는 `anim.walk` 프레임만 읽는다. 코드 주석에 "대기 상태가 생기면 idle을 읽는다"고 되어 있어, 나중에 대기 연출을 넣을 계획이면 남겨야 한다.

- idle 178개, 47.1 KB
- hit 2개: `assets/enemies/lizard_f_hit_anim_f0.png`, `assets/enemies/lizard_m_hit_anim_f0.png`

<details><summary>idle 파일 전체</summary>

```
assets/enemies/angel_idle_anim_f0.png
assets/enemies/angel_idle_anim_f1.png
assets/enemies/angel_idle_anim_f2.png
assets/enemies/angel_idle_anim_f3.png
assets/enemies/Bandit_Idle_1.png
assets/enemies/Bandit_Idle_2.png
assets/enemies/Bandit_Idle_3.png
assets/enemies/Bandit_Idle_4.png
assets/enemies/Bear_Idle_1.png
assets/enemies/Bear_Idle_2.png
assets/enemies/Bear_Idle_3.png
assets/enemies/Bear_Idle_4.png
assets/enemies/big_demon_idle_anim_f0.png
assets/enemies/big_demon_idle_anim_f1.png
assets/enemies/big_demon_idle_anim_f2.png
assets/enemies/big_demon_idle_anim_f3.png
assets/enemies/big_zombie_idle_anim_f0.png
assets/enemies/big_zombie_idle_anim_f1.png
assets/enemies/big_zombie_idle_anim_f2.png
assets/enemies/big_zombie_idle_anim_f3.png
assets/enemies/Centaur_F_Idle_1.png
assets/enemies/Centaur_F_Idle_2.png
assets/enemies/Centaur_F_Idle_3.png
assets/enemies/Centaur_F_Idle_4.png
assets/enemies/Centaur_M_Idle_1.png
assets/enemies/Centaur_M_Idle_2.png
assets/enemies/Centaur_M_Idle_3.png
assets/enemies/Centaur_M_Idle_4.png
assets/enemies/chort_idle_anim_f0.png
assets/enemies/chort_idle_anim_f1.png
assets/enemies/chort_idle_anim_f2.png
assets/enemies/chort_idle_anim_f3.png
assets/enemies/doc_idle_anim_f0.png
assets/enemies/doc_idle_anim_f1.png
assets/enemies/doc_idle_anim_f2.png
assets/enemies/doc_idle_anim_f3.png
assets/enemies/dwarf_f_idle_anim_f0.png
assets/enemies/dwarf_f_idle_anim_f1.png
assets/enemies/dwarf_f_idle_anim_f2.png
assets/enemies/dwarf_f_idle_anim_f3.png
assets/enemies/dwarf_m_idle_anim_f0.png
assets/enemies/dwarf_m_idle_anim_f1.png
assets/enemies/dwarf_m_idle_anim_f2.png
assets/enemies/dwarf_m_idle_anim_f3.png
assets/enemies/elf_f_idle_anim_f0.png
assets/enemies/elf_f_idle_anim_f1.png
assets/enemies/elf_f_idle_anim_f2.png
assets/enemies/elf_f_idle_anim_f3.png
assets/enemies/elf_m_idle_anim_f0.png
assets/enemies/elf_m_idle_anim_f1.png
assets/enemies/elf_m_idle_anim_f2.png
assets/enemies/elf_m_idle_anim_f3.png
assets/enemies/ElvenKnight_Idle_1.png
assets/enemies/ElvenKnight_Idle_2.png
assets/enemies/ElvenKnight_Idle_3.png
assets/enemies/ElvenKnight_Idle_4.png
assets/enemies/Ent_Idle_1.png
assets/enemies/Ent_Idle_2.png
assets/enemies/Ent_Idle_3.png
assets/enemies/Ent_Idle_4.png
assets/enemies/ForestGuardian_Idle_1.png
assets/enemies/ForestGuardian_Idle_2.png
assets/enemies/ForestGuardian_Idle_3.png
assets/enemies/ForestGuardian_Idle_4.png
assets/enemies/GnollBrute_Idle_1.png
assets/enemies/GnollBrute_Idle_2.png
assets/enemies/GnollBrute_Idle_3.png
assets/enemies/GnollBrute_Idle_4.png
assets/enemies/GnollOverseer_Idle_1.png
assets/enemies/GnollOverseer_Idle_2.png
assets/enemies/GnollOverseer_Idle_3.png
assets/enemies/GnollOverseer_Idle_4.png
assets/enemies/GnollScout_Idle_1.png
assets/enemies/GnollScout_Idle_2.png
assets/enemies/GnollScout_Idle_3.png
assets/enemies/GnollScout_Idle_4.png
assets/enemies/GnollShaman_Idle_1.png
assets/enemies/GnollShaman_Idle_2.png
assets/enemies/GnollShaman_Idle_3.png
assets/enemies/GnollShaman_Idle_4.png
assets/enemies/goblin_idle_anim_f0.png
assets/enemies/goblin_idle_anim_f1.png
assets/enemies/goblin_idle_anim_f2.png
assets/enemies/goblin_idle_anim_f3.png
assets/enemies/Golem_Idle_1.png
assets/enemies/Golem_Idle_2.png
assets/enemies/Golem_Idle_3.png
assets/enemies/Golem_Idle_4.png
assets/enemies/Golem_Idle_5.png
assets/enemies/Golem_Idle_6.png
assets/enemies/HighElf_F_Idle_1.png
assets/enemies/HighElf_F_Idle_2.png
assets/enemies/HighElf_F_Idle_3.png
assets/enemies/HighElf_F_Idle_4.png
assets/enemies/imp_idle_anim_f0.png
assets/enemies/imp_idle_anim_f1.png
assets/enemies/imp_idle_anim_f2.png
assets/enemies/imp_idle_anim_f3.png
assets/enemies/knight_f_idle_anim_f0.png
assets/enemies/knight_f_idle_anim_f1.png
assets/enemies/knight_f_idle_anim_f2.png
assets/enemies/knight_f_idle_anim_f3.png
assets/enemies/knight_m_idle_anim_f0.png
assets/enemies/knight_m_idle_anim_f1.png
assets/enemies/knight_m_idle_anim_f2.png
assets/enemies/knight_m_idle_anim_f3.png
assets/enemies/LargeMushroom_Idle_1.png
assets/enemies/LargeMushroom_Idle_2.png
assets/enemies/LargeMushroom_Idle_3.png
assets/enemies/LargeMushroom_Idle_4.png
assets/enemies/lizard_f_idle_anim_f0.png
assets/enemies/lizard_f_idle_anim_f1.png
assets/enemies/lizard_f_idle_anim_f2.png
assets/enemies/lizard_f_idle_anim_f3.png
assets/enemies/lizard_m_idle_anim_f0.png
assets/enemies/lizard_m_idle_anim_f1.png
assets/enemies/lizard_m_idle_anim_f2.png
assets/enemies/lizard_m_idle_anim_f3.png
assets/enemies/masked_orc_idle_anim_f0.png
assets/enemies/masked_orc_idle_anim_f1.png
assets/enemies/masked_orc_idle_anim_f2.png
assets/enemies/masked_orc_idle_anim_f3.png
assets/enemies/NormalMushroom_Idle_1.png
assets/enemies/NormalMushroom_Idle_2.png
assets/enemies/NormalMushroom_Idle_3.png
assets/enemies/NormalMushroom_Idle_4.png
assets/enemies/ogre_idle_anim_f0.png
assets/enemies/ogre_idle_anim_f1.png
assets/enemies/ogre_idle_anim_f2.png
assets/enemies/ogre_idle_anim_f3.png
assets/enemies/orc_shaman_idle_anim_f0.png
assets/enemies/orc_shaman_idle_anim_f1.png
assets/enemies/orc_shaman_idle_anim_f2.png
assets/enemies/orc_shaman_idle_anim_f3.png
assets/enemies/orc_warrior_idle_anim_f0.png
assets/enemies/orc_warrior_idle_anim_f1.png
assets/enemies/orc_warrior_idle_anim_f2.png
assets/enemies/orc_warrior_idle_anim_f3.png
assets/enemies/pumpkin_dude_idle_anim_f0.png
assets/enemies/pumpkin_dude_idle_anim_f1.png
assets/enemies/pumpkin_dude_idle_anim_f2.png
assets/enemies/pumpkin_dude_idle_anim_f3.png
assets/enemies/Ranger_Idle_1.png
assets/enemies/Ranger_Idle_2.png
assets/enemies/Ranger_Idle_3.png
assets/enemies/Ranger_Idle_4.png
assets/enemies/skelet_idle_anim_f0.png
assets/enemies/skelet_idle_anim_f1.png
assets/enemies/skelet_idle_anim_f2.png
assets/enemies/skelet_idle_anim_f3.png
assets/enemies/SmallMushroom_Idle_1.png
assets/enemies/SmallMushroom_Idle_2.png
assets/enemies/SmallMushroom_Idle_3.png
assets/enemies/SmallMushroom_Idle_4.png
assets/enemies/tiny_zombie_idle_anim_f0.png
assets/enemies/tiny_zombie_idle_anim_f1.png
assets/enemies/tiny_zombie_idle_anim_f2.png
assets/enemies/tiny_zombie_idle_anim_f3.png
assets/enemies/Troll_Idle_1.png
assets/enemies/Troll_Idle_2.png
assets/enemies/Troll_Idle_3.png
assets/enemies/Troll_Idle_4.png
assets/enemies/wizzard_f_idle_anim_f0.png
assets/enemies/wizzard_f_idle_anim_f1.png
assets/enemies/wizzard_f_idle_anim_f2.png
assets/enemies/wizzard_f_idle_anim_f3.png
assets/enemies/wizzard_m_idle_anim_f0.png
assets/enemies/wizzard_m_idle_anim_f1.png
assets/enemies/wizzard_m_idle_anim_f2.png
assets/enemies/wizzard_m_idle_anim_f3.png
assets/enemies/wogol_idle_anim_f0.png
assets/enemies/wogol_idle_anim_f1.png
assets/enemies/wogol_idle_anim_f2.png
assets/enemies/wogol_idle_anim_f3.png
assets/enemies/Wolf_Idle_1.png
assets/enemies/Wolf_Idle_2.png
assets/enemies/Wolf_Idle_3.png
assets/enemies/Wolf_Idle_4.png
```

</details>

## 5. 로드는 되지만 그리는 코드가 없는 UI

`assets/ui/manifest.json`에 있어서 시작할 때 전부 로드되지만, 이 경로를 그리는 코드가 없다. manifest 설명에는 "예비(보호막) 채움", "HP 잔상"으로 적혀 있다. 지울 때는 manifest 항목도 같이 지워야 한다(안 지우면 로드 실패가 난다).

| 파일 | 크기(바이트) |
| --- | --- |
| `assets/ui/enemy/fill_blue.png` | 87 |
| `assets/ui/enemy/fill_lag.png` | 87 |
| `assets/ui/gauges/fill_blue.png` | 101 |
| `assets/ui/gauges/fill_lag.png` | 101 |
| `assets/ui/gauges/fill_purple.png` | 101 |

## 참고: 게임이 읽지 않는 문서류 (27개, 70.6 KB)

README, 팔레트(.hex), 라이선스 파일이다. 후보에 넣지 않았다. `assets/fonts/*-OFL.txt`와 `assets/enemies/CREDITS.md`는 폰트·스프라이트 라이선스 고지라 지우면 안 된다.

- `assets/audio/bgm/README.md`
- `assets/characters/characters.hex`
- `assets/effects/monster/README.md`
- `assets/effects/README.md`
- `assets/enemies/CREDITS.md`
- `assets/enemies/README.md`
- `assets/fonts/FusionPixel-OFL.txt`
- `assets/fonts/Galmuri11-OFL.txt`
- `assets/fonts/NotoSans-OFL.txt`
- `assets/gems/palette.hex`
- `assets/gems/README.md`
- `assets/heroes/README.md`
- `assets/items/README.md`
- `assets/menu/README.md`
- `assets/obstacles/README.md`
- `assets/sfx/README.md`
- `assets/skills/README.md`
- `assets/specials/README.md`
- `assets/statues/README.md`
- `assets/summon/README.md`
- `assets/title/door_transition_spec.md`
- `assets/title/README.md`
- `assets/towers/README.md`
- `assets/ui/menu/README.md`
- `assets/ui/ranking/README.md`
- `assets/ui/README.md`
- `assets/ui/shop/README.md`

## 확인 방법과 한계

- 파일 이름(확장자 포함), 확장자 뺀 이름, 템플릿 문자열(`shop/skill_${id}.png` 같은 것), manifest 키를 코드에서 찾았다. 적 스프라이트는 `enemies.json`의 패턴을 프레임 번호로 풀어 정확히 대조했다.
- 같은 이름의 파일이 여러 폴더에 있으면(`red.png` 등 색 이름, `btn_close.png`, `fill_red.png`) 한쪽만 쓰여도 둘 다 "사용"으로 본다. `assets/towers`는 직접 확인해 2번에 넣었고, `btn_close.png`는 `menu/`·`upgrade/` 둘 다 쓰는 것을 확인했다.
- manifest에 있고 로더가 통째로 읽는 폴더(`assets/ui`, `assets/effects`, `assets/backgrounds` 등)는 "로드됨 = 사용"으로 봤다. 로드만 되고 화면에 안 그려지는 것은 5번처럼 경로가 코드에 없을 때만 잡힌다.
- `art/`, `preview/`, `mockups/`, `store/`는 작업용·제출용 폴더라 대상에서 뺐다.
- 게임을 실행해 실제 로드 기록과 맞춰 보지는 않았다.
