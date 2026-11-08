// 한 층 시도를 끝까지 구동하는 공용 엔진. src/core(보드·매치·특수 잼·방해요소·경제)와
// src/battle(전투)를 그대로 가져와 쓴다 - 규칙은 여기서 다시 짜지 않는다. T1~T6가 모두 이
// 함수 하나를 서로 다른 입력으로 호출해서 쓴다.
import { GameState } from '../../src/core/gameState.js';
import { BattleState } from '../../src/battle/battleState.js';
import { getFloor, resolveFloorSpawns } from '../../src/core/balance/floorGen.js';
import { towerAttack } from '../../src/core/economy/economy.js';
import { createRng } from '../../src/core/rng.js';
import { GEM_TYPES } from '../../src/config/gems.js';
import { ItemController } from '../../src/game/itemController.js';
import { SimBridge } from './simBridge.js';
import { chooseMove, DANGER_PROGRESS } from './bot.js';
import { pickItemUse } from './itemBot.js';
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
  skills = null, // config/skills.json(unlocked 조정본) | null = 기술 없음(skills.js skillsFor)
  bossRules = false, // false면 보스 면역·약점·넉백 면역을 비운다
  attackMul = 1, // T2 needPower 탐색용 공격력 배율(기본 사격·기술 모두에 걸린다)
  itemBot = null, // { config: items.json, inventory: {id: count}, equipped: [id] } | null (T6)
}) {
  const floor = getFloor(balance, enemies, obstacles, floorsData, floorNumber);
  // 게임(main.js -> BattleController)과 같은 데이터를 그대로 쓴다 - 자리 채움을 두지 않는
  // 이유는, 비면 시뮬레이션이 게임과 다른 탑으로 조용히 돌아 결과가 어긋나기 때문이다.
  const towersData = balance.tower.towers.map((tower, i) => ({
    ...tower,
    stats: { ...tower.stats, attack: towerAttack(balance, towerLevels[i]) * attackMul },
  }));

  let spawns = resolveFloorSpawns(balance, enemies, floor);
  if (!bossRules) spawns = spawns.map((s) => ({ ...s, immune: [], weak: [], knockbackImmune: false }));
  const resolvedFloor = { wallHp: floor.wallHp, interval: floor.spawnInterval, spawnAt: floor.spawnAt, spawns };

  const battleConfig = {
    cascadeBonusPerStep: balance.tower.puzzleShot.cascadeBonus,
    minDamage: 1,
    attackIntervalSec: enemies.attackInterval,
    effectDurationsMs: battleEffects.effectDurationsMs,
    summon,
    hooks: modifierHooks ?? undefined,
    skills: skills ?? undefined,
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

  // 색 효과 발동 횟수 계측 - 규칙은 battleState가 그대로 돌고, 호출만 센다(면역으로 막힌 건 따로).
  const effectCounts = Object.fromEntries(GEM_TYPES.map((g) => [g.id, 0]));
  let immuneCount = 0;
  if (skills) {
    const orig = battleState._applyColorEffect.bind(battleState);
    battleState._applyColorEffect = (target, color, damage, ultimate) => {
      if (skills.unlocked.colorEffects[color]) {
        if (target.immune.includes(color)) immuneCount++;
        else effectCounts[color]++;
      }
      return orig(target, color, damage, ultimate);
    };
  }

  const itemCtl = itemBot
    ? new ItemController({
        config: itemBot.config,
        player: { items: itemBot.inventory, equipped: itemBot.equipped, save() {} },
        gameState,
        battleState,
      })
    : null;
  const itemsUsed = {};

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
  // 피해 출처별 합(오버킬 포함) - basic(기본 사격), skill(특수 잼 기술), splash(레드 범위), poison(퍼플 독).
  const damageBySource = { basic: 0, skill: 0, splash: 0, poison: 0 };
  const skillCasts = {}; // skill id -> 발동 횟수
  // 상태 효과가 막은 성벽 피해(추정): 경직·정지 = 성벽에 붙은 채 못 때린 시간 x 초당 성벽 피해,
  // 감속 = 성벽에 닿기까지 늦어진 시간 x 초당 성벽 피해(닿은 적만 - 닿기 전에 죽으면 0).
  const blockedWall = { stun: 0, slow: 0, freeze: 0 };
  const slowDelaySec = new Map(); // enemyId -> 감속으로 늦어진 초
  const freezeDelaySec = new Map(); // enemyId -> 모래시계 정지로 늦어진 초(성벽 닿기 전)
  const attackInterval = enemies.attackInterval;

  function strongestColor() {
    let best = towersData[0];
    for (const t of towersData) if (t.stats.attack > best.stats.attack) best = t;
    return best.color;
  }

  while (battleState.status === 'active' && timeSec < maxFloorSeconds) {
    if (moveTimer <= 0) {
      if (itemCtl) {
        const use = pickItemUse(itemCtl, gameState, battleState);
        if (use) {
          const res = itemCtl.use(use.id, use.target);
          if (res.ok && !res.pending) itemsUsed[use.id] = (itemsUsed[use.id] ?? 0) + 1;
        }
      }
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
    if (itemCtl) {
      const done = itemCtl.update(dt);
      if (done?.ok) itemsUsed[done.id] = (itemsUsed[done.id] ?? 0) + 1;
    }
    bridge.update(gameState);
    if (modifierHooks) modifierHooks.tick(dt, battleState);
    battleState.update(dt);

    if (skills || itemCtl) {
      for (const e of battleState.enemies) {
        if (e.state !== 'alive') continue;
        const perSec = e.wallDmg / attackInterval;
        if (e.progress >= 1) {
          if (e.effects.stun.time > 1e-9) blockedWall.stun += perSec * dt;
          else if (itemCtl && battleState.isEnemyFrozen(e)) blockedWall.freeze += perSec * dt;
        } else if (itemCtl && battleState.isEnemyFrozen(e)) {
          freezeDelaySec.set(e.id, (freezeDelaySec.get(e.id) ?? 0) + dt);
        } else if (e.effects.slow.time > 1e-9) {
          slowDelaySec.set(e.id, (slowDelaySec.get(e.id) ?? 0) + (1 - e.effects.slow.mul) * dt);
        }
      }
    }

    for (const event of battleState.events) {
      if (seenEvents.has(event)) continue;
      seenEvents.add(event);
      if (event.type === 'enemyDie') {
        killGoldTotal += event.gold;
        if (event.rank === 'boss') {
          bossKilled = true;
          bossKilledBeforeWall = !bossSeen;
        }
      } else if (event.type === 'enemyHit') {
        damageBySource[event.source ?? 'basic'] += event.damage;
      } else if (event.type === 'skillCast') {
        skillCasts[event.skill] = (skillCasts[event.skill] ?? 0) + 1;
      } else if (event.type === 'enemyReachLine') {
        const enemy = battleState.enemies.find((e) => e.id === event.enemyId);
        if (enemy?.rank === 'boss') bossSeen = true;
        if (enemy && slowDelaySec.has(enemy.id)) blockedWall.slow += (slowDelaySec.get(enemy.id) * enemy.wallDmg) / attackInterval;
        if (enemy && freezeDelaySec.has(enemy.id)) blockedWall.freeze += (freezeDelaySec.get(enemy.id) * enemy.wallDmg) / attackInterval;
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
    damageBySource,
    effectCounts,
    immuneCount,
    skillCasts,
    blockedWall,
    itemsUsed,
    stats: bridge.stats,
  };
}
