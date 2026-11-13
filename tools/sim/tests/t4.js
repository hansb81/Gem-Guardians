// T4. 레벨업에 필요한 재화(진행 시뮬레이션, docs/simulation.md 2장). 1층부터 실제 진행처럼:
// 도전 -> 실패하면 가진 골드로 레벨업(even/byUse/none) -> 재도전 -> 클리어하면 다음 층.
// 보스층에서 지면(none 제외) 이전 층을 sim.bossFailFarmRuns회(기본 1) 반복 사냥(다시 깬 클리어 보상 x replayClearMul)한 뒤 재도전.
// 100층 또는 "같은 층 10연패"(안전판 - wallFlag=4보다 훨씬 큰 완전 정지 기준)까지.
// env.towerBuy(--towerbuy): always(기본) = 층이 끝날 때마다(성공·실패) 스킬 구매 뒤 남은 골드로 탑을 올린다.
// onfail = 실패했을 때만 탑을 올린다(v12-6까지의 방식, 참고용 - 실패가 적으면 골드를 쌓아 둔 채 낮은 레벨로 올라간다).
import { runFloorAttempt } from '../floorSim.js';
import { clearBonus, towerLevelCost, maxTowerLevelUps } from '../../../src/core/economy/economy.js';
import { GEM_TYPES } from '../../../src/config/gems.js';
import { getFloor } from '../../../src/core/balance/floorGen.js';
import { createRng } from '../../../src/core/rng.js';
import { mdTable } from '../report.js';
import { newAgg, addResult, aggRow, aggTable } from '../agg.js';
import { buyItems, SLOT4_ITEM } from '../itemBot.js';
import { openUnlocks, skillLevelCards, skillMaxLevel } from '../skills.js';
import { defaultShopSave } from '../../../src/core/shop/shop.js';
import { combo, comboGold } from '../combo.js';

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
  const unlockShareAt = {}; // 기술 id -> 해금가 / 그 시점 누적 수입
  let goldSpentUnlock = 0;
  let goldSpentSkills = 0;
  // S4 골드 흐름 + S6 허공 사격·칸 잠금 계측, 10층 구간별(구간 = 그 시도의 층).
  const flow = [];
  const comboByTag = { normal: 0, elite: 0, boss: 0 }; // --combogold 보너스(측정 전용) 층 종류별 합
  const bucketOf = (f) => (flow[Math.floor((f - 1) / 10)] ??= {
    first: 0, replay: 0, fail: 0, exchange: 0, combo: 0, tower: 0, skill: 0, unlock: 0, item: 0,
    hit: 0, wasteBasic: 0, wasteSkill: 0, wasteFlight: 0, wasteFlightDoomed: 0, wasteSummon: 0, ovBasic: 0, ovSkill: 0, ovOther: 0, firstEnemySec: 0, attempts: 0, swapsBeforeEnemy: 0, emptySec: 0, timeSec: 0, swaps: 0, noMove: 0, swapsAnim: 0, clears: 0, wallLeft: 0, emptySpawns: 0, aliveSec: 0,
  });
  const attemptLog = []; // 시도마다 { floor, cleared, wall, aliveMax, timeSec, farm } - 하위 10% 성벽·동시 적 최대·층 시간용
  const track = (f, r, farm = false) => {
    const b = bucketOf(f);
    attemptLog.push({ floor: f, cleared: r.status === 'cleared', wall: r.wallHealthPct, aliveMax: r.aliveMax, timeSec: r.timeSec, farm });
    b.aliveSec += r.aliveSec;
    b.hit += Object.values(r.damageBySource).reduce((a, v) => a + v, 0);
    b.wasteBasic += r.waste.basic;
    b.wasteSkill += r.waste.skill;
    b.wasteFlight += r.waste.flight;
    b.wasteFlightDoomed += r.waste.flightDoomed;
    b.wasteSummon += r.waste.summon;
    b.ovBasic += r.waste.overkill.basic;
    b.ovSkill += r.waste.overkill.skill;
    b.ovOther += r.waste.overkill.splash + r.waste.overkill.poison;
    b.firstEnemySec += r.firstEnemySec;
    b.attempts++;
    b.swapsBeforeEnemy += r.swapsBeforeFirstEnemy;
    b.emptySec += r.emptyFieldSec;
    b.timeSec += r.timeSec;
    b.swaps += r.swapCount;
    b.noMove += r.noMoveTicks;
    b.swapsAnim += r.swapsDuringAnim;
    b.emptySpawns += r.emptySpawns;
    if (r.status === 'cleared') {
      b.clears++;
      b.wallLeft += r.wallHealthPct;
    }
  };
  // S3 다이아·광고: 하루 = minutesPerDay분 플레이. f2p = 출석 다이아(config/attendance.json 7일 반복)로 보스 패배 때 깃털.
  const f2p = env.dia === 'f2p';
  const adsOn = env.ads === 'on';
  const reviveCfg = itemsCfg.items.revive;
  const dia = { earned: 0, spent: 0, feathersUsed: 0, feathersBought: 0, adsUsed: 0, have: 0, feathers: f2p ? reviveCfg.starterCount ?? 1 : 0, day: -1, adsToday: 0 };
  const dayTick = () => {
    const d = Math.floor(cumulativeTimeSec / 60 / env.minutesPerDay);
    while (dia.day < d) {
      dia.day++;
      dia.adsToday = 0;
      if (f2p) {
        const got = env.configs.attendance.days[dia.day % env.configs.attendance.days.length].diamonds ?? 0;
        dia.have += got;
        dia.earned += got;
      }
    }
  };
  // 광고(무료)를 먼저, 다 쓰면 보스층에서만 깃털(없고 다이아 >= 가격이면 사서). 층(시도)당 1회는 floorSim이 지킨다.
  const onFailFor = (isBoss) => (f2p || adsOn ? () => {
    if (adsOn && dia.adsToday < itemsCfg.adContinue.dailyCap) {
      dia.adsToday++;
      dia.adsUsed++;
      return 'ad';
    }
    if (f2p && isBoss) {
      if (dia.feathers === 0 && dia.have >= reviveCfg.diamond) {
        dia.have -= reviveCfg.diamond;
        dia.spent += reviveCfg.diamond;
        dia.feathers++;
        dia.feathersBought++;
      }
      if (dia.feathers > 0) {
        dia.feathers--;
        dia.feathersUsed++;
        return 'feather';
      }
    }
    return null;
  } : null);
  // S2 스킬 레벨 구매(--skills=shop에서만). balanced = 스킬 레벨에 쓴 골드 < 누적 수입 x skillShare일 때만,
  // max = 살 수 있는 만큼 먼저. 레벨 낮은 것부터, 같으면 특수 기술(해금된 것) -> 색 효과(config 순서).
  const buySkills = () => {
    if (!skillLv || env.skillBuy === 'none' || buyUnlocks()) return;
    const maxLv = skillMaxLevel(env.configs.shop, env.skillGate, floor);
    while (env.skillBuy !== 'balanced' || goldSpentSkills < env.skillShare * goldEarned) {
      const cards = skillLevelCards(env.configs, floor, skillLv, maxLv).filter((c) => c.price <= gold);
      if (cards.length === 0) break;
      cards.sort((a, b) => a.lv - b.lv || b.special - a.special);
      const c = cards[0];
      gold -= c.price;
      goldSpentSkills += c.price;
      bucketOf(floor).skill += c.price;
      skillLv[c.skill] = c.lv + 1;
    }
  };
  // 살 수 있는 만큼 사고, 아직 못 산 해금이 남았으면 true(그동안 레벨업 금지).
  const buyUnlocks = () => {
    if (!skillLv) return false;
    for (const { skill, price } of openUnlocks(env.configs, floor, skillLv)) {
      if (gold < price) return true;
      gold -= price;
      goldSpentUnlock += price;
      bucketOf(floor).unlock += price;
      unlockShareAt[skill] = price / Math.max(1, goldEarned);
      skillLv[skill] = 1;
      unlockFloors[skill] = floor;
    }
    return false;
  };
  // always: 아이템 boss 정책이고 다음 도전(floor)이 보스층이면 그 아이템 값(부족분을 층당 최대로 채우는 값)은 탑에 쓰지 않고 남긴다.
  // 아이템 always 정책(참고용)은 남기지 않는다 - 매 층 남기면 탑 골드가 말라 slow가 100층에 못 간다(84%가 아이템). 탑을 먼저 사고 남는 골드로 산다.
  const always = env.towerBuy !== 'onfail';
  const tagOf = (f) => getFloor(balance, enemies, obstacles, floorsData, f).tag;
  const itemReserve = () =>
    always && itemPolicy === 'boss' && tagOf(floor) === 'boss' ? buyItems(env.configs, { ...inventory }, equipped, Infinity, floor) : 0;
  const levelUp = () => {
    buySkills();
    if (buyUnlocks()) return;
    const reserve = itemReserve();
    const spent = spendGold(strategy, balance, towerLevels, gold - reserve, colorUsage);
    goldSpentLevels += gold - reserve - spent.gold;
    bucketOf(floor).tower += gold - reserve - spent.gold;
    towerLevels = spent.towerLevels;
    gold = spent.gold + reserve;
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
    const unlockPending = buyUnlocks();
    const goldAtEntry = gold; // 아이템 사기 전(selfcheck: always면 탑 레벨업 살 골드가 남아 있지 않아야 한다)
    dayTick();
    const levelsAtEntry = towerLevels.slice();
    const skillLvAtEntry = skillLv ? { ...skillLv } : null;
    attempt++;
    const tag = tagOf(floor);
    const itemsHere = useItems && (itemPolicy === 'always' || tag === 'boss');
    if (itemsHere) {
      const spent = buyItems(env.configs, inventory, equipped, gold, floor);
      gold -= spent;
      goldSpentItems += spent;
      bucketOf(floor).item += spent;
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
        onFail: floorNumber === floor ? onFailFor(tag === 'boss') : null,
        reviveCfg,
        seed: attemptSeed,
        dt: sim.dt,
        maxFloorSeconds: sim.maxFloorSeconds,
        summon,
        battleEffects,
        shotFlight: !!env.flight,
        emptySpawn: env.emptySpawn,
      });
    const result = attemptFloor(floor, seed * 100000 + attempt);
    cumulativeTimeSec += result.timeSec;
    floorTimeSec += result.timeSec;
    addResult(agg, result);
    track(floor, result);
    for (const [color, count] of Object.entries(result.stats.colorCounts)) colorUsage[color] += count;

    if (result.status === 'cleared') {
      const reward = result.killGoldTotal + clearBonus(balance, result.killGoldTotal, true);
      const cg = comboGold(balance, reward, result.maxCombo); // 콤보 골드(기본 config, --combogold=off면 0)
      gold += reward + cg;
      goldEarned += reward + cg;
      bucketOf(floor).first += reward;
      bucketOf(floor).combo += cg;
      comboByTag[result.tag] += cg;
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
      retriesByFloor.push({ floor, tag: result.tag, retries: attempt - 1, floorMinutes: floorTimeSec / 60, avgLevelAtEntry: avgLevel, wallLeftPct: result.wallHealthPct, levelsAtEntry: levelsAtEntry, skillLvAtEntry, continueUsed: result.continueUsed, goldAtEntry, unlockPending, clearSec: result.timeSec });
      const isWall = result.tag === 'boss' && bossWallMin != null ? floorTimeSec / 60 > bossWallMin : attempt - 1 >= wallFlagAt(result.tag);
      if (isWall) wallFloors.push(floor);
      floor += 1;
      attempt = 0;
      floorTimeSec = 0;
      if (always && floor <= env.floorsRange.to) levelUp();
      else buySkills();
    } else {
      gold += result.killGoldTotal;
      goldEarned += result.killGoldTotal;
      bucketOf(floor).fail += result.killGoldTotal;
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
        track(floor, farm, true);
        const farmReward = farm.killGoldTotal + (farm.status === 'cleared' ? clearBonus(balance, farm.killGoldTotal, false) : 0);
        const cg = farm.status === 'cleared' ? comboGold(balance, farmReward, farm.maxCombo) : 0;
        gold += farmReward + cg;
        goldEarned += farmReward + cg;
        bucketOf(floor).replay += farmReward;
        bucketOf(floor).combo += cg;
        comboByTag[farm.tag] += cg;
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
    comboByTag,
    goldSpentItems,
    goldSpentLevels,
    goldSpentUnlock,
    goldSpentSkills,
    skillLv: skillLv ? { ...skillLv } : null,
    flow,
    attemptLog,
    dia,
    unlockFloors,
    unlockShareAt,
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
export function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return (s[Math.floor((s.length - 1) / 2)] + s[Math.ceil((s.length - 1) / 2)]) / 2;
}

