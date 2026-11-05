import { test } from 'node:test';
import assert from 'node:assert/strict';
import { towerAttack, towerLevelCost, maxTowerLevelUps, clearBonus } from '../src/core/economy/economy.js';

const balance = {
  tower: { baseAtk: 10, atkGrowthPerLevel: 1.05, maxLevel: 200, levelCost: { base: 20, growth: 1.06 } },
  economy: { clearBonusMul: 1.0, replayClearMul: 0.3 },
};

test('towerAttack: 레벨 1은 baseAtk 그대로, 레벨이 오르면 atkGrowthPerLevel^(레벨-1)만큼 커진다', () => {
  assert.equal(towerAttack(balance, 1), 10);
  assert.equal(towerAttack(balance, 2), 10 * 1.05);
  assert.equal(towerAttack(balance, 10), 10 * 1.05 ** 9);
});

test('towerLevelCost: 레벨 1->2 비용은 base, 올라갈수록 growth만큼 비싸진다', () => {
  assert.equal(towerLevelCost(balance, 1), 20);
  assert.equal(towerLevelCost(balance, 2), Math.round(20 * 1.06));
  assert.ok(towerLevelCost(balance, 10) > towerLevelCost(balance, 5));
});

test('clearBonus: 처음 클리어는 clearBonusMul, 재클리어는 replayClearMul을 곱한다', () => {
  assert.equal(clearBonus(balance, 100, true), 100);
  assert.equal(clearBonus(balance, 100, false), 30);
});

test('maxTowerLevelUps: 골드로 살 수 있는 만큼만 레벨을 올리고 정확한 총 비용을 돌려준다', () => {
  const cost1 = towerLevelCost(balance, 1); // 20
  const cost2 = towerLevelCost(balance, 2); // round(20*1.06)
  const cost3 = towerLevelCost(balance, 3); // round(20*1.06^2)
  const r = maxTowerLevelUps(balance, 1, cost1 + cost2 + cost3 + 5); // 3번 살 돈 + 다음 레벨엔 모자란 잔돈
  assert.equal(r.levels, 3);
  assert.equal(r.cost, cost1 + cost2 + cost3);
  assert.equal(r.newLevel, 4);
});

test('maxTowerLevelUps: 첫 레벨업 비용도 안 되면 0레벨, 비용 0, 골드 그대로', () => {
  const r = maxTowerLevelUps(balance, 1, 5);
  assert.equal(r.levels, 0);
  assert.equal(r.cost, 0);
  assert.equal(r.newLevel, 1);
});

test('maxTowerLevelUps: 골드가 충분해도 maxLevel에서 멈춘다', () => {
  const capped = { tower: { ...balance.tower, maxLevel: 2 } };
  const r = maxTowerLevelUps(capped, 1, 1_000_000);
  assert.equal(r.levels, 1);
  assert.equal(r.newLevel, 2);
});
