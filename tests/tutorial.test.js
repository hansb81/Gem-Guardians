// 최초 진입 튜토리얼(docs/tutorial.md) - 레슨 보드 4개(assets/ui/tutorial/boards.json)와 스텝 머신(src/tutorial).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GameState } from '../src/core/gameState.js';
import { findMatches } from '../src/core/match.js';
import { refill } from '../src/core/gravity.js';
import { Board, EMPTY } from '../src/core/board.js';
import { BattleState } from '../src/battle/battleState.js';
import { PuzzleBattleBridge } from '../src/game/puzzleBattleBridge.js';
import { Tutorial, parseLessonBoard, completeTutorial, shouldStartTutorial, migrateTutorialSave } from '../src/tutorial/tutorial.js';
import { BattleController } from '../src/game/battleController.js';
import { playerState } from '../src/game/playerState.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf-8'));
const CFG = read('../config/tutorial.json');
const BOARDS = read('../assets/ui/tutorial/boards.json');
const SKILLS = read('../config/skills.json');
const LESSONS = ['match3', 'line', 'bomb', 'box'];

function idle(gs) {
  return gs.resolutions.length === 0 && !gs.effects.some((e) => e.type === 'shuffle') && gs.board.cellStates.every((cs) => cs === null);
}

// 보드가 쉴 때까지 돌리며 그동안 뜬 이펙트를 모은다.
function drain(gs, onTick = () => {}) {
  const seen = [];
  for (let i = 0; i < 5000; i++) {
    gs.update(0.016);
    for (const e of gs.effects) if (!seen.includes(e)) seen.push(e);
    onTick();
    if (idle(gs)) return seen;
  }
  assert.fail('보드가 멈추지 않음');
}

function lessonState(name) {
  const gs = new GameState({ seed: 7 });
  gs.refillMode = 'noMatch';
  gs.shuffleBoard({ targetBoard: parseLessonBoard(BOARDS[name].board) });
  drain(gs);
  return gs;
}

const swap = (gs, [[r1, c1], [r2, c2]]) => assert.ok(gs.trySwap(r1, c1, r2, c2), '스왑 수락');

for (const name of LESSONS) {
  const l = BOARDS[name];
  test(`${name}: (a) 처음 보드에 매치 없음`, () => {
    const grid = parseLessonBoard(l.board);
    assert.equal(findMatches({ grid, rows: 7, cols: 7 }).length, 0);
  });

  test(`${name}: (b) 만들기 수가 지정 칸에 특수 잼을 만들고 (c) noMatch 리필 뒤 쓰기 수가 그걸 터뜨림`, () => {
    const gs = lessonState(name);
    const before = gs.score;
    swap(gs, l.make);
    // 만들기 수가 맞추는 칸은 전부 딤 구멍(바꿀 두 칸 + highlight.make)에 있어야 한다.
    const hit = new Set();
    for (let i = 0; i < 40 && hit.size === 0; i++) {
      gs.update(0.016);
      gs.board.cellStates.forEach((cs, j) => cs && (cs.phase === 'clearing' || cs.phase === 'armed') && hit.add(j));
    }
    const lit = new Set([...l.make, ...(l.highlight?.make ?? [])].map(([r, c]) => r * 7 + c));
    assert.deepEqual([...hit].filter((j) => !lit.has(j)), [], `${name}: 맞추는 칸이 전부 강조됨`);
    const fx = drain(gs);
    assert.ok(gs.score > before, '매치가 났다');
    // noMatch 리필 - 우연한 연쇄 없음(연쇄 단계 1).
    assert.ok(fx.every((e) => (e.cascadeIndex ?? 1) <= 1), '연쇄 없음');
    if (!l.special) return;
    const [r, c] = l.special.at;
    assert.equal(gs.board.getSpecial(r, c)?.kind, l.special.type);
    swap(gs, l.use);
    const useFx = drain(gs);
    assert.ok(useFx.some((e) => e.type === 'specialActivate' && e.kind === l.special.type), `${l.special.type} 발동`);
  });
}

test('noMatch 리필은 바로 매치를 만들지 않는다', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const board = new Board({ seed });
    for (let i = 0; i < 21; i++) board.grid[i] = EMPTY; // 위 3줄 비움
    refill(board, null, { mode: 'noMatch' });
    assert.equal(findMatches(board).length, 0, `seed ${seed}`);
  }
});

