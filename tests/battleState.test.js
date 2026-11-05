// 전투 미니게임 순수 로직(src/battle/battleState.js) 테스트. 작은 가짜 데이터를 직접
// 만들어 숫자 검증을 명확하게 한다(실제 config/*.json과 독립적). resolvedFloor는
// src/core/balance/floorGen.js의 resolveFloorWaves() 출력 형태를 그대로 손으로 만든다.
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

function makeFloor({ waves, wallHp = 20, waveBreak = 2.5 } = {}) {
  return { wallHp, waveBreak, waves: waves ?? [{ interval: 1, spawns: [makeStat()] }] };
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
  const state = makeState({ floor: makeFloor({ waves: [{ interval: 1, spawns: [makeStat({ def: 100 })] }] }) });
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
  const state = makeState({ floor: makeFloor({ waves: [{ interval: 0, spawns: [makeStat(), makeStat()] }] }) });
  state.update(0); // 둘 다 스폰(interval 0).
  assert.equal(state.enemies.length, 2);
  state.enemies[0].progress = 0.3;
  state.enemies[1].progress = 0.9;

  state.applyGemClear('red', 1, 1);
  const shot = lastEventOf(state, 'towerAttack');
  assert.equal(shot.targetEnemyId, state.enemies[1].id, 'progress가 더 높은 적이 맞아야 한다');
});

test('표적 선택: progress가 동률이면 먼저 스폰된 적이 맞는다', () => {
  const state = makeState({ floor: makeFloor({ waves: [{ interval: 0, spawns: [makeStat(), makeStat()] }] }) });
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
      waves: [{ interval: 1, spawns: [makeStat({ hp: 5, def: 0 }), makeStat({ hp: 5, def: 0 })] }],
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
  const state = makeState({ floor: makeFloor({ waves: [{ interval: 1, spawns: [makeStat({ speed: 0.25 })] }] }) });
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
  const state = makeState({ floor: makeFloor({ waves: [{ interval: 1, spawns: [makeStat({ speed: 1 })] }] }) });
  state.update(0); // 스폰.

  const reachEvents = collectBattleEvents(state, (e) => e.type === 'enemyReachLine', [1, 1, 1, 1, 1]);
  assert.equal(reachEvents.length, 1, 'enemyReachLine은 중복 발동 없이 한 번만 나와야 한다');
});

// ------------------------------------------------------------
// 성벽 체력과 실패 판정
// ------------------------------------------------------------

test('성벽 체력: 방어선 도달 후 attackIntervalSec마다 wallDamaged가 발생하고 체력이 줄어든다', () => {
  const state = makeState({
    floor: makeFloor({ waves: [{ interval: 1, spawns: [makeStat({ speed: 1, wallDmg: 5 })] }] }), // wallHp 20(기본값)
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
    floor: makeFloor({ wallHp: 8, waves: [{ interval: 1, spawns: [makeStat({ speed: 1, wallDmg: 5 })] }] }),
    config: makeConfig({ attackIntervalSec: 1 }),
  });
  state.update(0); // 스폰.

  const damagedEvents = collectBattleEvents(state, (e) => e.type === 'wallDamaged', [1, 1, 1]);
  assert.equal(damagedEvents.length, 2, 'failed 이후에는 추가 wallDamaged가 없어야 한다');
  assert.equal(state.wallHealth, 0, '체력이 0 밑으로 내려가면 안 된다');
  assert.equal(state.status, 'failed');
});

test('자동 공격 없음: applyGemClear를 한 번도 안 부르면 update()를 아무리 반복해도 적 HP가 줄지 않는다(docs/battle.md §4)', () => {
  const state = makeState({ floor: makeFloor({ waves: [{ interval: 1, spawns: [makeStat({ hp: 50, speed: 0 })] }] }) });
  state.update(0); // 스폰.
  for (let i = 0; i < 50; i++) state.update(0.5); // 25초 - applyGemClear는 한 번도 호출 안 함.
  assert.equal(state.enemies[0].currentHealth, 50, '퍼즐 사격 없이는 체력이 그대로여야 한다');
  assert.equal(state.events.filter((e) => e.type === 'towerAttack').length, 0, 'towerAttack 이벤트도 없어야 한다');
});

