// 인벤토리 화면 보조 계산(src/render/inventoryTab.js inventoryGroups, rewardPopup.js rewardFromDelta).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inventoryGroups } from '../src/render/inventoryTab.js';
import { rewardFromDelta } from '../src/render/rewardPopup.js';
import { Inventory } from '../src/game/inventory.js';

const ITEMS = JSON.parse(readFileSync(new URL('../config/items.json', import.meta.url), 'utf8'));

test('보유 아이템 그룹: hotbar는 kind별, preFloor는 빠지고, 부활은 기타. 21층 전엔 해제 부적 없음', () => {
  const inv = new Inventory(null, { config: ITEMS });
  const g20 = inventoryGroups(ITEMS, inv.visibleItems(20));
  assert.deepEqual(g20.other, ['revive']);
  assert.ok(!g20.board.includes('defuse'));
  assert.ok(g20.battle.every((id) => ITEMS.items[id].kind === 'battle'));
  for (const id of ['booster_line', 'booster_bomb', 'gold_coin']) assert.ok(![...g20.board, ...g20.battle, ...g20.other].includes(id));
  assert.ok(inventoryGroups(ITEMS, inv.visibleItems(21)).board.includes('defuse'));
});

test('rewardFromDelta: 받은 것만(buy 비용 음수·over 제외), 빈 지급은 null', () => {
  assert.deepEqual(rewardFromDelta({ hammer: 2, gold: -300, over: { hammer: 1 } }), { gold: 0, diamonds: 0, items: { hammer: 2 }, skills: {}, flags: [] });
  assert.deepEqual(rewardFromDelta({ diamonds: 60, dye: 1, flags: ['slot4'], skills: { lava: 1 } }).flags, ['slot4']);
  assert.equal(rewardFromDelta({ hammer: 0 }), null);
  assert.equal(rewardFromDelta(null), null);
});

test('하단 바 쿨다운: 스왑 직후(validSwapCount+1) 숫자가 줄어든다 - inventory onChange 없이 ItemController를 매 프레임 읽음', async () => {
  const { ItemController } = await import('../src/game/itemController.js');
  const { ItemBarRenderer } = await import('../src/render/itemBarRenderer.js');
  const inventory = new Inventory({ items: { hammer: 3 }, loadout: { hotbar: ['hammer', null, null, null] } }, { config: ITEMS });
  let changes = 0;
  inventory.onChange(() => changes++);
  const gameState = { validSwapCount: 0, useHammer: () => true, board: { inBounds: () => true } };
  const items = new ItemController({ config: ITEMS, player: { inventory }, gameState });
  assert.equal(items.use('hammer', { row: 0, col: 0 }).ok, true);
  changes = 0;

  // drawBar가 슬롯 가운데에 그리는 숫자(center)를 가로챈다.
  const bar = new ItemBarRenderer();
  const centers = [];
  bar.drawSlot = (ctx, a, i, id, x, y, k, opts) => {
    centers.push(opts.center ?? null);
    return { x, y, width: 44, height: 44 };
  };
  const ctx = { save() {}, restore() {}, set imageSmoothingEnabled(v) {} };
  const ui = { equipped: inventory.hotbar(), counts: inventory.data.items, items };
  const frame = () => {
    centers.length = 0;
    bar.drawBar(ctx, { x: 0, y: 0, width: 300, height: 60 }, null, null, ui, 0);
    return centers[0];
  };
  const cd = ITEMS.items.hammer.cooldownMoves;
  assert.equal(frame(), String(cd));
  gameState.validSwapCount += 1; // 스왑 1번
  assert.equal(frame(), String(cd - 1), '스왑 직후 다음 프레임에 1 줄어듦');
  gameState.validSwapCount += cd - 1;
  assert.equal(frame(), null, '쿨다운 끝');
  assert.equal(changes, 0, 'inventory onChange는 오지 않았다');
});
