// 콤보 골드 보너스(docs/balance.md §8, balance.json economy.comboGold) - 층 클리어 골드 × min(판 최대 콤보, 20)/20 × 5%.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { comboGoldBonus, clearBonus } from '../src/core/economy/economy.js';
import { Board } from '../src/core/board.js';
import { GameState } from '../src/core/gameState.js';
import { BattleController } from '../src/game/battleController.js';
import { playerState } from '../src/game/playerState.js';

const CFG = join(dirname(fileURLToPath(import.meta.url)), '..', 'config');
const load = (name) => JSON.parse(readFileSync(join(CFG, name), 'utf8'));
const balance = load('balance.json');
const enemies = load('enemies.json');

test('config: maxPct 5%, comboCap 20', () => {
  assert.equal(balance.economy.comboGold.maxPct, 0.05);
  assert.equal(balance.economy.comboGold.comboCap, 20);
});

test('최대 콤보 0 / 10 / 20 / 35 -> 클리어 골드의 0 / 2.5% / 5% / 5%', () => {
  assert.equal(comboGoldBonus(balance, 1000, 0), 0);
  assert.equal(comboGoldBonus(balance, 1000, 10), 25);
  assert.equal(comboGoldBonus(balance, 1000, 20), 50);
  assert.equal(comboGoldBonus(balance, 1000, 35), 50);
  assert.equal(comboGoldBonus({ economy: {} }, 1000, 20), 0, 'config가 없으면 0');
});

test('GameState.maxComboStreak: 성공 스왑마다 최고값을 갱신하고, 새 보드(재도전·새 층)는 0부터', () => {
  const board = new Board({ rows: 3, cols: 3, typeCount: 5, seed: 7 });
  board.grid = [0, 0, 1, 1, 2, 0, 2, 1, 0];
  board.specials = new Array(9).fill(null);
  board.cellStates = new Array(9).fill(null);
  const state = new GameState({ board });
  assert.equal(state.maxComboStreak, 0);
  assert.equal(state.trySwap(0, 2, 1, 2), true);
  assert.equal(state.maxComboStreak, 1);
  state.resetCombo(); // 스트릭이 끊겨도 최고값은 남는다(이어하기 전후 중 큰 값).
  assert.equal(state.maxComboStreak, 1);
  assert.equal(new GameState({ seed: 1 }).maxComboStreak, 0);
});

test('다음 층(continueToFloor, 보드 유지)에서도 콤보와 최대 콤보는 0부터', () => {
  const board = new Board({ rows: 3, cols: 3, typeCount: 5, seed: 7 });
  board.grid = [0, 0, 1, 1, 2, 0, 2, 1, 0];
  board.specials = new Array(9).fill(null);
  board.cellStates = new Array(9).fill(null);
  const state = new GameState({ board });
  assert.equal(state.trySwap(0, 2, 1, 2), true);
  assert.equal(state.comboStreak, 1);
  state.continueToFloor(null);
  assert.equal(state.comboStreak, 0);
  assert.equal(state.comboStreakTimerMs, 0);
  assert.equal(state.maxComboStreak, 0);
});

function makeController() {
  return new BattleController({
    balance, enemies, obstacles: load('obstacles.json'), floorsData: load('floors.json'), towersBaseData: balance.tower.towers,
    battleConfig: { cascadeBonusPerStep: balance.tower.puzzleShot.cascadeBonus, minDamage: 1, attackIntervalSec: enemies.attackInterval,
      effectDurationsMs: { towerAttack: 100, enemyHit: 100, enemyDie: 100, enemyReachLine: 100, wallDamaged: 100 } },
  });
}

test('클리어한 판: 처치 + 클리어 보너스 기준으로 콤보 보너스를 지급하고 lastClearReward에 나눠 담는다', () => {
  const controller = makeController();
  controller.gameState = { maxComboStreak: 20 };
  const isFirst = playerState.isFirstClearOf(controller.floor);
  const goldBefore = playerState.gold;
  for (let guard = 0; guard < 1500 && controller.battleState.status === 'active'; guard++) {
    controller.update(0.05);
    for (const enemy of controller.battleState.enemies) {
      if (enemy.state === 'alive') controller.battleState.resolveTowerAttack({ targetEnemyId: enemy.id, damage: enemy.currentHealth + 1, towerId: controller.battleState.towers[0].id });
    }
  }
  controller.update(0.05);
  const r = controller.lastClearReward;
  assert.ok(r, '클리어 보상이 계산돼야 한다');
  const base = controller._killGoldBase;
  assert.equal(r.comboGold, Math.round(((base + clearBonus(balance, base, isFirst)) * 20) / 20 * 0.05));
  assert.ok(r.comboGold > 0);
  assert.equal(r.maxCombo, 20);
  assert.equal(r.firstClearMul, isFirst ? 1 + balance.economy.clearBonusMul : null, '첫 클리어 도장 배율(재클리어면 null)');
  assert.equal(r.comboFull, true);
  assert.equal(r.total, r.killGold + r.bonusGold + r.comboGold);
  assert.equal(playerState.gold - goldBefore, r.total);
});

test('실패한 판에는 콤보 보너스가 없다', () => {
  const controller = makeController();
  controller.gameState = { maxComboStreak: 35 };
  controller.battleState.status = 'failed';
  const goldBefore = playerState.gold;
  controller.update(0.05);
  assert.equal(controller.lastClearReward, null);
  assert.equal(playerState.gold, goldBefore);
});
