// 젬 기술 v3(docs/skills.md, config/skills.json) - BattleState의 색 효과 5종, 보스 면역·약점,
// 특수 잼 기술 5종 대상 선정/피해, 그리고 PuzzleBattleBridge의 특수 잼 -> 기술 전달 테스트.
// 숫자는 실제 config/skills.json을 읽어 쓴다(공격력 100, 방어 0이면 계산이 바로 보이게).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BattleState } from '../src/battle/battleState.js';
import { PuzzleBattleBridge } from '../src/game/puzzleBattleBridge.js';
import { GEM_TYPES } from '../src/config/gems.js';

const SKILLS = JSON.parse(readFileSync(new URL('../config/skills.json', import.meta.url), 'utf-8'));
const COLORS = ['red', 'blue', 'purple', 'yellow', 'green'];

function skillsWith(mutate) {
  const s = structuredClone(SKILLS);
  mutate?.(s);
  return s;
}

function enemy(overrides = {}) {
  return { type: 'e', rank: 'normal', name: 'E', hp: 10000, def: 0, speed: 0.1, wallDmg: 5, gold: 1, ...overrides };
}

const boss = (o = {}) => enemy({ rank: 'boss', immune: [], weak: [], ...o });

// progress를 직접 지정한 적들로 시작한다(interval 0 = update(0) 한 번에 전부 소환).
function makeState({ enemies = [enemy()], progress, skills = SKILLS, attack = 100, config = {} } = {}) {
  const state = new BattleState({
    towersData: COLORS.map((c) => ({ id: `tower_${c}`, color: c, stats: { attack } })),
    resolvedFloor: { wallHp: 1000, interval: 0, spawns: enemies },
    battleConfig: {
      cascadeBonusPerStep: 0.5,
      minDamage: 1,
      attackIntervalSec: 1,
      effectDurationsMs: { enemyHit: 1e9, effectImmune: 1e9, skillCast: 1e9 }, // 테스트 중엔 이벤트를 남겨 둔다.
      skills,
      ...config,
    },
  });
  state.update(0);
  if (progress) state.enemies.forEach((e, i) => (e.progress = progress[i]));
  return state;
}

// 기본 사격 1발을 쏘고 바로 명중시킨다.
function hit(state, color, count = 1) {
  const ev = state.applyGemClear(color, count, 1);
  state.resolveTowerAttack(ev);
  return ev;
}

const hp = (state, i = 0) => state.enemies[i].currentHealth;
const lost = (state, i = 0) => state.enemies[i].maxHealth - state.enemies[i].currentHealth;

function step(state, seconds, dt = 0.1) {
  for (let t = 0; t < seconds - 1e-9; t += dt) state.update(dt);
}

// ---- 색 효과 ----
// 기본값(appliesTo 'skills')은 기술 피해에만 효과가 붙는다. 아래 효과 규칙 테스트는 기본 사격 1발로
// 확인하려고 appliesTo 'all'로 돌린다(같은 _applyColorEffect 경로).
const ALL = skillsWith((s) => { s.colorEffects.appliesTo = 'all'; });
const makeAll = (o = {}) => makeState({ skills: ALL, ...o });

test('기본값 appliesTo=skills: 일반 3매치 사격은 효과·범위 2차 피해 없음, 기술 명중엔 효과', () => {
  assert.equal(SKILLS.colorEffects.appliesTo, 'skills');
  for (const c of COLORS) {
    const s = makeState({ enemies: [enemy(), enemy()], progress: [0.5, 0.5] });
    hit(s, c, 3);
    assert.deepEqual(s.enemies[0].effects, makeState().enemies[0].effects, `${c} 사격 뒤 effects 그대로`);
    assert.equal(lost(s, 1), 0, `${c}: 범위 2차 피해 없음`);
    assert.ok(!s.events.some((e) => e.source === 'splash' || e.type === 'effectImmune'));
  }
  const imm = makeState({ enemies: [boss({ immune: ['blue'] })] });
  hit(imm, 'blue', 3);
  assert.ok(!imm.events.some((e) => e.type === 'effectImmune'), '사격엔 면역 표시도 없음');

  const k = makeState({ enemies: [enemy(), enemy()], progress: [0.5, 0.45] });
  cast(k, 'red', 0, 1, true, 'bomb');
  cast(k, 'blue', 0, 1, true, 'line_h');
  assert.equal(k.enemies[0].effects.slow.mul, 0.7, '기술 명중엔 효과');
  assert.ok(k.events.some((e) => e.source === 'splash'), '기술 레드는 범위 2차 피해');
});

