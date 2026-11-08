// T4. 레벨업에 필요한 재화(진행 시뮬레이션, docs/simulation.md 2장). 1층부터 실제 진행처럼:
// 도전 -> 실패하면 가진 골드로 레벨업(even/byUse/none) -> 재도전 -> 클리어하면 다음 층.
// 보스층에서 지면(none 제외) 이전 층을 sim.bossFailFarmRuns회(기본 1) 반복 사냥(다시 깬 클리어 보상 x replayClearMul)한 뒤 재도전.
// 100층 또는 "같은 층 10연패"(안전판 - wallFlag=4보다 훨씬 큰 완전 정지 기준)까지.
import { runFloorAttempt } from '../floorSim.js';
import { clearBonus, towerLevelCost, maxTowerLevelUps } from '../../../src/core/economy/economy.js';
import { GEM_TYPES } from '../../../src/config/gems.js';
import { getFloor } from '../../../src/core/balance/floorGen.js';
import { createRng } from '../../../src/core/rng.js';
import { mdTable } from '../report.js';
import { newAgg, addResult, aggRow, aggTable } from '../agg.js';
import { buyItems, SLOT4_ITEM } from '../itemBot.js';
import { openUnlocks } from '../skills.js';
import { defaultShopSave } from '../../../src/core/shop/shop.js';

const HARD_STOP_RETRIES = 50; // 무한 루프 방지용 안전판일 뿐 - worst 보스 벽은 sim.targets.bossWallMinutesByPlayer(시간)로 표시.

export function spendGold(strategy, balance, towerLevels, gold, colorUsage) {
  if (strategy === 'none' || gold <= 0) return { towerLevels, gold };
  const levels = towerLevels.slice();
  let remaining = gold;

  if (strategy === 'even') {
    // maxLevel 캡 필수 - levelCost.growth가 1보다 작아지면(민감도 ±10% 등) 레벨이 오를수록
    // 비용이 0으로 반올림돼(towerLevelCost의 Math.round) 이 while(true)가 끝나지 않는다.
    // 실제 게임의 tryLevelUpTower도 level>=maxLevel이면 멈춘다 - 같은 규칙을 그대로 따른 것뿐.
    while (true) {
      let idx = 0;
      for (let i = 1; i < levels.length; i++) if (levels[i] < levels[idx]) idx = i;
      if (levels[idx] >= balance.tower.maxLevel) break;
      const cost = towerLevelCost(balance, levels[idx]);
      if (remaining < cost) break;
      remaining -= cost;
      levels[idx] += 1;
    }
  } else if (strategy === 'byUse') {
    const order = levels
      .map((_, i) => i)
      .sort((a, b) => (colorUsage[GEM_TYPES[b].id] ?? 0) - (colorUsage[GEM_TYPES[a].id] ?? 0));
    for (const idx of order) {
      const { levels: n, cost, newLevel } = maxTowerLevelUps(balance, levels[idx], remaining);
      if (n > 0) {
        levels[idx] = newLevel;
        remaining -= cost;
      }
    }
  }
  return { towerLevels: levels, gold: remaining };
}

