// 전투 미니게임 순수 로직(src/battle/battleState.js) 테스트. 작은 가짜 데이터를 직접
// 만들어 숫자 검증을 명확하게 한다(실제 config/*.json과 독립적). resolvedFloor는
// src/core/balance/floorGen.js의 resolveFloorSpawns() 출력 형태를 그대로 손으로 만든다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BattleState } from '../src/battle/battleState.js';

function makeTowers(overrides = {}) {
  return [
    { id: 'tower_red', color: 'red', stats: { attack: 10 }, ...overrides.red },
    { id: 'tower_blue', color: 'blue', stats: { attack: 8 }, ...overrides.blue },
  ];
}

function makeStat(overrides = {}) {
  return {
    type: 'weak',
    rank: 'normal',
    name: 'Weak',
    sprite: 'weak',
    size: 16,
    hp: 1000,
    def: 2,
    speed: 1,
    wallDmg: 5,
    gold: 1,
    ...overrides,
  };
}

function makeFloor({ spawns, interval = 1, wallHp = 20 } = {}) {
  return { wallHp, interval, spawns: spawns ?? [makeStat()] };
}

function makeConfig(overrides = {}) {
  return {
    cascadeBonusPerStep: 0.5,
    minDamage: 1,
    attackIntervalSec: 1,
    effectDurationsMs: {
      towerAttack: 100,
      enemyHit: 100,
      enemyDie: 100,
      enemyReachLine: 100,
      wallDamaged: 100,
    },
    ...overrides,
  };
}

function makeState({ towers, floor, config } = {}) {
  return new BattleState({
    towersData: towers ?? makeTowers(),
    resolvedFloor: floor ?? makeFloor(),
    battleConfig: config ?? makeConfig(),
  });
}

function lastEventOf(state, type) {
  const matches = state.events.filter((e) => e.type === type);
  return matches[matches.length - 1];
}

// applyGemClear는 사격만 하고(towerAttack 이벤트) 피해는 투사체 충돌 시점(render)에만
// 적용된다 - 즉시 피해까지 보고 싶은 테스트는 이 헬퍼로 쏘고 바로 충돌까지 시뮬레이션한다.
function fireAndResolve(state, color, count, cascadeIndex) {
  state.applyGemClear(color, count, cascadeIndex);
  const event = lastEventOf(state, 'towerAttack');
  if (event) state.resolveTowerAttack(event);
  return event;
}

function collectBattleEvents(state, predicate, updates) {
  const seen = new Set();
  const found = [];
  for (const dt of updates) {
    state.update(dt);
    for (const e of state.events) {
      if (!seen.has(e) && predicate(e)) {
        seen.add(e);
        found.push(e);
      }
    }
  }
  return found;
}

// ------------------------------------------------------------
// 퍼즐 사격 피해 계산
// ------------------------------------------------------------

test('퍼즐 사격 피해: 방어도가 공격력을 넘으면 minDamage로 바닥을 찍는다', () => {
  const state = makeState({ floor: makeFloor({ spawns: [makeStat({ def: 100 })] }) });
  state.update(0); // 스폰.
  state.applyGemClear('red', 1, 1);
  const hit = lastEventOf(state, 'towerAttack');
  assert.ok(hit, 'towerAttack 이벤트가 있어야 한다');
  assert.equal(hit.damage, 1);
});

test('퍼즐 사격 피해: cascadeIndex가 커질수록 피해가 커진다', () => {
  const state = makeState();
  state.update(0);
  state.applyGemClear('red', 1, 1);
  const dmg1 = lastEventOf(state, 'towerAttack').damage; // raw=10-2=8
  state.applyGemClear('red', 1, 3);
  const dmg3 = lastEventOf(state, 'towerAttack').damage; // raw=10*(1+0.5*2)-2=18
  assert.ok(dmg3 > dmg1, `cascadeIndex가 커지면 피해가 커져야 한다 (${dmg1} -> ${dmg3})`);
  assert.equal(dmg1, 8);
  assert.equal(dmg3, 18);
});