export async function run(env) {
  const { sim } = env.configs;
  const strategies = env.strategies ?? sim.levelStrategies.list;
  const flowSections = [];
  const wasteSections = [];
  const causeRows = [];
  const extraRows = [];
  const comboRows = []; // --combogold일 때만 t4combo csv
  const csvRows = [];
  const summaryRows = [];
  const bossAgg = new Map(); // `${player}|${strategy}|${floor}` -> { retries[], wallLeft[] }
  const outOfRange = [];
  const aggRows = [];
  const unlockRows = []; // --skills=shop: 기술별 실제 해금 층, 해금 골드 비율
  const timeRows = []; // 층 시간(클리어한 판, 반복 사냥 제외): 구간별 평균·중앙값 + 전체
  const timeCsv = [];
  const special = env.configs.shop.skills.special;
  const unlockIds = Object.keys(special).filter((id) => special[id].unlockBossFloor);

  for (const player of env.players) {
    for (const strategy of strategies) {
      const runs = [];
      for (let s = 0; s < env.seeds; s++) runs.push(runOneProgression(env, player, strategy, s + 1));
      aggRows.push(aggRow(`${player}:${strategy}`, mergeAggs(runs)));
      if (strategy !== 'none') {
        const label = `${player}:${strategy}`;
        flowSections.push(`#### ${label}
${flowTable(runs)}`);
        wasteSections.push(`#### ${label}
${wasteTable(runs, sim.players[player].secondsPerMove)}

${wasteCauseTable(runs)}`);
        extraRows.push(extraRow(label, runs, unlockIds));
        if (combo.goldPct !== 'off') comboRows.push(comboRow(player, strategy, runs, unlockIds));
        causeRows.push(...causeCsvRows(player, strategy, runs));
        const clears = runs.flatMap((r) => r.retriesByFloor.filter((x) => x.clearSec != null));
        const buckets = [...new Set(clears.map((x) => Math.floor((x.floor - 1) / 10)))].sort((a, b) => a - b);
        for (const [bucket, list] of [...buckets.map((i) => [`${i * 10 + 1}-${i * 10 + 10}`, clears.filter((x) => Math.floor((x.floor - 1) / 10) === i)]), ['전체', clears]]) {
          const secs = list.map((x) => x.clearSec);
          timeRows.push([label, bucket, avg(secs).toFixed(1), median(secs).toFixed(1), secs.length]);
          timeCsv.push({ player, strategy, bucket, clearSecMean: avg(secs).toFixed(2), clearSecMedian: median(secs).toFixed(2), n: secs.length });
        }
        // 층 시간 기준(targets.floorSeconds, v12-7): 클리어한 판 전체 중앙값. 100층 시간 기준이 있는 플레이어(normal·slow)만 판정.
        const fsMed = median(clears.map((x) => x.clearSec));
        const [fsLo, fsHi] = sim.targets.floorSeconds ?? [];
        if (fsLo != null && sim.targets.minutesTo100[player] && fsMed != null && (fsMed < fsLo || fsMed > fsHi)) {
          outOfRange.push(`층 시간: T4 ${label} 클리어 판 중앙값 ${fsMed.toFixed(1)}초 (기준 ${fsLo}~${fsHi}초)`);
        }
        // 허공 사격 기준(targets.wastedDamage): 전체 행의 (a)+(b)+(c). 오버킬은 기록만. --flight=off면 (b)가 0으로 잡힌다.
        const wasteMax = sim.targets.wastedDamage?.maxShare;
        const wasteAll = causeStats(runs).at(-1).wasteAll;
        if (wasteMax != null && !sim.players[player]?.referenceOnly && wasteAll > wasteMax) {
          outOfRange.push(`허공 사격: T4 ${label} (a)+(b)+(c) ${(wasteAll * 100).toFixed(1)}% (기준 ≤ ${wasteMax * 100}%, 탄 비행 ${env.flight ? 'on' : 'off - (b) 미측정'})`);
        }
      }
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
        const agg = bossAgg.get(key) ?? { retries: [], wallLeft: [], minutes: [], lv: [] };
        agg.retries.push(rec.retries);
        agg.lv.push(rec.avgLevelAtEntry);
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
      // v12-8b: seedWallInfoOnlyByPlayer면 시드 하나 기준 벽 층은 표시(wallFloors 열)만.
      if (wallFloors.length > 0 && !sim.targets.retriesPerFloor.seedWallInfoOnlyByPlayer?.[player]) outOfRange.push(`벽: T4 ${player}:${strategy} 층 ${wallFloors.join(', ')}에서 재도전 ${sim.targets.retriesPerFloor.wallFlag}회 이상(보스층 기준이 따로 있으면 ${sim.targets.retriesPerFloor.bossWallFlagByPlayer?.[player] ?? '-'}회, 보스 시간 기준이 있으면 보스층은 ${sim.targets.bossWallMinutesByPlayer?.[player] ?? '-'}분 초과)`);
    }
  }

  const bossRows = [...bossAgg]
    .map(([key, agg]) => {
      const [player, strategy, floor] = key.split('|');
      return { player, strategy, floor: Number(floor), retries: avg(agg.retries), wallLeft: avg(agg.wallLeft), minutes: avg(agg.minutes), lv: agg.lv };
    })
    .sort((a, b) => a.player.localeCompare(b.player) || a.strategy.localeCompare(b.strategy) || a.floor - b.floor);
  for (const r of bossRows) {
    // v12-8: 보스층 하나라도 시드 평균 재도전이 bossWallAvgByPlayer 이상이면 벽(slow).
    const wallAvg = sim.targets.retriesPerFloor.bossWallAvgByPlayer?.[r.player];
    if (wallAvg != null && r.retries >= wallAvg) outOfRange.push(`벽: T4 ${r.player}:${r.strategy} ${r.floor}층 보스 평균 재도전 ${r.retries.toFixed(2)} (기준 ${wallAvg}회 미만)`);
    csvRows.push({
      player: r.player,
      strategy: r.strategy,
      section: 'boss',
      bossFloor: r.floor,
      bossAvgRetries: r.retries.toFixed(2),
      bossWallLeftPct: r.wallLeft.toFixed(3),
    });
  }

  // 기존 t4 csv 모양을 안 바꾸려고 보스 진입 Lv·층 시간은 따로 낸다(t4boss, t4time).
  const bossCsv = bossRows.map((r) => ({
    player: r.player, strategy: r.strategy, floor: r.floor, entryLvMedian: median(r.lv).toFixed(1), entryLvMean: avg(r.lv).toFixed(1),
    entryLvMin: Math.min(...r.lv).toFixed(1), entryLvMax: Math.max(...r.lv).toFixed(1), retriesMean: r.retries.toFixed(2), floorMinutesMean: r.minutes?.toFixed(2) ?? '',
  }));
  const summaryMd =
    `## T4 진행 (기술 ${env.skillsMode}, enemyHpMul ${env.configs.balance.scaling.enemyHpMul ?? 1}, 탑 구매 ${env.towerBuy ?? 'always'})\n${mdTable(['구간', '일반층 재도전', '보스층 재도전', '진입 시 평균 Lv', '누적 시간(분)', '반복 사냥(회)', '멈춘 층', '벽 층'], summaryRows)}` +
    (unlockRows.length
      ? `\n\n### T4 특수 기술 해금 (A안, 해금 골드 차감 - 층 = 산 시점의 최고 층, 시드 평균 (최소~최대))\n${mdTable(['플레이어:전략', ...unlockIds.map((id) => `${id} 해금 층`), '해금 골드 / 전체 획득 골드'], unlockRows)}`
      : '') +
    `\n\n### T4 스킬·해금·다이아 (S2/S3, 시드 평균)\n${mdTable(['플레이어:전략', '스킬 레벨 골드 / 수입', '해금 골드 / 수입', '해금 시점 누적 대비(최대)', '아이템 골드 / 수입', '최종 스킬 Lv', '출석 다이아', '깃털 사용(구매)', '광고 이어하기'], extraRows)}` +
    `\n\n### T4 골드 흐름 (S4, 시드 평균 골드 - 구간 = 그 시도의 층, % = 그 구간 끝 누적 수입 대비 누적 지출)\n${flowSections.join('\n\n')}` +
    `\n\n### T4 허공 사격·칸 잠금 (S6, 진행 전체 시도. 버려진 피해 = 살아 있는 적이 없어 버린 사격·기술의 방어 전 피해 / (실제 피해 + 버려진 피해). 시뮬은 즉시 명중이라 비행 중 대상 소멸분은 0)\n${wasteSections.join('\n\n')}` +
    `\n\n### T4 기술 몫·발동 횟수 (진행 전체 시도 평균)\n${aggTable(aggRows)}` +
    `\n\n### T4 보스층만\n${mdTable(
      ['플레이어:전략', '층', '평균 재도전', '남은 성벽', '층에 쓴 시간(분)', '진입 Lv 중앙값 (최소~최대)'],
      bossRows.map((r) => [`${r.player}:${r.strategy}`, r.floor, r.retries.toFixed(2), `${(r.wallLeft * 100).toFixed(0)}%`, r.minutes?.toFixed(1) ?? '-', `${median(r.lv).toFixed(1)} (${Math.min(...r.lv).toFixed(1)}~${Math.max(...r.lv).toFixed(1)})`])
    )}` +
    `\n\n### T4 층 시간 (클리어한 판의 시간(초), 재도전 실패 판·반복 사냥 제외)\n${mdTable(['플레이어:전략', '구간', '평균', '중앙값', '판 수'], timeRows)}`;
  return { csvRows, summaryMd, outOfRange, extraCsv: { t4cause: causeRows, t4boss: bossCsv, t4time: timeCsv, ...(comboRows.length ? { t4combo: comboRows } : {}) } };
}