test('블루 감속: 이동 ×0.7, 2초, 중첩 없이 시간만 갱신 / 보스는 절감(×0.85)', () => {
  const s = makeAll({ enemies: [enemy(), boss()] });
  hit(s, 'blue');
  s.enemies[1].effects.slow.time = 0; // 직격은 0번 적만.
  s._applyColorEffect(s.enemies[1], 'blue', 1);
  hit(s, 'blue'); // 재적용 - 배율은 그대로.
  assert.equal(s.enemies[0].effects.slow.mul, 0.7);
  assert.equal(s.enemies[1].effects.slow.mul, 0.85);
  step(s, 1);
  assert.ok(Math.abs(s.enemies[0].progress - 0.07) < 1e-9);
  assert.ok(Math.abs(s.enemies[1].progress - 0.085) < 1e-9);
  step(s, 1.5);
  assert.equal(s.enemies[0].effects.slow.time <= 1e-9, true, '2초 뒤 풀림');
});

test('퍼플 독: 3초에 걸쳐 피해×0.5×중첩을 0.5초 틱으로, 방어 무시, 최대 3중첩', () => {
  const s = makeAll({ enemies: [enemy({ def: 20 })] });
  hit(s, 'purple'); // 직격 100−20 = 80 -> 독 총 40.
  assert.equal(lost(s), 80);
  const before = hp(s);
  step(s, 3, 0.5);
  assert.equal(before - hp(s), 40);
  const ticks = s.events.filter((e) => e.type === 'enemyHit' && e.source === 'poison');
  assert.equal(ticks.length, 6);
  assert.equal(s.enemies[0].effects.poison.stacks, 0);

  for (let i = 0; i < 5; i++) hit(s, 'purple');
  assert.equal(s.enemies[0].effects.poison.stacks, 3);
  const b2 = hp(s);
  step(s, 3, 0.5);
  assert.equal(b2 - hp(s), 120); // 80 × 0.5 × 3.
});

test('옐로우 경직: 이동·성벽 공격 정지, 쿨타임 2초 안엔 다시 안 걸림, 보스는 절반', () => {
  const s = makeAll({ enemies: [enemy()], progress: [1] });
  s.enemies[0]._reachedLine = true;
  hit(s, 'yellow');
  step(s, 0.9); // 0.4초 정지 + 0.5초 공격 타이머.
  assert.equal(s.wallHealth, 1000);
  step(s, 0.6);
  assert.equal(s.wallHealth, 995, '경직이 풀린 뒤 1초 쌓이면 공격');

  const m = makeAll({ enemies: [enemy()] });
  hit(m, 'yellow');
  step(m, 0.4);
  assert.equal(m.enemies[0].progress, 0);
  hit(m, 'yellow'); // 쿨타임 중 - 안 걸림.
  step(m, 0.1);
  assert.ok(m.enemies[0].progress > 0);
  step(m, 1.5);
  hit(m, 'yellow'); // 쿨 2초 지남.
  assert.ok(m.enemies[0].effects.stun.time > 0.39);

  const b = makeAll({ enemies: [boss()] });
  hit(b, 'yellow');
  assert.equal(b.enemies[0].effects.stun.time, 0.2);
});

test('그린 표식: 첫 중첩 즉시, 다음은 2초 쿨 뒤, 최대 2, 맞을 때마다 4초 갱신, 피해 ×(1+0.1×중첩)', () => {
  const s = makeAll();
  hit(s, 'green');
  const mark = s.enemies[0].effects.mark;
  assert.equal(mark.stacks, 1);
  hit(s, 'green');
  assert.equal(mark.stacks, 1, '쿨타임 중');
  step(s, 2);
  hit(s, 'green');
  assert.equal(mark.stacks, 2);
  step(s, 2);
  hit(s, 'green');
  assert.equal(mark.stacks, 2, '최대 2');
  assert.equal(s.applyGemClear('red', 1, 1).damage, 120);
  step(s, 3.9);
  assert.equal(mark.stacks, 2, '마지막 명중으로 4초 갱신');
  step(s, 0.2);
  assert.equal(mark.stacks, 0);
});