test('퍼즐 사격 피해: count(지운 잼 개수, 특수 잼으로 지운 잼 포함)가 커질수록 피해가 커진다', () => {
  const state = makeState();
  state.update(0);
  state.applyGemClear('red', 1, 1);
  const dmg1 = lastEventOf(state, 'towerAttack').damage; // raw=10*1-2=8
  state.applyGemClear('red', 5, 1);
  const dmg5 = lastEventOf(state, 'towerAttack').damage; // raw=10*5-2=48
  assert.ok(dmg5 > dmg1, `count가 커지면 피해가 커져야 한다 (${dmg1} -> ${dmg5})`);
  assert.equal(dmg1, 8);
  assert.equal(dmg5, 48);
});

test('퍼즐 사격 피해: 탑 레벨업으로 towersData.stats.attack을 직접 올리면 즉시 반영된다', () => {
  const towers = makeTowers();
  const state = makeState({ towers });
  state.update(0);
  towers[0].stats.attack = 20; // 레벨업(경제 모듈이 하는 일을 흉내).
  state.applyGemClear('red', 1, 1);
  assert.equal(lastEventOf(state, 'towerAttack').damage, 18); // raw=20-2=18
});

// ------------------------------------------------------------
// 표적 선택(퍼즐 사격 - 사거리 제한 없음)
// ------------------------------------------------------------

test('표적 선택: 여러 적 중 progress가 가장 높은 적이 맞는다', () => {
  const state = makeState({ floor: makeFloor({ interval: 0, spawns: [makeStat(), makeStat()] }) });
  state.update(0); // 둘 다 스폰(interval 0).
  assert.equal(state.enemies.length, 2);
  state.enemies[0].progress = 0.3;
  state.enemies[1].progress = 0.9;

  state.applyGemClear('red', 1, 1);
  const shot = lastEventOf(state, 'towerAttack');
  assert.equal(shot.targetEnemyId, state.enemies[1].id, 'progress가 더 높은 적이 맞아야 한다');
});

test('표적 선택: progress가 동률이면 먼저 스폰된 적이 맞는다', () => {
  const state = makeState({ floor: makeFloor({ interval: 0, spawns: [makeStat(), makeStat()] }) });
  state.update(0);
  assert.equal(state.enemies.length, 2);
  state.enemies[0].progress = 0.5;
  state.enemies[1].progress = 0.5;

  state.applyGemClear('red', 1, 1);
  const shot = lastEventOf(state, 'towerAttack');
  assert.equal(shot.targetEnemyId, state.enemies[0].id, '동률이면 먼저 스폰된(스폰 순서가 빠른) 적이 맞아야 한다');
});

test('표적 선택: 살아있는 적이 없으면(아직 스폰 전) applyGemClear가 아무 일도 하지 않는다', () => {
  const state = makeState(); // update()를 한 번도 안 불러서 아직 스폰 전.
  assert.equal(state.enemies.length, 0);
  assert.doesNotThrow(() => state.applyGemClear('red', 1, 1));
  assert.equal(state.events.length, 0, 'towerAttack 등 어떤 이벤트도 생기면 안 된다');
});

test('표적 선택: 살아있는 적이 없으면(스폰된 적이 전부 죽고 대기열은 남음) applyGemClear가 아무 일도 하지 않는다', () => {
  const state = makeState({
    floor: makeFloor({
      spawns: [makeStat({ hp: 5, def: 0 }), makeStat({ hp: 5, def: 0 })],
    }),
  });
  state.update(0); // 첫 적만 스폰(간격 1초).
  fireAndResolve(state, 'red', 1, 1); // raw=10-0=10 >= 5 -> 죽는다.
  assert.equal(state.enemies[0].state, 'dead');
  assert.equal(state.status, 'active', '대기열이 안 비었으므로 cleared가 되면 안 된다');

  const eventsBefore = state.events.length;
  assert.doesNotThrow(() => state.applyGemClear('red', 1, 1));
  assert.equal(state.events.length, eventsBefore, '살아있는 적이 없으면 새 이벤트가 생기면 안 된다');
});

// ------------------------------------------------------------
// 색 매칭 / 상태별 무효화
// ------------------------------------------------------------

test('색 매칭: towersData에 없는 색으로 호출하면 조용히 무시된다', () => {
  const state = makeState();
  state.update(0);
  assert.doesNotThrow(() => state.applyGemClear('black', 3, 1));
  assert.equal(state.events.length, 0);
});

