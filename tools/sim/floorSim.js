// 한 층 시도를 끝까지 구동하는 공용 엔진. src/core(보드·매치·특수 잼·방해요소·경제)와
// src/battle(전투)를 그대로 가져와 쓴다 - 규칙은 여기서 다시 짜지 않는다. T1~T5가 모두 이
// 함수 하나를 서로 다른 입력으로 호출해서 쓴다.
import { GameState } from '../../src/core/gameState.js';
import { BattleState } from '../../src/battle/battleState.js';
import { getFloor, resolveFloorSpawns } from '../../src/core/balance/floorGen.js';
import { towerAttack } from '../../src/core/economy/economy.js';
import { createRng } from '../../src/core/rng.js';
import { GEM_TYPES } from '../../src/config/gems.js';
import { SimBridge } from './simBridge.js';
import { chooseMove, DANGER_PROGRESS } from './bot.js';
import { deriveSeed } from './util.js';

export function runFloorAttempt({
  balance,
  enemies,
  obstacles,
  obstaclesEnabled = true,
  floorsData,
  floorNumber,
  towerLevels,
  playerCfg, // { secondsPerMove, pick, bombAware }
  modifierHooks, // modifiers.buildModifierHooks() 결과 | null
  seed,
  dt,
  maxFloorSeconds,
  summon,
  battleEffects,
}) {
  const floor = getFloor(balance, enemies, obstacles, floorsData, floorNumber);
  // 게임(main.js -> BattleController)과 같은 데이터를 그대로 쓴다 - 자리 채움을 두지 않는
  // 이유는, 비면 시뮬레이션이 게임과 다른 탑으로 조용히 돌아 결과가 어긋나기 때문이다.
  const towersData = balance.tower.towers.map((tower, i) => ({
    ...tower,
    stats: { ...tower.stats, attack: towerAttack(balance, towerLevels[i]) },
  }));

  const resolvedFloor = {
    wallHp: floor.wallHp,
    interval: floor.spawnInterval,
    spawns: resolveFloorSpawns(balance, enemies, floor),
  };

  const battleConfig = {
    cascadeBonusPerStep: balance.tower.puzzleShot.cascadeBonus,
    minDamage: 1,
    attackIntervalSec: enemies.attackInterval,
    effectDurationsMs: battleEffects.effectDurationsMs,
    summon,
    hooks: modifierHooks ?? undefined,
  };

  const battleState = new BattleState({ towersData, resolvedFloor, battleConfig });
  const obstaclesConfigForBoard = obstaclesEnabled ? obstacles : undefined;
  const floorObstacles = obstaclesEnabled ? floor.obstacles : null;
  const gameState = new GameState({
    seed: deriveSeed(seed, floorNumber, 1),
    obstaclesConfig: obstaclesConfigForBoard,
    floorObstacles,
  });
  gameState.shuffleBoard();
  const bridge = new SimBridge(battleState);
  const decisionRng = createRng(deriveSeed(seed, floorNumber, 2));

  let timeSec = 0;
  let moveTimer = 0;
  let swapCount = 0;
  let killGoldTotal = 0;
  const wallDamageByRole = {};
  const wallDamageByRank = {}; // normal/elite/boss - T1 실패 원인 분류용(역할별과는 다른 축).
  let bombWallDamageTotal = 0; // 시한폭탄(obstacleExpire)이 성벽에 준 피해 총합.
  let bossSeen = false; // 보스가 성벽 줄에 닿은 적이 있는지(progress>=1 도달).
  let bossKilled = false;
  let bossKilledBeforeWall = null; // 보스가 있는 층에서만 세팅 - true면 닿기 전에 처치.
  let probeCounter = 0;
  const seenEvents = new Set();

  function strongestColor() {
    let best = towersData[0];
    for (const t of towersData) if (t.stats.attack > best.stats.attack) best = t;
    return best.color;
  }

  while (battleState.status === 'active' && timeSec < maxFloorSeconds) {
    if (moveTimer <= 0) {
      const dangerEnemy = battleState.enemies.some((e) => e.state === 'alive' && e.progress >= DANGER_PROGRESS);
      const dangerColorId = dangerEnemy ? strongestColor() : null;
      const dangerColorIndex = dangerColorId != null ? GEM_TYPES.findIndex((g) => g.id === dangerColorId) : null;
      probeCounter++;
      const move = chooseMove(gameState, {
        obstaclesConfig: obstaclesConfigForBoard ?? null,
        pick: playerCfg.pick,
        bombAware: playerCfg.bombAware,
        rng: decisionRng,
        dangerColor: dangerColorIndex,
        probeSeedBase: deriveSeed(seed, floorNumber, 1000 + probeCounter),
      });
      if (move) {
        gameState.trySwap(move.r1, move.c1, move.r2, move.c2);
        swapCount++;
      }
      moveTimer = playerCfg.secondsPerMove;
    }

    gameState.update(dt);
    bridge.update(gameState);
    if (modifierHooks) modifierHooks.tick(dt, battleState);
    battleState.update(dt);

    for (const event of battleState.events) {
      if (seenEvents.has(event)) continue;
      seenEvents.add(event);
      if (event.type === 'enemyDie') {
        killGoldTotal += event.gold;
        if (event.rank === 'boss') {
          bossKilled = true;
          bossKilledBeforeWall = !bossSeen;
        }
      } else if (event.type === 'enemyReachLine') {
        const enemy = battleState.enemies.find((e) => e.id === event.enemyId);
        if (enemy?.rank === 'boss') bossSeen = true;
      } else if (event.type === 'wallDamaged') {
        if (event.source === 'obstacle') {
          bombWallDamageTotal += event.amount;
        } else if (event.sourceEnemyId != null) {
          const enemy = battleState.enemies.find((e) => e.id === event.sourceEnemyId);
          const role = enemy ? enemies.monsters[enemy.type]?.role ?? 'unknown' : 'unknown';
          const rank = enemy?.rank ?? 'unknown';
          wallDamageByRole[role] = (wallDamageByRole[role] ?? 0) + event.amount;
          wallDamageByRank[rank] = (wallDamageByRank[rank] ?? 0) + event.amount;
        }
      }
    }

    timeSec += dt;
    moveTimer -= dt;
  }

  const timedOut = battleState.status === 'active';
  return {
    floor: floor.floor,
    tag: floor.tag,
    status: timedOut ? 'timeout' : battleState.status,
    timeSec,
    wallHealthPct: battleState.wallHealth / battleState.wallMaxHealth,
    killGoldTotal,
    swapCount,
    killedCount: battleState._killedCount,
    totalEnemies: battleState.totalEnemies,
    bossSeen,
    bossKilled,
    bossKilledBeforeWall,
    wallDamageByRole,
    wallDamageByRank,
    bombWallDamageTotal,
    stats: bridge.stats,
  };
}
