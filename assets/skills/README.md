# Gem Guardians 젬 기술 전투 이펙트 v3 (assets/skills)

기획: `docs/skills.md` (= plan/skills/gem-skills-proposal-v3.md). 생성기 `art/skills-v3/skills_v3.py` + `build_assets.py`, 목업 `art/skills-v3/mockups/`.
픽셀 아트, 25색 팔레트, 알파 0/255, 네이티브 해상도, **팔레트(8비트) PNG**, 메타데이터 없음. 모든 이펙트는 **적과 같은 배율(2배)**, `imageSmoothingEnabled=false`.
**석상 위·석상→적 연출은 없다.** 모든 기술은 적 쪽에서만 나타난다.

## 최적화
1. 색마다 모양이 다른 것(가시·용암탄)만 색별 시트. 모양이 같은 것(명중 번쩍, 보스 잼 아이콘)은 **회색 마스크 1장 → 코드 틴트**(`tintSheet()`, 로드 시 1회, 캔버스 캐시).
2. 움직이는 잔 요소는 코드: 궤적·독 방울·감속 결정·경직 불꽃은 `particlePool`, 화면 번쩍·흔들림은 `fillRect`/`translate`. 이미지 아님.
3. 재활용: 영혼 불꽃 = `assets/effects/sheets/box_soul_{색}.png`(2배). 옐로우 궁극기 번개 = `pixelBolt`.
4. 모든 PNG는 팔레트 모드(색 ≤ 16)라 RGBA보다 작다. 새로 넣은 뒤 `python tools/optimize_png.py` 한 번 더.

## 틴트 규칙 (`manifest.tint`)
마스크 `#221c2b → ramp[0]`, `#3b3347 → ramp[1]`, `#655a74 → ramp[2]`, `#e8dcc0 → ramp[3]`, 외곽선 `#0d0a10` 그대로.
```js
export function tintSheet(img, maskColors, ramp) {
  const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, c.width, c.height), d = id.data;
  const from = maskColors.map(hexToRgb), to = ramp.map(hexToRgb);
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] === 0) continue;
    for (let k = 0; k < from.length; k++)
      if (d[i] === from[k][0] && d[i + 1] === from[k][1] && d[i + 2] === from[k][2]) { d[i] = to[k][0]; d[i + 1] = to[k][1]; d[i + 2] = to[k][2]; break; }
  }
  ctx.putImageData(id, 0, 0); return c;
}
```

## 시트 (`manifest.anims`)
| 키 | 크기 | 프레임 | 앵커 | 용도 |
|---|---|---|---|---|
| `spike_{색}` | 32x32 | 6 | 촉(22,22)을 적 몸통 중심에 = 프레임 중심을 (−12,−12)×배율 | 가시(라인 잼 공통). 프레임 2 타격+넉백 |
| `meteor_{색}` | 96x80 | 9~10 | bottom-center(착탄점 바닥) | 용암탄. 타격 프레임 red/blue 4, yellow 1, purple/green 3. 반경 40 네이티브 |
| `light_pillar` | 24x64 | 8 | bottom-center(적 발) | 무지개×무지개. 프레임 2 타격 |
| `hit` (마스크) | 16x16 | 3 | center | 명중 번쩍: 영혼 불꽃 도착, 궁극기, 빛기둥, 그린 표식 |
| `fx_splash` | 24x24 | 4 | center | 레드 색 효과 범위 폭발 |
| `status_icons` | 8x8 | 5 정지 | bottom-center | [감속, 독, 경직, 표식×1, 표식×2] |
| `gem_mini` (마스크) | 7x7 | 1 | top-left | 보스 면역·약점 잼 아이콘 |
| `boss_icons` | 9x9 | 2 정지 | top-left | [면역(빨간 금지), 약점(노란 ↑)] |

## 기술 연출 (`manifest.skills`) - 목업 `art/skills-v3/mockups/*.gif`
- **가시** (`line`): 가장 앞 적 1마리. `spike_{색}`을 촉이 몸통 중심에 오게 그림(왼쪽 위에서 대각선으로 내려옴). 프레임 2에 피해 ×2.5 + 넉백(렌더는 120ms 동안 오른쪽으로 보간, core는 progress −0.05). 라인 잼 2개 동시 → 두 번째 가시는 그 다음 앞 적.
- **용암탄** (`bomb`): 반경 안 적 수가 최대인 지점의 발 위치에 `meteor_{색}`. 타격 프레임에 반경 안 전부 피해 ×2.0 + 색 효과. 레드·블루·옐로우는 160ms 화면 흔들림(±4px). 퍼플·그린은 낙하 없음(그래서 흔들림 없음).
- **영혼 불꽃** (`box`): HP 가장 높은 2마리. `box_soul_{색}` 2개가 전투 영역 가장자리(위/아래/오른쪽) 랜덤 지점에서 출발, 유도 비행(140px/s×배율, 방향 보간 0.3), 궤적 2px 파티클. 도착 시 `hit` + 피해 ×1.5. 대상이 먼저 죽으면 남은 적 중 HP 최대로 변경, 없으면 소멸.
- **궁극기** (`color`, 무지개 1개): 전투 영역 `fillRect(ramp[3])` alpha 0.5→0 180ms + 모든 적 `hit` + 피해 ×1.0 + 그 색 효과.
- **대폭발** (`color_color`, 무지개×무지개): 적마다 `light_pillar`, 앞에서부터 80ms 간격. 프레임 2에 피해 ×2.0 + 다섯 색 효과 전부(보스 면역 색 제외). 첫 기둥 바닥 도달 때 뼈색 화면 번쩍 180ms.

## 색 효과 표시 (`manifest.colorEffects`)
- 레드: 직격 적 중심에 `fx_splash`, 반경 12×배율 안 다른 적 40% 피해.
- 블루 감속: 아이콘 0 + 발밑 1px ramp[3] 결정 2개/초 위로.
- 퍼플 독: 아이콘 1 + 몸통 2px ramp[2] 방울 3개/초, 틱마다 작은 피해 숫자.
- 옐로우 경직: 아이콘 2 + 머리 위 1px 불꽃 4개 공전, 걷기 애니 정지.
- 그린 표식: 아이콘 3/4, 붙는 순간 `hit`(초록) 1회.
- 보스: 이름 옆에 `gem_mini`(그 색 틴트) + `boss_icons` 0/1. 효과가 막히면 피해 숫자 폰트로 "면역".
- 적 스프라이트 자체는 틴트하지 않는다.
