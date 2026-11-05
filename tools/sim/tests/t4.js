// T4. 레벨업에 필요한 재화(진행 시뮬레이션, docs/simulation.md 2장). 1층부터 실제 진행처럼:
// 도전 -> 실패하면 가진 골드로 레벨업(even/byUse/none) -> 재도전 -> 클리어하면 다음 층.
// 100층 또는 "같은 층 10연패"(안전판 - wallFlag=4보다 훨씬 큰 완전 정지 기준)까지.
import { runFloorAttempt } from '../floorSim.js';
import { clearBonus, towerLevelCost, maxTowerLevelUps } from '../../../src/core/economy/economy.js';
import { GEM_TYPES } from '../../../src/config/gems.js';
import { mdTable } from '../report.js';

const HARD_STOP_RETRIES = 10;

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

export function runOneProgression(env, player, strategy, seed) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon } = env.configs;
  const playerCfg = sim.players[player];

  let towerLevels = [1, 1, 1, 1, 1];
  let gold = 0;
  const colorUsage = Object.fromEntries(GEM_TYPES.map((g) => [g.id, 0]));
  let floor = 1;
  let attempt = 0;
  let cumulativeTimeSec = 0;
  const retriesByFloor = []; // { floor, tag, retries }
  const wallFloors = [];
  let stoppedEarly = false;

  while (floor <= env.floorsRange.to) {
    const avgLevel = towerLevels.reduce((s, l) => s + l, 0) / towerLevels.length;
    const levelsAtEntry = towerLevels.slice();
    attempt++;
    const result = runFloorAttempt({
      balance,
      enemies,
      obstacles,
      obstaclesEnabled: true,
      floorsData,
      floorNumber: floor,
      towerLevels,
      playerCfg,
      modifierHooks: null,
      seed: seed * 100000 + attempt,
      dt: sim.dt,
      maxFloorSeconds: sim.maxFloorSeconds,
      summon,
      battleEffects,
    });
    cumulativeTimeSec += result.timeSec;
    for (const [color, count] of Object.entries(result.stats.colorCounts)) colorUsage[color] += count;

    if (result.status === 'cleared') {
      gold += result.killGoldTotal + clearBonus(balance, result.killGoldTotal, true);
      retriesByFloor.push({ floor, tag: result.tag, retries: attempt - 1, avgLevelAtEntry: avgLevel, wallLeftPct: result.wallHealthPct, levelsAtEntry: levelsAtEntry });
      if (attempt - 1 >= 4) wallFloors.push(floor);
      floor += 1;
      attempt = 0;
    } else {
      gold += result.killGoldTotal;
      if (attempt >= HARD_STOP_RETRIES) {
        retriesByFloor.push({ floor, tag: result.tag, retries: attempt, avgLevelAtEntry: avgLevel, wallLeftPct: result.wallHealthPct, levelsAtEntry: levelsAtEntry });
        wallFloors.push(floor);
        stoppedEarly = true;
        break;
      }
      const spent = spendGold(strategy, balance, towerLevels, gold, colorUsage);
      towerLevels = spent.towerLevels;
      gold = spent.gold;
    }
  }

  return { reachedFloor: floor - 1, cumulativeTimeMin: cumulativeTimeSec / 60, retriesByFloor, wallFloors, stoppedEarly, stoppedFloor: stoppedEarly ? floor : null };
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

  for (const player of env.players) {
    for (const strategy of strategies) {
      const runs = [];
      for (let s = 0; s < env.seeds; s++) runs.push(runOneProgression(env, player, strategy, s + 1));

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
        wallFloors: wallFloors.join(';'),
      });
      summaryRows.push([
        `${player}:${strategy}`,
        avg(normalRetries)?.toFixed(2) ?? '-',
        avgLevelAtEntry?.toFixed(1) ?? '-',
        avg(times)?.toFixed(1) ?? '-',
        avgStopped != null ? `${avgStopped.toFixed(1)} (${stoppedFloors.join('/')})` : '-',
        wallFloors.join(', ') || '-',
      ]);
      for (const rec of allRetries.filter((r) => r.tag === 'boss')) {
        const key = `${player}|${strategy}|${rec.floor}`;
        const agg = bossAgg.get(key) ?? { retries: [], wallLeft: [] };
        agg.retries.push(rec.retries);
        agg.wallLeft.push(rec.wallLeftPct);
        bossAgg.set(key, agg);
      }

      const [nLo, nHi] = sim.targets.retriesPerFloor.normal;
      const [bLo, bHi] = sim.targets.retriesPerFloor.boss;
      const nAvg = avg(normalRetries);
      const bAvg = avg(bossRetries);
      if (nAvg != null && (nAvg < nLo || nAvg > nHi)) {
        outOfRange.push(`벽: T4 ${player}:${strategy} 일반층 평균 재도전 ${nAvg.toFixed(2)} (기준 ${nLo}~${nHi})`);
      }
      if (bAvg != null && (bAvg < bLo || bAvg > bHi)) {
        outOfRange.push(`벽: T4 ${player}:${strategy} 보스층 평균 재도전 ${bAvg.toFixed(2)} (기준 ${bLo}~${bHi})`);
      }
      if (player === 'normal' && strategy !== 'none') {
        const [mLo, mHi] = sim.targets.minutesTo100.normal;
        const time = avg(times);
        if (time != null && (time < mLo || time > mHi) && avg(reachedFloors) >= env.floorsRange.to) {
          outOfRange.push(`기준 벗어남: T4 normal:${strategy} 100층 누적 시간 ${time.toFixed(1)}분 (기준 ${mLo}~${mHi})`);
        }
      }
      if (wallFloors.length > 0) outOfRange.push(`벽: T4 ${player}:${strategy} 층 ${wallFloors.join(', ')}에서 재도전 4회 이상`);
    }
  }

  const bossRows = [...bossAgg]
    .map(([key, agg]) => {
      const [player, strategy, floor] = key.split('|');
      return { player, strategy, floor: Number(floor), retries: avg(agg.retries), wallLeft: avg(agg.wallLeft) };
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
    `## T4 진행\n${mdTable(['구간', '평균 도전 횟수', '진입 시 평균 Lv', '누적 시간(분)', '멈춘 층', '벽 층'], summaryRows)}` +
    `\n\n### T4 보스층만\n${mdTable(
      ['플레이어:전략', '층', '평균 재도전', '남은 성벽'],
      bossRows.map((r) => [`${r.player}:${r.strategy}`, r.floor, r.retries.toFixed(2), `${(r.wallLeft * 100).toFixed(0)}%`])
    )}`;
  return { csvRows, summaryMd, outOfRange };
}