const pctOf = (v, t) => (t > 0 ? `${((v / t) * 100).toFixed(1)}%` : '-');
const sumBuckets = (runs) => {
  const out = [];
  for (const r of runs) r.flow.forEach((b, i) => {
    if (!b) return;
    out[i] ??= {};
    for (const [k, v] of Object.entries(b)) out[i][k] = (out[i][k] ?? 0) + v;
  });
  return out;
};

// S4: 10층 구간별 수입·지출(시드 평균)과 누적 수입 대비 누적 지출 %.
function flowTable(runs) {
  const n = runs.length;
  const cgOn = combo.goldPct !== 'off'; // 콤보 보너스 열은 --combogold=off가 아닐 때만(off면 v12-8 표 모양 그대로)
  const cum = { inc: 0, tower: 0, skill: 0, unlock: 0, item: 0 };
  const rows = sumBuckets(runs).map((b, i) => {
    if (!b) return null;
    const inc = b.first + b.replay + b.fail + b.exchange + b.combo;
    cum.inc += inc;
    for (const k of ['tower', 'skill', 'unlock', 'item']) cum[k] += b[k];
    const r0 = (v) => Math.round(v / n).toLocaleString('en-US');
    return [`${i * 10 + 1}-${i * 10 + 10}`, r0(b.first), r0(b.replay), r0(b.fail), r0(b.exchange), ...(cgOn ? [r0(b.combo)] : []), r0(b.tower), r0(b.skill), r0(b.unlock), r0(b.item), r0(cum.inc),
      pctOf(cum.tower, cum.inc), pctOf(cum.skill, cum.inc), pctOf(cum.unlock, cum.inc), pctOf(cum.item, cum.inc), pctOf(b.skill, inc)];
  }).filter(Boolean);
  return mdTable(['구간', '첫 클리어', '재클리어', '실패 처치', '교환', ...(cgOn ? ['콤보 보너스'] : []), '탑', '스킬 Lv', '해금', '아이템', '누적 수입', '누적 탑%', '누적 스킬%', '누적 해금%', '누적 아이템%', '구간 스킬%'], rows);
}