test('레드 범위: 반경 안 다른 적에게 피해×0.4를 2차 피해로(다시 색 효과 안 탐), 레드 면역 적은 제외', () => {
  const s = makeAll({
    enemies: [enemy(), enemy(), enemy(), boss({ immune: ['red'] })],
    progress: [0.5, 0.4, 0.2, 0.45],
  });
  hit(s, 'red');
  assert.deepEqual([0, 1, 2, 3].map((i) => lost(s, i)), [100, 40, 0, 0]);
  const splash = s.events.find((e) => e.type === 'enemyHit' && e.source === 'splash');
  assert.equal(splash.fromModifier, true);
  assert.ok(s.events.some((e) => e.type === 'effectImmune' && e.enemyId === s.enemies[3].id && e.color === 'red'));
});

test('면역: 그 색 효과만 막고 피해는 정상 + effectImmune 이벤트', () => {
  const s = makeAll({ enemies: [boss({ immune: ['blue', 'yellow'] })] });
  hit(s, 'blue');
  hit(s, 'yellow');
  assert.equal(lost(s), 200);
  assert.equal(s.enemies[0].effects.slow.time, 0);
  assert.equal(s.enemies[0].effects.stun.time, 0);
  const imm = s.events.filter((e) => e.type === 'effectImmune').map((e) => e.color);
  assert.deepEqual(imm, ['blue', 'yellow']);
});

test('약점 ×1.3이 표식보다 먼저, 둘 다 방어를 뺀 뒤에 곱한다', () => {
  const s = makeState({ enemies: [boss({ def: 10, weak: ['red'] })] });
  s.enemies[0].effects.mark.stacks = 1;
  // (100 − 10) × 1.3 × 1.1 = 128.7 -> 129 (방어 전에 곱하면 130).
  assert.equal(s.applyGemClear('red', 1, 1).damage, 129);
  assert.equal(s.applyGemClear('blue', 1, 1).damage, 99); // 약점 아닌 색: 90 × 1.1.
});

test('skills 설정이 없거나 unlocked=false면 효과 없음(기존 사격 그대로)', () => {
  const none = makeState({ skills: null });
  hit(none, 'blue');
  assert.equal(none.enemies[0].effects.slow.time, 0);
  assert.equal(none.applyGemClear('red', 0, 1, true, 'bomb'), undefined);
  assert.ok(!none.events.some((e) => e.type === 'skillCast'));

  const off = makeState({ skills: skillsWith((s) => { s.colorEffects.appliesTo = 'all'; s.unlocked.colorEffects.blue = false; s.unlocked.specialSkills.line = false; }) });
  hit(off, 'blue');
  assert.equal(off.enemies[0].effects.slow.time, 0);
  off.applyGemClear('red', 0, 1, true, 'line_h');
  assert.ok(!off.events.some((e) => e.type === 'skillCast'));
});

// ---- 특수 잼 기술 ----

const cast = (s, ...args) => {
  s.applyGemClear(...args);
  return s.events.filter((e) => e.type === 'skillCast').at(-1);
};

test('가시: 가장 앞 적, 공격력×2.5−방어, 넉백 0.05(0 아래 X), 넉백 면역 보스는 안 밀림', () => {
  const s = makeState({ enemies: [enemy({ def: 10 }), enemy(), boss({ knockbackImmune: true })], progress: [1, 0.5, 0.9] });
  s.enemies[0]._reachedLine = true;
  const ev = cast(s, 'red', 0, 1, true, 'line_v');
  assert.equal(ev.skill, 'line');
  assert.deepEqual(ev.targets, [s.enemies[0].id]);
  assert.equal(lost(s, 0), 240 + 40 * 0); // 250 − 10, 레드 범위는 반경 밖이라 없음.
  assert.ok(Math.abs(s.enemies[0].progress - 0.95) < 1e-9);
  assert.equal(s.enemies[0]._reachedLine, false, '성벽에서 떨어짐');

  const z = makeState({ progress: [0.02] });
  cast(z, 'blue', 0, 1, true, 'line_h');
  assert.equal(z.enemies[0].progress, 0);

  const b = makeState({ enemies: [boss({ knockbackImmune: true })], progress: [0.7] });
  cast(b, 'blue', 0, 1, true, 'line_h');
  assert.equal(b.enemies[0].progress, 0.7);
  assert.equal(lost(b), 250);
});

test('가시 2연속(같은 스텝): 두 번째는 그 다음 앞 적, 다음 스텝은 다시 맨 앞부터', () => {
  const s = makeState({ enemies: [enemy(), enemy(), enemy()], progress: [0.3, 0.8, 0.5], config: { deferSkillHits: true } });
  const a = cast(s, 'blue', 0, 1, true, 'line_h');
  const b = cast(s, 'blue', 0, 1, true, 'line_v');
  assert.deepEqual([a.targets[0], b.targets[0]], [s.enemies[1].id, s.enemies[2].id]);
  s.update(0);
  const c = cast(s, 'blue', 0, 1, true, 'line_h');
  assert.equal(c.targets[0], s.enemies[1].id);
});

