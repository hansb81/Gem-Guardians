// 탑 5개 배치(docs/battle.md §3) - 왼쪽/오른쪽 2열 지그재그. towerArea 크기에 맞춰
// battleRenderer가 실제 픽셀 좌표로 다시 계산한다.
export const TOWER_LAYOUT_CONFIG = {
  rowCount: 5, // 세로 간격을 나누는 기준(전투 영역 높이 / rowCount)
  columns: { left: 0.32, right: 0.68 }, // towerArea.width에 대한 비율
};