// S6: 허공 사격 비율, 첫 적까지 스왑, 빈 전장 시간 + 칸 단위 잠금 지표(분당 스왑, 수 없음 대기, 연출 중 스왑).
function wasteTable(runs, secondsPerMove) {
  const rows = sumBuckets(runs).map((b, i) => {
    if (!b) return null;
    const w = b.wasteBasic + b.wasteSkill;
    const a = Math.max(1, b.attempts);
    return [`${i * 10 + 1}-${i * 10 + 10}`, pctOf(w, b.hit + w), pctOf(b.wasteBasic, b.hit + w), pctOf(b.wasteSkill, b.hit + w),
      (b.swapsBeforeEnemy / a).toFixed(2), (b.emptySec / a).toFixed(1), ((b.swaps / b.timeSec) * 60).toFixed(1), ((b.noMove * secondsPerMove) / a).toFixed(1), pctOf(b.swapsAnim, b.swaps)];
  }).filter(Boolean);
  const t = sumBuckets(runs).filter(Boolean).reduce((s, b) => ({ w: s.w + b.wasteBasic + b.wasteSkill, h: s.h + b.hit }), { w: 0, h: 0 });
  rows.push(['전체', pctOf(t.w, t.h + t.w), '', '', '', '', '', '', '']);
  return mdTable(['구간', '버려진 피해', '기본 사격', '기술', '첫 적까지 스왑', '빈 전장(초/시도)', '분당 스왑', '수 없음 대기(초/시도)', '연출 중 스왑'], rows);
}

