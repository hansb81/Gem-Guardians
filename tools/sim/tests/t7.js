// T7. 운의 폭: 같은 보스층·같은 탑 레벨을 시드 30개(31~60, 다른 테스트의 1~N과 겹치지 않음)로 돌려
// 평균이 아니라 분포(승률, 시간·성벽 P10/P50/P90, 연쇄·특수 잼 수)를 본다. 기준(sim.json targets.luck)을
// 벗어나도 수치는 바꾸지 않고 표시만 한다.
// 기준 레벨: normal = expTowerLevel(T2와 같음), slow = T4 even 진행의 그 보스층 진입 평균 레벨(시드 1..N).
// 열: 기준 / +2 / +4 / 아이템(기준 레벨 + boss 정책 아이템을 층당 최대로 채워 장착).
import { runFloorAttempt } from '../floorSim.js';
import { mdTable } from '../report.js';
import { expectedTowerLevels, PROBE_FLOOR_NUMBERS } from './t2.js';
import { runOneProgression } from './t4.js';
import { SLOT4_ITEM } from '../itemBot.js';

const SEEDS = Array.from({ length: 30 }, (_, i) => 31 + i);
const COLUMNS = [
  { key: '0', off: 0, items: false },
  { key: '2', off: 2, items: false },
  { key: '4', off: 4, items: false },
  { key: 'items', off: 0, items: true },
];
const PLAYERS = ['normal', 'slow'];

function pct(sorted, p) {
  return sorted.length ? sorted[Math.round(p * (sorted.length - 1))] : null;
}
const sortNum = (a) => [...a].sort((x, y) => x - y);
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
const f1 = (v) => (v == null ? '-' : v.toFixed(1));
const p3 = (a, fmt = f1) => {
  const s = sortNum(a);
  return `${fmt(pct(s, 0.1))} / ${fmt(pct(s, 0.5))} / ${fmt(pct(s, 0.9))}`;
};
const colName = (c) => (c.items ? '아이템' : c.off === 0 ? '기준' : `+${c.off}`);

// boss 정책 아이템 봇: 기본 장착 3개 + (20층 보스를 깬 뒤) 모래시계, 각각 층당 최대(망치는 1개).
function itemBotFor(itemsCfg, floor) {
  const equipped = itemsCfg.starter.equipped.slice();
  if (floor > itemsCfg.slots.unlock4BossFirstClear) equipped.push(SLOT4_ITEM);
  const inventory = Object.fromEntries(equipped.map((id) => [id, itemsCfg.items[id].perFloor ?? 1]));
  return { config: itemsCfg, inventory, equipped };
}

// slow 기준 레벨 = T4 even 진행에서 그 보스층을 깰 때의 진입 평균 레벨(T4 표의 "진입 시 평균 Lv"와 같은 값).
function slowEntryLevels(env, floors) {
  const runs = Array.from({ length: env.seeds }, (_, s) => runOneProgression(env, 'slow', 'even', s + 1));
  return new Map(
    floors.map((f) => {
      const lv = runs.map((r) => r.retriesByFloor.find((x) => x.floor === f)?.avgLevelAtEntry).filter((v) => v != null);
      return [f, Math.round(mean(lv))];
    })
  );
}

