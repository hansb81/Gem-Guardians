// cellState phase/effect 종류별 애니메이션 길이(ms). GameState가 board.cellStates와
// effects 항목의 durationMs로 그대로 꽂아 쓴다.
// - swap: 유효 스왑에서 두 칸이 서로 자리를 바꾸는 'falling' 전환의 길이. 무효 스왑의
//   "들썩"(원위치 -> 상대 위치 -> 원위치)도 각 구간에 이 값을 그대로 써서 왕복 모두
//   스왑과 같은 속도로 보이게 한다(gameState._beginInvalidSwapWiggle).
// - clear/fall/spawn: board.cellStates의 clearing/falling/spawning phase 길이.
// - shuffle/specialCreate/specialActivate/comboActivate/specialTransform: GameState.effects
//   항목의 durationMs.
export const ANIMATION_DURATIONS_MS = {
  swap: 160,
  clear: 180,
  fall: 220,
  spawn: 220,
  shuffle: 900,
  shuffleReduced: 300,
  specialCreate: 220,
  specialActivate: 280,
  comboActivate: 360,
  specialTransform: 260,
};

// 낙하·리필 연출(render/animator dropTiming) - 한 열에서 같이 떨어지는 잼을 아래부터 하나씩
// staggerMs 간격으로 출발시킨다. 전체 길이는 fall/spawn 그대로라 간격 합이 길이의 maxShare를
// 넘으면 간격을 줄인다.
export const DROP_ANIM = { staggerMs: 25, maxShare: 0.5 };
