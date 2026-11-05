// 층 시스템 데이터(config/balance.json, enemies.json, obstacles.json, floors.json)를 읽어
// src/core/balance/floorGen.js에 그대로 꽂을 수 있는 형태로 돌려준다. loadBattleData.js와
// 같은 패턴 - 하나라도 실패하면 null(이 데이터가 없으면 층 시스템 자체가 성립하지 않는다).
async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

export async function loadBalanceData() {
  try {
    const [balance, enemies, obstacles, floorsData] = await Promise.all([
      fetchJson('config/balance.json'),
      fetchJson('config/enemies.json'),
      fetchJson('config/obstacles.json'),
      fetchJson('config/floors.json'),
    ]);
    return { balance, enemies, obstacles, floorsData };
  } catch {
    return null;
  }
}