test('상태 무효화: status가 cleared가 된 뒤에는 applyGemClear가 아무 효과도 없다', () => {
  const state = makeState();
  state.update(0);
  state.status = 'cleared';
  const healthBefore = state.enemies[0].currentHealth;
  const eventsBefore = state.events.length;

  state.applyGemClear('red', 5, 3);

  assert.equal(state.enemies[0].currentHealth, healthBefore);
  assert.equal(state.events.length, eventsBefore);
});

test('상태 무효화: status가 failed가 된 뒤에는 applyGemClear가 아무 효과도 없다', () => {
  const state = makeState();
  state.update(0);
  state.status = 'failed';
  const healthBefore = state.enemies[0].currentHealth;
  const eventsBefore = state.events.length;

  state.applyGemClear('red', 5, 3);

  assert.equal(state.enemies[0].currentHealth, healthBefore);
  assert.equal(state.events.length, eventsBefore);
});

// ------------------------------------------------------------
// 적 이동과 방어선 도달
// ------------------------------------------------------------

test('적 이동: progress는 speed*dt만큼 늘다가 1에서 멈춘다', () => {
  const state = makeState({ floor: makeFloor({ spawns: [makeStat({ speed: 0.25 })] }) });
  state.update(0); // 스폰.
  assert.equal(state.enemies[0].progress, 0);

  state.update(1);
  assert.equal(state.enemies[0].progress, 0.25);
  state.update(1);
  assert.equal(state.enemies[0].progress, 0.5);
  state.update(1);
  assert.equal(state.enemies[0].progress, 0.75);
  state.update(1);
  assert.equal(state.enemies[0].progress, 1, '정확히 1에 도달해야 한다');
  state.update(1);
  assert.equal(state.enemies[0].progress, 1, '1을 넘으면 안 된다');
});

test('적 이동: enemyReachLine은 progress가 1에 도달하는 순간 정확히 한 번만 발생한다', () => {
  const state = makeState({ floor: makeFloor({ spawns: [makeStat({ speed: 1 })] }) });
  state.update(0); // 스폰.

  const reachEvents = collectBattleEvents(state, (e) => e.type === 'enemyReachLine', [1, 1, 1, 1, 1]);
  assert.equal(reachEvents.length, 1, 'enemyReachLine은 중복 발동 없이 한 번만 나와야 한다');
});

// ------------------------------------------------------------
// 성벽 체력과 실패 판정
// ------------------------------------------------------------

test('성벽 체력: 방어선 도달 후 attackIntervalSec마다 wallDamaged가 발생하고 체력이 줄어든다', () => {
  const state = makeState({
    floor: makeFloor({ spawns: [makeStat({ speed: 1, wallDmg: 5 })] }), // wallHp 20(기본값)
    config: makeConfig({ attackIntervalSec: 1 }),
  });
  state.update(0); // 스폰.

  const damagedEvents = collectBattleEvents(state, (e) => e.type === 'wallDamaged', [1, 1]);
  assert.equal(damagedEvents.length, 2, '1초 간격으로 두 번 공격받아야 한다');
  assert.equal(damagedEvents[0].amount, 5);
  assert.equal(damagedEvents[0].remainingHealth, 15);
  assert.equal(damagedEvents[1].remainingHealth, 10);
  assert.equal(state.wallHealth, 10);
  assert.equal(state.status, 'active');
});

test('성벽 체력: 0 이하가 되면 failed로 바뀌고 0 밑으로 안 내려가며, 이후 추가 공격이 없다', () => {
  const state = makeState({
    floor: makeFloor({ wallHp: 8, spawns: [makeStat({ speed: 1, wallDmg: 5 })] }),
    config: makeConfig({ attackIntervalSec: 1 }),
  });
  state.update(0); // 스폰.

  const damagedEvents = collectBattleEvents(state, (e) => e.type === 'wallDamaged', [1, 1, 1]);
  assert.equal(damagedEvents.length, 2, 'failed 이후에는 추가 wallDamaged가 없어야 한다');
  assert.equal(state.wallHealth, 0, '체력이 0 밑으로 내려가면 안 된다');
  assert.equal(state.status, 'failed');
});

