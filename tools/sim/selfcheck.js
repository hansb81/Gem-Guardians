#!/usr/bin/env node
// tools/sim 자체 점검(v12 추가 기능): node tools/sim/selfcheck.js. 실패하면 assert 에러로 끝난다.
import assert from 'node:assert/strict';
import { loadConfigs, applySets } from './config.js';
import { skillMaxLevel, skillLevelCards } from './skills.js';
import { runOneProgression } from './tests/t4.js';
import { skillArgsAtFor } from './skills.js';

const c = loadConfigs();

// S1 --set: 파일 접두어, 배열 id/item 찾기, 숫자 배열, 접두어 없음 = balance, 없는 키는 에러.
applySets(c, 'shop.skills.special.lava.unlockGold=1.5;skills.colorEffects.red.radius=0.2;shop.goldExchange.small.floors=1;shop.itemBundles.hammer.dia=12;shop.skills.levelCost=[0.75,0.75,0.75,0.75];scaling.enemyHpMul=1.4');
assert.equal(c.shop.skills.special.lava.unlockGold, 1.5);
assert.equal(c.skills.colorEffects.red.radius, 0.2);
assert.equal(c.shop.goldExchange.find((g) => g.id === 'small').floors, 1);
assert.equal(c.shop.itemBundles.find((b) => b.item === 'hammer').dia, 12);
assert.deepEqual(c.shop.skills.levelCost, [0.75, 0.75, 0.75, 0.75]);
assert.equal(c.balance.scaling.enemyHpMul, 1.4);
assert.throws(() => applySets(c, 'shop.goldExchange.small.goldR=1'), /키 없음/);
assert.throws(() => applySets(c, 'items.items.hammer.diamond=12'), /키 없음/);

// S2 잠금 상한: 1 + floor(최고 층 / 20), off = maxLevel.
assert.equal(skillMaxLevel(c.shop, 20, 19), 1);
assert.equal(skillMaxLevel(c.shop, 20, 40), 3);
assert.equal(skillMaxLevel(c.shop, 20, 200), 5);
assert.equal(skillMaxLevel(c.shop, 'off', 1), 5);
const lv = { red: 1, blue: 1, purple: 1, yellow: 1, green: 1, spike: 1, lava: 0, soul: 0, ult: 0 };
assert.equal(skillLevelCards(c, 25, lv, 1).length, 0); // 상한 Lv1이면 살 것 없음
assert.equal(skillLevelCards(c, 25, lv, 2).length, 6); // 잠긴 특수 기술(Lv 0) 제외

// S2 balanced: 스킬 레벨 골드가 누적 수입의 skillShare를 (마지막 1건 초과분 말고는) 넘지 않는다.
const env = {
  configs: c, floorsRange: { from: 1, to: 25 }, skillsMode: 'shop', skillArgsAt: skillArgsAtFor('shop', c.skills, c.shop),
  skillBuy: 'balanced', skillGate: 'off', skillShare: 0.15, dia: 'none', ads: 'off', minutesPerDay: 30,
};
const r = runOneProgression(env, 'normal', 'even', 1);
const maxCard = Math.round(0.75 * 400); // 25층 근처 R x 0.75 여유
assert.ok(r.goldSpentSkills <= 0.15 * r.goldEarned + maxCard, `skill share ${r.goldSpentSkills}/${r.goldEarned}`);
assert.ok(r.goldSpentSkills > 0, 'balanced가 스킬을 하나도 안 샀다');
const none = runOneProgression({ ...env, skillBuy: 'none' }, 'normal', 'even', 1);
assert.equal(none.goldSpentSkills, 0);
console.log('selfcheck ok');

// v12-7 --towerbuy=always(기본): 층에 들어갈 때 살 수 있는 탑 레벨업이 남아 있지 않다(해금 골드를 모으는 층 제외).
// 아이템 boss 정책이면 보스층 진입 때만 아이템 값을 남긴다(일반층은 같은 검사). onfail은 골드를 쌓아 두므로 걸리는 층이 있어야 한다.
{
  const { towerLevelCost } = await import('../../src/core/economy/economy.js');
  const leftover = (run) => run.retriesByFloor.filter((x) => !x.unlockPending && x.goldAtEntry >= towerLevelCost(c.balance, Math.min(...x.levelsAtEntry)));
  assert.deepEqual(leftover(r).map((x) => x.floor), []);
  const boss = runOneProgression(env, 'normal', 'even', 1, { itemPolicy: 'boss' });
  assert.deepEqual(leftover(boss).filter((x) => x.tag !== 'boss').map((x) => x.floor), []);
  assert.ok(boss.goldSpentItems > 0, 'boss 정책인데 아이템을 안 샀다');
  const onfail = leftover(runOneProgression({ ...env, towerBuy: 'onfail' }, 'normal', 'even', 1));
  assert.ok(onfail.length > 0, 'onfail인데 남은 골드가 없다 - 검사가 죽었다');
  console.log(`towerbuy ok (always: 진입 때 살 수 있는 탑 레벨업 0층, onfail: ${onfail.length}/25층에서 남음)`);
}