test('가시: 앞 적이 예약 피해로 죽을 예정이면 건너뛴다(pendingDamage)', () => {
  const s = makeState({ enemies: [enemy({ hp: 100 }), enemy()], progress: [0.9, 0.5], config: { deferSkillHits: true } });
  s.applyGemClear('red', 1, 1); // 100 예약.
  const ev = cast(s, 'blue', 0, 1, true, 'line_h');
  assert.equal(ev.targets[0], s.enemies[1].id);
});

test('용암탄: 반경 0.27 안 적 수가 최대인 적이 중심(동률이면 앞), 그 안 전부 ×2.0', () => {
  const s = makeState({ enemies: [enemy(), enemy(), enemy(), enemy()], progress: [0.9, 0.5, 0.45, 0.3] });
  const ev = cast(s, 'blue', 0, 1, true, 'bomb');
  assert.equal(ev.extra.centerEnemyId, s.enemies[1].id);
  assert.deepEqual(ev.targets, [s.enemies[1].id, s.enemies[2].id, s.enemies[3].id]);
  assert.deepEqual([0, 1, 2, 3].map((i) => lost(s, i)), [0, 200, 200, 200]);
  assert.equal(s.enemies[2].effects.slow.mul, 0.7, '기술 피해에도 색 효과');
});

test('영혼 불꽃: 박스+박스(같은 스텝 2번) = 서로 다른 4마리, 적이 적으면 되돌아 배정, 죽을 예정이면 건너뜀', () => {
  const hps = [900, 800, 700, 600, 500];
  const s = makeState({ enemies: hps.map((hp) => enemy({ hp })), config: { deferSkillHits: true } });
  const ids = s.enemies.map((e) => e.id);
  const a = cast(s, 'red', 0, 1, true, 'box');
  const b = cast(s, 'red', 0, 1, true, 'box');
  assert.deepEqual([...a.targets, ...b.targets], ids.slice(0, 4));

  // 2마리면 2발씩. 같은 적에 두 번 명중 = resolveSkillHit 두 번.
  const two = makeState({ enemies: [enemy({ hp: 900 }), enemy({ hp: 800 })], config: { deferSkillHits: true } });
  const t1 = cast(two, 'red', 0, 1, true, 'box');
  const t2 = cast(two, 'red', 0, 1, true, 'box');
  assert.deepEqual([...t1.targets, ...t2.targets], [two.enemies[0].id, two.enemies[1].id, two.enemies[0].id, two.enemies[1].id]);
  two.resolveSkillHit(t2, two.enemies[0].id);
  two.resolveSkillHit(t1, two.enemies[0].id);
  two.resolveSkillHit(t1, two.enemies[0].id); // t1의 0번 몫은 이미 끝 - 무시.
  assert.equal(lost(two, 0), 300);

  // HP 1위가 예약 피해로 죽을 예정이면 건너뛴다.
  const d = makeState({ enemies: [enemy({ hp: 900 }), enemy({ hp: 800 }), enemy({ hp: 700 })], progress: [0.9, 0.5, 0.4], config: { deferSkillHits: true } });
  d.enemies[0].pendingDamage = 900;
  assert.deepEqual(cast(d, 'red', 0, 1, true, 'box').targets, [d.enemies[1].id, d.enemies[2].id]);

  // 다음 스텝은 다시 HP 1위부터.
  s.update(0);
  assert.equal(cast(s, 'red', 0, 1, true, 'box').targets[0], ids[0]);
});

test('영혼 불꽃: 현재 HP 가장 높은 2마리(같으면 앞쪽), 각 ×1.5', () => {
  const s = makeState({ enemies: [enemy({ hp: 500 }), enemy({ hp: 900 }), enemy({ hp: 900 }), enemy({ hp: 800 })], progress: [0.9, 0.2, 0.6, 0.5] });
  const ev = cast(s, 'purple', 0, 1, true, 'box');
  assert.deepEqual(ev.targets, [s.enemies[2].id, s.enemies[1].id]);
  assert.equal(lost(s, 2), 150);
  assert.equal(s.enemies[1].effects.poison.stacks, 1);
});