test('자동 공격 없음: applyGemClear를 한 번도 안 부르면 update()를 아무리 반복해도 적 HP가 줄지 않는다(docs/battle.md §4)', () => {
  const state = makeState({ floor: makeFloor({ spawns: [makeStat({ hp: 50, speed: 0 })] }) });
  state.update(0); // 스폰.
  for (let i = 0; i < 50; i++) state.update(0.5); // 25초 - applyGemClear는 한 번도 호출 안 함.
  assert.equal(state.enemies[0].currentHealth, 50, '퍼즐 사격 없이는 체력이 그대로여야 한다');
  assert.equal(state.events.filter((e) => e.type === 'towerAttack').length, 0, 'towerAttack 이벤트도 없어야 한다');
});

// ------------------------------------------------------------
// 몬스터 소환(웨이브 없음) / 층 클리어
// ------------------------------------------------------------

test('몬스터 소환: 웨이브 구분 없이 interval초 간격으로 오른쪽 끝에서 한 줄로 소환된다', () => {
  const state = makeState({
    floor: makeFloor({ interval: 2, spawns: [makeStat(), makeStat(), makeStat()] }),
  });
  state.update(0);
  assert.equal(state.enemies.length, 1, '0초 시점엔 첫 번째만');
  state.update(1.9);
  assert.equal(state.enemies.length, 1, '아직 interval(2초) 전');
  state.update(0.2); // 2.1초.
  assert.equal(state.enemies.length, 2, '두 번째가 소환됨');
  state.update(2);
  assert.equal(state.enemies.length, 3, '세 번째까지 소환됨');
});

test('남은 몬스터: 처치할 때마다 줄고, 아직 안 나온 적도 포함한다', () => {
  const state = makeState({
    floor: makeFloor({ interval: 1, spawns: [makeStat({ hp: 1, def: 0 }), makeStat({ hp: 1, def: 0 })] }),
  });
  state.update(0); // 첫 적만 소환.
  assert.equal(state.remainingEnemies, 2, '아직 못 죽인 적(스폰 전 포함) 전부 남은 수');

  fireAndResolve(state, 'red', 1, 1); // 첫 적을 죽인다.
  assert.equal(state.remainingEnemies, 1);
});

test('층 클리어: 마지막 적까지 전멸시키면 status가 cleared가 된다', () => {
  const state = makeState({
    floor: makeFloor({ interval: 1, spawns: [makeStat({ hp: 1, def: 0, speed: 0 }), makeStat({ hp: 1, def: 0, speed: 0 })] }),
  });
  state.update(0); // 첫 적 소환.
  fireAndResolve(state, 'red', 1, 1); // 첫 적 처치.
  assert.equal(state.status, 'active', '아직 소환 대기열이 남아있으므로 cleared가 아니다');

  state.update(1); // 두 번째 적 소환.
  assert.equal(state.enemies.length, 1);

  fireAndResolve(state, 'red', 1, 1); // 마지막 적까지 처치.
  assert.equal(state.status, 'cleared');
});

test('enemyDie 이벤트는 처치 보상 계산에 쓸 gold/type/rank를 그대로 들고 있다', () => {
  const state = makeState({
    floor: makeFloor({ spawns: [makeStat({ hp: 1, def: 0, gold: 7, type: 'orc', rank: 'elite' })] }),
  });
  state.update(0);
  fireAndResolve(state, 'red', 1, 1);
  const die = lastEventOf(state, 'enemyDie');
  assert.equal(die.gold, 7);
  assert.equal(die.enemyType, 'orc');
  assert.equal(die.rank, 'elite');
});

// ------------------------------------------------------------
// reset()
// ------------------------------------------------------------

test('reset(): cleared 이후 reset하면 active로 돌아가고 소환을 처음부터 다시 시작한다', () => {
  const state = makeState({
    floor: makeFloor({ spawns: [makeStat({ hp: 5, def: 0 })] }),
  });
  state.update(0);
  fireAndResolve(state, 'red', 1, 1);
  assert.equal(state.status, 'cleared');

  state.reset();
  assert.equal(state.status, 'active');
  assert.equal(state.wallHealth, state.wallMaxHealth);
  assert.equal(state.enemies.length, 0);
  assert.equal(state.remainingEnemies, state.totalEnemies);

  state.update(0);
  assert.equal(state.enemies.length, 1);
  assert.equal(state.enemies[0].state, 'alive');
});

