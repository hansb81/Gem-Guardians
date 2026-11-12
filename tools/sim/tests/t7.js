// T7. 운의 폭: 같은 보스층·같은 탑 레벨을 시드 60개(31~90, 기준 레벨용 T4 진행의 1~10과 겹치지 않음)로 돌려
// 평균이 아니라 분포(승률, 시간·성벽 P10/P50/P90, 연쇄·특수 잼 수)를 본다. 기준(sim.json targets.luck)을
// 벗어나도 수치는 바꾸지 않고 표시만 한다.
// 기준 레벨(v12-7): normal·slow 모두 T4 even 진행(--towerbuy 그대로, 시드 1..10 고정)의 그 보스층 진입 레벨 중앙값 + 그때 스킬 레벨 중앙값.
// 평균·가변 시드 수였을 때는 시드 수에 따라 2~3레벨 흔들렸다(v12-6). expTowerLevel은 참고.
// 판정: 범위 안 = 통과, 범위 밖이지만 5%p 안 = 통과(경계), 그 밖 = 실패. 승률 옆 ± = 표준 오차 sqrt(p(1-p)/n).
// 열: 기준 / +2 / +4 / 아이템(기준 레벨 + boss 정책 아이템을 층당 최대로 채워 장착).
import { runFloorAttempt } from '../floorSim.js';
import { mdTable } from '../report.js';
import { expectedTowerLevels, PROBE_FLOOR_NUMBERS } from './t2.js';
import { runOneProgression, median } from './t4.js';
import { SLOT4_ITEM } from '../itemBot.js';

// 시드(seedFrom부터 seeds개)·기준 레벨용 T4 시드 수(baseSeeds, --seeds와 무관하게 고정)·경계 폭(borderline)은 sim.json targets.luck에서 읽는다.
// 범위 밖으로 벗어난 정도로 판정한다(1e-9 = 승률이 n/60이라 생기는 부동소수 오차).
export function verdict(winRate, range, border) {
  const out = Math.max(range[0] - winRate, winRate - range[1], 0);
  return out === 0 ? '통과' : out <= border + 1e-9 ? '통과(경계)' : '실패';
}
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

// 기준 레벨 = 그 플레이어의 T4 even 진행에서 그 보스층을 깰 때의 진입 탑 레벨(5개 탑 평균)의 시드 중앙값(시드 1..10, 반올림) +
// 그때의 스킬 레벨(시드 중앙값 반올림, --skillbuy 그대로). expTowerLevel은 참고 열로만 남긴다.
function entryLevels(env, player, floors, baseSeeds) {
  const runs = Array.from({ length: baseSeeds }, (_, s) => runOneProgression(env, player, 'even', s + 1));
  return new Map(
    floors.map((f) => {
      const recs = runs.map((r) => r.retriesByFloor.find((x) => x.floor === f)).filter(Boolean);
      const lv = Math.round(median(recs.map((x) => x.avgLevelAtEntry)) ?? 1);
      let skillLv;
      if (recs[0]?.skillLvAtEntry) {
        skillLv = {};
        for (const id of Object.keys(recs[0].skillLvAtEntry)) skillLv[id] = Math.round(median(recs.map((x) => x.skillLvAtEntry[id])));
      }
      return [f, { lv, skillLv, reached: recs.length }];
    })
  );
}

