// Animator.reset() - 퍼즐 보드가 새로 만들어졌을 때(층 전환) "지난 프레임" 기억을 비우는지만
// 확인한다(puzzleBattleBridge.test.js의 reset() 테스트와 같은 이유).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Animator, computeShuffleMovePose } from '../src/render/animator.js';

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

// computeShuffleMovePose: 0ms(시작)/phases.convergeMs(1->2단계 경계)/phases.totalMs(끝) 세
// 지점만 본다 - 그 경계들이 서로 자연스럽게 이어지는지가 핵심이라, 중간값은 수치를 손으로
// 다시 유도해야 해서 스냅샷하지 않았다(§셔플 애니메이션, config/effects.json의 shuffleAnim).
test('computeShuffleMovePose: 0ms엔 from 칸에 그대로, scale은 1이다', () => {
  const cfg = effectsConfig.shuffleAnim;
  const move = { from: { row: 0, col: 0 }, to: { row: 6, col: 6 } };
  const pose = computeShuffleMovePose(move, 0, cfg, 7, 7);
  assert.equal(pose.row, 0);
  assert.equal(pose.col, 0);
  assert.equal(pose.scale, 1);
});

test('computeShuffleMovePose: phases.totalMs(끝)엔 to 칸에 도착하고, scale은 scatter.scaleTo다', () => {
  const cfg = effectsConfig.shuffleAnim;
  const move = { from: { row: 0, col: 0 }, to: { row: 6, col: 6 } };
  const pose = computeShuffleMovePose(move, cfg.phases.totalMs, cfg, 7, 7);
  assert.equal(pose.row, 6);
  assert.equal(pose.col, 6);
  assert.equal(pose.scale, cfg.scatter.scaleTo);
});

test('computeShuffleMovePose: phases.convergeMs(1->2단계 경계)엔 중심 기준 최대 회전·축소된 지점에 있고, scale은 converge.scale이다', () => {
  const cfg = effectsConfig.shuffleAnim;
  const rows = 7;
  const cols = 7;
  const move = { from: { row: 0, col: 0 }, to: { row: 6, col: 6 } };
  const pose = computeShuffleMovePose(move, cfg.phases.convergeMs, cfg, rows, cols);

  // 손으로 다시 유도: center=(3,3), v=(from-center)=(-3,-3), radiusScale=1-pullRatio=0.3 ->
  // (-0.9,-0.9), maxRotationDeg(90도)만큼 회전 -> row'=3-0.9=2.1, col'=3+0.9=3.9.
  assert.ok(Math.abs(pose.row - 2.1) < 1e-9, `row=${pose.row}`);
  assert.ok(Math.abs(pose.col - 3.9) < 1e-9, `col=${pose.col}`);
  assert.equal(pose.scale, cfg.converge.scale);
});

test('computeShuffleMovePose: 단계 경계에서 값이 끊기지 않는다(popMs/scatterMs 전후가 연속)', () => {
  const cfg = effectsConfig.shuffleAnim;
  const move = { from: { row: 1, col: 2 }, to: { row: 5, col: 4 } };
  const eps = 1e-6;

  const beforePop = computeShuffleMovePose(move, cfg.phases.popMs - eps, cfg, 7, 7);
  const afterPop = computeShuffleMovePose(move, cfg.phases.popMs, cfg, 7, 7);
  assert.ok(Math.abs(beforePop.row - afterPop.row) < 1e-3);
  assert.ok(Math.abs(beforePop.scale - afterPop.scale) < 1e-3);

  // scatterMs 경계: to.row(5) * rowStaggerMs만큼 늦게 시작하는 행이라도 경계 양쪽 값이 이어져야 한다.
  const beforeScatter = computeShuffleMovePose(move, cfg.phases.scatterMs - eps, cfg, 7, 7);
  const afterScatter = computeShuffleMovePose(move, cfg.phases.scatterMs, cfg, 7, 7);
  assert.ok(Math.abs(beforeScatter.row - afterScatter.row) < 1e-3);
  assert.ok(Math.abs(beforeScatter.col - afterScatter.col) < 1e-3);
});
