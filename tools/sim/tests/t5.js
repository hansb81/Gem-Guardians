// T5. 추가로 보는 것들(docs/simulation.md 2장, 판단해서 넣은 항목). 방해요소 영향, 적 역할별
// 위험도, 보스 처치 시간, 색 편중, 연쇄·특수 잼 빈도, 민감도(±10%).
import { runFloorAttempt } from '../floorSim.js';
import { GEM_TYPES } from '../../../src/config/gems.js';
import { mdTable } from '../report.js';
import { runOneProgression } from './t4.js';
import { genFloor, unitStats } from '../../../src/core/balance/floorGen.js';

const LEVEL = 10; // 즉시 실패/즉시 클리어로 데이터가 비지 않을 "중간" 레벨(보고: 기획에 T5
// 기준 레벨 명시 없어 임의로 정함).

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
}

function runBatch(env, player, obstaclesEnabled) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon } = env.configs;
  const playerCfg = sim.players[player];
  const towerLevels = [LEVEL, LEVEL, LEVEL, LEVEL, LEVEL];
  const out = [];
  for (let floor = env.floorsRange.from; floor <= env.floorsRange.to; floor++) {
    for (let s = 0; s < env.seeds; s++) {
      out.push(
        runFloorAttempt({
          balance,
          enemies,
          obstacles,
          obstaclesEnabled,
          floorsData,
          floorNumber: floor,
          towerLevels,
          playerCfg,
          modifierHooks: null,
          seed: s + 1,
          dt: sim.dt,
          maxFloorSeconds: sim.maxFloorSeconds,
          summon,
          battleEffects,
        })
      );
    }
  }
  return out;
}

function floorEnemyHpTotal(balance, enemies, obstacles, floorNumber) {
  const floor = genFloor(balance, enemies, obstacles, floorNumber);
  return floor.spawns.reduce((sum, spawn) => sum + unitStats(balance, enemies, floor, spawn).hp, 0);
}

function climbMaxFloor(env, player, ceilingFloor) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon } = env.configs;
  let maxFloorReached = 0;
  for (let floor = 1; floor <= ceilingFloor; floor++) {
    let fails = 0;
    for (let s = 0; s < env.seeds; s++) {
      const result = runFloorAttempt({
        balance,
        enemies,
        obstacles,
        obstaclesEnabled: true,
        floorsData,
        floorNumber: floor,
        towerLevels: [1, 1, 1, 1, 1],
        playerCfg: sim.players[player],
        modifierHooks: null,
        seed: s + 1,
        dt: sim.dt,
        maxFloorSeconds: sim.maxFloorSeconds,
        summon,
        battleEffects,
      });
      if (result.status !== 'cleared') fails++;
    }
    if (fails > env.seeds / 2) return maxFloorReached;
    maxFloorReached = floor;
  }
  return maxFloorReached;
}

function withBalanceOverride(balance, path, mul, isGrowthRate = false) {
  const clone = JSON.parse(JSON.stringify(balance));
  const parts = path.split('.');
  let obj = clone;
  for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
  const key = parts[parts.length - 1];
  const v = obj[key];
  obj[key] = isGrowthRate ? 1 + (v - 1) * mul : v * mul;
  return clone;
}

const SENSITIVITY_KNOBS = [
  // growthRate = 지수의 밑(1.0235 등). ±10%는 값이 아니라 성장률(v-1)에 걸어야 뜻이 통한다.
  { name: 'hpGrowth', path: 'scaling.hpGrowth', growthRate: true },
  { name: 'threatBudget.perFloor', path: 'floorShape.threatBudget.perFloor' },
  { name: 'spawnInterval.min', path: 'floorShape.spawnInterval.min' },
  { name: 'levelCost.growth', path: 'tower.levelCost.growth', growthRate: true },
];

