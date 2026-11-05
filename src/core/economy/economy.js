// 골드·탑 레벨 순수 계산(docs/balance.md §2, §8). 브라우저 API 사용 금지 - 저장은
// src/platform/storage.js(인터페이스 + localStorage 구현)가 맡고, 이 모듈은 숫자만 다룬다.

// 탑 공격력 = baseAtk x atkGrowthPerLevel^(레벨-1).
export function towerAttack(balance, level) {
  const { baseAtk, atkGrowthPerLevel } = balance.tower;
  return baseAtk * atkGrowthPerLevel ** (level - 1);
}

// 레벨업 비용 = levelCost.base x levelCost.growth^(레벨-1) (지금 레벨 -> 레벨+1로 올리는 비용).
export function towerLevelCost(balance, level) {
  const { base, growth } = balance.tower.levelCost;
  return Math.round(base * growth ** (level - 1));
}

// MAX 강화 - 지금 골드로 레벨 상한까지 몇 레벨을 한 번에 올릴 수 있는지와 그 총 비용을 계산한다.
export function maxTowerLevelUps(balance, level, gold) {
  const { maxLevel } = balance.tower;
  let lvl = level;
  let spent = 0;
  while (lvl < maxLevel) {
    const cost = towerLevelCost(balance, lvl);
    if (spent + cost > gold) break;
    spent += cost;
    lvl += 1;
  }
  return { levels: lvl - level, cost: spent, newLevel: lvl };
}

// 처치 골드 = 기본 골드(unitStats().gold에 이미 적 종류/엘리트/보스 배율까지 반영됨).
// 클리어 보상 = 처치 골드 총합 x (처음 클리어면 clearBonusMul, 다시 깬 층이면 replayClearMul).
export function clearBonus(balance, killGoldTotal, isFirstClear) {
  const { clearBonusMul, replayClearMul } = balance.economy;
  return Math.round(killGoldTotal * (isFirstClear ? clearBonusMul : replayClearMul));
}
