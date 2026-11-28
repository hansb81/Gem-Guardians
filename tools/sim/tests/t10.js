// T10(v13-sw). 벽 층(소프트 벽) 구매 가치. all에는 안 넣음: node tools/sim/run.js --test=t10 --player=normal,slow [--wallfloors=30,60,90]
// 구매(kind): none | continue(패배 직후 이어하기 1회 - 광고·깃털이 같은 효과) | pack(보스 돌파 팩 아이템, products.json pack.boss grant.items)
//            | exchange(골드 교환 small 1회 = R x goldExchange[0].floors 골드로 탑 레벨업).
// T7 부분: 기준 Lv = T7과 같은 T4 even 진입 Lv 중앙값(시드 1..baseSeeds), 시드 targets.luck(31-90). pack = 팩 하단 아이템 장착(층당 한도까지) + 깃털 1(도전당 1회).
// T4 부분: runOneProgression(wallBuy) 시드 1..--seeds, 그 층에서 처음 진 순간 한 번 구매(팩은 다음 도전부터, 남으면 버림). 벽 층 재도전을 none과 비교.
import { runFloorAttempt } from '../floorSim.js';
import { runOneProgression } from './t4.js';
import { entryLevels } from './t7.js';
import { mdTable } from '../report.js';
import { evenTowerLevelUps, normalFloorReward } from '../../../src/core/economy/economy.js';

export const KINDS = ['none', 'continue', 'pack', 'exchange'];
const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

export async function run(env) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon, items: itemsCfg, products, shop } = env.configs;
  const walls = env.wallFloors ?? [30, 60, 90];
  const L = sim.targets.luck;
  const SEEDS = Array.from({ length: L.seeds }, (_, i) => L.seedFrom + i);
  const packItems = products['pack.boss'].grant.items;
  const exMul = shop.goldExchange[0].floors;
  const csvRows = [];
  const md = [];
  for (const player of env.players) {
    const entry = entryLevels(env, player, walls, L.baseSeeds);
    // T4: 진행 시드마다 kind별로 다시 돌린다.
    const prog = {};
    for (const kind of KINDS) {
      prog[kind] = Array.from({ length: env.seeds }, (_, s) => runOneProgression(env, player, 'even', s + 1, { wallBuy: kind === 'none' ? null : { kind, floors: walls } }));
    }
    const rows = [];
    for (const floor of walls) {
      const ent = entry.get(floor);
      const lv = ent.lv;
      const R = normalFloorReward(env.configs, floor);
      const exLevels = evenTowerLevelUps(balance, [lv, lv, lv, lv, lv], Math.round(exMul * R));
      const base = { balance, enemies, obstacles, obstaclesEnabled: true, floorsData, floorNumber: floor, playerCfg: sim.players[player], modifierHooks: null,
        ...env.skillArgsAt(floor, ent.skillLv), dt: sim.dt, maxFloorSeconds: sim.maxFloorSeconds, summon, battleEffects, shotFlight: !!env.flight, emptySpawn: env.emptySpawn,
        spiritSlots: ent.spirits, reviveCfg: itemsCfg.items.revive };
      const win = {};
      for (const kind of KINDS) {
        const wins = SEEDS.map((seed) => {
          const r = runFloorAttempt({
            ...base, seed,
            towerLevels: kind === 'exchange' ? exLevels.levels : [lv, lv, lv, lv, lv],
            itemBot: kind === 'pack' ? { config: itemsCfg, inventory: { ...packItems }, equipped: Object.keys(packItems).filter((id) => itemsCfg.items[id].group === 'hotbar') } : null,
            onFail: kind === 'continue' ? () => 'ad' : kind === 'pack' && packItems.revive > 0 ? () => 'feather' : null,
          });
          return r.status === 'cleared';
        }).filter(Boolean).length;
        win[kind] = wins / SEEDS.length;
      }
      for (const kind of KINDS) {
        const recs = prog[kind].map((r) => r.retriesByFloor.find((x) => x.floor === floor));
        const retries = recs.map((x) => (x ? x.retries : NaN));
        const stopped = prog[kind].filter((r) => r.stoppedEarly && r.stoppedFloor === floor).length;
        const row = {
          player, floor, kind, level: lv, exGold: Math.round(exMul * R), exLevels: exLevels.count,
          winRate: win[kind].toFixed(3), winDelta: ((win[kind] - win.none) * 100).toFixed(1),
          retriesMean: mean(retries).toFixed(2), retriesSaved: (mean(prog.none.map((r) => r.retriesByFloor.find((x) => x.floor === floor)?.retries ?? NaN)) - mean(retries)).toFixed(2),
          retriesBySeed: retries.join('/'), stopped, minutesTo100: mean(prog[kind].map((r) => r.cumulativeTimeMin)).toFixed(1),
        };
        csvRows.push(row);
        rows.push([player, `${floor}층`, kind, `Lv${lv}${kind === 'exchange' ? ` (+${exLevels.count}레벨, ${row.exGold}골드)` : ''}`, `${(win[kind] * 100).toFixed(0)}%`, kind === 'none' ? '-' : `${row.winDelta}%p`, row.retriesMean, kind === 'none' ? '-' : row.retriesSaved, row.retriesBySeed, stopped]);
        console.log(`t10 ${player} ${floor}층 ${kind}: 승률 ${(win[kind] * 100).toFixed(0)}% 재도전 ${row.retriesMean}`);
      }
    }
    md.push(mdTable(['플레이어', '층', '구매', 'T7 기준 Lv', 'T7 승률', '승률 차', 'T4 재도전 평균', '아낀 재도전', '시드별 재도전', '50연패 정지'], rows));
  }
  const summaryMd = `## T10 벽 층 구매 가치 (v13-sw, 벽 층 ${walls.join('·')}, T7 시드 ${SEEDS[0]}-${SEEDS.at(-1)}, T4 시드 1-${env.seeds})\n` +
    `continue = 패배 직후 이어하기 1회(광고·깃털 같은 효과), pack = 보스 돌파 팩 아이템(${Object.entries(packItems).map(([k, n]) => `${k} ${n}`).join(', ')}), exchange = 골드 교환 small 1회(R x ${exMul}). T4는 그 층에서 처음 진 순간 한 번 구매.\n\n` + md.join('\n\n');
  return { csvRows, summaryMd, outOfRange: [] };
}
