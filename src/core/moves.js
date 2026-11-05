import { findMatches } from './match.js';

function wouldMatchAfterSwap({ grid, rows, cols }, r1, c1, r2, c2) {
  const copy = grid.slice();
  const i1 = r1 * cols + c1;
  const i2 = r2 * cols + c2;
  const tmp = copy[i1];
  copy[i1] = copy[i2];
  copy[i2] = tmp;
  return findMatches({ grid: copy, rows, cols }).length > 0;
}

// 인접한 두 칸을 바꿨을 때 매치가 생기는 조합을 하나 찾아 반환한다. 없으면 null.
// canSwap(r1,c1,r2,c2)(선택, 기본 항상 true)은 "이 두 칸을 실제로 스왑할 수 있는가"를
// core가 몰라도 되는 일반적인 방식으로 걸러낸다 - occupant 방해요소처럼 swappable:false인
// 칸을 낀 조합은 매치가 생겨도 플레이어가 실제로 둘 수 없으므로 "가능한 수"가 아니다.
export function findAnyValidMove(state, canSwap = () => true) {
  const { rows, cols } = state;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (c + 1 < cols && canSwap(r, c, r, c + 1) && wouldMatchAfterSwap(state, r, c, r, c + 1)) {
        return { from: { row: r, col: c }, to: { row: r, col: c + 1 } };
      }
      if (r + 1 < rows && canSwap(r, c, r + 1, c) && wouldMatchAfterSwap(state, r, c, r + 1, c)) {
        return { from: { row: r, col: c }, to: { row: r + 1, col: c } };
      }
    }
  }
  return null;
}

export function hasAnyValidMove(state, canSwap = () => true) {
  return findAnyValidMove(state, canSwap) !== null;
}
