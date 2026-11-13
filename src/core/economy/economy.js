// 골드·탑 레벨 순수 계산(docs/balance.md §2, §8). 브라우저 API 사용 금지 - 저장은
// src/platform/storage.js(캐시 + 마켓 어댑터 저장소)가 맡고, 이 모듈은 숫자만 다룬다.

import { getFloor, unitStats } from '../balance/floorGen.js';

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

// 일괄 강화 - 가장 낮은 레벨 석상(같으면 앞 번호)부터 1레벨씩, 골드가 모자랄 때까지 골고루 올린다.
// 비용이 레벨에만 달려 있어 가장 낮은 석상이 늘 가장 싸다 = 남은 골드로 가장 많은 레벨을 올리는 순서.
export function evenTowerLevelUps(balance, levels, gold) {
  const { maxLevel } = balance.tower;
  const next = levels.slice();
  let spent = 0;
  for (;;) {
    let i = -1;
    for (let k = 0; k < next.length; k++) if (next[k] < maxLevel && (i < 0 || next[k] < next[i])) i = k;
    if (i < 0) break;
    const cost = towerLevelCost(balance, next[i]);
    if (spent + cost > gold) break;
    spent += cost;
    next[i] += 1;
  }
  return { levels: next, cost: spent, count: next.reduce((a, l, k) => a + l - levels[k], 0) };
}

// 처치 골드 = 기본 골드(unitStats().gold에 이미 적 종류/엘리트/보스 배율까지 반영됨).
// 콤보 골드 보너스(balance.economy.comboGold) = 클리어 골드(처치 + 클리어 보상, 골드 배율 전) × min(판 최대 콤보, cap)/cap × maxPct.
// 계산 순서는 시뮬(tools/sim/combo.js)과 바이트 단위로 같게 유지한다.
export function comboGoldBonus(balance, clearGold, maxCombo) {
  const cfg = balance.economy.comboGold;
  if (!cfg) return 0;
  return Math.round((clearGold * Math.min(maxCombo, cfg.comboCap)) / cfg.comboCap * cfg.maxPct);
}

// 클리어 보상 = 처치 골드 총합 x (처음 클리어면 clearBonusMul, 다시 깬 층이면 replayClearMul).
export function clearBonus(balance, killGoldTotal, isFirstClear) {
  const { clearBonusMul, replayClearMul } = balance.economy;
  return Math.round(killGoldTotal * (isFirstClear ? clearBonusMul : replayClearMul));
}

// 아이템 골드 가격(docs/items.md 4장) = round(goldBase x 기준 층 보상). 기준 층 = 최고 도달 층
// 이하에서 가장 가까운 순수 일반층(보스·엘리트 제외), 보상 = 그 층 처치 골드 합 + clearBonus(다시 깬 층 기준).
// floors.json/genFloor 모두 층 번호 seed라 같은 층이면 항상 같은 값이다.
// data = { balance, enemies, obstacles, floorsData }(loadBalanceData 결과 그대로).
// goldBase가 null(다이아 전용)이면 null - 다이아 값은 itemsConfig.items[id].diamond를 그대로 읽는다.
export function itemPrice(data, itemsConfig, id, maxFloor) {
  if (itemsConfig.items[id].goldBase == null) return null;
  return Math.round(itemsConfig.items[id].goldBase * normalFloorReward(data, maxFloor));
}

// itemPrice의 "기준 층 보상"(goldBase 1 = 이 값). 상점의 젬 스킬·골드 교환도 같은 배수로 값을 매긴다(config/shop.json).
export function normalFloorReward(data, maxFloor) {
  const { balance, enemies, obstacles, floorsData } = data;
  let floor = getFloor(balance, enemies, obstacles, floorsData, Math.max(1, maxFloor));
  while (floor.tag !== 'normal' && floor.floor > 1) floor = getFloor(balance, enemies, obstacles, floorsData, floor.floor - 1);
  const killGold = floor.spawns.reduce((sum, spawn) => sum + unitStats(balance, enemies, floor, spawn).gold, 0);
  return killGold + clearBonus(balance, killGold, false);
}
