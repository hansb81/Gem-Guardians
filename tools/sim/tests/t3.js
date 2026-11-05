// T3. 플레이에 따른 골드(docs/simulation.md 2장). 층마다 처음 클리어/다시 클리어(x0.3)/실패
// 골드와 분당 골드를 본다. 탑 레벨은 T4 진행(even)에서 그 층에 실제로 들어갔을 때의 레벨을
// 쓴다 - Lv1 고정으로는 후반 층을 깨지 못해 골드 칸이 비고, "첫 클리어로 몇 레벨"도
// 과대평가된다(sim.json targets.levelsPerFirstClear._doc).
import { runFloorAttempt } from '../floorSim.js';
import { clearBonus } from '../../../src/core/economy/economy.js';
import { runOneProgression, spendGold } from './t4.js';
import { mdTable } from '../report.js';

const BUCKET_SIZE = 10;

function bucketLabel(from, to) {
  return `${from}-${to}`;
}

function levelsBought(balance, levelsAtEntry, gold) {
  const after = spendGold('even', balance, levelsAtEntry, gold, {}).towerLevels;
  return after.reduce((s, l) => s + l, 0) - levelsAtEntry.reduce((s, l) => s + l, 0);
}

export async function run(env) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon } = env.configs;
  const csvRows = [];
  const bucketAgg = new Map(); // `${player}|${bucket}` -> accumulator

  for (const player of env.players) {
    const playerCfg = sim.players[player];
    // 기준 탑 레벨 = T4 진행(even, 시드 1)에서 그 층에 실제로 들어갔을 때의 레벨. Lv1 고정으로
    // 계산하면 후반 층에서 "한 번에 수십 레벨"이 되어 기준(2~5)과 비교할 수 없다.
    const prog = runOneProgression(env, player, 'even', 1);
    const levelsByFloor = new Map(prog.retriesByFloor.map((r) => [r.floor, r.levelsAtEntry]));
    // shortcut: 그 진행이 도달하지 못한 층은 마지막으로 알려진 레벨을 쓴다(casual처럼 중간에
    // 멈추는 경우 후반 구간 값이 과대평가된다), T4가 100층까지 안정적으로 가면 그때 제거.
    let lastKnownLevels = [1, 1, 1, 1, 1];
    for (let floor = env.floorsRange.from; floor <= env.floorsRange.to; floor++) {
      const levelsAtEntry = levelsByFloor.get(floor) ?? lastKnownLevels;
      lastKnownLevels = levelsAtEntry;
      const bucketFrom = Math.floor((floor - 1) / BUCKET_SIZE) * BUCKET_SIZE + 1;
      const bucketTo = bucketFrom + BUCKET_SIZE - 1;
      const bucket = bucketLabel(bucketFrom, bucketTo);
      const key = `${player}|${bucket}`;
      if (!bucketAgg.has(key)) {
        bucketAgg.set(key, { firstClearGold: [], replayGold: [], failGold: [], floorSeconds: [], levelsFromFirst: [] });
      }
      const agg = bucketAgg.get(key);

      for (let s = 0; s < env.seeds; s++) {
        const result = runFloorAttempt({
          balance,
          enemies,
          obstacles,
          obstaclesEnabled: true,
          floorsData,
          floorNumber: floor,
          towerLevels: levelsAtEntry,
          playerCfg,
          modifierHooks: null,
          seed: s + 1,
          dt: sim.dt,
          maxFloorSeconds: sim.maxFloorSeconds,
          summon,
          battleEffects,
        });

        if (result.status === 'cleared') {
          const firstGold = result.killGoldTotal + clearBonus(balance, result.killGoldTotal, true);
          const replayGold = result.killGoldTotal + clearBonus(balance, result.killGoldTotal, false);
          agg.firstClearGold.push(firstGold);
          agg.replayGold.push(replayGold);
          agg.floorSeconds.push(result.timeSec);
          agg.levelsFromFirst.push(levelsBought(balance, levelsAtEntry, firstGold));
        } else {
          agg.failGold.push(result.killGoldTotal);
        }
      }
    }
  }

  const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null);
  const summaryRows = [];
  const outOfRange = [];
  const [lo, hi] = sim.targets.levelsPerFirstClear.range;

  for (const [key, agg] of bucketAgg) {
    const [player, bucket] = key.split('|');
    const firstGold = avg(agg.firstClearGold);
    const replayGold = avg(agg.replayGold);
    const failGold = avg(agg.failGold);
    const floorSeconds = avg(agg.floorSeconds);
    const levels = avg(agg.levelsFromFirst);
    const goldPerMinFirst = firstGold != null && floorSeconds ? firstGold / (floorSeconds / 60) : null;
    const goldPerMinReplay = replayGold != null && floorSeconds ? replayGold / (floorSeconds / 60) : null;

    csvRows.push({
      player,
      bucket,
      firstClearGold: firstGold?.toFixed(1) ?? '',
      replayClearGold: replayGold?.toFixed(1) ?? '',
      failGold: failGold?.toFixed(1) ?? '',
      floorSeconds: floorSeconds?.toFixed(2) ?? '',
      goldPerMinFirstClear: goldPerMinFirst?.toFixed(1) ?? '',
      goldPerMinFarming: goldPerMinReplay?.toFixed(1) ?? '',
      levelsPerFirstClear: levels?.toFixed(2) ?? '',
    });
    summaryRows.push([
      env.players.length > 1 ? `${player}:${bucket}` : bucket,
      firstGold?.toFixed(1) ?? '-',
      floorSeconds?.toFixed(1) ?? '-',
      goldPerMinFirst?.toFixed(1) ?? '-',
      levels?.toFixed(2) ?? '-',
    ]);

    if (levels != null) {
      if (levels > hi) outOfRange.push(`너무 쉬움: T3 ${key} 첫 클리어 레벨 ${levels.toFixed(2)} > 기준 ${hi}`);
      else if (levels < lo) outOfRange.push(`너무 어려움: T3 ${key} 첫 클리어 레벨 ${levels.toFixed(2)} < 기준 ${lo}`);
    }
    if (goldPerMinFirst != null && goldPerMinReplay != null && goldPerMinReplay > goldPerMinFirst) {
      outOfRange.push(`벽: T3 ${key} 파밍 분당 골드(${goldPerMinReplay.toFixed(1)})가 첫 클리어(${goldPerMinFirst.toFixed(1)})보다 높음 - 파밍만 하게 됨`);
    }
  }

  const summaryMd = `## T3 골드\n${mdTable(
    ['구간', '첫 클리어 골드', '층 시간(초)', '분당 골드', '첫 클리어로 살 수 있는 레벨'],
    summaryRows
  )}`;

  return { csvRows, summaryMd, outOfRange };
}