// --combogold(측정 전용, 10-combogold): 보너스 몫(전체·층 종류별, 총수입 대비)과 경제 몫, 보스층 진입 Lv 평균.
function comboRow(player, strategy, runs, unlockIds) {
  const tot = (k) => runs.reduce((s, r) => s + r[k], 0);
  const earned = Math.max(1, tot('goldEarned'));
  const byTag = (t) => runs.reduce((s, r) => s + r.comboByTag[t], 0);
  const f = (v) => (v / earned).toFixed(6);
  const boss = runs.flatMap((r) => r.retriesByFloor.filter((x) => x.tag === 'boss' && x.clearSec != null).map((x) => x.avgLevelAtEntry));
  const row = { player, strategy, goldPct: combo.goldPct ?? combo.configPct, goldEarned: Math.round(earned / runs.length), comboShare: f(byTag('normal') + byTag('elite') + byTag('boss')),
    comboNormal: f(byTag('normal')), comboElite: f(byTag('elite')), comboBoss: f(byTag('boss')),
    skillShare: f(tot('goldSpentSkills')), unlockShare: f(tot('goldSpentUnlock')), itemShare: f(tot('goldSpentItems')),
    bossEntryLvMean: (boss.reduce((s, v) => s + v, 0) / Math.max(1, boss.length)).toFixed(3) };
  for (const id of unlockIds) row[`unlockAt_${id}`] = Math.max(0, ...runs.map((r) => r.unlockShareAt[id] ?? 0)).toFixed(6);
  return row;
}