// itemPolicy(T6, docs/items.md 4장): none = 아이템 없음, boss = 보스층에서만 사서 씀, always = 모든 층.
// 시작 지급(starter)·보스 첫 클리어 보상 2개·20층 4번째 슬롯은 게임(BattleController._grantFirstClearItems)과
// 같은 규칙을 여기서 따른다(그 메서드는 playerState에 묶여 있어 import하지 못함).
export function runOneProgression(env, player, strategy, seed, { itemPolicy = 'none' } = {}) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon, items: itemsCfg } = env.configs;
  const playerCfg = sim.players[player];
  const agg = newAgg();
  const useItems = itemPolicy !== 'none';
  const inventory = useItems ? Object.fromEntries(Object.keys(itemsCfg.items).map((id) => [id, itemsCfg.starter.count])) : {};
  const equipped = useItems ? itemsCfg.starter.equipped.slice() : [];
  let goldEarned = 0;
  let goldSpentItems = 0;
  let goldSpentLevels = 0;
  // --skills=shop: 특수 기술 해금은 상점에서 골드로 산다(A안). 조건이 풀린 기술이 있으면 그 골드를 모을 때까지
  // 탑 레벨업을 미루고, 모이면 바로 산다. 사기 전에는 잠긴 채로 싸운다. 다른 모드는 skillLv = null(조건만 봄).
  const skillLv = env.skillsMode === 'shop' ? defaultShopSave(env.configs.shop).skillLv : null;
  const unlockFloors = {}; // 기술 id -> 산 시점의 층(= bestFloor)
  let goldSpentUnlock = 0;
  // 살 수 있는 만큼 사고, 아직 못 산 해금이 남았으면 true(그동안 레벨업 금지).
  const buyUnlocks = () => {
    if (!skillLv) return false;
    for (const { skill, price } of openUnlocks(env.configs, floor, skillLv)) {
      if (gold < price) return true;
      gold -= price;
      goldSpentUnlock += price;
      skillLv[skill] = 1;
      unlockFloors[skill] = floor;
    }
    return false;
  };
  const levelUp = () => {
    if (buyUnlocks()) return;
    const spent = spendGold(strategy, balance, towerLevels, gold, colorUsage);
    goldSpentLevels += gold - spent.gold;
    towerLevels = spent.towerLevels;
    gold = spent.gold;
  };

  let towerLevels = [1, 1, 1, 1, 1];
  let gold = 0;
  const colorUsage = Object.fromEntries(GEM_TYPES.map((g) => [g.id, 0]));
  let floor = 1;
  let attempt = 0;
  let farmRuns = 0;
  let cumulativeTimeSec = 0;
  let floorTimeSec = 0; // 지금 층에 쓴 시간(도전 + 반복 사냥)
  const bossWallMin = sim.targets.bossWallMinutesByPlayer?.[player];
  const rpf = sim.targets.retriesPerFloor;
  const wallFlagAt = (tag) => (tag === 'boss' ? rpf.bossWallFlagByPlayer?.[player] : null) ?? rpf.wallFlag;
  const retriesByFloor = []; // { floor, tag, retries }
  const wallFloors = [];
  let stoppedEarly = false;

  while (floor <= env.floorsRange.to) {
    const avgLevel = towerLevels.reduce((s, l) => s + l, 0) / towerLevels.length;
    buyUnlocks();
    const levelsAtEntry = towerLevels.slice();
    attempt++;
    const tag = getFloor(balance, enemies, obstacles, floorsData, floor).tag;
    const itemsHere = useItems && (itemPolicy === 'always' || tag === 'boss');
    if (itemsHere) {
      const spent = buyItems(env.configs, inventory, equipped, gold, floor);
      gold -= spent;
      goldSpentItems += spent;
    }
    const attemptFloor = (floorNumber, attemptSeed) =>
      runFloorAttempt({
        balance,
        enemies,
        obstacles,
        obstaclesEnabled: true,
        floorsData,
        floorNumber,
        towerLevels,
        playerCfg,
        modifierHooks: null,
        ...env.skillArgsAt(floor, skillLv ?? undefined),
        itemBot: itemsHere && floorNumber === floor ? { config: itemsCfg, inventory, equipped } : null,
        seed: attemptSeed,
        dt: sim.dt,
        maxFloorSeconds: sim.maxFloorSeconds,
        summon,
        battleEffects,
      });
    const result = attemptFloor(floor, seed * 100000 + attempt);
    cumulativeTimeSec += result.timeSec;
    floorTimeSec += result.timeSec;
    addResult(agg, result);
    for (const [color, count] of Object.entries(result.stats.colorCounts)) colorUsage[color] += count;

    if (result.status === 'cleared') {
      const reward = result.killGoldTotal + clearBonus(balance, result.killGoldTotal, true);
      gold += reward;
      goldEarned += reward;
      if (useItems && tag === 'boss') {
        // 보스 첫 클리어 = 서로 다른 무작위 아이템 2개(층 번호 seed), 20층 = 4번째 슬롯(모래시계 장착).
        const ids = Object.keys(itemsCfg.items);
        const rng = createRng(floor);
        for (let i = 0; i < itemsCfg.bossFirstClearReward.count && ids.length > 0; i++) {
          const id = ids.splice(Math.floor(rng() * ids.length), 1)[0];
          inventory[id] = (inventory[id] ?? 0) + 1;
        }
        if (floor === itemsCfg.slots.unlock4BossFirstClear && !equipped.includes(SLOT4_ITEM)) equipped.push(SLOT4_ITEM);
      }
      retriesByFloor.push({ floor, tag: result.tag, retries: attempt - 1, floorMinutes: floorTimeSec / 60, avgLevelAtEntry: avgLevel, wallLeftPct: result.wallHealthPct, levelsAtEntry: levelsAtEntry });
      const isWall = result.tag === 'boss' && bossWallMin != null ? floorTimeSec / 60 > bossWallMin : attempt - 1 >= wallFlagAt(result.tag);
      if (isWall) wallFloors.push(floor);
      floor += 1;
      attempt = 0;
      floorTimeSec = 0;
    } else {
      gold += result.killGoldTotal;
      goldEarned += result.killGoldTotal;
      if (attempt >= HARD_STOP_RETRIES) {
        retriesByFloor.push({ floor, tag: result.tag, retries: attempt, avgLevelAtEntry: avgLevel, wallLeftPct: result.wallHealthPct, levelsAtEntry: levelsAtEntry });
        wallFloors.push(floor);
        stoppedEarly = true;
        break;
      }
      levelUp();
      const farmCount = result.tag === 'boss' && strategy !== 'none' && floor > 1 ? sim.bossFailFarmRuns ?? 1 : 0;
      for (let k = 0; k < farmCount; k++) {
        farmRuns++;
        const farm = attemptFloor(floor - 1, seed * 100000 + 50000 + attempt * 10 + k);
        cumulativeTimeSec += farm.timeSec;
        floorTimeSec += farm.timeSec;
        const farmReward = farm.killGoldTotal + (farm.status === 'cleared' ? clearBonus(balance, farm.killGoldTotal, false) : 0);
        gold += farmReward;
        goldEarned += farmReward;
        levelUp();
      }
    }
  }

  return {
    reachedFloor: floor - 1,
    farmRuns,
    cumulativeTimeMin: cumulativeTimeSec / 60,
    retriesByFloor,
    wallFloors,
    stoppedEarly,
    stoppedFloor: stoppedEarly ? floor : null,
    agg,
    goldEarned,
    goldSpentItems,
    goldSpentLevels,
    goldSpentUnlock,
    unlockFloors,
    itemsUsed: agg.itemsUsed,
  };
}

