// 석상 소환 연출(src/battle/summon.js) 슬롯별 프레임 선택 테스트. 실제
// assets/summon/manifest.json 수치(staggerMs=120, frameMs 16개, 총 990ms)를 그대로 쓴다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickSummonFrame, isSummonDone } from '../src/battle/summon.js';

const CFG = {
  staggerMs: 120,
  frameMs: [70, 60, 60, 40, 40, 50, 60, 60, 60, 60, 60, 60, 70, 70, 80, 90],
};
const TOTAL_MS = CFG.frameMs.reduce((a, b) => a + b, 0); // 990
const SLOT_COUNT = 5;

test('t=0: 슬롯0은 프레임0에서 시작하고, 슬롯1은 아직 시작 전', () => {
  const slot0 = pickSummonFrame(0, 0, CFG);
  assert.equal(slot0.started, true);
  assert.equal(slot0.frame, 0);
  assert.equal(slot0.done, false);

  const slot1 = pickSummonFrame(0, 1, CFG);
  assert.equal(slot1.started, false);
});

test('슬롯 i는 i * staggerMs 뒤에 시작한다', () => {
  const justBefore = pickSummonFrame(CFG.staggerMs - 1, 1, CFG);
  assert.equal(justBefore.started, false);

  const atStart = pickSummonFrame(CFG.staggerMs, 1, CFG);
  assert.equal(atStart.started, true);
  assert.equal(atStart.frame, 0);
});

test('frameMs 누적(가변 길이)으로 프레임 경계를 정확히 넘는다', () => {
  // frame0(70ms) + frame1(60ms) = 130ms 누적 - 129ms는 아직 frame1, 130ms부터 frame2.
  const before = pickSummonFrame(129, 0, CFG);
  assert.equal(before.frame, 1);
  const at = pickSummonFrame(130, 0, CFG);
  assert.equal(at.frame, 2);
});

test(`t = 총시간(${TOTAL_MS}ms) + 4 * staggerMs 이후에는 모든 슬롯이 done이다`, () => {
  const elapsed = TOTAL_MS + 4 * CFG.staggerMs;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const slot = pickSummonFrame(elapsed, i, CFG);
    assert.equal(slot.started, true, `슬롯 ${i}는 시작했어야 한다`);
    assert.equal(slot.done, true, `슬롯 ${i}는 done이어야 한다`);
  }
  assert.equal(isSummonDone(elapsed, SLOT_COUNT, CFG), true);
});

test('isSummonDone: 마지막 슬롯이 아직 끝나지 않았으면 false', () => {
  const lastSlotStart = (SLOT_COUNT - 1) * CFG.staggerMs;
  const elapsed = lastSlotStart + TOTAL_MS - 1; // 마지막 슬롯이 끝나기 1ms 전.
  assert.equal(isSummonDone(elapsed, SLOT_COUNT, CFG), false);
});

test('isSummonDone: slotCount가 0이면 항상 true(소환 자체가 없음)', () => {
  assert.equal(isSummonDone(0, 0, CFG), true);
});
