// BattleController가 층 전환마다 floor(obstacles 포함)를 밖으로 노출하는지 테스트한다
// (src/main.js가 이걸로 퍼즐 보드를 다시 만든다 - docs/balance.md 7장). 실제 config/*.json을
// 그대로 쓴다(tests/floorGen.test.js와 같은 방식) - 손으로 만든 balance 데이터로는
// floorShape/scaling 등 필수 필드가 너무 많아 비현실적이다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BattleController } from '../src/game/battleController.js';
import { playerState } from '../src/game/playerState.js';
import { getFloor } from '../src/core/balance/floorGen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CFG = join(__dirname, '..', 'config');
const load = (name) => JSON.parse(readFileSync(join(CFG, name), 'utf8'));

const balance = load('balance.json');
const enemies = load('enemies.json');
const obstacles = load('obstacles.json');
const floorsData = load('floors.json');

function makeController(onBattleStateChanged) {
  return new BattleController({
    balance,
    enemies,
    obstacles,
    floorsData,
    towersBaseData: balance.tower.towers,
    battleConfig: {
      cascadeBonusPerStep: balance.tower.puzzleShot.cascadeBonus,
      minDamage: 1,
      attackIntervalSec: enemies.attackInterval,
      effectDurationsMs: { towerAttack: 100, enemyHit: 100, enemyDie: 100, enemyReachLine: 100, wallDamaged: 100 },
    },
    onBattleStateChanged,
  });
}

test('생성 직후 controller.currentFloor가 getFloor() 결과와 같다(obstacles 포함)', () => {
  const controller = makeController();
  const expected = getFloor(balance, enemies, obstacles, floorsData, playerState.floor);
  assert.deepEqual(controller.currentFloor, expected);
  assert.ok(controller.currentFloor.obstacles, 'obstacles 필드가 있어야 한다(빈 객체여도 존재는 해야 함)');
});

test('층이 바뀔 때(retryFloor) onBattleStateChanged가 (battleState, floor)로 호출되고 floor는 currentFloor와 일치한다', () => {
  let seenFloor = null;
  const controller = makeController((bs, floor) => {
    seenFloor = floor;
  });

  controller.retryFloor(); // playerState.save()를 타지 않는 경로 - 테스트에서 저장소 걱정 없음.

  assert.ok(seenFloor, '콜백이 floor 인자를 받아야 한다');
  assert.deepEqual(seenFloor, controller.currentFloor);
  assert.deepEqual(seenFloor, getFloor(balance, enemies, obstacles, floorsData, playerState.floor));
});

test('층 클리어 -> 다음 층: 웨이브를 모두 전멸시키면 status가 cleared가 되고, advanceFloor()는 층 번호를 1 올린 다음 층의 BattleState를 새로 만든다', () => {
  const startFloor = playerState.floor;
  const controller = makeController();

  // 현재 층의 모든 웨이브를 즉시 전멸시킨다(스폰 즉시 체력을 깎아 죽인다) - 실제 플레이와
  // 같은 "마지막 웨이브까지 전멸 -> cleared" 경로를 그대로 탄다.
  for (let guard = 0; guard < 1500 && controller.battleState.status === 'active'; guard++) {
    controller.battleState.update(0.05);
    for (const enemy of controller.battleState.enemies) {
      if (enemy.state === 'alive') controller.battleState.resolveTowerAttack({ targetEnemyId: enemy.id, damage: enemy.currentHealth + 1, towerId: controller.battleState.towers[0].id });
    }
  }
  assert.equal(controller.battleState.status, 'cleared');

  controller.advanceFloor();

  assert.equal(playerState.floor, startFloor + 1);
  assert.equal(controller.currentFloor.floor, startFloor + 1);
  assert.deepEqual(controller.currentFloor, getFloor(balance, enemies, obstacles, floorsData, startFloor + 1));
  assert.equal(controller.battleState.status, 'active');
});

test('경쟁 모드 startComp: 무한 웨이브, 석상 comp.towerLevel 고정·강화 불가, 키트 아이템, 골드 안 늘고 점수만, retryFloor로 본편 복귀', async () => {
  const { towerAttack } = await import('../src/core/economy/economy.js');
  const comp = JSON.parse(readFileSync(join(CFG, 'ranking.json'), 'utf8')).comp;
  const items = load('items.json');
  const controller = new BattleController({
    balance, enemies, obstacles, floorsData, towersBaseData: balance.tower.towers, itemsConfig: items,
    battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: JSON.parse(readFileSync(join(__dirname, '..', 'src', 'config', 'battle.json'), 'utf8')).effectDurationsMs },
  });
  const mainItems = controller.items;
  const normalAtk = controller.towersData[0].stats.attack;
  const run = { runId: 'r', seasonId: '2026-W48', seed: 1234, cfg: comp };
  controller.startComp(run);
  assert.equal(controller.comp, run);
  assert.equal(controller.floorTag, 'comp');
  assert.ok(controller.battleState.nextWave);
  assert.equal(controller.battleState.towers[0].stats.attack, towerAttack(balance, comp.towerLevel));
  assert.equal(controller.towersData[0].stats.attack, normalAtk); // 본편 석상은 그대로
  assert.equal(controller.tryLevelUpTower(0), false);
  assert.deepEqual(run.towerLevels, controller.towersData.map(() => comp.towerLevel)); // 화면 표시용 레벨
  assert.notEqual(controller.items, mainItems);
  assert.deepEqual(controller.items.inv.hotbar(), Object.keys(comp.kit));
  const gold = playerState.gold;
  for (let i = 0; i < 400; i++) {
    for (const shot of controller.battleState.applyGemClear('red', 50, 1)) controller.battleState.resolveTowerAttack(shot);
    controller.update(0.1);
  }
  assert.equal(playerState.gold, gold);
  assert.ok(run.score.s.kills > 0 && run.score.total > 2000);
  assert.equal(controller.battleState.status, 'active');
  assert.ok(controller.battleState.wave > 1);
  assert.equal(controller.floor, controller.battleState.wave);
  controller.logSwap(0, 0, 0, 1);
  assert.equal(run.input.log.s.length, 1);
  controller.retryFloor();
  assert.equal(controller.comp, null);
  assert.equal(controller.items, mainItems);
  assert.equal(controller.battleState.nextWave, null);
});
