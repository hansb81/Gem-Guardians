// 101층 이후 규칙(v13-5): 보스 HP 층 배율 bossHpMulAt, 적 성벽 피해 배율 wallDmgRaw. 테스트 안에서 만든 작은 balance로 본다(config 값과 무관).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bossHpMulAt, wallDmgRaw } from '../src/core/balance/floorGen.js';

const bal = (bossMul) => ({ floorShape: { bossMul: { hpMulByFloor: { _doc: 'x', 80: 0.8, 100: 0.76, 150: 1.2 }, ...bossMul } } });

test('bossHpMulAt: 1~100층은 그 층 키, 없으면 1.0 (cycleMul은 안 곱함)', () => {
  const B = bal({ cycleMul: 0.9 });
  assert.equal(bossHpMulAt(B, 80), 0.8);
  assert.equal(bossHpMulAt(B, 70), 1);
});

test('bossHpMulAt: 101층부터 같은 자리 1~100층 값 x cycleMul, 직접 넣은 키가 우선', () => {
  const B = bal({ cycleMul: 0.9 });
  assert.equal(bossHpMulAt(B, 180), 0.8 * 0.9);
  assert.equal(bossHpMulAt(B, 280), 0.8 * 0.9);
  assert.equal(bossHpMulAt(B, 200), 0.76 * 0.9); // ((200-1) % 100) + 1 = 100
  assert.equal(bossHpMulAt(B, 170), 0.9); // 70 키 없음 -> 1.0 x cycleMul
  assert.equal(bossHpMulAt(B, 150), 1.2); // 직접 키
  assert.equal(bossHpMulAt(bal({}), 180), 0.8); // cycleMul 없으면 1.0
});

test('wallDmgRaw: 100층까지 wallDmgGrowth^(f-1), 101층부터 100층 누적 x dmgGrowthAfter100^(f-100), 101층에서 안 튐', () => {
  const B = { scaling: { wallDmgGrowth: 1.015 }, wall: { dmgGrowthAfter100: 1.01 } };
  assert.equal(wallDmgRaw(B, 100), 1.015 ** 99);
  assert.ok(Math.abs(wallDmgRaw(B, 101) - 1.015 ** 99 * 1.01) < 1e-12);
  assert.ok(Math.abs(wallDmgRaw(B, 150) / wallDmgRaw(B, 149) - 1.01) < 1e-12);
  const same = { scaling: { wallDmgGrowth: 1.015 }, wall: {} }; // 키 없음 = 예전 식 그대로
  assert.equal(wallDmgRaw(same, 180), 1.015 ** 179);
});