export async function run(env) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon, items: itemsCfg } = env.configs;
  const target = sim.targets.luck;
  const players = env.players.filter((p) => PLAYERS.includes(p));
  const probes = expectedTowerLevels(env.configs, PROBE_FLOOR_NUMBERS).filter((p) => p.floor >= env.floorsRange.from && p.floor <= env.floorsRange.to);
  const csvRows = [];
  const outOfRange = [];
  const winCell = new Map(); // `${player}|${floor}|${col}` -> 문자열
  const baseLevel = new Map(); // `${player}|${floor}` -> 레벨
  const detailRows = [];

  for (const player of players) {
    const slowLv = player === 'slow' ? slowEntryLevels(env, probes.map((p) => p.floor)) : null;
    for (const { floor, expTowerLevel } of probes) {
      const base = slowLv ? slowLv.get(floor) : expTowerLevel;
      baseLevel.set(`${player}|${floor}`, base);
      for (const col of COLUMNS) {
        const level = base + col.off;
        const runs = SEEDS.map((seed) => {
          const r = runFloorAttempt({
            balance, enemies, obstacles, obstaclesEnabled: true, floorsData, floorNumber: floor,
            towerLevels: [level, level, level, level, level], playerCfg: sim.players[player], modifierHooks: null,
            ...env.skillArgsAt(floor), itemBot: col.items ? itemBotFor(itemsCfg, floor) : null,
            seed, dt: sim.dt, maxFloorSeconds: sim.maxFloorSeconds, summon, battleEffects,
          });
          const casc = r.stats.cascadeSamples;
          const topRole = Object.entries(r.wallDamageByRole).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
          return { win: r.status === 'cleared', time: r.timeSec, wall: r.wallHealthPct, cascade: mean(casc) ?? 0, specials: r.stats.specialsCreated, topRole, bossAlive: !r.bossKilled };
        });
        const wins = runs.filter((r) => r.win);
        const losses = runs.filter((r) => !r.win);
        const winRate = wins.length / runs.length;
        const times = sortNum(wins.map((r) => r.time));
        const spread = times.length >= 2 && pct(times, 0.1) > 0 ? pct(times, 0.9) / pct(times, 0.1) : null;
        const roles = {};
        for (const r of losses) roles[r.topRole] = (roles[r.topRole] ?? 0) + 1;
        const cause = losses.length
          ? `보스 생존 ${losses.filter((r) => r.bossAlive).length}/${losses.length}, 성벽 피해 1위 ${Object.entries(roles).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`
          : '-';
        const spW = mean(wins.map((r) => r.specials));
        const spL = mean(losses.map((r) => r.specials));

        const tag = `${colName(col)}(Lv${level})`;
        const range = target.floorOverride?.[player]?.[floor]?.[col.key] ?? target.winRate?.[player]?.[col.key];
        let flag = '';
        if (range && (winRate < range[0] || winRate > range[1])) {
          flag = winRate < range[0] ? '↓' : '↑';
          outOfRange.push(`운의 폭: T7 ${player} ${floor}층 ${tag} 승률 ${(winRate * 100).toFixed(0)}% (기준 ${range[0] * 100}~${range[1] * 100}%)`);
        }
        const lucky = target.luckyFloorBelow?.[player];
        if (col.key === '4' && lucky != null && winRate < lucky) {
          flag += '⚠';
          outOfRange.push(`운이 너무 큰 층: T7 ${player} ${floor}층 ${tag}에서도 승률 ${(winRate * 100).toFixed(0)}% (< ${lucky * 100}%)`);
        }
        if (spread != null && spread > target.timeSpreadMax) {
          outOfRange.push(`운의 폭: T7 ${player} ${floor}층 ${tag} 클리어 시간 P90/P10 ${spread.toFixed(2)} (기준 ≤ ${target.timeSpreadMax})`);
        }
        winCell.set(`${player}|${floor}|${col.key}`, `${(winRate * 100).toFixed(0)}%${flag}`);
        detailRows.push([
          player, `${floor}층`, tag, `${(winRate * 100).toFixed(0)}%`,
          p3(wins.map((r) => r.time)), spread == null ? '-' : spread.toFixed(2),
          p3(runs.map((r) => r.wall * 100), (v) => (v == null ? '-' : v.toFixed(0))),
          p3(runs.map((r) => r.cascade), (v) => (v == null ? '-' : v.toFixed(2))),
          p3(runs.map((r) => r.specials), (v) => (v == null ? '-' : String(v))),
          `${f1(spW)} / ${f1(spL)}`, cause,
        ]);
        csvRows.push({
          player, floor, level, column: col.key, winRate: winRate.toFixed(3),
          timeP10: f1(pct(times, 0.1)), timeP50: f1(pct(times, 0.5)), timeP90: f1(pct(times, 0.9)), timeSpread: spread?.toFixed(2) ?? '',
          specialsWin: f1(spW), specialsLoss: f1(spL), lossCause: cause,
        });
        console.log(`t7 ${player} ${floor}층 ${tag}: ${(winRate * 100).toFixed(0)}%`);
      }
    }
  }

  const fmtR = (r) => (r[1] >= 1 ? `≥ ${r[0] * 100}%` : `${r[0] * 100}~${r[1] * 100}%`);
  const crit = players
    .map((p) => `${p}: ${Object.entries(target.winRate[p] ?? {}).map(([k, r]) => `${colName(COLUMNS.find((c) => c.key === k))} ${fmtR(r)}`).join(', ')}`)
    .join(' / ');
  const matrixHead = ['보스층', ...players.flatMap((p) => [`${p} 기준 Lv`, ...COLUMNS.map((c) => `${p} ${colName(c)}`)])];
  const matrix = probes.map(({ floor }) => [
    `${floor}층`,
    ...players.flatMap((p) => [String(baseLevel.get(`${p}|${floor}`)), ...COLUMNS.map((c) => winCell.get(`${p}|${floor}|${c.key}`) ?? '-')]),
  ]);
  const summaryMd =
    `## T7 운의 폭 (보스층, 시드 31~60, 기준 Lv: normal = 기대 레벨, slow = T4 even 진입 평균 레벨)\n` +
    `기준: ${crit} (normal 10층 기준 ${fmtR(target.floorOverride.normal['10']['0'])}) / 클리어 시간 P90/P10 ≤ ${target.timeSpreadMax}. ` +
    `아이템 = 기준 Lv + boss 정책 아이템(기본 장착 3개, 20층 이후 모래시계, 층당 최대). ↓↑ = 기준 밖, ⚠ = +4에서도 기준 미만(운이 너무 큰 층). 수치는 바꾸지 않고 표시만.\n\n` +
    mdTable(matrixHead, matrix) +
    `\n\n### T7 분포 (시간 = 이긴 판, P10 / P50 / P90)\n` +
    mdTable(['플레이어', '층', '열(레벨)', '승률', '클리어 시간(초)', 'P90/P10', '남은 성벽 %', '판당 평균 연쇄', '특수 잼 생성', '특수 잼 이김/짐', '진 판 원인'], detailRows);

  return { csvRows, summaryMd, outOfRange };
}