const TOWERS = ['red', 'blue', 'yellow', 'green', 'purple'].map((c) => ({ id: `t_${c}`, color: c, stats: { attack: 10 } }));
const enemy = (o = {}) => ({ type: 'tiny_slug', rank: 'normal', name: 'S', hp: 30, def: 0, speed: 0.5, wallDmg: 5, gold: 3, ...o });

function lockedSkills() {
  // 신규 플레이어처럼 폭탄·박스 기술 잠김.
  const skills = structuredClone(SKILLS);
  skills.unlocked.specialSkills.bomb = false;
  skills.unlocked.specialSkills.box = false;
  return skills;
}

// controller를 주면 그 battleState로, 전투 진행은 controller.update(처치 골드·클리어 보상 경로 포함)로.
function world({ onComplete, controller = null, practice = false } = {}) {
  const gs = new GameState({ seed: 3 });
  const bs =
    controller?.battleState ??
    new BattleState({
      towersData: TOWERS,
      resolvedFloor: { wallHp: 1000, interval: 1, spawns: [enemy(), enemy()] },
      battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: {}, skills: lockedSkills() },
    });
  const bridge = new PuzzleBattleBridge(bs);
  const tut = new Tutorial({ config: CFG, boards: BOARDS, gameState: gs, battleState: bs, enemyStat: enemy(), onComplete, practice });
  const casts = [];
  const tick = (ms = 16) => {
    gs.update(ms / 1000);
    bridge.update(gs);
    for (const e of bs.events) {
      if (e.type === 'towerAttack' && !e._done) {
        e._done = true;
        bs.resolveTowerAttack(e);
      }
      if (e.type === 'enemyHit' && e.source === 'tutorial') casts.push('forcedKill');
      if (e.type === 'skillCast' && !e._seen) {
        e._seen = true;
        casts.push(e.skill);
      }
    }
    if (controller) controller.update(ms / 1000);
    else bs.update(ms / 1000);
    tut.update(ms);
  };
  const until = (cond, max = 3000) => {
    for (let i = 0; i < max && !cond(); i++) tick();
    assert.ok(cond(), '조건 도달');
  };
  return { gs, bs, tut, tick, until, casts };
}

test('(d) 스텝 순서대로, 만들기 수엔 몬스터가 버티고 쓰기 수에 죽는다 + 기술 발동, 웨이브 정지', () => {
  const warn = console.warn;
  const warned = [];
  console.warn = (m) => warned.push(m);
  try {
    let rewarded = null;
    const w = world({ onComplete: (r) => (rewarded = r) });
    const { tut, bs } = w;
    const infoIds = CFG.steps.filter((s) => s.type === 'info').map((s) => s.id);
    for (const id of infoIds) {
      assert.equal(tut.step.id, id);
      tut.tap(10); // 0.4초 전 - 무시
      assert.equal(tut.step.id, id);
      for (let i = 0; i < 30; i++) w.tick();
      tut.tap(1000); // 타자 중 - 전체 표시
      assert.equal(tut.step.id, id);
      tut.tap(1000);
    }
    for (const name of LESSONS) {
      const l = BOARDS[name];
      assert.equal(tut.lesson, l);
      w.until(() => idle(w.gs));
      const m = tut.monster;
      assert.equal(m.tutorial, true);
      // 안내 밖 스왑은 막히고 손가락 강조.
      assert.equal(tut.swap(0, 0, 0, 1), false);
      assert.equal(tut.events.at(-1).type, 'tutorialHintPulse');
      const [[a, b], [c, d]] = l.make;
      assert.ok(tut.swap(c, d, a, b), '두 칸 순서 무관');
      if (l.use) {
        w.until(() => tut.phase === 'use');
        for (let i = 0; i < 200; i++) w.tick(); // 날아가던 탄까지 다 맞게
        assert.equal(m.state, 'alive', `${name}: 만들기 수엔 안 죽음`);
        assert.equal(m.currentHealth, 1);
        assert.ok(tut.swap(...l.use[0], ...l.use[1]));
      }
      w.until(() => tut.phase === 'praise');
      assert.equal(m.state, 'dead');
      w.until(() => tut.phase !== 'praise');
    }
    assert.ok(['line', 'bomb', 'box'].every((s) => w.casts.includes(s)), `기술 발동: ${w.casts}`);
    assert.ok(!w.casts.includes('forcedKill'), '안전장치 처치 없이 기술로 죽었다');
    w.until(() => tut.popup === 'done');
    assert.equal(bs.enemies.filter((e) => !e.tutorial).length, 0, '튜토리얼 중 웨이브 없음');
    assert.equal(bs.wallHealth, 1000);
    tut.confirmDone();
    w.until(() => tut.finished);
    assert.equal(rewarded, true);
    assert.equal(bs.holdSpawns, false);
    assert.equal(bs.skills.unlocked.specialSkills.bomb, false, '기술 잠금 복구');
    assert.equal(w.gs.refillMode, 'random');
    for (let i = 0; i < 200; i++) w.tick();
    assert.ok(bs.enemies.some((e) => !e.tutorial), '웨이브 1 시작');
    assert.deepEqual(warned, [], '안전장치가 안 돌았다(보드가 예상대로)');
  } finally {
    console.warn = warn;
  }
});

