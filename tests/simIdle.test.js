// tools/sim/idle.js(--idle 광산 모델) 하루 정산이 손계산과 맞는지. 수치는 여기 고정(config/mine.json을 바꿔도 안 깨지게).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mineDay, newIdleMine } from '../tools/sim/idle.js';

const cfg = {
  unlockFloor: 10,
  veins: [10, 20, 30, 40, 50].map((f, i) => ({ id: `v${i}`, unlockBossFloor: f })),
  prod: { base: 10, growth: 1.12 },
  cost: { base: 40, growth: 1.2 },
  maxLv: { base: 5, perFloors: 5 },
  storage: { hours: [8], bigBonusHours: 4 },
  gold: { perDay: 4, costs: [50, 100, 200, 400], rMul: 2 },
  passBonus: { monthly: 0.25 },
  unlockGift: 50,
};

test('idle: 10층 보스 전에는 광산이 없다', () => {
  const mine = newIdleMine(cfg);
  assert.deepEqual(mineDay(cfg, mine, { day: 1, clearedFloor: 9, bestFloor: 10, R: 100, visits: 2 }), { gold: 0, pouches: 0 });
  assert.equal(mine.ore, 0);
});

test('idle: 하루 주머니 수·골드·레벨업·이월이 손계산과 같다', () => {
  const mine = newIdleMine(cfg);
  // 1일: 선물 50 + 10 x 8 x 2 = 210 -> 주머니 50, 100(남 60, 200은 못 삼) -> 골드 2 x 100 x 2 = 400 -> Lv1->2(40) -> 남 20
  assert.deepEqual(mineDay(cfg, mine, { day: 1, clearedFloor: 10, bestFloor: 11, R: 100, visits: 2 }), { gold: 400, pouches: 2 });
  assert.deepEqual([mine.veins, mine.ore], [[2, 0, 0, 0, 0], 20]);
  // 2일: 11.2 x 16 = 179.2 -> 수확 179(소수는 수레에 남음) + 20 = 199 -> 주머니 50, 100(남 49) -> Lv2->3(48) -> 남 1
  assert.deepEqual(mineDay(cfg, mine, { day: 2, clearedFloor: 10, bestFloor: 11, R: 150, visits: 2 }), { gold: 600, pouches: 2 });
  assert.deepEqual([mine.veins, mine.ore], [[3, 0, 0, 0, 0], 1]);
});

test('idle: 주머니는 하루 4개까지, 레벨업은 가장 싼 광맥부터 최대 레벨(5 + floor(최고 층 / 5))까지', () => {
  const mine = newIdleMine(cfg);
  mine.ore = 1e6;
  const r = mineDay(cfg, mine, { day: 1, clearedFloor: 20, bestFloor: 21, R: 100, visits: 3 });
  assert.deepEqual(r, { gold: 800, pouches: 4 });
  assert.deepEqual(mine.veins, [9, 9, 0, 0, 0]);
  // rMul 덮어쓰기(--idleRMul)는 cfg 사본의 gold.rMul만 바꾼다. 같은 날에는 더 못 산다.
  assert.equal(mineDay(cfg, mine, { day: 1, clearedFloor: 20, bestFloor: 21, R: 100, visits: 3 }).pouches, 0);
  assert.equal(mineDay({ ...cfg, gold: { ...cfg.gold, rMul: 1 } }, mine, { day: 2, clearedFloor: 20, bestFloor: 21, R: 100, visits: 3 }).gold, 400);
});