test('궁극기: 모든 적 ×1.0 + 고른 색 효과, 그린은 바로 2중첩, 옐로우는 보스 제외', () => {
  const g = makeState({ enemies: [enemy(), boss()] });
  const ev = cast(g, 'green', 0, 1, true, 'color', 'green');
  assert.equal(ev.skill, 'color');
  assert.equal(ev.targets.length, 2);
  assert.deepEqual(g.enemies.map((e) => e.effects.mark.stacks), [2, 2]);
  assert.deepEqual([lost(g, 0), lost(g, 1)], [100, 100]);

  const y = makeState({ enemies: [enemy(), boss()] });
  cast(y, 'yellow', 0, 1, true, 'color', 'yellow');
  assert.ok(y.enemies[0].effects.stun.time > 0);
  assert.equal(y.enemies[1].effects.stun.time, 0);

  // 강화판: 블루 ×0.5 3초(보스는 절감 ×0.75), 퍼플 3중첩 즉시, 레드 범위 없음(전원 직격만).
  const b = makeState({ enemies: [enemy(), boss()] });
  cast(b, 'blue', 0, 1, true, 'color', 'blue');
  assert.deepEqual(b.enemies.map((e) => [e.effects.slow.mul, e.effects.slow.time]), [[0.5, 3], [0.75, 3]]);
  const p = makeState({ enemies: [enemy()] });
  cast(p, 'purple', 0, 1, true, 'color', 'purple');
  assert.equal(p.enemies[0].effects.poison.stacks, 3);
  const r = makeState({ enemies: [enemy(), enemy()], progress: [0.5, 0.5] });
  cast(r, 'red', 0, 1, true, 'color', 'red');
  assert.deepEqual([lost(r, 0), lost(r, 1)], [100, 100]);
  assert.ok(!r.events.some((e) => e.source === 'splash'));
});

test('대폭발: 모든 적 ×2.0(탑 평균 공격력) + 다섯 색 효과, 보스는 면역 색만 빠지고 경직 제외', () => {
  const s = makeState({ enemies: [enemy(), boss({ immune: ['purple'] })], progress: [0.3, 0.6] });
  const ev = cast(s, null, 0, 1, true, 'color_color');
  assert.equal(ev.skill, 'color_color');
  assert.deepEqual(ev.extra.order, [s.enemies[1].id, s.enemies[0].id]);
  const [n, b] = s.enemies;
  // 일반 적: 5효과 전부.
  assert.equal(n.effects.slow.mul, 0.5);
  assert.equal(n.effects.poison.stacks, 3);
  assert.ok(n.effects.stun.time > 0);
  assert.equal(n.effects.mark.stacks, 2);
  // 보스: 퍼플 면역, 경직 제외, 나머지는 걸림(감속은 보스 절감).
  assert.equal(b.effects.poison.stacks, 0);
  assert.equal(b.effects.stun.time, 0);
  assert.equal(b.effects.slow.mul, 0.75);
  assert.equal(b.effects.mark.stacks, 2);
  assert.ok(s.events.some((e) => e.type === 'effectImmune' && e.enemyId === b.id && e.color === 'purple'));
  // 두 적 모두 200 직격만(강화판 레드는 범위 없음). 마크는 명중 뒤에 붙는다.
  assert.equal(lost(s, 0), 200);
  assert.equal(lost(s, 1), 200);
});

test('deferSkillHits: 렌더가 resolveSkillHit을 부를 때 적용, 예약 반영, 시간 초과면 즉시 적용', () => {
  const s = makeState({ enemies: [enemy(), enemy()], config: { deferSkillHits: true, shotTimeoutMs: 1000 } });
  const ev = cast(s, 'blue', 0, 1, true, 'color', 'blue');
  assert.equal(lost(s, 0), 0);
  assert.equal(s.enemies[0].pendingDamage, 100);
  s.resolveSkillHit(ev, s.enemies[0].id);
  s.resolveSkillHit(ev, s.enemies[0].id); // 두 번 불러도 한 번만.
  assert.equal(lost(s, 0), 100);
  assert.equal(s.enemies[0].pendingDamage, 0);
  assert.equal(lost(s, 1), 0);
  step(s, 1.1);
  assert.equal(lost(s, 1), 100, '타임아웃이면 남은 명중을 즉시 적용');
});

