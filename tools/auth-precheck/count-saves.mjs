// 1~10층 한 판 동안 storage.save 호출 수 세기(docs/auth-precheck.md 5번). 실제 BattleController·playerState·
// LocalRankingService를 Node에서 돌리고, 층마다 "전투 시작 -> 클리어 -> 랭킹 제출 -> 다음 층"을 게임(main.js)과 같은
// 순서로 부른다. 전투 자체(퍼즐)는 돌리지 않고 클리어 상태로 바로 넘긴다 - 전투 중 save를 부르는 건 아이템 사용(spend)뿐이라
// 플레이어 행동(층당 아이템 사용 ITEM_USES회, 석상 강화 LEVELUPS회)은 가정값으로 따로 더한다.
// 실행: node tools/auth-precheck/count-saves.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { storage } from '../../src/platform/storage.js';
import { BattleController } from '../../src/game/battleController.js';
import { playerState } from '../../src/game/playerState.js';
import { createRankingService } from '../../src/ranking/rankingService.js';
import { completeTutorial } from '../../src/tutorial/tutorial.js';
import { createCloudSave } from '../../src/net/cloudSave.js';

// 클라우드 저장 업로드(save-put) 횟수: main.js와 같은 자리에서 flush(층 클리어 뒤 'floor', grant 성공 'grant'), 층당 FLOOR_MS.
const FLOOR_MS = 90e3; // 층당 약 1.5분(docs/auth-precheck.md 5번)

const ITEM_USES = 1;
const LEVELUPS = 2;
const cfg = (f) => JSON.parse(readFileSync(new URL(`../../config/${f}`, import.meta.url), 'utf8'));
const balance = cfg('balance.json');
const enemies = cfg('enemies.json');
const items = cfg('items.json');
const shop = cfg('shop.json');

const counts = {};
let phase = 'init';
const origSave = storage.save;
storage.save = (key, value) => {
  if (key === 'gemGuardians.save.v2') counts[phase] = (counts[phase] ?? 0) + 1;
  return origSave(key, value);
};

playerState.initShop(shop);
playerState.initItems(items);
completeTutorial(playerState, cfg('tutorial.json'), true);
const ranking = createRankingService({ player: playerState, config: cfg('ranking.json') });
const controller = new BattleController({
  balance, enemies, obstacles: cfg('obstacles.json'), floorsData: cfg('floors.json'),
  towersBaseData: balance.tower.towers, itemsConfig: items, shopConfig: shop,
  battleConfig: { cascadeBonusPerStep: balance.tower.puzzleShot.cascadeBonus, minDamage: 1, attackIntervalSec: enemies.attackInterval, effectDurationsMs: {} },
  onBattleStateChanged: () => {},
});
controller.onFloorClear = (floor) => ranking.submit('normal', { floor, at: Date.now() }); // main.js:334
playerState.gold = 1e9; // 강화가 늘 성공하게(호출 수만 셈)

let clock = 0;
const puts = [];
const cloud = createCloudSave();
const net = { enabled: true, on: true, features: { cloudSave: true }, playerId: 'me' };
storage.save('cloudMeta', { owner: 'me', rev: 0, dirty: false }); // 이미 동기화된 기기
cloud.init({ playerState, storage, net, call: async (n, b) => (puts.push(b), { ok: true, rev: b.baseRev + 1 }), reload() {}, now: () => clock });
await cloud.syncOnStart({ rev: 0 }); // S == L, 안 dirty -> 호출 없음
const inv = playerState.inventory;
const grant = inv.grant.bind(inv);
inv.grant = (...a) => {
  const r = grant(...a);
  if (r.ok) cloud.flush('grant');
  return r;
};

for (let f = 1; f <= 10; f++) {
  phase = 'beginFloor(예약 소모)';
  controller.update(0); // 첫 update = beginFloor -> consumeReservations
  phase = '아이템 사용(spend)';
  for (let i = 0; i < ITEM_USES; i++) {
    const id = playerState.inventory.hotbar().find((x) => x && playerState.inventory.has(x));
    if (id) playerState.inventory.spend(id, 1);
  }
  phase = '클리어 보상(+보스 첫 보상)·랭킹';
  controller.battleState.status = 'cleared';
  controller.update(0);
  await Promise.resolve();
  phase = '석상 강화';
  for (let i = 0; i < LEVELUPS; i++) controller.tryLevelUpTower(i % 5); // 한 번 탭 = 1레벨 = save 1회
  phase = '다음 층(advanceFloor·initItems)';
  controller.advanceFloor();
  await cloud.flush('floor');
  clock += FLOOR_MS;
}
assert.equal(playerState.bestFloor, 11, '10층까지 클리어해야 함');
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`가정: 층당 아이템 사용 ${ITEM_USES}회, 석상 강화 ${LEVELUPS}회`);
for (const [k, v] of Object.entries(counts)) console.log(`${k}: ${v}`);
console.log(`합계(1~10층): ${total}회, 층당 ${(total / 10).toFixed(1)}회`);
await new Promise((r) => setTimeout(r, 0));
console.log(`클라우드 업로드(save-put, 층당 ${FLOOR_MS / 1000}초): ${puts.length}회 (rank 실린 것 ${puts.filter((b) => b.rank).length})`);
