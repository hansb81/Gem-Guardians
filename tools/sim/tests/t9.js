// T9(v13-6). 아이템 하나씩 쓸모 측정. all에는 안 넣음: node tools/sim/run.js --test=t9 --player=normal,slow [--itemset=none,scythe_h,...]
// 기준 = 아이템 없음. 각 세트는 그 아이템만 장착(시작 부스터는 매 층 예약, 황금 주화·깃털은 매 도전 공짜 = 상한).
// T7 부분: 1-100층 보스층(범위 안), 기준 Lv = T7과 같은 T4 even 진입 Lv 중앙값(시드 1..baseSeeds), 시드 targets.luck(31-90), 하단 아이템은 층당 한도까지 채움.
// T4 부분: runOneProgression(itemSet) 시드 1..--seeds. 실행 규칙은 게임 ItemController, 사용 시점은 tools/sim/itemBot.js.
import { runFloorAttempt } from '../floorSim.js';
import { runOneProgression } from './t4.js';
import { entryLevels } from './t7.js';
import { mdTable } from '../report.js';

const BUNDLE = ['scythe_h', 'hammer', 'repair', 'hourglass'];
export const ITEM_SETS = {
  none: [], scythe_h: ['scythe_h'], hammer: ['hammer'], repair: ['repair'], hourglass: ['hourglass'],
  dye: ['dye'], shuffle: ['shuffle'], glove: ['glove'], rainbow: ['rainbow'], barrier: ['barrier'], drum: ['drum'],
  booster_line: ['booster_line'], booster_bomb: ['booster_bomb'], gold_coin: ['gold_coin'], revive: ['revive'], bundle4: BUNDLE,
};
const T7_SKIP = new Set(['gold_coin']); // 경제 효과만

const mean = (a) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN);

export async function run(env) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon, items: itemsCfg } = env.configs;
  const sets = (env.itemSets ?? Object.keys(ITEM_SETS)).filter((k) => ITEM_SETS[k]);
  const L = sim.targets.luck;
  const SEEDS = Array.from({ length: L.seeds }, (_, i) => L.seedFrom + i);
  const every = balance.floorShape.bossEvery;
  const bossFloors = [];
  for (let f = every; f <= Math.min(100, env.floorsRange.to); f += every) if (f >= env.floorsRange.from) bossFloors.push(f);
  const csvRows = [];
  const md = [];
  for (const player of env.players) {
    const entry = entryLevels(env, player, bossFloors, L.baseSeeds);
    for (const name of sets) {
      const set = ITEM_SETS[name];
      const hot = set.filter((id) => itemsCfg.items[id].group === 'hotbar');
      const starter = set.filter((id) => itemsCfg.items[id].action === 'starterSpecials').map((id) => ({ special: itemsCfg.items[id].special, count: itemsCfg.items[id].count }));
      const feather = set.includes('revive');
      // T7
      const t7 = {};
      if (!T7_SKIP.has(name)) {
        for (const floor of bossFloors) {
          const ent = entry.get(floor);
          if (!ent?.reached) continue;
          const lv = ent.lv;
          let wins = 0;
          for (const seed of SEEDS) {
            const inventory = Object.fromEntries(hot.map((id) => [id, itemsCfg.items[id].perFloor ?? 1]));
            const r = runFloorAttempt({
              balance, enemies, obstacles, obstaclesEnabled: true, floorsData, floorNumber: floor, towerLevels: [lv, lv, lv, lv, lv], playerCfg: sim.players[player], modifierHooks: null,
              ...env.skillArgsAt(floor, ent.skillLv), itemBot: hot.length ? { config: itemsCfg, inventory, equipped: hot } : null,
              onFail: feather ? () => 'feather' : null, reviveCfg: itemsCfg.items.revive, starterSpecials: starter.length ? starter : null,
              seed, dt: sim.dt, maxFloorSeconds: sim.maxFloorSeconds, summon, battleEffects, shotFlight: !!env.flight, emptySpawn: env.emptySpawn, spiritSlots: ent.spirits,
            });
            if (r.status === 'cleared') wins++;
          }
          t7[floor] = wins / SEEDS.length;
        }
      }
      // T4
      const runs = Array.from({ length: env.seeds }, (_, s) => runOneProgression(env, player, 'even', s + 1, name === 'none' ? {} : { itemSet: set }));
      const boss = runs.flatMap((r) => r.retriesByFloor.filter((x) => x.tag === 'boss').map((x) => x.retries));
      const earned = runs.reduce((t, r) => t + r.goldEarned, 0);
      const st = (k, id) => runs.reduce((t, r) => t + (r.itemStat[k][id] ?? 0), 0);
      const attempts = runs.reduce((t, r) => t + r.itemStat.attempts, 0);
      const ids = [...hot, ...set.filter((id) => !hot.includes(id))];
      const costR = ids.reduce((t, id) => t + st('bought', id) * (itemsCfg.items[id].goldBase ?? 0), 0) / Math.max(1, attempts); // 도전당 구매 비용(R)
      const row = {
        player, set: name, t7Avg: Number.isFinite(mean(Object.values(t7))) ? mean(Object.values(t7)).toFixed(4) : '',
        ...Object.fromEntries(bossFloors.map((f) => [`t7_${f}`, t7[f] != null ? t7[f].toFixed(3) : ''])),
        bossRetries: mean(boss).toFixed(3), minutesTo100: mean(runs.map((r) => r.cumulativeTimeMin)).toFixed(2), reached: mean(runs.map((r) => r.reachedFloor)).toFixed(1),
        itemGoldShare: (runs.reduce((t, r) => t + r.goldSpentItems, 0) / Math.max(1, earned)).toFixed(4), goldEarned: Math.round(earned / runs.length), costRPerAttempt: costR.toFixed(3),
        usesPerAttempt: hot.map((id) => (st('uses', id) / Math.max(1, attempts)).toFixed(3)).join('/'), usableAttempts: hot.map((id) => st('usable', id)).join('/'),
        unusedPct: hot.map((id) => (st('usable', id) ? (st('unused', id) / st('usable', id)).toFixed(3) : '')).join('/'),
        revivesPerAttempt: feather ? (runs.reduce((t, r) => t + r.itemStat.revives, 0) / Math.max(1, attempts)).toFixed(3) : '', attempts,
      };
      csvRows.push(row);
      console.log(`t9 ${player} ${name}: T7 ${row.t7Avg} 보스 ${row.bossRetries} 100층 ${row.minutesTo100}분 골드 ${row.itemGoldShare}`);
    }
  }
  md.push(`## T9 아이템 하나씩 (T7 보스층 ${bossFloors.join('·')} 시드 ${SEEDS[0]}-${SEEDS.at(-1)}, T4 시드 1-${env.seeds})\n${mdTable(['플레이어', '세트', 'T7 평균', '보스 재도전', '100층(분)', '아이템 골드 몫', '도전당 비용(R)', '도전당 사용', '쓸 수 있었는데 안 쓴 비율'], csvRows.map((r) => [r.player, r.set, r.t7Avg, r.bossRetries, r.minutesTo100, r.itemGoldShare, r.costRPerAttempt, r.usesPerAttempt, r.unusedPct]))}`);
  return { csvRows, summaryMd: md.join('\n\n'), outOfRange: [] };
}
