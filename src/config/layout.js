// 전투 화면 레이아웃 - basis(540x960 = 안전 프레임 180x320의 3배) 고정 px. 합계 = 960.
// src/render/layout.js가 frame CSS 폭/540 배율로 환산한다(frame 밖 블리드엔 배경만 깔린다).
export const LAYOUT_CONFIG = {
  basisW: 540,
  basisH: 960,
  currencyBarPx: 54, // 최상단 재화 바(frame 위쪽에 붙음)
  battlePx: 300,
  scoreBarPx: 54,
  boardPx: 468, // 보드 정사각 영역 - 칸 = 468 / max(rows, cols) (6x6이면 78, 지금 7x7이면 약 66.9)
  actionBarPx: 84, // 핫바(frame 아래쪽에 붙음) - 남는 12는 핫바 안 위아래 여백
};