test('스킵: 확인 팝업 동안 멈추고, 건너뛰면 몬스터 제거 + 보상 없음', () => {
  let rewarded = null;
  const w = world({ onComplete: (r) => (rewarded = r) });
  const { tut, bs } = w;
  while (tut.step.type !== 'lesson') {
    for (let i = 0; i < 30; i++) w.tick();
    tut.tap(0);
  }
  for (let i = 0; i < 20; i++) w.tick();
  tut.openSkip();
  const t0 = tut.timeMs;
  w.tick();
  assert.equal(tut.timeMs, t0, '팝업 중 정지');
  tut.closeSkip();
  tut.openSkip();
  tut.confirmSkip();
  w.until(() => tut.finished);
  assert.equal(rewarded, false);
  assert.equal(bs.enemies.some((e) => e.tutorial), false);
});

test('(e) 완료/스킵 후 done 저장, 두 번째 진입엔 튜토리얼 없음', () => {
  const grants = [];
  const player = { tutorial: { done: false, version: 1 }, saved: 0, save() { this.saved++; }, inventory: { grant: (b, o) => grants.push([b, o]) } };
  assert.equal(shouldStartTutorial(player.tutorial, 1), true);
  assert.equal(shouldStartTutorial(player.tutorial, 2), false);
  completeTutorial(player, CFG, true);
  assert.equal(player.tutorial.done, true);
  assert.equal(player.saved, 1);
  assert.deepEqual(grants, [[{ gold: 100 }, { src: 'tutorial', txId: 'tutorial_complete' }]]);
  assert.equal(shouldStartTutorial(player.tutorial, 1), false);

  const skipped = { tutorial: { done: false, version: 1 }, save() {}, inventory: { grant: () => assert.fail('스킵은 보상 없음') } };
  completeTutorial(skipped, CFG, false);
  assert.equal(shouldStartTutorial(skipped.tutorial, 1), false);
});

// 정보 단계는 탭으로, 레슨은 안내 스왑으로 끝까지(완료 팝업까지).
function playThrough(w, { onLessonTick = () => {} } = {}) {
  const { tut } = w;
  while (tut.step.type === 'info') {
    for (let i = 0; i < 30; i++) w.tick();
    tut.tap(0);
  }
  while (tut.step.type === 'lesson') {
    const id = tut.step.id;
    w.until(() => idle(w.gs));
    const l = tut.lesson;
    assert.ok(tut.swap(...l.make[0], ...l.make[1]));
    if (l.use) {
      w.until(() => tut.phase === 'use');
      assert.ok(tut.swap(...l.use[0], ...l.use[1]));
    }
    w.until(() => tut.step.id !== id || tut.popup === 'done', 5000);
    onLessonTick();
  }
  w.until(() => tut.popup === 'done');
}

test('마이그레이션: tutorial 없는 세이브 - 플레이 흔적이 있으면 done true, 새 세이브는 false', () => {
  assert.deepEqual(migrateTutorialSave(null), { done: false, version: 1 });
  assert.deepEqual(migrateTutorialSave({ gold: 0, diamonds: 0, floor: 1, bestFloor: 1, towerLevels: [1, 1, 1, 1, 1] }), { done: false, version: 1 });
  for (const trace of [{ bestFloor: 3 }, { floor: 2 }, { towerLevels: [1, 2, 1, 1, 1] }, { gold: 15 }, { diamonds: 1 }]) {
    const saved = { gold: 0, diamonds: 0, floor: 1, bestFloor: 1, towerLevels: [1, 1, 1, 1, 1], ...trace };
    assert.equal(migrateTutorialSave(saved).done, true, JSON.stringify(trace));
  }
  // 이미 필드가 있으면 그대로(흔적과 무관).
  assert.deepEqual(migrateTutorialSave({ bestFloor: 9, tutorial: { done: false, version: 1 } }), { done: false, version: 1 });
});

