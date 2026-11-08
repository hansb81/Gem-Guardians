// 아이템 사용 제한(개수·쿨다운·층당 횟수)과 실행(docs/items.md 3장). 브라우저 API 없음.
// 쿨다운은 GameState.validSwapCount(유효 스왑 수) 기준. gameState/battleState는 층마다 새로
// 만들어지므로 소유자가 갈아 끼운다(BattleController가 battleState, main.js가 gameState).
// group(config): hotbar = 슬롯 장착·use(), preFloor = 층 시작 예약(consumePreFloor), onFail = 패배 팝업(use('revive')).
const RESERVABLE = new Set(['destroy', 'shuffle']); // 대상이 바쁘면 reserveSec까지 대기하는 action.

// tools/sim(수정 금지)은 { items: {id: n}, equipped: [id] } 평범한 객체를 넘긴다 - 그 객체를 직접 고치는 얇은 어댑터
// (시뮬레이터 결과가 예전과 같게). 게임은 항상 playerState.inventory를 쓴다.
function plainInventory(player) {
  return {
    hotbar: () => player.equipped ?? [],
    has: (id, n = 1) => (player.items?.[id] ?? 0) >= n,
    spend: (id, n = 1) => {
      player.items[id] -= n;
      return { ok: true, reason: null };
    },
    consumeReservations: () => [],
  };
}

export class ItemController {
  constructor({ config, player, gameState = null, battleState = null }) {
    this.config = config;
    this.player = player; // { bestFloor?, inventory(src/game/inventory.js) } - 보유·장착·예약은 inventory만 읽고 쓴다.
    this.inv = player.inventory ?? plainInventory(player);
    this.gameState = gameState;
    this.battleState = battleState;
    this.preFloorUsed = []; // 이번 층에 소모·적용된 preFloor 아이템 id.
    this.resetFloor();
  }

  // 층 시작(층 전환/재시도) - 쿨다운 0, 층당 사용 횟수 0.
  resetFloor() {
    this._lastUseAt = {}; // id -> 사용 시점의 validSwapCount
    this._usesThisFloor = {};
    this.pending = null; // 예약된 낫·망치·섞기 { id, target, ageSec } - UI가 대기 중 줄을 깜빡이는 데 쓴다.
    this.buff = null; // 분노의 북 { id, swapsLeft, lastSwapCount } - 0이 된 뒤 Resolution이 다 끝나면 종료.
  }

  isUnlocked(id) {
    return (this.player.bestFloor ?? Infinity) >= (this.config.items[id].unlockFloor ?? 1);
  }

  // 남은 쿨다운(유효 스왑 수). 0이면 사용 가능. 북은 버프 중엔 전체 쿨다운(끝난 뒤부터 센다).
  cooldownLeft(id) {
    if (this.buff?.id === id) return this.config.items[id].cooldownMoves;
    const last = this._lastUseAt[id];
    if (last == null) return 0;
    const swaps = (this.gameState?.validSwapCount ?? 0) - last;
    return Math.max(0, (this.config.items[id].cooldownMoves ?? 0) - swaps);
  }

  // 이번 층 남은 사용 횟수(null = 제한 없음).
  perFloorLeft(id) {
    const { perFloor } = this.config.items[id];
    return perFloor == null ? null : Math.max(0, perFloor - (this._usesThisFloor[id] ?? 0));
  }

  // UI용 - 북 버프 남은 유효 스왑 수(버프 없으면 null).
  get buffSwapsLeft() {
    return this.buff ? Math.max(0, this.buff.swapsLeft) : null;
  }

  canUse(id) {
    const cfg = this.config.items[id];
    if (!cfg || cfg.group === 'preFloor') return { ok: false, reason: 'notEquipped' };
    if (cfg.group === 'hotbar' && !this.inv.hotbar().includes(id)) return { ok: false, reason: 'notEquipped' };
    if (!this.isUnlocked(id)) return { ok: false, reason: 'locked' };
    if (!this.inv.has(id)) return { ok: false, reason: 'noStock' };
    if (this.pending) return { ok: false, reason: 'busy' }; // 예약 대기 중엔 다른 아이템 불가.
    if (this.perFloorLeft(id) === 0) return { ok: false, reason: 'perFloor' };
    if (this.cooldownLeft(id) > 0) return { ok: false, reason: 'cooldown' };
    const owner = cfg.kind === 'battle' ? this.battleState : this.gameState;
    const needStatus = cfg.action === 'revive' ? 'failed' : 'active';
    if (!owner || (cfg.kind === 'battle' && owner.status !== needStatus)) return { ok: false, reason: 'busy' };
    return { ok: true, reason: null };
  }

  // target: cell/rainbow = {row, col}, dye = {row, col, color}, row/col 낫 = {row} / {col},
  // pair = {a:{row,col}, b:{row,col}}, none/battle = 없음.
  // 실패하면 아무 것도 차감하지 않는다. 낫·망치·섞기(RESERVABLE)는 대상이 바쁘면 예약하고
  // { ok: true, pending: true }를 돌려준다 - 실제 실행·소모는 update()에서.
  use(id, target) {
    const check = this.canUse(id);
    if (!check.ok) return check;
    const cfg = this.config.items[id];
    if (cfg.kind === 'board' && !this._validTarget(cfg, target)) return { ok: false, reason: 'invalidTarget' };
    const result = this._apply(cfg, target);
    if (result === true) {
      this._consume(id);
      if (cfg.action === 'atkBuff') {
        delete this._lastUseAt[id]; // 쿨다운은 버프가 끝난 뒤부터.
        this.buff = { id, swapsLeft: cfg.moves, lastSwapCount: this.gameState?.validSwapCount ?? 0 };
      }
      return { ok: true, reason: null };
    }
    if (typeof result === 'string') return { ok: false, reason: result };
    if (!RESERVABLE.has(cfg.action)) return { ok: false, reason: 'busy' };
    this.pending = { id, target, ageSec: 0 };
    return { ok: true, reason: null, pending: true };
  }

