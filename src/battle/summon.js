// 석상 소환 연출(assets/summon)의 슬롯별 프레임 계산 - 순수 함수(core/battle 쪽, 렌더와 분리).
// 슬롯 i(manifest.order 순서 = towersData 순서)는 i * staggerMs만큼 늦게 시작해서, frameMs
// 배열(가변 길이)을 누적한 시간으로 프레임 인덱스를 고른다. BattleState가 elapsedMs를
// 들고 있고(update(dtSec)로만 증가 - 일시정지 중엔 안 불림), 렌더도 같은 함수로 같은
// elapsedMs를 읽어 프레임을 다시 계산한다(상태 중복 없음).
export function pickSummonFrame(elapsedMs, slotIndex, { staggerMs, frameMs }) {
  const localMs = elapsedMs - slotIndex * staggerMs;
  if (localMs < 0) return { started: false, frame: 0, done: false };

  let acc = 0;
  for (let i = 0; i < frameMs.length; i++) {
    acc += frameMs[i];
    if (localMs < acc) return { started: true, frame: i, done: false };
  }
  return { started: true, frame: frameMs.length - 1, done: true };
}

// 마지막 슬롯(slotCount-1)까지 끝났으면 소환 전체가 끝난 것 - BattleState가 스폰 타이머와
// 퍼즐 입력 차단을 풀 때 쓴다.
export function isSummonDone(elapsedMs, slotCount, config) {
  if (slotCount <= 0) return true;
  return pickSummonFrame(elapsedMs, slotCount - 1, config).done;
}
