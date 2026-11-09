// 최초 진입 튜토리얼(docs/tutorial.md) - 데이터 주도 스텝 머신. config/tutorial.json의 steps를 순서대로
// 진행하고, 레슨 보드는 assets/ui/tutorial/boards.json을 쓴다. 브라우저 API 없음(테스트는 Node).
// 화면(딤/말풍선/손가락)은 src/render/tutorialRenderer.js가 이 객체의 상태만 읽어 그린다.
// 시간은 update(dtMs)로만 흐른다 - 확인 팝업(popup)이 떠 있으면 멈춘다.
import { GEM_TYPES } from '../config/gems.js';

const LETTER_TO_ID = { R: 'red', B: 'blue', Y: 'yellow', G: 'green', P: 'purple' };

// 저장 데이터 기준 최초 자동 실행 여부(1층에서만, 끝나지 않았으면). 다시 보기(연습 모드)는 이 조건과 무관.
export function shouldStartTutorial(tutorialSave, floor) {
  return floor === 1 && tutorialSave?.done !== true;
}

// 세이브의 tutorial 필드. 없던 세이브(튜토리얼 전 버전)는 이미 플레이한 흔적(최고층/진행 층 > 1, 석상 강화,
// 재화 보유)이 있으면 done:true - 완전히 새 세이브(null 포함)만 자동 실행된다.
export function migrateTutorialSave(saved) {
  if (saved?.tutorial && typeof saved.tutorial === 'object') return { done: false, version: 1, ...saved.tutorial };
  const played =
    !!saved &&
    ((saved.bestFloor ?? 1) > 1 ||
      (saved.floor ?? 1) > 1 ||
      (Array.isArray(saved.towerLevels) && saved.towerLevels.some((lv) => lv > 1)) ||
      (saved.gold ?? 0) > 0 ||
      (saved.diamonds ?? 0) > 0);
  return { done: played, version: 1 };
}

// 완료/스킵 공통 - done 저장, 완료(rewarded)면 rewardGold를 txId 'tutorial_complete'로 한 번만.
export function completeTutorial(player, config, rewarded) {
  player.tutorial = { ...player.tutorial, done: true };
  const gold = config.rewardGold ?? 100;
  if (rewarded && gold > 0) player.inventory.grant({ gold }, { src: 'tutorial', txId: 'tutorial_complete' });
  player.save();
}

// boards.json 행 문자열 -> 색 인덱스 flat 배열(GEM_TYPES 순서).
export function parseLessonBoard(rows) {
  const out = [];
  for (const row of rows) for (const ch of row) out.push(GEM_TYPES.findIndex((g) => g.id === LETTER_TO_ID[ch]));
  return out;
}

const samePair = ([a, b], r1, c1, r2, c2) =>
  (a[0] === r1 && a[1] === c1 && b[0] === r2 && b[1] === c2) || (a[0] === r2 && a[1] === c2 && b[0] === r1 && b[1] === c1);

export class Tutorial {
  // enemyStat = 1층 일반 몬스터 스탯(resolveFloorSpawns 결과 1개). onComplete(rewarded)는 셔플·웨이브 재개 직전에 한 번.
  // practice = 다시 보기(연습 모드) - 끝나도 셔플·웨이브 없이 그대로 멈춰 있고(main.js가 메뉴로 돌아감), 세이브는 main이 안 건드린다.
  constructor({ config, boards, gameState, battleState, enemyStat, onComplete = null, practice = false }) {
    this.practice = practice;
    this.config = config;
    this.boards = boards;
    this.gameState = gameState;
    this.battleState = battleState;
    this.enemyStat = enemyStat;
    this.onComplete = onComplete;
    this.lessonIds = config.steps.filter((s) => s.type === 'lesson').map((s) => s.lesson);

    this.timeMs = 0;
    this.popup = null; // null | 'skip' | 'done'
    this.events = []; // { type: 'tutorialHintPulse' } - 입력 때 쌓이고, main.js가 그린 뒤 비운다.
    this.finished = false;
    this._finishing = null; // { rewarded } - 보드가 쉴 때까지 기다렸다가 마무리.
    this.monster = null;

    battleState.holdSpawns = true;
    // 튜토리얼 중엔 콤보를 쌓지 않는다(끝나면 0부터).
    gameState.comboEnabled = false;
    gameState.resetCombo();
    // 신규 플레이어는 폭탄·박스 기술이 잠겨 있다(상점 해금) - 레슨 동안만 전부 풀어 기술을 보여 준다.
    // 메모리의 battleState.skills만 바꾼 복사본으로 덮는다(세이브엔 안 쓴다) - 끝/스킵이면 _restore, 층을 나가면
    // battleState가 통째로 새로 만들어져 원래 값으로 돌아온다.
    this._savedSkills = battleState.skills;
    const un = battleState.skills?.unlocked;
    if (un?.specialSkills) {
      battleState.skills = { ...battleState.skills, unlocked: { ...un, specialSkills: Object.fromEntries(Object.keys(un.specialSkills).map((k) => [k, true])) } };
    }
    this._enterStep(0);
  }