function extraRow(label, runs, unlockIds) {
  const tot = (k) => runs.reduce((s, r) => s + r[k], 0);
  const earned = Math.max(1, tot('goldEarned'));
  const shares = unlockIds.map((id) => Math.max(0, ...runs.map((r) => r.unlockShareAt[id] ?? 0)));
  const lvIds = runs[0].skillLv ? Object.keys(runs[0].skillLv) : [];
  const lv = lvIds.map((id) => `${id} ${(runs.reduce((s, r) => s + r.skillLv[id], 0) / runs.length).toFixed(1)}`).join(', ') || '-';
  const d = (k) => (runs.reduce((s, r) => s + r.dia[k], 0) / runs.length).toFixed(1);
  return [label, pctOf(tot('goldSpentSkills'), earned), pctOf(tot('goldSpentUnlock'), earned), unlockIds.map((id, i) => `${id} ${(shares[i] * 100).toFixed(1)}%`).join(', '),
    pctOf(tot('goldSpentItems'), earned), lv, d('earned'), `${d('feathersUsed')} (${d('feathersBought')})`, d('adsUsed')];
}

// S6 원인별: 분모 D = 실제 피해(오버킬 포함) + (a) + (b) + (c). (a)(c)는 방어 전, (b)·오버킬은 방어 후 값.
// (a) 빈 전장 기본 사격, (b) 비행 중 대상 소멸(--flight=on에서만, off면 0; 그중 예약 폴백 = 쏠 때 이미 예약 피해로 죽을 적), (c) 기술 허공. 오버킬 = 명중 피해 중 남은 HP 초과분.
// 구간(10층)별 + 전체 수치 행. 성벽·동시 적은 그 구간의 모든 시도(반복 사냥 포함)가 모집단.
// wallLow10 = 클리어한 시도를 남은 성벽 순으로 세워 아래 10%(올림, 최소 1개)의 평균. aliveMaxMean = 시도별 최대의 평균, aliveMax = 구간 최대.
function causeStats(runs) {
  const bs = sumBuckets(runs);
  const logs = runs.flatMap((r) => r.attemptLog);
  const boss = runs.flatMap((r) => r.retriesByFloor.filter((x) => x.tag === 'boss'));
  const avgOf = (a) => (a.length ? a.reduce((s2, v) => s2 + v, 0) / a.length : null);
  const one = (label, b, inBucket) => {
    const d = b.hit + b.wasteBasic + b.wasteFlight + b.wasteSkill;
    const a = Math.max(1, b.attempts);
    const lg = logs.filter((x) => inBucket(x.floor));
    const walls = lg.filter((x) => x.cleared).map((x) => x.wall).sort((x, y) => x - y);
    const low = walls.slice(0, Math.max(1, Math.ceil(walls.length * 0.1)));
    const sh = (v) => (d > 0 ? v / d : 0);
    return {
      bucket: label, wasteAll: sh(b.wasteBasic + b.wasteFlight + b.wasteSkill), wasteA: sh(b.wasteBasic), wasteSummon: sh(b.wasteSummon), wasteB: sh(b.wasteFlight), wasteBDoomed: sh(b.wasteFlightDoomed), wasteC: sh(b.wasteSkill),
      ovBasic: sh(b.ovBasic), ovSkill: sh(b.ovSkill), ovOther: sh(b.ovOther),
      firstEnemySec: b.firstEnemySec / a, swapsBeforeEnemy: b.swapsBeforeEnemy / a, emptySec: b.emptySec / a,
      secPerAttempt: b.timeSec / a, minutesPerSeed: b.timeSec / 60 / runs.length, failsPerSeed: (b.attempts - b.clears) / runs.length,
      bossRetries: avgOf(boss.filter((x) => inBucket(x.floor)).map((x) => x.retries)),
      wallMean: b.clears ? b.wallLeft / b.clears : null, wallLow10: avgOf(low), wallP10: walls.length ? walls[Math.round(0.1 * (walls.length - 1))] : null,
      aliveAvg: b.timeSec > 0 ? b.aliveSec / b.timeSec : 0, aliveMaxMean: avgOf(lg.map((x) => x.aliveMax)), aliveMax: Math.max(0, ...lg.map((x) => x.aliveMax)),
      emptySpawnsPerAttempt: b.emptySpawns / a,
    };
  };
  const out = bs.map((b, i) => (b?.attempts ? one(`${i * 10 + 1}-${i * 10 + 10}`, b, (f) => Math.floor((f - 1) / 10) === i) : null)).filter(Boolean);
  const tot = {};
  for (const b of bs.filter(Boolean)) for (const k of Object.keys(b)) tot[k] = (tot[k] ?? 0) + b[k];
  out.push(one('전체', tot, () => true));
  return out;
}

