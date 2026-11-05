// 시한폭탄(attachment) 전용 핸들러. hp/gemCleared 피해는 obstacles.js의 범용 경로로
// 처리되므로(hp 1 -> 지워지면 바로 해제), 여기서는 "플레이어 스왑 횟수로 줄어드는 타이머"
// (onMove)와 "타이머가 0이 됐을 때"(onExpire)만 다룬다.
export function onMove(instance) {
  instance.timer -= 1;
  return { expired: instance.timer <= 0 };
}

// gameState.js가 타이머 만료를 감지한 뒤 그 칸을 지우기 직전에 호출한다. 이벤트 모양을
// 반환만 하고(부수효과 없음) 실제 wallDamage 적용은 전투 쪽(PuzzleBattleBridge)이 한다.
export function onExpire(instance) {
  return { type: 'obstacleExpire', id: 'timeBomb', wallDamagePct: instance.wallDamagePct };
}