  get step() {
    return this.config.steps[this.stepIndex];
  }

  get lesson() {
    return this.step?.type === 'lesson' ? this.boards[this.step.lesson] : null;
  }

  // 지금 말풍선 문구 키(locales tutorial.*) - null이면 말풍선 없음.
  get textKey() {
    const s = this.step;
    if (!s || this.popup === 'done') return null;
    if (this.phase === 'praise') return 'tutorial.nice';
    if (s.type === 'info') return `tutorial.${s.textKey}.body`;
    if (s.type === 'lesson' && this.phase !== 'praiseDelay') return `tutorial.${s.textKey}.${this.phase === 'use' || (this.phase === 'killWait' && this.lesson.use) ? 'use' : 'make'}`;
    return null;
  }

  get titleKey() {
    return this.step?.type === 'info' ? `tutorial.${this.step.textKey}.title` : 'tutorial.speaker';
  }

  // 지금 안내 중인 스왑 [from, to] | null.
  get guideSwap() {
    const l = this.lesson;
    if (!l || this.popup) return null;
    if (this.phase === 'make') return l.make;
    if (this.phase === 'use') return l.use;
    return null;
  }

  // 레슨 딤 구멍에 들어갈 칸(바꿀 두 칸 + highlight).
  get guideCells() {
    const pair = this.guideSwap;
    if (!pair) return null;
    const cells = [...pair, ...(this.lesson.highlight?.[this.phase] ?? [])];
    // 쓰기 수엔 특수 잼 칸도 밝힌다(라인 레슨처럼 바꿀 두 칸 밖에 있을 때).
    const at = this.lesson.special?.at;
    if (this.phase === 'use' && at && !cells.some(([r, c]) => r === at[0] && c === at[1])) cells.push(at);
    return cells;
  }

  _enterStep(index) {
    this.stepIndex = index;
    this.stepMs = 0;
    this.textMs = 0;
    this.revealed = false;
    const s = this.step;
    if (!s) return;
    this.phase = s.type === 'lesson' ? 'make' : s.type;
    if (s.type === 'lesson') this._startLesson(this.boards[s.lesson]);
  }

  _startLesson(l) {
    this.gameState.refillMode = 'noMatch';
    this.gameState.shuffleBoard({ targetBoard: parseLessonBoard(l.board) });
    this._removeMonster();
    this.monster = this.battleState.spawnTutorialEnemy(this.enemyStat, {
      hp: 1,
      hpFloor: l.use ? 1 : null,
      stopAt: this.config.monsterStopAt ?? 0.6,
    });
  }

  _removeMonster() {
    if (!this.monster) return;
    const id = this.monster.id;
    this.battleState.enemies = this.battleState.enemies.filter((e) => e.id !== id);
    this.monster = null;
  }

  _boardIdle() {
    const gs = this.gameState;
    return gs.resolutions.length === 0 && !gs.effects.some((e) => e.type === 'shuffle') && gs.board.cellStates.every((cs) => cs === null);
  }

  // info 스텝 탭: 0.4초 전은 무시, 타자 중이면 전체 표시, 아니면 다음. textLength = 지금 본문 글자 수(렌더가 앎).
  tap(textLength) {
    if (this.popup || this._finishing || this.step?.type !== 'info') return;
    if (this.stepMs < (this.config.infoInputDelayMs ?? 400)) return;
    if (!this.revealed && this.textMs < textLength * (this.config.typeMsPerChar ?? 30)) {
      this.revealed = true;
      return;
    }
    this._enterStep(this.stepIndex + 1);
  }

  // 레슨 중 보드 스왑 - 안내한 두 칸이면 gameState.trySwap 결과, 아니면 false + 손가락 강조.
  swap(r1, c1, r2, c2) {
    const pair = this.guideSwap;
    if (!pair || !samePair(pair, r1, c1, r2, c2)) {
      this.events.push({ type: 'tutorialHintPulse' });
      return false;
    }
    if (!this.gameState.trySwap(r1, c1, r2, c2)) return false;
    if (this.phase === 'make') this.phase = 'makeWait';
    else {
      this.monster.skillBreaksFloor = true; // 쓰기 수 - 특수 잼 기술 피해로 죽는다(일반 사격이 먼저 끝내지 않게).
      this.phase = 'killWait';
      this.stepMs = 0;
    }
    return true;
  }