function causeCsvRows(player, strategy, runs) {
  return causeStats(runs).map((r) => ({ player, strategy, ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? v.toFixed(6) : v ?? ''])) }));
}

function wasteCauseTable(runs) {
  const p = (v) => (v == null ? '-' : `${(v * 100).toFixed(1)}%`);
  const rows = causeStats(runs).map((r) => [r.bucket, p(r.wasteAll), p(r.wasteA), p(r.wasteSummon), p(r.wasteB), p(r.wasteBDoomed), p(r.wasteC), p(r.ovBasic), p(r.ovSkill), p(r.ovOther),
    r.firstEnemySec.toFixed(2), r.swapsBeforeEnemy.toFixed(2), r.emptySec.toFixed(1), r.secPerAttempt.toFixed(1), r.minutesPerSeed.toFixed(1), r.failsPerSeed.toFixed(1), p(r.wallMean), r.emptySpawnsPerAttempt.toFixed(1),
    p(r.wallLow10), r.aliveAvg.toFixed(2), `${r.aliveMaxMean.toFixed(1)} / ${r.aliveMax}`]);
  return mdTable(['구간', '버려짐 a+b+c', '(a) 빈 전장', '(a) 중 소환 연출 중', '(b) 비행 중 소멸', '(b) 중 예약 폴백', '(c) 기술 허공', '오버킬 기본', '오버킬 기술', '오버킬 범위·독', '첫 적까지(초)', '첫 적까지 스왑', '빈 전장(초/시도)', '시도당 시간(초)', '구간 시간(분/시드, 재도전·사냥 포함)', '실패 시도(회/시드)', '클리어 시 남은 성벽', '즉시 등장(회/시도)', '남은 성벽 하위 10% 평균', '동시 적 평균', '동시 적 최대(시도 평균 / 구간 최대)'], rows);
}
