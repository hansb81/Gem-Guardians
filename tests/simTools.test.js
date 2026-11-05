// tools/sim(밸런스 시뮬레이터)의 핵심 보장 3가지(docs/simulation.md): 같은 시드는 항상 같은
// 결과, 봇은 항상 유효한(실제로 Resolution이 생기는) 스왑만 고른다, modifier가 none이면 실제
// 게임 전투와 피해 값이 같다(= battleConfig.hooks가 없을 때와 동일 - battleState.test.js의
// "가상 효과 훅" 쪽에서 이미 보장).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runFloorAttempt } from '../tools/sim/floorSim.js';
import { findCandidateMoves } from '../tools/sim/bot.js';
import { GameState } from '../src/core/gameState.js';
import { Board } from '../src/core/board.js';
import { createRng } from '../src/core/rng.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CFG = join(__dirname, '..', 'config');
const load = (name) => JSON.parse(readFileSync(join(CFG, name), 'utf8'));

const balance = load('balance.json');
const enemies = load('enemies.json');
const obstacles = load('obstacles.json');
const floorsData = load('floors.json');
const battleEffects = JSON.parse(readFileSync(join(__dirname, '..', 'src', 'config', 'battle.json'), 'utf8'));

function baseArgs(overrides = {}) {
  return {
    balance,
    enemies,
    obstacles,
    obstaclesEnabled: true,
    floorsData,
    floorNumber: 15,
    towerLevels: [5, 5, 5, 5, 5],
    playerCfg: { secondsPerMove: 2.5, pick: 'top3', bombAware: true },
    modifierHooks: null,
    seed: 42,
    dt: 0.05,
    maxFloorSeconds: 120,
    summon: null,
    battleEffects,
    ...overrides,
  };
}

test('결정성: 같은 시드로 두 번 돌리면 결과가 완전히 같다', () => {
  const a = runFloorAttempt(baseArgs());
  const b = runFloorAttempt(baseArgs());
  assert.deepEqual(a, b);
});

test('결정성: seed가 다르면(보통) 결과가 달라진다 - 완전히 같은 seed 무시 버그가 아닌지 확인', () => {
  const a = runFloorAttempt(baseArgs({ seed: 1 }));
  const b = runFloorAttempt(baseArgs({ seed: 2 }));
  assert.notDeepEqual(a, b);
});

test('봇: findCandidateMoves가 고른 스왑은 전부 실제로 Resolution을 만든다(= 유효한 수)', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const board = new Board({ rng: createRng(seed) });
    const gameState = new GameState({ board, obstaclesConfig: obstacles, floorObstacles: { crate: { initial: 4, everyMoves: 0 } } });
    const candidates = findCandidateMoves(gameState);
    assert.ok(candidates.length > 0, `seed ${seed}: 후보가 하나도 없음(보드가 막힘?)`);

    for (const move of candidates) {
      const probe = new GameState({
        board: (() => {
          const b = new Board({ rng: createRng(seed * 1000) });
          b.grid = gameState.board.grid.slice();
          b.specials = gameState.board.specials.map((s) => (s ? { ...s } : null));
          b.occupants = gameState.board.occupants.map((o) => (o ? { ...o } : null));
          b.attachments = gameState.board.attachments.map((a) => (a ? { ...a } : null));
          return b;
        })(),
        obstaclesConfig: obstacles,
        floorObstacles: null,
      });
      probe.trySwap(move.r1, move.c1, move.r2, move.c2);
      assert.ok(probe.resolutions.length > 0, `seed ${seed} move ${JSON.stringify(move)}는 Resolution을 안 만든다`);
    }
  }
});
