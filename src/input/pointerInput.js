// Pointer Events로 마우스/터치를 통합 처리한다. 셀을 누른 뒤 일정 거리 이상
// 드래그하면 그 방향(상/하/좌/우)에 따라 인접 칸과의 스왑을 요청한다.
const SWIPE_THRESHOLD_PX = 16;

export class PointerInput {
  constructor(canvas, { getBoardRect, onSwap, canInteract, onSelect }) {
    this.canvas = canvas;
    this.getBoardRect = getBoardRect;
    this.onSwap = onSwap;
    // onSelect(row, col): 보드 칸을 처음 누른 순간(gem_select 효과음용). 선택 자체는
    // 상태를 바꾸지 않으므로 알림만 보낸다.
    this.onSelect = onSelect ?? (() => {});
    this.canInteract = canInteract ?? (() => true);
    // canInteract(row, col): 눌린 칸 기준으로 입력을 허용할지 판정한다. 드래그 목표 칸
    // (active.row+dr, active.col+dc) 쪽은 따로 검사하지 않는다 - gameState.trySwap()이
    // 어차피 두 칸을 전부 다시 검사하므로, 시작 칸만 게이트하면 충분하다.
    this.active = null;

    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);

    canvas.addEventListener('pointerdown', this._onPointerDown);
    canvas.addEventListener('pointermove', this._onPointerMove);
    canvas.addEventListener('pointerup', this._onPointerUp);
    canvas.addEventListener('pointercancel', this._onPointerUp);
  }

  _cellAtClientPoint(clientX, clientY) {
    const boardRect = this.getBoardRect();
    if (!boardRect) return null;

    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    if (
      x < boardRect.x ||
      x >= boardRect.x + boardRect.width ||
      y < boardRect.y ||
      y >= boardRect.y + boardRect.height
    ) {
      return null;
    }

    const col = Math.floor((x - boardRect.x) / boardRect.cellSize);
    const row = Math.floor((y - boardRect.y) / boardRect.cellSize);
    return { row, col };
  }

  _onPointerDown(e) {
    const cell = this._cellAtClientPoint(e.clientX, e.clientY);
    if (!cell) return;
    if (!this.canInteract(cell.row, cell.col)) return;

    this.canvas.setPointerCapture(e.pointerId);
    this.active = {
      pointerId: e.pointerId,
      row: cell.row,
      col: cell.col,
      startX: e.clientX,
      startY: e.clientY,
      resolved: false,
    };
    this.onSelect(cell.row, cell.col);
  }

  _onPointerMove(e) {
    const active = this.active;
    if (!active || active.pointerId !== e.pointerId || active.resolved) return;

    const dx = e.clientX - active.startX;
    const dy = e.clientY - active.startY;
    if (Math.hypot(dx, dy) < SWIPE_THRESHOLD_PX) return;

    let dr = 0;
    let dc = 0;
    if (Math.abs(dx) > Math.abs(dy)) {
      dc = dx > 0 ? 1 : -1;
    } else {
      dr = dy > 0 ? 1 : -1;
    }

    active.resolved = true;
    this.onSwap(active.row, active.col, active.row + dr, active.col + dc);
  }

  _onPointerUp(e) {
    if (this.active && this.active.pointerId === e.pointerId) {
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch (err) {
        // 이미 해제된 경우 무시.
      }
      this.active = null;
    }
  }
}
