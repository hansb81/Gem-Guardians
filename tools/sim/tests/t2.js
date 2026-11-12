// T2. 잼 특수 효과 미리 시험(docs/simulation.md 2장). "최대 도달 층"은 보스 관문 때문에 거의
// 움직이지 않아 쓸모없으므로, 보스층 전체(10~100)에서 그 층의 기대 탑 레벨로 탑을
// 고정하고 "그 층을 이길 수 있는 최소 공격력 배율"(needPower)을 이분 탐색한다.
// 등가 전력 배율 = needPower(효과 없음) / needPower(효과 켬). 1.4면 "공격력 x1.4와 같음".
// 훅이 실제로 몇 번 발동했는지(onShot/onHit/추가 피해)도 같이 기록한다 - 0이면 배선 버그.
import { runFloorAttempt } from '../floorSim.js';
import { buildModifierHooks, resolveModifierList } from '../modifiers.js';
import { mdTable } from '../report.js';
import { addResult } from '../agg.js';
import { spendGold } from './t4.js';
import { getFloor, unitStats } from '../../../src/core/balance/floorGen.js';
import { clearBonus } from '../../../src/core/economy/economy.js';

const PROBE_FLOOR_NUMBERS = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

// expTowerLevel(docs/balance.md §8, tools/sim_floors.py와 같은 정의) = 1층부터 각 층을 한 번씩
// 깨고 그 층 첫 클리어 골드를 가장 싼 탑부터 썼을 때, 그 층에 들어갈 때의 평균 탑 레벨(반올림).
// 경제 수치를 바꾸면 자동으로 따라오도록 floors.json에서 매번 계산한다.
export function expectedTowerLevels(configs, floorNumbers) {
  const { balance, enemies, obstacles, floorsData } = configs;
  let levels = [1, 1, 1, 1, 1];
  let gold = 0;
  const out = new Map();
  const last = Math.max(...floorNumbers);
  for (let f = 1; f <= last; f++) {
    ({ towerLevels: levels, gold } = spendGold('even', balance, levels, gold, {}));
    out.set(f, Math.round(levels.reduce((s, l) => s + l, 0) / levels.length));
    const floor = getFloor(balance, enemies, obstacles, floorsData, f);
    const kill = floor.spawns.reduce((s, sp) => s + unitStats(balance, enemies, floor, sp).gold, 0);
    gold += kill + clearBonus(balance, kill, true);
  }
  return floorNumbers.map((floor) => ({ floor, expTowerLevel: out.get(floor) }));
}

const POWER_LO = 0.05;
const POWER_HI = 3; // docs/balance.md 9장 needPower 최대 1.14 - 3이면 충분한 상한.
const BISECT_STEPS = 8; // (3-0.05)/2^8 ~= 0.012 해상도. 효과가 몇 % 절약하는지 보려면 필요.

// mul = 공격력 배율(runFloorAttempt attackMul - 탑 공격력에 직접 곱하므로 기본 사격과 특수 잼 기술에
// 똑같이 걸린다). skillArgs = { skills, bossRules } (기본은 --skills, T2s는 모드별로 넘긴다).
function clearsFloor(env, player, floorNumber, level, modList, mul, statsAcc, skillArgs) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon } = env.configs;
  const towerLevels = [level, level, level, level, level];
  let clears = 0;
  for (let s = 0; s < env.seeds; s++) {
    // 훅은 시도마다 새로 만든다 - dots/slows가 다음 전투의 같은 enemyId로 새는 것을 막는다.
    const hooks = buildModifierHooks(modList);
    const result = runFloorAttempt({
      balance,
      enemies,
      obstacles,
      obstaclesEnabled: true,
      floorsData,
      floorNumber,
      towerLevels,
      playerCfg: sim.players[player],
      modifierHooks: hooks,
      attackMul: mul,
      ...skillArgs,
      seed: s + 1,
      dt: sim.dt,
      maxFloorSeconds: sim.maxFloorSeconds,
      summon,
      battleEffects,
      shotFlight: !!env.flight,
      emptySpawn: env.emptySpawn,
    });
    if (result.status === 'cleared') clears++;
    if (statsAcc && hooks) {
      statsAcc.onShot += hooks.stats.onShot;
      statsAcc.onHit += hooks.stats.onHit;
      statsAcc.extraDamage += hooks.stats.extraDamage;
    }
    if (statsAcc?.agg) addResult(statsAcc.agg, result);
  }
  return clears > env.seeds / 2;
}

// 그 층을 과반 시드로 깨는 최소 공격력 배율. 피해가 늘면 더 쉬워진다(단조)는 가정.
export function needPower(env, player, floorNumber, level, modList, statsAcc, skillArgs = env.skillArgsAt(floorNumber)) {
  if (clearsFloor(env, player, floorNumber, level, modList, POWER_LO, statsAcc, skillArgs)) return POWER_LO;
  if (!clearsFloor(env, player, floorNumber, level, modList, POWER_HI, statsAcc, skillArgs)) return null;
  let lo = POWER_LO;
  let hi = POWER_HI;
  for (let i = 0; i < BISECT_STEPS; i++) {
    const mid = (lo + hi) / 2;
    if (clearsFloor(env, player, floorNumber, level, modList, mid, statsAcc, skillArgs)) hi = mid;
    else lo = mid;
  }
  return Math.round(hi * 100) / 100;
}

