// 실패 골드 배율(v13-sw, balance.json economy.failGoldMul / failGoldScope) - 진 판 처치 골드 = floor(처치 골드 x 배율), 클리어 판은 그대로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { failKillGold, clearBonus } from '../src/core/economy/economy.js';
import { BattleController } from '../src/game/battleController.js';
import { playerState } from '../src/game/playerState.js';

const CFG = join(dirname(fileURLToPath(import.meta.url)), '..', 'config');
const load = (name) => JSON.parse(readFileSync(join(CFG, name), 'utf8'));
const balance = load('balance.json');
const enemies = load('enemies.json');
const withFail = (mul, scope) => ({ ...balance, economy: { ...balance.economy, failGoldMul: mul, failGoldScope: scope } });

test('config 기본값: failGoldMul 1.0, failGoldScope all = 예전과 같음', () => {
  assert.equal(balance.economy.failGoldMul, 1);
  assert.equal(balance.economy.failGoldScope, 'all');
  for (const g of [0, 1, 7, 12345]) for (const tag of ['normal', 'elite', 'boss']) assert.equal(failKillGold(balance, tag, g), g);
  assert.equal(failKillGold({ economy: {} }, 'boss', 99), 99, '키가 없으면 1.0/all');
});

test('scope all: 모든 층에 floor(골드 x 배율)', () => {
  const b = withFail(0.7, 'all');
  assert.equal(failKillGold(b, 'normal', 100), 70);
  assert.equal(failKillGold(b, 'boss', 101), 70, '내림(70.7)');
  assert.equal(failKillGold(b, 'elite', 10), 7, '부동소수 오차로 6이 되지 않는다');
  assert.equal(failKillGold(b, 'boss', 0), 0);
});

test('scope boss: 보스층만 줄고 일반·엘리트층은 그대로', () => {
  const b = withFail(0.5, 'boss');
  assert.equal(failKillGold(b, 'boss', 255), 127);
  assert.equal(failKillGold(b, 'normal', 255), 255);
  assert.equal(failKillGold(b, 'elite', 255), 255);
});

function makeController(bal) {
  return new BattleController({
    balance: bal, enemies, obstacles: load('obstacles.json'), floorsData: load('floors.json'), towersBaseData: bal.tower.towers,
    battleConfig: { cascadeBonusPerStep: bal.tower.puzzleShot.cascadeBonus, minDamage: 1, attackIntervalSec: enemies.attackInterval,
      effectDurationsMs: { towerAttack: 100, enemyHit: 100, enemyDie: 100, enemyReachLine: 100, wallDamaged: 100 } },
  });
}
// 처음 나오는 적 kills마리만 잡는다(나머지는 살려 둠).
function killSome(c, kills) {
  let n = 0;
  for (let guard = 0; guard < 4000 && n < kills; guard++) {
    c.update(0.05);
    for (const e of c.battleState.enemies) {
      if (n < kills && e.state === 'alive') {
        c.battleState.resolveTowerAttack({ targetEnemyId: e.id, damage: e.currentHealth + 1, towerId: c.battleState.towers[0].id });
        n++;
      }
    }
  }
  c.update(0.05);
}

test('게임: 진 판은 failGold만 지갑에 들어가고 패배 팝업 값(failGold)과 같다', () => {
  const c = makeController(withFail(0.5, 'all'));
  const before = playerState.gold;
  killSome(c, 5);
  assert.ok(c.killGoldThisFloor > 0);
  c.battleState.status = 'failed';
  c.update(0.05);
  assert.equal(c.failGold, Math.floor(c.killGoldThisFloor * 0.5));
  assert.equal(playerState.gold - before, c.failGold);
  assert.equal(c.lastClearReward, null);
});

test('게임: 클리어 판은 failGoldMul과 상관없이 처치 골드 전부 + 보너스', () => {
  const c = makeController(withFail(0.5, 'all'));
  c.gameState = { maxComboStreak: 0 };
  const isFirst = playerState.isFirstClearOf(c.floor);
  const before = playerState.gold;
  killSome(c, Infinity);
  const r = c.lastClearReward;
  assert.ok(r, '클리어 보상');
  assert.equal(r.bonusGold, clearBonus(c.balance, c._killGoldBase, isFirst));
  assert.equal(playerState.gold - before, r.killGold + r.bonusGold + r.comboGold);
});