  // 매 프레임(퍼즐 dt). 북 버프 진행 + 예약 재시도 - 실행되면 { id, ok: true }, reserveSec을 넘기면
  // 취소하고 { id, ok: false, reason: 'busy' }, 그 밖엔 null.
  update(dtSec) {
    this._advanceBuff();
    const p = this.pending;
    if (!p) return null;
    if (this._apply(this.config.items[p.id], p.target) === true) {
      this.pending = null;
      this._consume(p.id);
      return { id: p.id, ok: true, reason: null };
    }
    p.ageSec += dtSec;
    if (p.ageSec < this.config.reserveSec) return null;
    this.pending = null;
    return { id: p.id, ok: false, reason: 'busy' };
  }

  // 유효 스왑마다 남은 횟수 -1, 0이 된 뒤 활성 Resolution이 모두 끝나면(마지막 스왑의 연쇄까지 적용) 종료.
  _advanceBuff() {
    const b = this.buff;
    if (!b) return;
    const count = this.gameState?.validSwapCount ?? 0;
    b.swapsLeft -= count - b.lastSwapCount;
    b.lastSwapCount = count;
    if (b.swapsLeft > 0 || (this.gameState?.resolutions.length ?? 0) > 0) return;
    this.buff = null;
    this._lastUseAt[b.id] = count;
    this.battleState?.clearAtkBuff();
  }

  // 층 시작 전 예약된 아이템을 소모하고 이번 층에 적용할 목록(preFloorUsed)을 만든다(inventory.consumeReservations -
  // 각 1개, 층당 1회, 개수 0이면 그 예약은 꺼짐).
  consumePreFloor() {
    this.preFloorUsed = this.inv.consumeReservations();
    return this.preFloorUsed;
  }

  // 이번 층 골드 배율(황금 주화) - BattleController가 처치 골드·클리어 보너스에 곱한다.
  get goldMul() {
    return this.preFloorUsed.reduce((m, id) => m * (this.config.items[id].action === 'goldMul' ? this.config.items[id].mul : 1), 1);
  }

  // 시작 부스터 - 새 퍼즐 보드가 만들어진 직후(main.js resetPuzzleBoard) 호출.
  applyStarterSpecials(gameState = this.gameState) {
    for (const id of this.preFloorUsed) {
      const cfg = this.config.items[id];
      if (cfg.action === 'starterSpecials') gameState.placeStarterSpecials(cfg.special, cfg.count);
    }
  }

  // 보드 밖 대상은 대기 없이 즉시 실패시키려고 미리 거른다.
  _validTarget(cfg, target) {
    if (cfg.target === 'none') return true;
    const { board } = this.gameState;
    const inRange = (v, n) => Number.isInteger(v) && v >= 0 && v < n;
    if (cfg.target === 'row') return inRange(target?.row, board.rows);
    if (cfg.target === 'col') return inRange(target?.col, board.cols);
    if (cfg.target === 'pair') return !!target?.a && !!target?.b && board.inBounds(target.a.row, target.a.col) && board.inBounds(target.b.row, target.b.col);
    if (cfg.action === 'recolor' && !inRange(target?.color, board.typeCount)) return false;
    return !!target && board.inBounds(target.row, target.col);
  }

  _consume(id) {
    this.inv.spend(id, 1);
    this._lastUseAt[id] = this.gameState?.validSwapCount ?? 0;
    this._usesThisFloor[id] = (this._usesThisFloor[id] ?? 0) + 1;
  }

  // true = 실행됨, false = 대상이 바쁨(예약 가능), 문자열 = 즉시 실패 사유.
  _apply(cfg, target) {
    const gs = this.gameState;
    const bs = this.battleState;
    switch (cfg.action) {
      case 'destroy':
        if (cfg.target === 'row') return gs.useScythe('row', target.row);
        if (cfg.target === 'col') return gs.useScythe('col', target.col);
        return gs.useHammer(target.row, target.col);
      case 'transform':
        return gs.useRainbow(target.row, target.col);
      case 'freeSwap':
        return gs.trySwap(target.a.row, target.a.col, target.b.row, target.b.col, { force: true });
      case 'recolor': {
        const r = gs.useDye(target.row, target.col, target.color);
        return r === 'busy' ? false : r;
      }
      case 'shuffle':
        return gs.useShuffle();
      case 'timeBombTimer':
        return gs.addTimeBombTimers(cfg.add) > 0 || 'noTarget';
      case 'wallHeal':
        return bs.healWall(cfg.pct);
      case 'freezeEnemies':
        return bs.freezeEnemies(cfg.duration, cfg.bossMul);
      case 'wallShield':
        return bs.shieldWall(cfg.duration, cfg.blockFlashSec);
      case 'atkBuff':
        return bs.setAtkBuff(cfg.mul);
      case 'revive':
        return bs.revive(cfg.pct, cfg.freezeSec, cfg.bossMul);
      default:
        return false;
    }
  }
}
