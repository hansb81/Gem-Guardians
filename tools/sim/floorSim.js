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
  // 패배 직후 이어하기(S3): () => 'ad' | 'feather' | null. 값이 있으면 items.revive 효과로 1번 부활(층당 1회 - 깃털·광고 공유,
  // items.json adContinue.sharePerFloorWithRevive). 효과는 게임 ItemController.continueFree와 같은 battleState.revive.
  onFail = null,
  reviveCfg = null, // config/items.json items.revive
  // 측정 전용(S6 허공 사격 (b)): true면 기본 사격을 즉시 명중 대신 게임 렌더의 비행 시간(flightSecOf) 뒤에 명중시킨다.
  // 규칙은 그대로(battleState의 pendingDamage 예약·_pickTarget이 게임처럼 작동) - 기술은 계속 즉시 명중.
  shotFlight = false,
  // 빈 전장 즉시 등장(게임 규칙 - src/core/balance/emptySpawn.js, battleState._pullSpawn) 덮어쓰기: 'off'|'on'|'predict'.
  // null이면 balance.json floorShape.emptySpawn(게임 그대로). 쿨다운은 balance.floorShape.emptySpawnCooldown.
  emptySpawn = null,
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
  // 게임(BattleController._resetBattleState)과 같은 필드. emptySpawn만 옵션으로 덮어쓸 수 있다.
  const resolvedFloor = {
    wallHp: floor.wallHp, interval: floor.spawnInterval, spawnAt: floor.spawnAt, spawns,
    emptySpawn: emptySpawn ?? balance.floorShape.emptySpawn, emptySpawnCooldown: balance.floorShape.emptySpawnCooldown, packGap: balance.floorShape.pack?.gap,
  };

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
  const inFlight = []; // shotFlight: { event, left(초) }
  const bridge = new SimBridge(battleState, shotFlight ? (event) => {
    // 쏠 때 이미 "예약 피해로 죽을 적"이었는지(_pickTarget 폴백 = 모두 죽을 예정이라 맨 앞 적).
    const t = battleState.enemies.find((e) => e.id === event.targetEnemyId);
    const doomed = !!t && t.currentHealth - (t.pendingDamage - event.damage) <= 0;
    inFlight.push({ event, doomed, left: flightSecOf(battleState, towersData, event) });
  } : null);
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

  // S6 허공 사격 계측(규칙은 그대로, 호출만 감싼다): 살아 있는 적이 없어 버려진 기본 사격·기술의 피해(방어 전 값).
  // 시뮬은 탄이 즉시 명중하므로 "날아가는 중 대상이 사라져 버려진 탄"은 0이다(게임에서만 생김 - 측정 불가).
  // flight = 쏠 때 대상은 있었는데 명중 전에 죽어 버려진 탄(shotFlight에서만, 방어 후 피해).
  // overkill = 명중했지만 남은 HP를 넘긴 초과분(출처별: basic/skill/splash/poison).
  // flightDoomed = flight 중 쏠 때 이미 예약 피해로 죽을 예정이던 적을 노린 몫(폴백).
  const waste = { basic: 0, skill: 0, summon: 0, flight: 0, flightDoomed: 0, overkill: { basic: 0, skill: 0, splash: 0, poison: 0 } };
  {
    const origDamage = battleState._damageEnemy.bind(battleState);
    battleState._damageEnemy = (target, damage, fields) => {
      const over = damage - Math.max(0, target.currentHealth);
      if (over > 0) {
        const k = fields?.source ?? 'basic';
        waste.overkill[k] = (waste.overkill[k] ?? 0) + over;
      }
      return origDamage(target, damage, fields);
    };
  }
  const hasAlive = () => battleState.enemies.some((e) => e.state === 'alive');
  let emptySpawns = 0; // 즉시 등장(_pullSpawn)으로 앞당겨 등장시킨 횟수
  {
    // 즉시 등장은 battleState 안(_pullSpawn)에서 대상 선정 직전에 일어난다 - 그래서 허공 판정은 호출 뒤에 본다:
    // 기본 사격 = 전투 중·count > 0인데 탄이 안 나감(대상 없음), 기술 = 열린 기술인데 skillCast가 안 나감.
    const origPull = battleState._pullSpawn.bind(battleState);
    battleState._pullSpawn = () => {
      const pulled = origPull();
      if (pulled) emptySpawns++;
      return pulled;
    };
    const origClear = battleState.applyGemClear.bind(battleState);
    battleState.applyGemClear = (color, count, cascadeIndex, ...rest) => {
      const summoning = battleState.summon.active;
      const event = origClear(color, count, cascadeIndex, ...rest);
      if (!event && battleState.status === 'active' && count > 0 && !hasAlive()) {
        const t = towersData.find((x) => x.color === color);
        const w = t ? t.stats.attack * battleState.atkMul * count * (1 + battleConfig.cascadeBonusPerStep * (cascadeIndex - 1)) : 0;
        waste.basic += w;
        // 게임은 소환 연출 중 스왑을 막는다(main.js isBlocked) - 시뮬 봇은 막히지 않아 생기는 몫(보고용 분리).
        if (summoning) waste.summon += w;
      }
      return event;
    };
    const origCast = battleState._castSkill.bind(battleState);
    battleState._castSkill = (specialType, color, chosenColor, cascadeIndex) => {
      const sk = skills?.specialGemToSkill[specialType];
      const spec = skills?.specialSkills[sk];
      const castsBefore = battleState._nextCastId;
      const out = origCast(specialType, color, chosenColor, cascadeIndex);
      if (spec && skills.unlocked?.specialSkills?.[sk] && battleState.status === 'active' && battleState._nextCastId === castsBefore && !hasAlive()) {
        const tw = sk === 'color_color' ? null : towersData.find((x) => x.color === (sk === 'color' ? chosenColor : color));
        const atk = tw ? tw.stats.attack : towersData.reduce((s2, x) => s2 + x.stats.attack, 0) / towersData.length;
        waste.skill += atk * battleState.atkMul * spec.mul * (spec.count ?? 1);
      }
      return out;
    };
  }
  let swapsBeforeFirstEnemy = null; // 층 시작 후 첫 적이 나타날 때까지 한 스왑 수
  let firstEnemySec = null; // 층 시작 후 첫 적이 나타난 시각(초, 소환 연출 포함)
  let emptyFieldSec = 0; // 전투 중 살아 있는 적이 하나도 없던 시간
  let aliveSec = 0; // 살아 있는 적 수 x 시간(동시 적 평균 = aliveSec / timeSec)
  let aliveMax = 0; // 한 시도에서 동시에 살아 있던 적 최대
  let noMoveTicks = 0; // 둘 수 있는 수가 없어(칸 잠금·연출 대기) 넘긴 결정 틱
  let swapsDuringAnim = 0; // 다른 해소가 진행 중일 때 한 스왑(칸 단위 잠금 덕분)
  let continueUsed = null; // 'ad' | 'feather' | null

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
        if (gameState.resolutions.length > 0) swapsDuringAnim++;
        gameState.trySwap(move.r1, move.c1, move.r2, move.c2);
        swapCount++;
      } else noMoveTicks++;
      moveTimer = playerCfg.secondsPerMove;
    }

    gameState.update(dt);
    if (itemCtl) {
      const done = itemCtl.update(dt);
      if (done?.ok) itemsUsed[done.id] = (itemsUsed[done.id] ?? 0) + 1;
    }
    bridge.update(gameState);
    if (inFlight.length > 0) {
      let w = 0;
      for (const shot of inFlight) {
        shot.left -= dt;
        if (shot.left > 1e-9) {
          inFlight[w++] = shot;
          continue;
        }
        const ev = shot.event;
        if (battleState.status === 'active' && !battleState.enemies.some((e) => e.id === ev.targetEnemyId && e.state === 'alive')) {
          waste.flight += ev.damage;
          if (shot.doomed) waste.flightDoomed += ev.damage;
        }
        battleState.resolveTowerAttack(ev);
      }
      inFlight.length = w;
    }
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

    if (swapsBeforeFirstEnemy == null && battleState.enemies.length > 0) {
      swapsBeforeFirstEnemy = swapCount;
      firstEnemySec = timeSec;
    }
    let aliveNow = 0;
    for (const e of battleState.enemies) if (e.state === 'alive') aliveNow++;
    if (battleState.status === 'active') {
      if (aliveNow === 0) emptyFieldSec += dt;
      aliveSec += aliveNow * dt;
      if (aliveNow > aliveMax) aliveMax = aliveNow;
    }
    if (battleState.status === 'failed' && onFail && reviveCfg && !continueUsed) {
      const how = onFail();
      if (how && battleState.revive(reviveCfg.pct, reviveCfg.freezeSec, reviveCfg.bossMul)) continueUsed = how;
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
    waste,
    swapsBeforeFirstEnemy: swapsBeforeFirstEnemy ?? swapCount,
    firstEnemySec: firstEnemySec ?? timeSec,
    emptyFieldSec,
    emptySpawns,
    aliveSec,
    aliveMax,
    noMoveTicks,
    swapsDuringAnim,
    continueUsed,
    stats: bridge.stats,
  };
}

