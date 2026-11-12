// 빈 전장 즉시 등장 규칙(balance.json floorShape.emptySpawn)의 판정 - 순수 함수, 객체를 만들지 않는다.
// 게임(src/battle/battleState.js _pullSpawn)과 시뮬(tools/sim)이 이 함수 하나를 같이 쓴다.
//
// 사격·기술이 대상을 고르기 직전에 부른다. 반환 = 지금 앞당겨 낼 적 수(0 = 안 냄): 다음 적 + 그 뒤로 예정 시각
// 간격이 packGap 이하로 붙은 무리.
//   'off'     항상 0.
//   'on'      살아 있는 적이 0이고 안 나온 적이 남았을 때.
//   'predict' on + 살아 있는 적이 모두 예약 피해(pendingDamage)로 죽을 예정일 때도(= _pickTarget 폴백이 나는 경우).
//             단 마지막 즉시 등장 뒤 cooldownSec 안이면 0(쿨다운은 predict에만 건다).
// enemies: { state, currentHealth, pendingDamage }[], spawnAt: 적마다 등장 시각(초) 배열 | null(= spawnInterval 간격).
export function emptySpawnCount(mode, enemies, spawnedCount, spawnTotal, spawnAt, spawnInterval, packGap, sincePullSec, cooldownSec) {
  if (mode !== 'on' && mode !== 'predict') return 0;
  if (spawnedCount >= spawnTotal) return 0;
  const predict = mode === 'predict';
  if (predict && sincePullSec < cooldownSec - 1e-9) return 0;
  for (let k = 0; k < enemies.length; k++) {
    const e = enemies[k];
    if (e.state === 'alive' && (!predict || e.currentHealth - e.pendingDamage > 0)) return 0;
  }
  let i = spawnedCount + 1;
  while (i < spawnTotal && (spawnAt ? spawnAt[i] - spawnAt[i - 1] : spawnInterval) <= packGap + 1e-9) i++;
  return i - spawnedCount;
}
