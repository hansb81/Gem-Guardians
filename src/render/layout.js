import { LAYOUT_CONFIG as L } from '../config/layout.js';

// frame CSS 크기(width/height)를 받아 재화 바/전투 패널/점수바/보드/액션바 사각형을 계산한다.
// 모두 basis(540x960) 고정 px를 width/basisW 배율로 환산 - frame이 항상 9:16이라 세로도 같은 배율.
// Canvas 변환(DPR, frame 원점)은 이 계산에 들어가지 않는다 - 렌더러가 ctx 변환으로 처리한다.
export function computeLayout(width, height, boardRows, boardCols) {
  const k = width / L.basisW;
  const currencyBarHeight = L.currencyBarPx * k;
  const battleHeight = L.battlePx * k;
  const scoreBarY = currencyBarHeight + battleHeight;
  const scoreBarHeight = L.scoreBarPx * k;
  const cellSize = Math.min(L.cellPx, L.boardPx / Math.max(boardRows, boardCols)) * k;
  const boardPixelWidth = cellSize * boardCols;
  const boardPixelHeight = cellSize * boardRows;
  const boardY = scoreBarY + scoreBarHeight + (L.boardPx * k - boardPixelHeight) / 2;
  const actionBarHeight = L.actionBarPx * k;

  return {
    currencyBar: { x: 0, y: 0, width, height: currencyBarHeight },
    battle: { x: 0, y: currencyBarHeight, width, height: battleHeight },
    scoreBar: { x: 0, y: scoreBarY, width, height: scoreBarHeight },
    board: {
      x: (width - boardPixelWidth) / 2,
      y: boardY,
      width: boardPixelWidth,
      height: boardPixelHeight,
      cellSize,
      rows: boardRows,
      cols: boardCols,
    },
    // 핫바는 frame 바닥에 붙인다(보드가 6행이 아니어도 아래 끝 고정).
    actionBar: { x: 0, y: height - actionBarHeight, width, height: actionBarHeight },
  };
}