// 게임의 탑 탄 비행 시간 근사(초) - src/render/battleRenderer.js 그대로: 공격 애니 fireFrame 3 x 80ms 뒤 스폰
// (DEFAULT_ATTACK_FIRE_FRAME/FRAME_MS, assets/towers/manifest.json도 3·80), 속도 DEFAULT_PROJECTILE_SPEED 480 논리px/초
// (tower.stats.projectileSpeed 없음 - balance.json tower.projectileSpeed 1.6은 렌더가 안 읽는다), 최소 80ms.
// 좌표 = getLayout(computeLayout(360, 640)) 결과: track x112 w242 y78 h152(3줄), 탑 muzzle 5개(_towerMuzzlePosition).
// shortcut: 360x640 논리 frame 고정·스폰 후 이동(0.24초) 무시, 레이아웃이 바뀌면 다시 뽑는다.
const MUZZLES = [[36.08, 86.61], [69.92, 111.95], [36.08, 137.28], [69.92, 162.61], [36.08, 187.95]];
const laneOf = (id) => {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 3; // battleRenderer.js hashLane(String(enemy.id), ENEMY_LANE_COUNT=3)
};
export function flightSecOf(battleState, towersData, event) {
  const enemy = battleState.enemies.find((e) => e.id === event.targetEnemyId);
  const [mx, my] = MUZZLES[Math.max(0, towersData.findIndex((t) => t.id === event.towerId))];
  const p = Math.min(1, Math.max(0, enemy?.progress ?? 0));
  const dx = 112 + 242 * (1 - p) - mx;
  const dy = 78 + ((laneOf(event.targetEnemyId) + 0.5) * 152) / 3 - my;
  return 0.24 + Math.max(0.08, Math.hypot(dx, dy) / 480);
}