test('retargetSkillHit: 대상이 먼저 죽으면 예약을 (HP-예약)이 남은 HP 최대 적으로 옮기고, 없으면 null', () => {
  const s = makeState({ enemies: [enemy({ hp: 900 }), enemy({ hp: 800 }), enemy({ hp: 700 }), enemy({ hp: 600 })], config: { deferSkillHits: true } });
  const [a, b, c] = s.enemies;
  const ev = cast(s, 'red', 0, 1, true, 'box'); // a, b에 150씩.
  assert.deepEqual(ev.targets, [a.id, b.id]);
  a.currentHealth = 0;
  a.state = 'dead';
  c.pendingDamage = 700; // c는 죽을 예정 - 건너뛰고 b(800)도 아직 HP가 남아 1위.
  assert.equal(s.retargetSkillHit(ev, a.id), b.id);
  assert.equal(a.pendingDamage, 0);
  assert.equal(b.pendingDamage, 300);
  s.resolveSkillHit(ev, b.id);
  s.resolveSkillHit(ev, b.id);
  assert.equal(b.maxHealth - b.currentHealth, 300, '옮긴 몫도 실제로 들어감');
  assert.equal(b.pendingDamage, 0);
  s.resolveSkillHit(ev, a.id); // 원래 몫은 이미 옮겼으니 아무 일 없음.

  const none = makeState({ enemies: [enemy({ hp: 900 })], config: { deferSkillHits: true } });
  const ev2 = cast(none, 'red', 0, 1, true, 'box');
  none.enemies[0].state = 'dead';
  assert.equal(none.retargetSkillHit(ev2, none.enemies[0].id), null);
  assert.equal(none.enemies[0].pendingDamage, 150, '남은 1발 몫만 남음');
});

// ---- 퍼즐 -> 전투 다리 ----

function bridgeWith(effects) {
  const casts = [];
  const fake = {
    applyGemClear(color, count, cascadeIndex, isSpecial, specialType, chosenColor) {
      casts.push([color, count, specialType, chosenColor ?? null]);
    },
    applyObstacleWallDamage() {},
  };
  const bridge = new PuzzleBattleBridge(fake);
  bridge.update({
    board: { cellStates: [], cols: 1 },
    resolutions: [],
    effects: effects.map((e) => ({ elapsedMs: 0, cascadeIndex: 1, ...e })),
  });
  return casts;
}

test('다리: 특수 잼 발동/조합을 종류·색과 함께 기술로 넘긴다', () => {
  const id = (i) => GEM_TYPES[i].id;
  assert.deepEqual(bridgeWith([{ type: 'specialActivate', kind: 'line', direction: 'vertical', gemColor: 2, color: null }]), [
    [id(2), 0, 'line_v', null],
  ]);
  assert.deepEqual(bridgeWith([{ type: 'specialActivate', kind: 'color', color: 1, gemColor: -2 }]), [[id(1), 0, 'color', id(1)]]);
  // 박스+컬러가 대신 터뜨리는 칸(gemColor 없음), 조합 변환으로 생긴 잼 - 기술 없음.
  assert.deepEqual(bridgeWith([{ type: 'specialActivate', kind: 'box', color: 3 }]), []);
  assert.deepEqual(bridgeWith([{ type: 'specialActivate', kind: 'line', direction: 'vertical', gemColor: 2, fromTransform: true }]), []);
  const bomb = { kind: 'bomb' };
  assert.deepEqual(bridgeWith([{ type: 'comboActivate', comboKind: 'bomb_bomb', specials: [bomb, bomb], gemColors: [1, 2] }]), [[id(1), 0, 'bomb', null]]);
  const box = { kind: 'box' };
  assert.equal(bridgeWith([{ type: 'comboActivate', comboKind: 'box_box', specials: [box, box], gemColors: [1, 2] }]).length, 2);
  const line = (direction) => ({ kind: 'line', direction });
  assert.deepEqual(
    bridgeWith([{ type: 'comboActivate', comboKind: 'line_line', specials: [line('horizontal'), line('vertical')], gemColors: [0, 4] }]),
    [
      [id(0), 0, 'line_h', null],
      [id(4), 0, 'line_v', null],
    ]
  );
  assert.deepEqual(
    bridgeWith([{ type: 'comboActivate', comboKind: 'line_color', specials: [line('horizontal'), { kind: 'color' }], gemColors: [3, -2] }]),
    [
      [id(3), 0, 'line_h', null],
      [id(3), 0, 'color', id(3)],
    ]
  );
  assert.deepEqual(bridgeWith([{ type: 'comboActivate', comboKind: 'color_color', specials: [{ kind: 'color' }, { kind: 'color' }], gemColors: [-2, -2] }]), [
    [null, 0, 'color_color', null],
  ]);
});
