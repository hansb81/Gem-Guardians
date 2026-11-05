// 화면 분할 비율 설정. 상단 재화 바 / 전투 영역 / 퍼즐 영역(점수바+보드+액션바).
export const LAYOUT_CONFIG = {
  // 고정 캔버스 비율(가로/세로). 데스크톱도 모바일과 같은 비율을 쓰고, 창이 더 넓거나
  // 길면 레터박스(빈 공간)로 남긴다 - main.js의 resize()가 이 비율로 캔버스 CSS 크기를 정한다.
  aspectRatio: 9 / 16,

  currencyBarMinPx: 40, // 최상단 재화 바 - 작은 화면에서도 아이콘+숫자가 읽히도록 최소 높이 보장
  currencyBarRatio: 0.05,

  battleRatio: 1 / 3, // 재화 바를 뺀 나머지 중 전투 영역 비율
  boardRatio: 2 / 3,

  scoreBarRatio: 0.09, // 보드 영역(하단) 중 점수/콤보 바가 차지하는 비율
  actionBarRatio: 0.12, // 보드 영역 중 스킬/아이템 바가 차지하는 비율
};