test('reset(): failed 이후 reset하면 active로 돌아가고 체력이 최대치로 회복된다', () => {
  const state = makeState({
    floor: makeFloor({ wallHp: 8, spawns: [makeStat({ speed: 1, wallDmg: 50 })] }),
  });
  state.update(0);
  state.update(1); // 방어선 도달 + 공격 1회로 바로 failed.
  assert.equal(state.status, 'failed');
  assert.equal(state.wallHealth, 0);

  state.reset();
  assert.equal(state.status, 'active');
  assert.equal(state.wallHealth, 8);
  assert.equal(state.enemies.length, 0);

  state.update(0);
  assert.equal(state.enemies.length, 1);
});

// ------------------------------------------------------------
// 이벤트 수명
// ------------------------------------------------------------

test('이벤트 수명: durationMs를 넘긴 이벤트는 events 배열에서 사라진다', () => {
  const state = makeState({ config: makeConfig({ effectDurationsMs: { towerAttack: 100 } }) });
  state.update(0);
  state.applyGemClear('red', 1, 1);
  assert.ok(state.events.some((e) => e.type === 'towerAttack'), '이벤트가 일단 생겨야 한다');

  state.update(0.15); // 150ms > 100ms.
  assert.ok(!state.events.some((e) => e.type === 'towerAttack'), 'durationMs를 넘긴 이벤트는 사라져야 한다');
});

// ------------------------------------------------------------
// 가상 효과(modifier) 훅 - tools/sim 전용, 게임은 기본적으로 battleConfig.hooks를 안 준다
// (docs/simulation.md T2). hooks가 없으면 100% 기존 동작과 같아야 한다.
// ------------------------------------------------------------

test('가상 효과 훅: battleConfig.hooks가 없으면 onShot/onHit 없이 기존 피해 공식 그대로다', () => {
  const state = makeState();
  state.update(0);
  const shot = fireAndResolve(state, 'red', 1, 1);
  assert.equal(shot.damage, 8); // attack(10) - def(2).
});

test('가상 효과 훅: onShot이 있으면 피해 계산 전에 호출되고, 반환값이 최종 피해에 그대로 쓰인다', () => {
  const state = makeState({
    config: makeConfig({ hooks: { onShot: ({ rawDamage }) => rawDamage * 2 } }),
  });
  state.update(0);
  const shot = fireAndResolve(state, 'red', 1, 1);
  assert.equal(shot.damage, 18); // (attack(10)*2) - def(2).
});

test('가상 효과 훅: onHit이 있으면 resolveTowerAttack 직후(적 hp가 깎인 뒤) 호출된다', () => {
  let seenDamage = null;
  const state = makeState({
    config: makeConfig({ hooks: { onHit: (bs, event, target) => (seenDamage = { damage: event.damage, hp: target.currentHealth }) } }),
  });
  state.update(0);
  fireAndResolve(state, 'red', 1, 1);
  assert.equal(seenDamage.damage, 8);
  assert.equal(seenDamage.hp, 1000 - 8);
});

test('가상 효과 훅: fromModifier:true인 합성 이벤트는 onHit을 다시 타지 않는다(무한 증폭 방지)', () => {
  let onHitCalls = 0;
  const state = makeState({ config: makeConfig({ hooks: { onHit: () => onHitCalls++ } }) });
  state.update(0);
  const shot = fireAndResolve(state, 'red', 1, 1);
  assert.equal(onHitCalls, 1);
  state.resolveTowerAttack({ ...shot, fromModifier: true, damage: 1 });
  assert.equal(onHitCalls, 1, 'fromModifier 이벤트는 onHit을 부르면 안 된다');
});

// ------------------------------------------------------------
// 오버킬 방지: 날아가는 탄의 예상 피해 예약
// ------------------------------------------------------------