export async function run(env) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon, items: itemsCfg } = env.configs;
  const target = sim.targets.luck;
  const SEEDS = Array.from({ length: target.seeds }, (_, i) => target.seedFrom + i);
  const BASE_SEEDS = target.baseSeeds;
  const BORDER = target.borderline;
  const players = env.players.filter((p) => PLAYERS.includes(p));
  const probes = expectedTowerLevels(env.configs, PROBE_FLOOR_NUMBERS).filter((p) => p.floor >= env.floorsRange.from && p.floor <= env.floorsRange.to);
  const csvRows = [];
  const outOfRange = [];
  const winCell = new Map(); // `${player}|${floor}|${col}` -> 문자열
  const baseLevel = new Map(); // `${player}|${floor}` -> 레벨
  const detailRows = [];

  for (const player of players) {
    const entry = entryLevels(env, player, probes.map((p) => p.floor), BASE_SEEDS);
    for (const { floor, expTowerLevel } of probes) {
      const ent = entry.get(floor);
      const base = ent.reached ? ent.lv : expTowerLevel; // 진행이 그 층에 못 가면 기대 레벨로 대신(표에 표시)
      baseLevel.set(`${player}|${floor}`, ent.reached ? `${base} (exp ${expTowerLevel})` : `${base}* (exp)`);
      for (const col of COLUMNS) {
        const level = base + col.off;
        const runs = SEEDS.map((seed) => {
          const r = runFloorAttempt({
            balance, enemies, obstacles, obstaclesEnabled: true, floorsData, floorNumber: floor,
            towerLevels: [level, level, level, level, level], playerCfg: sim.players[player], modifierHooks: null,
            ...env.skillArgsAt(floor, ent.skillLv), itemBot: col.items ? itemBotFor(itemsCfg, floor) : null,
            seed, dt: sim.dt, maxFloorSeconds: sim.maxFloorSeconds, summon, battleEffects, shotFlight: !!env.flight, emptySpawn: env.emptySpawn,
          });
          const casc = r.stats.cascadeSamples;
          const topRole = Object.entries(r.wallDamageByRole).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '-';
          return { win: r.status === 'cleared', time: r.timeSec, wall: r.wallHealthPct, cascade: mean(casc) ?? 0, specials: r.stats.specialsCreated, topRole, bossAlive: !r.bossKilled };
        });
        const wins = runs.filter((r) => r.win);
        const losses = runs.filter((r) => !r.win);
        const winRate = wins.length / runs.length;
        const se = Math.sqrt((winRate * (1 - winRate)) / runs.length);
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
        const v = range ? verdict(winRate, range, BORDER) : '';
        if (range && v !== '통과') {
          flag = v === '실패' ? (winRate < range[0] ? '↓' : '↑') : '(경계)';
          outOfRange.push(`운의 폭${v === '실패' ? '' : '(경계, 통과로 침)'}: T7 ${player} ${floor}층 ${tag} 승률 ${(winRate * 100).toFixed(0)}% ±${(se * 100).toFixed(0)} (기준 ${range[0] * 100}~${range[1] * 100}%)`);
        }
        const lucky = target.luckyFloorBelow?.[player];
        if (col.key === '4' && lucky != null && winRate < lucky) {
          flag += '⚠';
          outOfRange.push(`운이 너무 큰 층: T7 ${player} ${floor}층 ${tag}에서도 승률 ${(winRate * 100).toFixed(0)}% (< ${lucky * 100}%)`);
        }
        if (spread != null && spread > target.timeSpreadMax) {
          outOfRange.push(`운의 폭: T7 ${player} ${floor}층 ${tag} 클리어 시간 P90/P10 ${spread.toFixed(2)} (기준 ≤ ${target.timeSpreadMax})`);
        }
        winCell.set(`${player}|${floor}|${col.key}`, `${(winRate * 100).toFixed(0)}% ±${(se * 100).toFixed(0)}${flag}`);
        detailRows.push([
          player, `${floor}층`, tag, `${(winRate * 100).toFixed(0)}%`,
          p3(wins.map((r) => r.time)), spread == null ? '-' : spread.toFixed(2),
          p3(runs.map((r) => r.wall * 100), (v) => (v == null ? '-' : v.toFixed(0))),
          p3(runs.map((r) => r.cascade), (v) => (v == null ? '-' : v.toFixed(2))),
          p3(runs.map((r) => r.specials), (v) => (v == null ? '-' : String(v))),
          `${f1(spW)} / ${f1(spL)}`, cause,
        ]);
        csvRows.push({
          player, floor, level, expTowerLevel, skillLv: ent.skillLv ? Object.values(ent.skillLv).join('/') : '', column: col.key, winRate: winRate.toFixed(3), se: se.toFixed(3), n: runs.length, verdict: v,
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
    `## T7 운의 폭 (보스층, 시드 ${SEEDS[0]}~${SEEDS.at(-1)}(${SEEDS.length}개), 기준 Lv = T4 even(탑 구매 ${env.towerBuy ?? 'always'}, 시드 1~${BASE_SEEDS}) 진입 레벨 중앙값 + 그때 스킬 Lv 중앙값, 괄호 = expTowerLevel 참고)\n` +
    `기준: ${crit} (normal 10층 기준 ${fmtR(target.floorOverride.normal['10']['0'])}) / 클리어 시간 P90/P10 ≤ ${target.timeSpreadMax}. ` +
    `아이템 = 기준 Lv + boss 정책 아이템(기본 장착 3개, 20층 이후 모래시계, 층당 최대). ± = 표준 오차(%p). 판정: 표시 없음 = 통과, (경계) = 범위 밖이지만 ${BORDER * 100}%p 안(통과로 침), ↓↑ = 실패, ⚠ = +4에서도 기준 미만(운이 너무 큰 층). 수치는 바꾸지 않고 표시만.\n\n` +
    mdTable(matrixHead, matrix) +
    `\n\n### T7 분포 (시간 = 이긴 판, P10 / P50 / P90)\n` +
    mdTable(['플레이어', '층', '열(레벨)', '승률', '클리어 시간(초)', 'P90/P10', '남은 성벽 %', '판당 평균 연쇄', '특수 잼 생성', '특수 잼 이김/짐', '진 판 원인'], detailRows);

  return { csvRows, summaryMd, outOfRange };
}
