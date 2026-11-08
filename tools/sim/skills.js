// --skills 스위치 -> runFloorAttempt 인자. 규칙은 src/battle/battleState.js(config/skills.json)가
// 그대로 돌고, 여기서는 unlocked 플래그만 끄고 켠다(docs/skills.md 4장 "끄면 그 효과/기술만 빠짐").
// bossRules=false면 보스 면역·약점·넉백 면역을 비운다(all 모드 - 면역 효과만 따로 보기 위함).
// shop = 게임 그대로(all+boss) + 특수 기술 A안 해금 일정(config/shop.json skills.special.unlockBossFloor).
//   진행(T4 runOneProgression)에서는 해금 골드를 모아 사야 켜진다(unlockPrice). 고정 층 테스트는 조건만 본다.
// shop-free = shop과 같지만 진행에서도 해금 골드 없이 조건만 풀리면 켠다(비용 영향 비교용).
import { defaultShopSave, applySkillLevels, buildRail } from '../../src/core/shop/shop.js';

export const SHOP_MODES = ['shop', 'shop-free'];

export function skillsFor(mode, skillsConfig) {
  if (mode === 'none') return { skills: null, bossRules: false };
  if (SHOP_MODES.includes(mode)) return { skills: skillsConfig, bossRules: true };
  const on = (keys, flag) => Object.fromEntries(keys.map((k) => [k, flag]));
  const colors = Object.keys(skillsConfig.unlocked.colorEffects);
  const specials = Object.keys(skillsConfig.specialSkills);
  const skills = {
    ...skillsConfig,
    unlocked: {
      colorEffects: on(colors, mode !== 'special'),
      specialSkills: on(specials, mode !== 'color'),
    },
  };
  return { skills, bossRules: mode === 'all+boss' };
}

// 상점 레벨(전부 Lv 1)을 최고 도달 층(bestFloor)으로 정한다: 게임의 bestFloor는 클리어한 다음 층이라
// "보스 N층 첫 처치" = bestFloor > N. 여기선 골드를 따지지 않는다(조건만).
export function shopSkillLv(shopCfg, bestFloor) {
  const lv = defaultShopSave(shopCfg).skillLv;
  for (const [id, s] of Object.entries(shopCfg.skills.special)) if (bestFloor > s.unlockBossFloor) lv[id] = 1;
  return lv;
}

// 지금 살 수 있는 특수 기술 해금 카드 [{ skill, price }] (config/shop.json 순서) - 게임 상점 레일(shop.js buildRail
// 'skills')을 그대로 불러 가격(round(unlockGold x normalFloorReward(bestFloor)))과 잠김(bestFloor > 보스층)을 얻는다.
export function openUnlocks(configs, bestFloor, skillLv) {
  const { balance, enemies, obstacles, floorsData, shop, items } = configs;
  const ctx = { cfg: shop, itemsConfig: items, data: { balance, enemies, obstacles, floorsData }, player: { bestFloor, shop: { skillLv } } };
  return buildRail(ctx, 'skills').filter((p) => p.kind === 'skillUnlock' && p.state === '').map((p) => ({ skill: p.skill, price: p.price }));
}

// env.skillArgsAt(bestFloor, skillLv?): shop 모드면 해금 상태별(최대 4가지)로 캐시, 그 밖은 고정값.
// skillLv를 넘기면(진행에서 실제로 산 상태) 그것을, 없으면 bestFloor 조건으로 정한다.
export function skillArgsAtFor(mode, skillsConfig, shopCfg) {
  const base = skillsFor(mode, skillsConfig);
  if (!SHOP_MODES.includes(mode)) return () => base;
  const cache = new Map();
  return (bestFloor, skillLv) => {
    const lv = skillLv ?? shopSkillLv(shopCfg, bestFloor);
    const key = JSON.stringify(lv);
    if (!cache.has(key)) cache.set(key, { skills: applySkillLevels(skillsConfig, shopCfg.skills, lv), bossRules: true });
    return cache.get(key);
  };
}
