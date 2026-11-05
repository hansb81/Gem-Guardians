import { LAYOUT_CONFIG } from '../config/layout.js';

// 캔버스 CSS 크기(width/height)를 받아 재화 바/전투 패널/점수바/보드/액션바 사각형을 계산한다.
// Canvas 변환(DPR 스케일)은 이 계산에 들어가지 않는다 - 렌더러가 ctx 변환으로 처리한다.
export function computeLayout(width, height, boardRows, boardCols) {
  const currencyBarHeight = Math.max(LAYOUT_CONFIG.currencyBarMinPx, height * LAYOUT_CONFIG.currencyBarRatio);
  const remainingHeight = height - currencyBarHeight;

  const battleHeight = remainingHeight * LAYOUT_CONFIG.battleRatio;
  const boardAreaY = currencyBarHeight + battleHeight;
  const boardAreaHeight = remainingHeight - battleHeight;

  const actionBarHeight = boardAreaHeight * LAYOUT_CONFIG.actionBarRatio;
  const scoreBarHeight = boardAreaHeight * LAYOUT_CONFIG.scoreBarRatio;
  const gridAreaHeight = boardAreaHeight - actionBarHeight - scoreBarHeight;

  const cellSize = Math.min(width / boardCols, gridAreaHeight / boardRows);
  const boardPixelWidth = cellSize * boardCols;
  const boardPixelHeight = cellSize * boardRows;
  const boardX = (width - boardPixelWidth) / 2;
  const boardY = boardAreaY + scoreBarHeight + (gridAreaHeight - boardPixelHeight) / 2;

  return {
    currencyBar: { x: 0, y: 0, width, height: currencyBarHeight },
    battle: { x: 0, y: currencyBarHeight, width, height: battleHeight },
    scoreBar: { x: 0, y: boardAreaY, width, height: scoreBarHeight },
    board: {
      x: boardX,
      y: boardY,
      width: boardPixelWidth,
      height: boardPixelHeight,
      cellSize,
      rows: boardRows,
      cols: boardCols,
    },
    actionBar: { x: 0, y: boardAreaY + scoreBarHeight + gridAreaHeight, width, height: actionBarHeight },
  };
}