test('튜토리얼 후 기술 잠금 원복 + 콤보 0 - 완료·스킵·중간 이탈(abort) 모두', () => {
  const check = (w, label) => {
    assert.equal(w.bs.skills.unlocked.specialSkills.bomb, false, `${label}: 폭탄 기술 다시 잠김`);
    assert.equal(w.bs.skills.unlocked.specialSkills.box, false, `${label}: 박스 기술 다시 잠김`);
    assert.equal(w.gs.comboStreak, 0, `${label}: 콤보 0`);
    assert.equal(w.gs.comboEnabled, true, `${label}: 콤보 다시 켜짐`);
    assert.equal(w.gs.effects.some((e) => e.type === 'comboBreak'), false, `${label}: Combo Break 없음`);
  };
  const done = world();
  assert.equal(done.bs.skills.unlocked.specialSkills.bomb, true, '튜토리얼 동안은 임시 해금');
  playThrough(done, { onLessonTick: () => assert.equal(done.gs.comboStreak, 0, '레슨 중 콤보 안 쌓임') });
  done.tut.confirmDone();
  done.until(() => done.tut.finished);
  check(done, '완료');

  const skipped = world();
  while (skipped.tut.step.type !== 'lesson') {
    for (let i = 0; i < 30; i++) skipped.tick();
    skipped.tut.tap(0);
  }
  skipped.until(() => idle(skipped.gs));
  const l = skipped.tut.lesson;
  skipped.tut.swap(...l.make[0], ...l.make[1]);
  skipped.tut.openSkip();
  skipped.tut.confirmSkip();
  skipped.until(() => skipped.tut.finished);
  check(skipped, '스킵');

  const aborted = world();
  for (let i = 0; i < 30; i++) aborted.tick();
  aborted.tut.abort();
  check(aborted, '중간 이탈');
});

test('연습 모드(다시 보기): 1층 데이터로 열고 진행 층·골드·세이브·done을 안 바꾼다', () => {
  const keys = ['gold', 'diamonds', 'floor', 'bestFloor', 'towerLevels', 'tutorial'];
  Object.assign(playerState, { floor: 7, bestFloor: 7, gold: 55, tutorial: { done: true, version: 1 } });
  const snap = () => JSON.stringify([keys.map((k) => playerState[k]), playerState.inventory.data]);
  const save = playerState.save;
  let saves = 0;
  playerState.save = () => saves++;
  try {
    const controller = new BattleController({
      balance: read('../config/balance.json'),
      enemies: read('../config/enemies.json'),
      obstacles: read('../config/obstacles.json'),
      floorsData: read('../config/floors.json'),
      itemsConfig: read('../config/items.json'),
      towersBaseData: read('../config/balance.json').tower.towers,
      battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: {}, skills: lockedSkills() },
    });
    playerState.inventory.setReserve(Object.keys(playerState.inventory.data.items)[0], true); // 예약 아이템이 있어도 소모 안 됨
    saves = 0;
    const before = snap();
    controller.startPractice();
    assert.equal(controller.practice, true);
    assert.equal(controller.floor, 1, 'HUD 층 = 1');
    assert.equal(controller.currentFloor.floor, 1);
    let completed = null;
    const w = world({ controller, practice: true, onComplete: (r) => (completed = r) });
    playThrough(w);
    w.tut.confirmDone();
    w.until(() => w.tut.finished);
    assert.equal(completed, true);
    for (let i = 0; i < 300; i++) w.tick();
    assert.equal(w.bs.holdSpawns, true, '연습 모드는 끝나도 웨이브 없음');
    assert.equal(w.bs.enemies.length, 0);
    assert.equal(controller.lastClearReward, null);
    assert.equal(snap(), before, '진행·재화·인벤토리·done 그대로');
    assert.equal(saves, 0, '세이브 안 함');
    controller.retryFloor(); // 메인 메뉴로 나갈 때와 같은 길
    assert.equal(controller.practice, false);
    assert.equal(controller.floor, 7);
  } finally {
    playerState.save = save;
  }
});