// 피해 8짜리 한 발(attack 8 x count 1 x cascade 1 - def 0)을 쏘는 상태. 적은 speed 0이라
// 움직이지 않으므로 앞뒤 순서는 스폰 순서(A가 앞, B가 뒤)로 고정된다.
function makeOverkillState({ hpA = 5, hpB = 30, onlyA = false, config } = {}) {
  const stat = (hp) => makeStat({ hp, def: 0, speed: 0 });
  const spawns = onlyA ? [stat(hpA)] : [stat(hpA), stat(hpB)];
  const state = makeState({
    towers: makeTowers({ red: { stats: { attack: 8 } } }),
    floor: makeFloor({ spawns, interval: 0, wallHp: 1000 }),
    config,
  });
  state.update(0); // 전부 스폰(interval 0).
  return state;
}

function fire(state) {
  state.applyGemClear('red', 1, 1);
  return lastEventOf(state, 'towerAttack');
}

test('예약: 날아가는 탄으로 죽을 적은 건너뛰고 뒤의 적을 쏜다', () => {
  const state = makeOverkillState({ hpA: 5, hpB: 30 });
  const [a, b] = state.enemies;
  assert.equal(fire(state).targetEnemyId, a.id);
  assert.equal(fire(state).targetEnemyId, b.id, '예상 피해 8 > A의 HP 5라 둘째 발은 B로 간다');
  assert.equal(a.pendingDamage, 8);
  assert.equal(b.pendingDamage, 8);
});

test('예약: 예상 피해가 아직 HP에 못 미치면 같은 적을 계속 쏜다', () => {
  const state = makeOverkillState({ hpA: 20, hpB: 30 });
  const [a, b] = state.enemies;
  assert.equal(fire(state).targetEnemyId, a.id);
  assert.equal(fire(state).targetEnemyId, a.id);
  assert.equal(fire(state).targetEnemyId, a.id, '8+8=16 < 20이라 셋째 발도 A');
  assert.equal(fire(state).targetEnemyId, b.id, '24 >= 20이라 넷째 발부터 B');
});

test('예약: 뒤에 적이 없으면 죽을 예정이어도 맨 앞 적을 쏜다(피해를 버리지 않는다)', () => {
  const state = makeOverkillState({ hpA: 5, onlyA: true });
  const a = state.enemies[0];
  assert.equal(fire(state).targetEnemyId, a.id);
  const second = fire(state);
  assert.ok(second, '폴백 사격 이벤트가 생겨야 한다');
  assert.equal(second.targetEnemyId, a.id);
});

test('예약: resolveTowerAttack이 예약을 해제한다(목표가 이미 죽었어도)', () => {
  const state = makeOverkillState({ hpA: 20, hpB: 30 });
  const a = state.enemies[0];
  const shot1 = fire(state);
  const shot2 = fire(state);
  assert.equal(a.pendingDamage, 16);
  state.resolveTowerAttack(shot1);
  assert.equal(a.pendingDamage, 8);
  assert.equal(a.currentHealth, 12);

  const dead = makeOverkillState({ hpA: 5, onlyA: true });
  const killShot = fire(dead);
  const extraShot = fire(dead);
  dead.resolveTowerAttack(killShot);
  assert.equal(dead.enemies[0].state, 'dead');
  dead.resolveTowerAttack(extraShot);
  assert.equal(dead._pendingShots.size, 0, '죽은 적 대상 탄도 예약은 풀려야 한다');
  assert.equal(shot2.shotId !== undefined, true);
});

test('예약: resolve가 안 와도 shotTimeoutMs가 지나면 예약이 풀린다', () => {
  const state = makeOverkillState({ hpA: 5, hpB: 30, config: makeConfig({ shotTimeoutMs: 1000 }) });
  const [a, b] = state.enemies;
  assert.equal(fire(state).targetEnemyId, a.id);
  assert.equal(fire(state).targetEnemyId, b.id);
  state.update(1);
  assert.equal(a.pendingDamage, 0);
  assert.equal(b.pendingDamage, 0);
  assert.equal(fire(state).targetEnemyId, a.id, '예약이 풀렸으니 다시 맨 앞 적을 노린다');
});

test('예약: reset() 후 예약이 비어 있다', () => {
  const state = makeOverkillState({ hpA: 20, hpB: 30 });
  fire(state);
  assert.equal(state._pendingShots.size, 1);
  state.reset();
  assert.equal(state._pendingShots.size, 0);
});
