import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UpgradeSfx } from '../src/audio/upgradeSfx.js';

const rec = () => {
  const calls = [];
  return { calls, sfx: new UpgradeSfx((key, o = {}) => calls.push([key, o.step ?? null, o.delayMs ?? 0])) };
};
const steps = (calls) => calls.map((c) => c[1]);

test('manifest에 guardian_upgrade 8개 파일과 guardian_tier_up이 있다', () => {
  const { sounds } = JSON.parse(readFileSync(new URL('../assets/sfx/manifest.json', import.meta.url), 'utf8'));
  assert.equal(sounds.guardian_upgrade.files.length, 8);
  assert.deepEqual(sounds.guardian_tier_up.files, ['guardian_tier_up']);
});

test('1.2초 안 연속 강화는 1..8에서 멈추고, 쉬거나 다른 수호자면 1부터', () => {
  const { calls, sfx } = rec();
  let t = 0;
  for (let i = 0; i < 10; i++) sfx.one(0, (t += 100), false);
  assert.deepEqual(steps(calls), [1, 2, 3, 4, 5, 6, 7, 8, 8, 8]);
  sfx.one(0, (t += 1200), false); // 딱 1.2초 = 아직 연속
  sfx.one(0, (t += 1201), false); // 넘게 쉼
  sfx.one(0, (t += 100), false);
  sfx.one(1, (t += 100), false); // 다른 수호자
  assert.deepEqual(steps(calls).slice(10), [8, 1, 2, 1]);
  assert.ok(calls.every((c) => c[0] === 'guardian_upgrade'));
});

test('모습 등급이 바뀌는 강화는 tier_up 한 번만, 다음 강화는 1부터', () => {
  const { calls, sfx } = rec();
  sfx.one(0, 0, false);
  sfx.one(0, 100, false);
  sfx.one(0, 200, true);
  sfx.one(0, 300, false);
  assert.deepEqual(calls.map((c) => [c[0], c[1]]), [['guardian_upgrade', 1], ['guardian_upgrade', 2], ['guardian_tier_up', null], ['guardian_upgrade', 1]]);
});

test('MAX +N은 소리 한 번 - step 8, 등급이 바뀌면 tier_up', () => {
  const a = rec();
  a.sfx.one(2, 0, false, true);
  assert.deepEqual(a.calls, [['guardian_upgrade', 8, 0]]);
  const b = rec();
  b.sfx.one(2, 0, true, true);
  assert.deepEqual(b.calls, [['guardian_tier_up', null, 0]]);
});

test('일괄 강화: 오른 줄마다 step 1,2,3…을 줄×80ms에, 등급이 바뀌었으면 끝에 tier_up 한 번', () => {
  const a = rec();
  a.sfx.all([0, 2, 3], false);
  assert.deepEqual(a.calls, [['guardian_upgrade', 1, 0], ['guardian_upgrade', 2, 160], ['guardian_upgrade', 3, 240]]);
  a.sfx.one(0, 0, false);
  assert.equal(a.calls.at(-1)[1], 1, '일괄 강화 뒤에는 1부터');
  const b = rec();
  b.sfx.all([0, 1, 2, 3, 4], true);
  assert.equal(b.calls.length, 6);
  assert.deepEqual(b.calls.at(-1), ['guardian_tier_up', null, 400]);
});