export async function run(env) {
  const { sim } = env.configs;
  const csvRows = [];
  const summarySections = [];
  const outOfRange = [];

  // --- 방해요소 영향 / 색 편중 / 연쇄·특수 잼 빈도 / 보스 처치 비율 / 역할별 위험도 ---
  const roleTotals = {};
  const roleTotalsByPlayer = {}; // player -> role -> 성벽 피해
  const colorTotals = Object.fromEntries(GEM_TYPES.map((g) => [g.id, 0]));
  let totalWallDmg = 0;
  let totalBombWallDmg = 0;
  const bossResults = [];
  let onCellsPerSwap = [];
  let offCellsPerSwap = [];

  for (const player of env.players) {
    const onRuns = runBatch(env, player, true);
    const offRuns = runBatch(env, player, false);

    for (const r of onRuns) {
      if (r.swapCount > 0) onCellsPerSwap.push(r.stats.totalCellsCleared / r.swapCount);
      const byP = (roleTotalsByPlayer[player] ??= {});
      for (const [role, dmg] of Object.entries(r.wallDamageByRole)) {
        roleTotals[role] = (roleTotals[role] ?? 0) + dmg;
        byP[role] = (byP[role] ?? 0) + dmg;
      }
      for (const [color, n] of Object.entries(r.stats.colorCounts)) colorTotals[color] += n;
      totalWallDmg += Object.values(r.wallDamageByRole).reduce((s, v) => s + v, 0) + r.bombWallDamageTotal;
      totalBombWallDmg += r.bombWallDamageTotal;
      if (r.bossSeen || r.bossKilledBeforeWall != null) bossResults.push(r.bossKilledBeforeWall);

      csvRows.push({
        section: 'obstaclesOn',
        player,
        floor: r.floor,
        tag: r.tag,
        status: r.status,
        cellsPerSwap: r.swapCount ? (r.stats.totalCellsCleared / r.swapCount).toFixed(2) : '',
        avgCascade: avg(r.stats.cascadeSamples)?.toFixed(2) ?? '',
        specialsPerSwap: r.swapCount ? (r.stats.specialsCreated / r.swapCount).toFixed(3) : '',
        bombsExpired: r.stats.bombsExpired,
        bombsDefused: r.stats.bombsDefused,
      });
    }
    for (const r of offRuns) {
      if (r.swapCount > 0) offCellsPerSwap.push(r.stats.totalCellsCleared / r.swapCount);
      csvRows.push({ section: 'obstaclesOff', player, floor: r.floor, tag: r.tag, status: r.status, cellsPerSwap: r.swapCount ? (r.stats.totalCellsCleared / r.swapCount).toFixed(2) : '' });
    }
  }

  const avgOn = avg(onCellsPerSwap);
  const avgOff = avg(offCellsPerSwap);
  const efficiencyDropPct = avgOn != null && avgOff ? ((avgOff - avgOn) / avgOff) * 100 : null;
  const bossBeforeWallRatio = bossResults.length ? bossResults.filter(Boolean).length / bossResults.length : null;
  const colorTotalSum = Object.values(colorTotals).reduce((s, v) => s + v, 0) || 1;
  const colorRatioStr = GEM_TYPES.map((g) => `${g.id} ${((colorTotals[g.id] / colorTotalSum) * 100).toFixed(1)}%`).join(', ');
  const roleRatio = (totals) => {
    const sum = Object.values(totals).reduce((s, v) => s + v, 0) || 1;
    return Object.entries(totals)
      .sort((a, b) => b[1] - a[1])
      .map(([role, dmg]) => `${role} ${((dmg / sum) * 100).toFixed(1)}%`)
      .join(', ');
  };
  const roleRatioStr = roleRatio(roleTotals);
  const roleRatioByPlayerStr = Object.entries(roleTotalsByPlayer)
    .map(([p, t]) => `  - ${p}: ${roleRatio(t) || '-'}\n`)
    .join('');
  const bombWallDmgPctOfTotal = totalWallDmg ? (totalBombWallDmg / totalWallDmg) * 100 : 0;

  summarySections.push(
    `## T5\n` +
      `- 방해요소 영향: 스왑당 지운 잼 켬=${avgOn?.toFixed(2) ?? '-'} 끔=${avgOff?.toFixed(2) ?? '-'} (효율 ${efficiencyDropPct != null ? efficiencyDropPct.toFixed(1) : '-'}% 감소), 시한폭탄 성벽 피해 비중 ${bombWallDmgPctOfTotal.toFixed(1)}%\n` +
      `- 역할별 성벽 피해 비율(전체, Lv${LEVEL} 고정): ${roleRatioStr || '-'}\n` +
      roleRatioByPlayerStr +
      `- 보스를 성벽 전에 잡는 비율: ${bossBeforeWallRatio != null ? (bossBeforeWallRatio * 100).toFixed(1) + '%' : '-'} (표본 ${bossResults.length})\n` +
      `- 색 비율: ${colorRatioStr}\n` +
      `- 스왑당 잼 ${avgOn?.toFixed(2) ?? '-'}, 평균 연쇄 ${avg(onRunsCascade(csvRows))?.toFixed(2) ?? '-'}`
  );

  if (efficiencyDropPct != null && bombWallDmgPctOfTotal > 30) {
    outOfRange.push(`기준 벗어남: T5 시한폭탄 성벽 피해 비중 ${bombWallDmgPctOfTotal.toFixed(1)}% > 30%`);
  }

  // --- 민감도 ±10% ---
  // 성능: 'normal'/'fast'는 매 수마다 후보를 전부 복제+끝까지 돌려 채점한다(bot.js) - 민감도는
  // ±10%가 T1/T4를 얼마나 움직이는지 "방향과 크기"만 보면 되므로, 채점 없이 바로 고르는
  // 'worst'(random, 구 casual)로 돌리고 maxFloorSeconds도 줄인다(한쪽이 거의 이기지도 지지도 않는 접전일
  // 때 매 수 채점까지 겹치면 100층 진행 시뮬레이션 하나가 수 분까지 늘어질 수 있었다 - 느리면
  // "탐색만" 최적화하라는 지침에 따라 테스트 쪽 설정만 줄였다, 게임 규칙은 그대로).
  // 2026-11-05: casual(현 worst)은 보스 벽(10층 정지) 때문에 결과가 0이거나 노이즈라 normal로 바꿈.
  // 일반층이 60~90초라 90초 상한이면 시간 초과로 지므로 상한도 150초로 올렸다.
  const SENS_PLAYER = 'normal';
  const sensSeeds = Math.min(env.seeds, 2);
  // floorsData: null 이 핵심이다 - config/floors.json 캐시를 쓰면 getFloor()가 미리 만들어진
  // 층을 그대로 돌려줘서 hpGrowth/threatBudget/spawnInterval을 바꿔도 결과가 전부 0이 된다.
  // null이면 getFloor()가 그때그때 genFloor(변경된 balance)로 층을 다시 만든다(파일은 건드리지
  // 않는다). 기준선도 같은 경로로 재어야 비교가 성립한다.
  const sensEnv = {
    ...env,
    seeds: sensSeeds,
    configs: { ...env.configs, floorsData: null, sim: { ...env.configs.sim, maxFloorSeconds: 150 } },
  };

  // self-check: 위 경로가 정말 "바뀐 값으로 층을 다시 만드는지" 확인한다(여기가 깨지면 민감도
  // 표가 조용히 전부 0이 된다).
  {
    const E = env.configs.enemies;
    const O = env.configs.obstacles;
    const hpUp = withBalanceOverride(env.configs.balance, 'scaling.hpGrowth', 1.1, true);
    if (genFloor(hpUp, E, O, 50).scaling.hpMul === genFloor(env.configs.balance, E, O, 50).scaling.hpMul) {
      throw new Error('T5 self-check 실패: balance 덮어쓰기가 genFloor에 반영되지 않는다');
    }
  }
  // 봇 선택에 무작위가 섞여 한 시드만 보면 들쭉날쭉하다 - sensSeeds만큼 평균낸다.
  const avgProgTime = (e) => avg(Array.from({ length: sensSeeds }, (_, i) => runOneProgression(e, SENS_PLAYER, 'even', i + 1).cumulativeTimeMin));

  const baselineFloor = climbMaxFloor(sensEnv, SENS_PLAYER, env.floorsRange.to);
  const baselineProgTime = avgProgTime(sensEnv);

  const sensRows = [];
  const baseHp100 = floorEnemyHpTotal(env.configs.balance, env.configs.enemies, env.configs.obstacles, 100);
  for (const knob of SENSITIVITY_KNOBS) {
    for (const mul of [0.9, 1.1]) {
      const balanceVariant = withBalanceOverride(env.configs.balance, knob.path, mul, knob.growthRate);
      const variantEnv = { ...sensEnv, configs: { ...sensEnv.configs, balance: balanceVariant } };
      const floorResult = climbMaxFloor(variantEnv, SENS_PLAYER, env.floorsRange.to);
      const progTime = avgProgTime(variantEnv);
      const hp100 = floorEnemyHpTotal(balanceVariant, env.configs.enemies, env.configs.obstacles, 100);
      const hp100Pct = ((hp100 - baseHp100) / baseHp100) * 100;
      sensRows.push([
        knob.name,
        `x${mul}`,
        `${hp100Pct >= 0 ? '+' : ''}${hp100Pct.toFixed(1)}%`,
        `${floorResult - baselineFloor >= 0 ? '+' : ''}${floorResult - baselineFloor}`,
        `${(progTime - baselineProgTime).toFixed(1)}분`,
      ]);
      csvRows.push({
        section: 'sensitivity',
        knob: knob.name,
        mul,
        floor100EnemyHpDeltaPct: hp100Pct.toFixed(1),
        maxFloorDelta: floorResult - baselineFloor,
        minutesTo100Delta: (progTime - baselineProgTime).toFixed(1),
      });
    }
  }
  summarySections.push(`### 민감도 (±10%, 기준 T1 최대 층 ${baselineFloor} / T4 even 누적 ${baselineProgTime.toFixed(1)}분)\n${mdTable(['손잡이', '변화', '100층 적 HP 총합', 'T1 최대 층 변화', 'T4 누적 시간 변화'], sensRows)}`);

  return { csvRows, summaryMd: summarySections.join('\n\n'), outOfRange };
}

// cascadeSamples는 csvRows에 직접 넣지 않았으므로(행마다 배열이라 CSV에 부적합) summary 문구
// 하나에만 평균을 다시 계산해 넣는다 - 저장된 avgCascade 문자열 열을 재사용.
function onRunsCascade(rows) {
  return rows.filter((r) => r.section === 'obstaclesOn' && r.avgCascade !== '').map((r) => Number(r.avgCascade));
}
