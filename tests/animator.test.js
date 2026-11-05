// Animator.reset() - 퍼즐 보드가 새로 만들어졌을 때(층 전환) "지난 프레임" 기억을 비우는지만
// 확인한다(puzzleBattleBridge.test.js의 reset() 테스트와 같은 이유).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Animator, computeShuffleFallTiming, shuffleElapsedMs } from '../src/render/animator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const effectsConfig = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'config', 'effects.json'), 'utf8'));

test('reset()은 newly-clearing/newly-settled 판정용 Set 4개를 모두 비운다', () => {
  const animator = new Animator();
  animator._prevClearing.add(1);
  animator._scratchClearing.add(2);
  animator._prevFalling.add(3);
  animator._scratchFalling.add(4);

  animator.reset();

  assert.equal(animator._prevClearing.size, 0);
  assert.equal(animator._scratchClearing.size, 0);
  assert.equal(animator._prevFalling.size, 0);
  assert.equal(animator._scratchFalling.size, 0);
});

// computeShuffleFallTiming(seed, rows, cols, shuffleAnim) - 셔플 "떨어지며 쌓이기" 연출의
// 칸별 시작/착지 시각을 돌려주는 순수 함수(§셔플 애니메이션). 7x7 보드 기준으로 요구된
// 네 가지 성질만 확인한다(값 자체는 seed 기반 난수라 손으로 다시 유도하지 않는다).
const ROWS = 7;
const COLS = 7;

test('computeShuffleFallTiming: 같은 seed면 같은 결과다', () => {
  const a = computeShuffleFallTiming(42, ROWS, COLS, effectsConfig.shuffleAnim);
  const b = computeShuffleFallTiming(42, ROWS, COLS, effectsConfig.shuffleAnim);
  assert.deepEqual(a, b);
});

test('computeShuffleFallTiming: 모든 칸의 착지 시각은 phases.fallEndMs(860ms) 이하다', () => {
  for (const seed of [1, 2, 3, 12345, 999999]) {
    const timing = computeShuffleFallTiming(seed, ROWS, COLS, effectsConfig.shuffleAnim);
    for (const entry of timing) {
      assert.ok(entry.landMs <= effectsConfig.shuffleAnim.phases.fallEndMs, `landMs=${entry.landMs}`);
    }
  }
});

test('computeShuffleFallTiming: 같은 열에서 위 칸의 착지는 바로 아래 칸의 착지 + 최소 30ms다', () => {
  const minGapMs = effectsConfig.shuffleAnim.fall.minGapMs;
  for (const seed of [1, 2, 3, 12345, 999999]) {
    const timing = computeShuffleFallTiming(seed, ROWS, COLS, effectsConfig.shuffleAnim);
    for (let c = 0; c < COLS; c++) {
      for (let r = 0; r < ROWS - 1; r++) {
        const upper = timing[r * COLS + c];
        const lower = timing[(r + 1) * COLS + c];
        assert.ok(upper.landMs >= lower.landMs + minGapMs - 1e-9, `row ${r} vs ${r + 1}, col ${c}`);
      }
    }
  }
});

test('computeShuffleFallTiming: 맨 아래 행(마지막 row)이 각 열에서 가장 먼저 시작한다', () => {
  for (const seed of [1, 2, 3, 12345, 999999]) {
    const timing = computeShuffleFallTiming(seed, ROWS, COLS, effectsConfig.shuffleAnim);
    for (let c = 0; c < COLS; c++) {
      const bottomStart = timing[(ROWS - 1) * COLS + c].startMs;
      for (let r = 0; r < ROWS - 1; r++) {
        assert.ok(timing[r * COLS + c].startMs >= bottomStart, `row ${r}, col ${c}`);
      }
    }
  }
});

// 입장 셔플(skipClear) - 층에 들어올 때는 치울 이전 보드가 없으므로 §0 비우기(기존 자리에서
// 가라앉으며 페이드아웃)를 건너뛴다. 그 단계를 그대로 쓰면 방금 만든 보드가 내려가며
// 사라졌다가 다시 위에서 떨어지는 "두 번 떨어지는" 연출이 된다.
const CLEAR_MS = effectsConfig.shuffleAnim.phases.clearMs;

function shuffleFx(overrides = {}) {
  return {
    type: 'shuffle',
    elapsedMs: 0,
    durationMs: effectsConfig.shuffleAnim.phases.totalMs,
    seed: 12345,
    moves: [{ id: 0, from: { row: 6, col: 0 }, to: { row: 0, col: 0 }, value: 0, special: null }],
    ...overrides,
  };
}

test('shuffleElapsedMs: skipClear면 비우기 단계만큼 타임라인을 앞당기고, 아니면 그대로다', () => {
  const cfg = effectsConfig.shuffleAnim;
  assert.equal(shuffleElapsedMs(shuffleFx({ elapsedMs: 0 }), cfg), 0);
  assert.equal(shuffleElapsedMs(shuffleFx({ elapsedMs: 40 }), cfg), 40);
  assert.equal(shuffleElapsedMs(shuffleFx({ elapsedMs: 0, skipClear: true }), cfg), CLEAR_MS);
  assert.equal(shuffleElapsedMs(shuffleFx({ elapsedMs: 40, skipClear: true }), cfg), CLEAR_MS + 40);
});

test('입장 셔플(skipClear)은 t=0에 "원래 자리에서 가라앉으며 사라지는" 젬을 그리지 않는다', () => {
  const animator = new Animator();
  // 비우기 단계 한가운데(t=0 ~ clearMs)에 재배치는 from 자리에 반투명 젬을 그린다.
  const reshuffle = animator._getShuffleDisplayList(shuffleFx({ elapsedMs: CLEAR_MS / 2 }), ROWS, COLS, effectsConfig);
  assert.equal(reshuffle.length, 1, '재배치는 비우기 단계에 젬을 그린다');
  assert.equal(reshuffle[0].row, 6 + 0.3 * 0.5, 'from(6행)에서 아래로 가라앉는다');
  assert.ok(reshuffle[0].opacity < 1, '페이드아웃 중이어야 한다');

  // 같은 시각, 입장 연출은 이미 낙하 구간이라 from 자리에 아무것도 없다.
  const entry = animator._getShuffleDisplayList(
    shuffleFx({ elapsedMs: CLEAR_MS / 2, skipClear: true }),
    ROWS,
    COLS,
    effectsConfig
  );
  for (const item of entry) {
    assert.equal(item.opacity, 1, '입장 연출엔 페이드아웃이 없다');
    assert.ok(item.row < 6, 'from(6행)에 가라앉는 젬이 남아 있으면 안 된다');
  }
});

test('입장 셔플도 낙하 자체는 재배치와 같은 타이밍을 쓴다(끝 모습이 같다)', () => {
  const animator = new Animator();
  const { fallEndMs } = effectsConfig.shuffleAnim.phases;
  const entry = animator._getShuffleDisplayList(
    shuffleFx({ elapsedMs: fallEndMs, skipClear: true }),
    ROWS,
    COLS,
    effectsConfig
  );
  assert.equal(entry.length, 1);
  assert.equal(entry[0].row, 0, '낙하가 끝나면 목표 칸(0행)에 있다');
  assert.equal(entry[0].col, 0);
});