export { PROBE_FLOOR_NUMBERS };

export async function run(env) {
  const { sim } = env.configs;
  const modNames = (env.mods ?? Object.keys(sim.modifiers)).filter(
    (name) => name !== 'none' && name !== '_doc' && sim.modifiers[name]
  );
  const probes = expectedTowerLevels(env.configs, PROBE_FLOOR_NUMBERS).filter((p) => p.floor >= env.floorsRange.from && p.floor <= env.floorsRange.to);
  const csvRows = [];
  const outOfRange = [];
  const equivByMod = new Map(); // modifier -> floor -> 배율 문자열
  const hookTotals = new Map(); // modifier -> { onShot, onHit, extraDamage }
  const baseByFloor = new Map();

  for (const player of env.players) {
    for (const { floor, expTowerLevel } of probes) {
      const base = needPower(env, player, floor, expTowerLevel, [], null);
      baseByFloor.set(`${player}|${floor}`, base);
      const needRange = sim.targets.bossNeedPower?.[player];
      if (needRange && (base == null || base < needRange[0] || base > needRange[1])) {
        outOfRange.push(`${base != null && base < needRange[0] ? '너무 쉬움' : '너무 어려움'}: T2 ${player} ${floor}층 보스 needPower ${base ?? '>3'} (기준 ${needRange[0]}~${needRange[1]})`);
      }
      csvRows.push({ player, floor, expTowerLevel, modifier: 'none', needPower: base ?? '>3', equivalentPowerMul: 1, hookOnShot: '', hookOnHit: '', hookExtraDamage: '' });

      for (const name of modNames) {
        const list = resolveModifierList(sim.modifiers, name);
        if (list.length === 0) continue;
        const statsAcc = { onShot: 0, onHit: 0, extraDamage: 0 };
        const withMod = needPower(env, player, floor, expTowerLevel, list, statsAcc);
        // 탐색용 배율은 probe 표시로 계측에서 빠지므로, 아래 숫자는 효과 자체의 발동 횟수다.
        const needsHit = list.some((m) => m.type !== 'dmgMul' && m.type !== 'burst');
        if (needsHit && statsAcc.onHit === 0) {
          outOfRange.push(`버그: T2 ${player} ${floor}층 ${name} - onHit 훅 발동 0회(효과가 아예 안 걸림)`);
        }
        const equiv = base != null && withMod != null ? Math.round((base / withMod) * 100) / 100 : null;
        // self-check: dmg+20%는 '공격력 x1.2' 그 자체이므로 등가 배율이 1.2 근처여야 한다.
        // 벗어나면 이분 탐색/훅 배선이 깨진 것이다(탐색 해상도 0.012 + 시드 노이즈로 ±15% 허용).
        if (name === 'dmg+20%' && equiv != null && Math.abs(equiv - 1.2) > 0.18) {
          outOfRange.push(`버그: T2 self-check 실패 - dmg+20%의 등가 배율이 x${equiv} (1.2 근처여야 함, ${player} ${floor}층)`);
        }

        if (!equivByMod.has(name)) equivByMod.set(name, new Map());
        equivByMod.get(name).set(`${player}|${floor}`, equiv != null ? `x${equiv.toFixed(2)}` : '-');
        const h = hookTotals.get(name) ?? { onShot: 0, onHit: 0, extraDamage: 0 };
        h.onShot += statsAcc.onShot;
        h.onHit += statsAcc.onHit;
        h.extraDamage += statsAcc.extraDamage;
        hookTotals.set(name, h);

        csvRows.push({
          player,
          floor,
          expTowerLevel,
          modifier: name,
          needPower: withMod ?? '>3',
          equivalentPowerMul: equiv ?? '',
          hookOnShot: statsAcc.onShot,
          hookOnHit: statsAcc.onHit,
          hookExtraDamage: Math.round(statsAcc.extraDamage),
        });
      }
    }
  }

  const colKeys = [];
  for (const player of env.players) for (const p of probes) colKeys.push(`${player}|${p.floor}`);
  const colLabels = colKeys.map((k) => (env.players.length > 1 ? k.replace('|', ' ') + '층' : k.split('|')[1] + '층'));

  const needRows = [['none(기준 needPower)', ...colKeys.map((k) => String(baseByFloor.get(k) ?? '>3'))]];
  for (const [name, byFloor] of equivByMod) needRows.push([name, ...colKeys.map((k) => byFloor.get(k) ?? '-')]);

  const hookRows = [...hookTotals].map(([name, h]) => [name, h.onShot, h.onHit, Math.round(h.extraDamage)]);

  const summaryMd =
    `## T2 효과별 등가 전력 (고정 보스층, 탑 레벨 = floors.csv expTowerLevel)\n` +
    mdTable(['효과', ...colLabels], needRows) +
    `\n\n### 훅 발동 횟수 (탐색 전체 합계, 탐색용 배율 제외)\n` +
    mdTable(['효과', 'onShot', 'onHit', '추가 피해 합계'], hookRows);

  return { csvRows, summaryMd, outOfRange };
}