// S6 탄 비행 근사(floorSim flightSecOf): 발사 지연 0.24초 + 거리/480. 성벽 앞(p=1) < 출발점(p=0) < 1초.
{
  const { flightSecOf } = await import('./floorSim.js');
  const towersData = [{ id: 'a' }];
  const at = (progress) => flightSecOf({ enemies: [{ id: 1, progress }] }, towersData, { targetEnemyId: 1, towerId: 'a' });
  assert.ok(at(1) >= 0.32 && at(1) < at(0) && at(0) < 1, `flight ${at(1)} ${at(0)}`);
  console.log(`flight ok (p=1 ${at(1).toFixed(2)}s, p=0 ${at(0).toFixed(2)}s)`);
}

// D8 빈 전장 즉시 등장 - core 판정 함수(src/core/balance/emptySpawn.js emptySpawnCount): 반환 = 지금 낼 적 수.
{
  const { emptySpawnCount } = await import('../../src/core/balance/emptySpawn.js');
  const at = [0, 2, 2.35, 5]; // 2번째·3번째가 무리(간격 0.35)
  const alive = (hp, pending) => ({ state: 'alive', currentHealth: hp, pendingDamage: pending });
  const n = (mode, enemies, spawned, since = Infinity, spawnAt = at) => emptySpawnCount(mode, enemies, spawned, 4, spawnAt, 2, 0.35, since, 0.3);
  // 빈 전장: on·predict 모두 다음 적 + 무리 전체(2마리), off는 0. 죽은 적만 있어도 빈 전장.
  assert.deepEqual([n('off', [], 1), n('on', [], 1), n('predict', [], 1), n('on', [{ state: 'dead' }], 3)], [0, 2, 2, 1]);
  // 모두 죽을 예정(HP <= 예약 피해): predict만 낸다. 한 마리라도 살아남을 예정이면 안 낸다.
  assert.deepEqual([n('on', [alive(10, 10)], 1), n('predict', [alive(10, 10), alive(5, 9)], 1), n('predict', [alive(10, 10), alive(5, 4)], 1)], [0, 2, 0]);
  // 쿨다운 안(predict만): 0.3초 전에는 안 내고, 0.3초부터 낸다. on은 쿨다운 없음.
  assert.deepEqual([n('predict', [], 1, 0), n('predict', [], 1, 0.25), n('predict', [], 1, 0.3), n('on', [], 1, 0)], [0, 0, 2, 2]);
  // 남은 적 없음: 0. spawnAt 없는 층(interval 2초 간격)은 무리가 없어 1마리.
  assert.deepEqual([n('on', [], 4), n('predict', [], 4), n('predict', [], 1, Infinity, null)], [0, 0, 1]);
  console.log('emptySpawnCount ok (빈 전장 / 모두 죽을 예정 / 쿨다운 안 / 남은 적 없음)');
}

// 게임 배선(battleState._pullSpawn)을 거친 결과: off = 즉시 등장 0, on = 빈 전장 사격 0, predict = on보다 많이 끌어오고 비행 중 소멸이 준다.
// 기본값(emptySpawn 안 줌)은 balance.json floorShape.emptySpawn과 같아야 한다.
{
  const { runFloorAttempt } = await import('./floorSim.js');
  const args = (emptySpawn) => ({
    ...c, floorNumber: 15, towerLevels: [15, 15, 15, 15, 15], playerCfg: c.sim.players.normal, modifierHooks: null,
    ...skillArgsAtFor('shop', c.skills, c.shop)(15), seed: 7, dt: c.sim.dt, maxFloorSeconds: c.sim.maxFloorSeconds, shotFlight: true, emptySpawn,
  });
  const off = runFloorAttempt(args('off'));
  const on = runFloorAttempt(args('on'));
  const predict = runFloorAttempt(args('predict'));
  const dflt = runFloorAttempt(args(undefined));
  assert.equal(off.emptySpawns, 0);
  assert.ok(off.waste.basic > 0 && on.emptySpawns > 0 && on.waste.basic === 0, `off waste ${off.waste.basic}, on spawns ${on.emptySpawns} waste ${on.waste.basic}`);
  assert.ok(on.firstEnemySec <= off.firstEnemySec);
  assert.ok(predict.emptySpawns > on.emptySpawns && predict.waste.flight < on.waste.flight, `predict ${predict.emptySpawns}/${predict.waste.flight} on ${on.emptySpawns}/${on.waste.flight}`);
  const byMode = { off, on, predict }[c.balance.floorShape.emptySpawn];
  assert.deepEqual([dflt.timeSec, dflt.emptySpawns, dflt.wallHealthPct], [byMode.timeSec, byMode.emptySpawns, byMode.wallHealthPct]);
  const line = (r) => `즉시 등장 ${r.emptySpawns}회, 빈 전장 사격 ${Math.round(r.waste.basic)}, 비행 중 소멸 ${Math.round(r.waste.flight)}, 층 시간 ${r.timeSec.toFixed(1)}초`;
  console.log(`emptySpawn ok (15층 seed 7, flight on, 기본값 ${c.balance.floorShape.emptySpawn})\n  off: ${line(off)}\n  on: ${line(on)}\n  predict: ${line(predict)}`);
}
