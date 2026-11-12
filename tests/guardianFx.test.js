import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fxTier, outlineMask } from '../src/render/guardianFx.js';

test('guardianFx: tier = 레벨 이하인 구간 값의 개수', () => {
  const tiers = [10, 20, 35, 50, 70];
  assert.deepEqual([1, 9, 10, 19, 20, 35, 50, 69, 70, 200].map((l) => fxTier(l, tiers)), [0, 0, 1, 1, 2, 3, 4, 4, 5, 5]);
});

test('guardianFx: 윤곽 = 4방향 이웃 투명 칸, 12px 미만 덩어리는 제외', () => {
  const w = 8;
  const h = 8;
  const alpha = new Uint8Array(w * h);
  for (let y = 2; y < 6; y++) for (let x = 2; x < 6; x++) alpha[y * w + x] = 255; // 4x4 = 16px 몸
  alpha[0 * w + 7] = 255; // 떠다니는 점 1px
  const m = outlineMask(alpha, w, h);
  const W = w + 2;
  const on = (x, y) => m[(y + 1) * W + (x + 1)]; // 원본 좌표
  assert.equal(on(1, 3), 1); // 몸 왼쪽
  assert.equal(on(3, 6), 1); // 몸 아래
  assert.equal(on(1, 1), 0); // 대각선만 닿는 모서리는 아님
  assert.equal(on(3, 3), 0); // 몸 안
  assert.equal(on(6, 0), 0); // 점 옆은 윤곽 없음
  assert.equal(m.reduce((a, b) => a + b, 0), 16);
});

test('guardianFx: 공격 hit+residue 합계 40개 제한(오래된 것부터), 같은 몬스터 잔상은 다시 재생', async () => {
  const { GuardianAttackFx, ATK_FX_MAX, atkFrame } = await import('../src/render/guardianFx.js');
  const fx = new GuardianAttackFx();
  for (let i = 0; i < ATK_FX_MAX + 5; i++) fx.hit(0, 'red', i, 0, 3, false, i);
  assert.equal(fx._fx.length, ATK_FX_MAX);
  assert.equal(fx._fx[0].startMs, 5); // 0~4 지워짐
  assert.equal(fx._pool.length, 1); // 밀려난 객체를 다음 hit이 다시 씀
  fx.residue('e1', 'red', 10, 20, 3, false, 100);
  fx.residue('e1', 'red', 11, 21, 3, false, 200);
  const res = fx._fx.filter((o) => o.kind === 'residue');
  assert.equal(res.length, 1);
  assert.equal(res[0].startMs, 200);
  assert.equal(fx._fx.at(-1), res[0]);
  assert.equal(fx._fx.length, ATK_FX_MAX);
  // 프레임: 1회 재생은 끝나면 -1, 반복은 돌아간다.
  assert.equal(atkFrame({ frames: 4, frameMs: 60, loop: false }, 239), 3);
  assert.equal(atkFrame({ frames: 4, frameMs: 60, loop: false }, 240), -1);
  assert.equal(atkFrame({ frames: 6, frameMs: 60, loop: true }, 360), 0);
});

test('guardianFx: 투사체 각도는 15도 단위, ±60도에서 자르고 왼쪽은 반전 기준', async () => {
  const { quantizeAngle } = await import('../src/render/guardianFx.js');
  assert.equal(quantizeAngle(10, 0), 0);
  assert.equal(quantizeAngle(10, 2), 15); // 11.3도
  assert.equal(quantizeAngle(10, -10), -45);
  assert.equal(quantizeAngle(1, 10), 60); // 84도 -> 60
  assert.equal(quantizeAngle(-10, 10), 45); // 왼쪽 아래 = 반전한 뒤 45도
  assert.equal(quantizeAngle(10, -0.1), 0); // -0 아님
});
