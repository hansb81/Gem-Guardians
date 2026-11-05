// obstacles.json의 types를 읽어 등록한다. "새 방해요소 추가 = types에 항목 1개 +
// (특별한 동작이 있으면) 핸들러 1개"(docs/balance.md 7-1). 핸들러가 없는 type은 데이터만으로
// 동작한다(hp/swappable/falls/matchable/damagedBy는 obstacles.js가 범용으로 처리) - timeBomb만
// 타이머(onMove)/만료(onExpire) 훅이 필요해서 handler.js를 둔다.
import * as timeBomb from './timeBomb.js';

const HANDLERS = {
  timeBomb,
};

export function createObstacleRegistry(obstaclesConfig) {
  const types = obstaclesConfig.types ?? {};
  return {
    boardCap: obstaclesConfig.boardCap ?? Infinity,
    get(id) {
      return types[id];
    },
    handler(id) {
      return HANDLERS[id] ?? null;
    },
  };
}
