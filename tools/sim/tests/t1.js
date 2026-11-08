// T1. 레벨 없이 어디까지 가나(docs/simulation.md 2장). 탑 5개 모두 Lv1/Lv10/Lv20으로 고정하고
// 1층부터 올라가며, 시드 중 과반이 실패하는 첫 층에서 멈춘다.
import { runFloorAttempt } from '../floorSim.js';
import { mdTable } from '../report.js';

const LEVEL_SETS = [
  { label: 'Lv1', level: 1 },
  { label: 'Lv10', level: 10 },
  { label: 'Lv20', level: 20 },
];

function failReason(result) {
  if (result.status !== 'failed') return '';
  const rankEntries = Object.entries(result.wallDamageByRank);
  const enemyTotal = rankEntries.reduce((s, [, v]) => s + v, 0);
  if (result.bombWallDamageTotal > 0 && result.bombWallDamageTotal >= enemyTotal) return '시한폭탄';
  if (rankEntries.length === 0) return result.bombWallDamageTotal > 0 ? '시한폭탄' : '적 누적';
  rankEntries.sort((a, b) => b[1] - a[1]);
  return rankEntries[0][0] === 'boss' ? '보스' : '적 누적';
}

export async function run(env) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon } = env.configs;
  const csvRows = [];
  const maxFloorByPlayerLevel = {}; // `${player}|${label}` -> floor

  for (const player of env.players) {
    const playerCfg = sim.players[player];
    for (const { label, level } of LEVEL_SETS) {
      const towerLevels = [level, level, level, level, level];
      let maxFloorReached = 0;
      for (let floor = 1; floor <= env.floorsRange.to; floor++) {
        const results = [];
        for (let s = 0; s < env.seeds; s++) {
          results.push(
            runFloorAttempt({
              balance,
              enemies,
              obstacles,
              obstaclesEnabled: true,
              floorsData,
              floorNumber: floor,
              towerLevels,
              playerCfg,
              modifierHooks: null,
              ...env.skillArgsAt(floor),
              seed: s + 1,
              dt: sim.dt,
              maxFloorSeconds: sim.maxFloorSeconds,
              summon,
              battleEffects,
            })
          );
        }
        const fails = results.filter((r) => r.status !== 'cleared');
        const clears = results.filter((r) => r.status === 'cleared');
        const avgWallLeft = clears.length ? clears.reduce((s, r) => s + r.wallHealthPct, 0) / clears.length : null;
        const avgTime = results.reduce((s, r) => s + r.timeSec, 0) / results.length;
        const reasons = [...new Set(fails.map(failReason).filter(Boolean))].join('/');

        csvRows.push({
          player,
          level: label,
          floor,
          seedsFailed: fails.length,
          seedsTotal: env.seeds,
          avgWallLeftPctOnClear: avgWallLeft != null ? avgWallLeft.toFixed(3) : '',
          avgFloorSeconds: avgTime.toFixed(2),
          failReason: reasons,
        });

        const majorityFail = fails.length > env.seeds / 2;
        if (majorityFail) break;
        maxFloorReached = floor;
      }
      maxFloorByPlayerLevel[`${player}|${label}`] = maxFloorReached;
    }
  }

  const headerRow = ['플레이어', ...LEVEL_SETS.map((l) => l.label)];
  const bodyRows = env.players.map((p) => [p, ...LEVEL_SETS.map((l) => maxFloorByPlayerLevel[`${p}|${l.label}`])]);
  const summaryMd = `## T1 레벨 없이\n${mdTable(headerRow, bodyRows)}`;

  const outOfRange = [];
  const targets = sim.targets.noLevelReach;
  for (const player of env.players) {
    const range = targets[player];
    if (!range) continue;
    const reached = maxFloorByPlayerLevel[`${player}|Lv1`];
    if (reached > range[1]) outOfRange.push(`너무 쉬움: T1 ${player} Lv1 최대 층 ${reached} > 기준 ${range[1]}`);
    else if (reached < range[0]) outOfRange.push(`너무 어려움: T1 ${player} Lv1 최대 층 ${reached} < 기준 ${range[0]}`);
  }

  return { csvRows, summaryMd, outOfRange };
}