  openSkip() {
    if (!this.popup && !this._finishing) this.popup = 'skip';
  }

  closeSkip() {
    if (this.popup === 'skip') this.popup = null;
  }

  confirmSkip() {
    if (this.popup !== 'skip') return;
    this.popup = null;
    this._finishing = { rewarded: false };
  }

  confirmDone() {
    if (this.popup !== 'done') return;
    this.popup = null;
    this._finishing = { rewarded: true };
  }

  update(dtMs) {
    if (this.finished || this.popup) return;
    if (this._finishing) {
      this._removeMonster();
      if (this._boardIdle()) this._finish();
      return;
    }
    this.timeMs += dtMs;
    this.stepMs += dtMs;
    this.textMs += dtMs;
    const cfg = this.config;
    const s = this.step;
    if (s.type === 'done') {
      if (this.stepMs >= (cfg.doneDelayMs ?? 800)) this.popup = 'done';
      return;
    }
    if (s.type !== 'lesson') return;
    const l = this.lesson;
    if (this.phase === 'makeWait' && this._boardIdle()) {
      if (l.use) {
        this._ensureUseReady(l);
        this.phase = 'use';
        this.textMs = 0;
        this.revealed = false;
      } else {
        this.phase = 'killWait';
        this.stepMs = 0;
      }
    } else if (this.phase === 'killWait') {
      const settled = this._boardIdle() && !this.battleState.attacksInFlight;
      if (this.monster.state === 'dead' && settled) this._setPhase('praiseDelay');
      else if (settled && this.stepMs > (cfg.forceKillMs ?? 2000)) {
        // 안전장치: 탄이 시간 초과로 사라지는 등 피해가 끝내 안 들어간 경우.
        this.monster.hpFloor = null;
        this.battleState._damageEnemy(this.monster, this.monster.currentHealth, { source: 'tutorial' });
      }
    } else if (this.phase === 'praiseDelay' && this.stepMs >= (cfg.praiseDelayMs ?? 600)) {
      this._setPhase('praise');
    } else if (this.phase === 'praise' && this.stepMs >= (cfg.praiseMs ?? 1000)) {
      this.monster = null; // 이미 죽어서 battleState가 치운다.
      this._enterStep(this.stepIndex + 1);
    }
  }

  _setPhase(phase) {
    this.phase = phase;
    this.stepMs = 0;
    this.textMs = 0;
  }

  // 만들기 수 뒤 보드가 예상(afterMake 특수 잼 위치)과 다르면 쓰기 수에 필요한 칸만 맞춘다.
  _ensureUseReady(l) {
    const board = this.gameState.board;
    const color = parseLessonBoard([l.board[l.make[0][0]]])[l.make[0][1]];
    const [sr, sc] = l.special.at;
    const inPair = l.use.some(([r, c]) => r === sr && c === sc);
    const cells = [...(l.highlight?.use ?? []), ...(inPair ? [] : [l.use[0]])];
    const sp = board.getSpecial(sr, sc);
    const ok = sp?.kind === l.special.type && board.get(sr, sc) === color && cells.every(([r, c]) => board.get(r, c) === color);
    if (ok) return;
    console.warn(`[tutorial] ${this.step.lesson}: 만들기 수 뒤 보드가 예상과 달라 쓰기 수 칸을 맞춥니다`);
    board.set(sr, sc, color);
    board.setSpecial(sr, sc, { kind: l.special.type, direction: l.special.type === 'line' ? sp?.direction ?? 'horizontal' : null });
    for (const [r, c] of cells) {
      board.set(r, c, color);
      board.setSpecial(r, c, null);
    }
  }

  // 튜토리얼이 바꾼 메모리 상태를 원래대로(기술 잠금, 리필, 콤보).
  _restore() {
    this._removeMonster();
    this.battleState.skills = this._savedSkills;
    this.gameState.refillMode = 'random';
    this.gameState.comboEnabled = true;
    this.gameState.resetCombo();
  }

  // 중간에 버릴 때(층을 나감 등) - 마무리 연출 없이 원복만.
  abort() {
    if (this.finished) return;
    this.finished = true;
    this._restore();
  }

  _finish() {
    this.finished = true;
    this._restore();
    this.onComplete?.(this._finishing.rewarded);
    if (this.practice) return; // 연습 모드 - 웨이브 없음(main.js가 메뉴로).
    this.gameState.shuffleBoard();
    this.battleState.holdSpawns = false;
  }
}
