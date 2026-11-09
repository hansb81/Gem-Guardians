import { EMPTY } from './board.js';

// 각 열을 아래쪽으로 압축한다(빈 칸 위의 잼들이 떨어짐). board.grid/board.specials를
// 함께 수정하고(특수 잼은 색과 같이 이동), 실제로 자리가 바뀐 칸들의 이동 목록을 반환한다.
// board.occupants/board.attachments가 있으면(방해요소 레이어, src/core/obstacles/) 같은
// 자리이동을 그대로 따라간다 - occupant는 falls:true라 잼처럼 떨어지고(grid가 OBSTACLE
// 값을 들고 있어 이 함수는 그냥 "비어있지 않은 값"으로만 다룬다), attachment는 자신이
// 붙은 잼과 함께 이동한다. 둘 다 없는 보드(기존 테스트가 쓰는 plain {grid,rows,cols,specials})
// 에서는 아무 영향이 없다.
// columns(Set, 선택)를 주면 그 열만 처리한다 - 다른 해소가 진행 중인 열을 건드리지 않기 위함.
export function applyGravity(board, columns = null) {
  const { rows, cols, grid, specials, occupants, attachments } = board;
  const hasOccupants = Array.isArray(occupants);
  const hasAttachments = Array.isArray(attachments);
  const moves = [];

  for (let c = 0; c < cols; c++) {
    if (columns && !columns.has(c)) continue;
    let writeRow = rows - 1;
    for (let r = rows - 1; r >= 0; r--) {
      const value = grid[r * cols + c];
      if (value === EMPTY) continue;
      const special = specials[r * cols + c];
      const occupant = hasOccupants ? occupants[r * cols + c] : null;
      const attachment = hasAttachments ? attachments[r * cols + c] : null;
      if (writeRow !== r) {
        moves.push({ from: { row: r, col: c }, to: { row: writeRow, col: c }, value, special, occupant, attachment });
      }
      grid[writeRow * cols + c] = value;
      specials[writeRow * cols + c] = special;
      if (hasOccupants) occupants[writeRow * cols + c] = occupant;
      if (hasAttachments) attachments[writeRow * cols + c] = attachment;
      writeRow--;
    }
    for (let r = writeRow; r >= 0; r--) {
      grid[r * cols + c] = EMPTY;
      specials[r * cols + c] = null;
      if (hasOccupants) occupants[r * cols + c] = null;
      if (hasAttachments) attachments[r * cols + c] = null;
    }
  }

  return moves;
}

// 남은 빈 칸을 각 열의 위에서부터 새 잼으로 채운다(항상 일반 잼, 특수 아님).
// board.grid/board.specials를 직접 수정하고 생성된 칸 목록을 반환한다.
// mode 'noMatch'(튜토리얼 레슨, docs/tutorial.md 3장)면 그 자리에 놓아도 3매치/2x2가 안 생기는 색만
// 고른다(이미 놓인 칸 전부 기준 - 나중 칸이 앞 칸을 다시 검사하므로 결과 보드에 새 매치 없음).
export function refill(board, columns = null, { mode = 'random' } = {}) {
  const { rows, cols, grid, specials } = board;
  const spawns = [];

  for (let c = 0; c < cols; c++) {
    if (columns && !columns.has(c)) continue;
    for (let r = 0; r < rows; r++) {
      if (grid[r * cols + c] !== EMPTY) continue;
      const value = mode === 'noMatch' ? pickNoMatchType(board, r, c) : board.randomType();
      grid[r * cols + c] = value;
      specials[r * cols + c] = null;
      spawns.push({ row: r, col: c, value });
    }
  }

  return spawns;
}

// (r, c)에 t를 놓으면 가로/세로 3연속이나 2x2가 생기는지 - 네 방향 전부 본다(리필은 아래 칸이 이미 차 있다).
export function wouldMatchAt(grid, rows, cols, r, c, t) {
  const at = (rr, cc) => (rr >= 0 && rr < rows && cc >= 0 && cc < cols ? grid[rr * cols + cc] : EMPTY);
  let run = 1;
  for (let cc = c - 1; at(r, cc) === t; cc--) run++;
  for (let cc = c + 1; at(r, cc) === t; cc++) run++;
  if (run >= 3) return true;
  run = 1;
  for (let rr = r - 1; at(rr, c) === t; rr--) run++;
  for (let rr = r + 1; at(rr, c) === t; rr++) run++;
  if (run >= 3) return true;
  for (const [dr, dc] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
    if (at(r + dr, c) === t && at(r, c + dc) === t && at(r + dr, c + dc) === t) return true;
  }
  return false;
}

function pickNoMatchType(board, r, c) {
  const ok = [];
  for (let t = 0; t < board.typeCount; t++) if (!wouldMatchAt(board.grid, board.rows, board.cols, r, c, t)) ok.push(t);
  return ok.length ? ok[Math.floor(board.rng() * ok.length)] : board.randomType();
}