// ------------------------------------------------------------
// 웨이브 진행 / 층 클리어
// ------------------------------------------------------------

test('웨이브 소환: interval초 간격으로 오른쪽 끝에서 소환된다', () => {
  const state = makeState({
    floor: makeFloor({ waves: [{ interval: 2, spawns: [makeStat(), makeStat(), makeStat()] }] }),
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

test('웨이브 진행: 한 웨이브를 전멸시키면 waveBreak초 뒤 다음 웨이브가 시작된다(마지막 웨이브 아님)', () => {
  const state = makeState({
    floor: makeFloor({
      waveBreak: 2.5,
      waves: [
        { interval: 1, spawns: [makeStat({ hp: 1, def: 0 })] },
        { interval: 1, spawns: [makeStat({ hp: 1, def: 0 })] },
      ],
    }),
  });
  state.update(0); // 1번째 웨이브 소환.
  fireAndResolve(state, 'red', 1, 1); // 죽인다.
  assert.equal(state.status, 'active', '다음 웨이브가 남아있으므로 cleared가 아니다');
  assert.equal(state.waveNumber, 1, '아직 waveBreak 동안은 1번째 웨이브');

  state.update(2.4); // waveBreak(2.5초) 전.
  assert.equal(state.waveNumber, 1);
  assert.equal(state.enemies.length, 0, '다음 웨이브 소환 전');

  state.update(0.2); // 2.6초 - waveBreak 종료.
  assert.equal(state.waveNumber, 2, '다음 웨이브로 넘어갔다');
  assert.equal(state.enemies.length, 1, '다음 웨이브 첫 적이 소환됨');
});

test('층 클리어: 마지막 웨이브까지 전멸시키면 status가 cleared가 된다(waveBreak 없이 즉시)', () => {
  const state = makeState({
    floor: makeFloor({
      waves: [
        { interval: 1, spawns: [makeStat({ hp: 1, def: 0, speed: 0 })] },
        { interval: 1, spawns: [makeStat({ hp: 1, def: 0, speed: 0 })] },
      ],
    }),
  });
  state.update(0);
  fireAndResolve(state, 'red', 1, 1); // 1번째 웨이브 클리어.
  state.update(10); // waveBreak 지나 2번째 웨이브 소환(speed 0이라 성벽에 닿지 않음).
  assert.equal(state.enemies.length, 1);

  fireAndResolve(state, 'red', 1, 1); // 2번째(마지막) 웨이브도 클리어.
  assert.equal(state.status, 'cleared');
});

test('enemyDie 이벤트는 처치 보상 계산에 쓸 gold/type/rank를 그대로 들고 있다', () => {
  const state = makeState({
    floor: makeFloor({ waves: [{ interval: 1, spawns: [makeStat({ hp: 1, def: 0, gold: 7, type: 'orc', rank: 'elite' })] }] }),
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

test('reset(): cleared 이후 reset하면 active로 돌아가고 1번째 웨이브부터 다시 시작한다', () => {
  const state = makeState({
    floor: makeFloor({ waves: [{ interval: 1, spawns: [makeStat({ hp: 5, def: 0 })] }] }),
  });
  state.update(0);
  fireAndResolve(state, 'red', 1, 1);
  assert.equal(state.status, 'cleared');

  state.reset();
  assert.equal(state.status, 'active');
  assert.equal(state.wallHealth, state.wallMaxHealth);
  assert.equal(state.enemies.length, 0);
  assert.equal(state.waveNumber, 1);

  state.update(0);
  assert.equal(state.enemies.length, 1);
  assert.equal(state.enemies[0].state, 'alive');
});

test('reset(): failed 이후 reset하면 active로 돌아가고 체력이 최대치로 회복된다', () => {
  const state = makeState({
    floor: makeFloor({ wallHp: 8, waves: [{ interval: 1, spawns: [makeStat({ speed: 1, wallDmg: 50 })] }] }),
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