// 여러 진행(시드)의 계측을 하나로 합친다(T4/T6 표용).
export function mergeAggs(runs) {
  const merged = newAgg();
  for (const r of runs) {
    merged.runs += r.agg.runs;
    for (const k of Object.keys(merged.damage)) merged.damage[k] += r.agg.damage[k];
    for (const [c, n] of Object.entries(r.agg.effects)) merged.effects[c] = (merged.effects[c] ?? 0) + n;
    merged.immune += r.agg.immune;
    for (const [k, n] of Object.entries(r.agg.casts)) merged.casts[k] = (merged.casts[k] ?? 0) + n;
    for (const k of Object.keys(merged.blocked)) merged.blocked[k] += r.agg.blocked[k];
    merged.wallDamage += r.agg.wallDamage;
    merged.bombDamage += r.agg.bombDamage;
    for (const [k, n] of Object.entries(r.agg.itemsUsed)) merged.itemsUsed[k] = (merged.itemsUsed[k] ?? 0) + n;
  }
  return merged;
}

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
}

export async function run(env) {
  const { sim } = env.configs;
  const strategies = sim.levelStrategies.list;
  const csvRows = [];
  const summaryRows = [];
  const bossAgg = new Map(); // `${player}|${strategy}|${floor}` -> { retries[], wallLeft[] }
  const outOfRange = [];
  const aggRows = [];
  const unlockRows = []; // --skills=shop: 기술별 실제 해금 층, 해금 골드 비율
  const special = env.configs.shop.skills.special;
  const unlockIds = Object.keys(special).filter((id) => special[id].unlockBossFloor);

  for (const player of env.players) {
    for (const strategy of strategies) {
      const runs = [];
      for (let s = 0; s < env.seeds; s++) runs.push(runOneProgression(env, player, strategy, s + 1));
      aggRows.push(aggRow(`${player}:${strategy}`, mergeAggs(runs)));
      if (env.skillsMode === 'shop') {
        // 해금 층 = 산 시점의 최고 층(bestFloor). 못 산 시드는 '미해금 n'으로 따로 센다.
        const row = { player, strategy, section: 'unlock' };
        const cells = unlockIds.map((id) => {
          const fl = runs.map((r) => r.unlockFloors[id]).filter((f) => f != null);
          const miss = runs.length - fl.length;
          const a = fl.length ? avg(fl).toFixed(1) : '';
          Object.assign(row, { [`unlock_${id}_avgFloor`]: a, [`unlock_${id}_minFloor`]: fl.length ? Math.min(...fl) : '', [`unlock_${id}_maxFloor`]: fl.length ? Math.max(...fl) : '', [`unlock_${id}_missingSeeds`]: miss });
          const txt = fl.length ? `${a} (${Math.min(...fl)}~${Math.max(...fl)})` : '-';
          return miss ? `${txt} 미해금 ${miss}` : txt;
        });
        const share = runs.reduce((t, r) => t + r.goldSpentUnlock, 0) / Math.max(1, runs.reduce((t, r) => t + r.goldEarned, 0));
        row.unlockGoldShare = share.toFixed(4);
        csvRows.push(row);
        unlockRows.push([`${player}:${strategy}`, ...cells, `${(share * 100).toFixed(1)}%`]);
      }

      const reachedFloors = runs.map((r) => r.reachedFloor);
      const times = runs.map((r) => r.cumulativeTimeMin);
      const allRetries = runs.flatMap((r) => r.retriesByFloor);
      const normalRetries = allRetries.filter((r) => r.tag === 'normal').map((r) => r.retries);
      const bossRetries = allRetries.filter((r) => r.tag === 'boss').map((r) => r.retries);
      const avgLevelAtEntry = avg(allRetries.map((r) => r.avgLevelAtEntry));
      const wallFloors = [...new Set(runs.flatMap((r) => r.wallFloors))].sort((a, b) => a - b);
      // 멈춘 층 - none(레벨업 안 함)은 반드시 어딘가에서 재도전 상한에 걸린다.
      const stoppedFloors = runs.map((r) => r.stoppedFloor).filter((f) => f != null);
      const avgStopped = avg(stoppedFloors);

      csvRows.push({
        player,
        strategy,
        avgReachedFloor: avg(reachedFloors)?.toFixed(1) ?? '',
        avgRetriesNormal: avg(normalRetries)?.toFixed(2) ?? '',
        avgRetriesBoss: avg(bossRetries)?.toFixed(2) ?? '',
        avgLevelAtEntry: avgLevelAtEntry?.toFixed(1) ?? '',
        cumulativeMinutesTo100: avg(times)?.toFixed(1) ?? '',
        stoppedFloorAvg: avgStopped?.toFixed(1) ?? '',
        stoppedFloors: stoppedFloors.join(';'),
        avgFarmRuns: avg(runs.map((r) => r.farmRuns))?.toFixed(1) ?? '',
        wallFloors: wallFloors.join(';'),
      });
      summaryRows.push([
        `${player}:${strategy}${sim.players[player]?.referenceOnly ? ' (참고)' : ''}`,
        avg(normalRetries)?.toFixed(2) ?? '-',
        avg(bossRetries)?.toFixed(2) ?? '-',
        avgLevelAtEntry?.toFixed(1) ?? '-',
        avg(times)?.toFixed(1) ?? '-',
        avg(runs.map((r) => r.farmRuns))?.toFixed(1) ?? '-',
        avgStopped != null ? `${avgStopped.toFixed(1)} (${stoppedFloors.join('/')})` : '-',
        wallFloors.join(', ') || '-',
      ]);
      for (const rec of allRetries.filter((r) => r.tag === 'boss')) {
        const key = `${player}|${strategy}|${rec.floor}`;
        const agg = bossAgg.get(key) ?? { retries: [], wallLeft: [], minutes: [] };
        agg.retries.push(rec.retries);
        agg.wallLeft.push(rec.wallLeftPct);
        if (rec.floorMinutes != null) agg.minutes.push(rec.floorMinutes);
        bossAgg.set(key, agg);
      }

      // referenceOnly(worst) 플레이어는 리포트에만 남기고 판정하지 않는다.
      if (sim.players[player]?.referenceOnly) continue;
      const [nLo, nHi] = sim.targets.retriesPerFloor.normal;
      const [bLo, bHi] = sim.targets.retriesPerFloor.bossByPlayer?.[player] ?? sim.targets.retriesPerFloor.boss;
      const nAvg = avg(normalRetries);
      const bAvg = avg(bossRetries);
      if (nAvg != null && (nAvg < nLo || nAvg > nHi)) {
        outOfRange.push(`벽: T4 ${player}:${strategy} 일반층 평균 재도전 ${nAvg.toFixed(2)} (기준 ${nLo}~${nHi})`);
      }
      if (bAvg != null && (bAvg < bLo || bAvg > bHi)) {
        outOfRange.push(`벽: T4 ${player}:${strategy} 보스층 평균 재도전 ${bAvg.toFixed(2)} (기준 ${bLo}~${bHi})`);
      }
      const minutesRange = sim.targets.minutesTo100[player];
      if (minutesRange && strategy !== 'none') {
        const [mLo, mHi] = minutesRange;
        const time = avg(times);
        if (time != null && (time < mLo || time > mHi) && avg(reachedFloors) >= env.floorsRange.to) {
          outOfRange.push(`기준 벗어남: T4 ${player}:${strategy} 100층 누적 시간 ${time.toFixed(1)}분 (기준 ${mLo}~${mHi})`);
        }
        if (stoppedFloors.length > 0) {
          outOfRange.push(`벽: T4 ${player}:${strategy} ${stoppedFloors.join('/')}층에서 멈춤(${HARD_STOP_RETRIES}연패)`);
        }
      }
      if (wallFloors.length > 0) outOfRange.push(`벽: T4 ${player}:${strategy} 층 ${wallFloors.join(', ')}에서 재도전 ${sim.targets.retriesPerFloor.wallFlag}회 이상(보스층 기준이 따로 있으면 ${sim.targets.retriesPerFloor.bossWallFlagByPlayer?.[player] ?? '-'}회, 보스 시간 기준이 있으면 보스층은 ${sim.targets.bossWallMinutesByPlayer?.[player] ?? '-'}분 초과)`);
    }
  }

  const bossRows = [...bossAgg]
    .map(([key, agg]) => {
      const [player, strategy, floor] = key.split('|');
      return { player, strategy, floor: Number(floor), retries: avg(agg.retries), wallLeft: avg(agg.wallLeft), minutes: avg(agg.minutes) };
    })
    .sort((a, b) => a.player.localeCompare(b.player) || a.strategy.localeCompare(b.strategy) || a.floor - b.floor);
  for (const r of bossRows) {
    csvRows.push({
      player: r.player,
      strategy: r.strategy,
      section: 'boss',
      bossFloor: r.floor,
      bossAvgRetries: r.retries.toFixed(2),
      bossWallLeftPct: r.wallLeft.toFixed(3),
    });
  }

  const summaryMd =
    `## T4 진행 (기술 ${env.skillsMode}, enemyHpMul ${env.configs.balance.scaling.enemyHpMul ?? 1})\n${mdTable(['구간', '일반층 재도전', '보스층 재도전', '진입 시 평균 Lv', '누적 시간(분)', '반복 사냥(회)', '멈춘 층', '벽 층'], summaryRows)}` +
    (unlockRows.length
      ? `\n\n### T4 특수 기술 해금 (A안, 해금 골드 차감 - 층 = 산 시점의 최고 층, 시드 평균 (최소~최대))\n${mdTable(['플레이어:전략', ...unlockIds.map((id) => `${id} 해금 층`), '해금 골드 / 전체 획득 골드'], unlockRows)}`
      : '') +
    `\n\n### T4 기술 몫·발동 횟수 (진행 전체 시도 평균)\n${aggTable(aggRows)}` +
    `\n\n### T4 보스층만\n${mdTable(
      ['플레이어:전략', '층', '평균 재도전', '남은 성벽', '층에 쓴 시간(분)'],
      bossRows.map((r) => [`${r.player}:${r.strategy}`, r.floor, r.retries.toFixed(2), `${(r.wallLeft * 100).toFixed(0)}%`, r.minutes?.toFixed(1) ?? '-'])
    )}`;
  return { csvRows, summaryMd, outOfRange };
}
