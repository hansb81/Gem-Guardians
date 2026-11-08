// 보관함 설명 패널 버튼(itemButtons, 최대 2개·상점 버튼 하나만)과 분류 탭 필터(filterItems) - docs/inventory.md 5-1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { itemButtons, filterItems } from '../src/render/inventoryTab.js';
import { Inventory } from '../src/game/inventory.js';

const ITEMS = JSON.parse(readFileSync(new URL('../config/items.json', import.meta.url), 'utf8'));
const make = (items, hotbar) => new Inventory({ items, loadout: { hotbar } }, { config: ITEMS });
const kinds = (inv, id, hasShop) => itemButtons(inv, id, hasShop).map((b) => b.kind);

test('보유+미장착 = 장착(첫 빈 칸) / 상점 가기, 보유+장착 = 해제 / 상점 가기', () => {
  const inv = make({ hammer: 1, glove: 2 }, ['hammer', null, null, null]);
  assert.deepEqual(itemButtons(inv, 'glove'), [{ kind: 'equip', slot: 1 }, { kind: 'shop' }]);
  inv.equip(1, 'glove');
  assert.deepEqual(itemButtons(inv, 'glove'), [{ kind: 'unequip', slot: 1 }, { kind: 'shop' }]);
});

test('빈 칸이 없으면 장착 대신 안내(칸을 눌러 바꾸기), 잠긴 4번째 칸은 빈 칸이 아니다', () => {
  const inv = make({ hammer: 1, scythe_h: 1, repair: 1, glove: 1 }, ['hammer', 'scythe_h', 'repair', null]);
  assert.deepEqual(kinds(inv, 'glove'), ['swapHint', 'shop']);
});

test('0개+미장착 = 상점에서 사기만, 0개+장착 = 상점에서 사기 / 해제', () => {
  const inv = make({ hammer: 0, glove: 0 }, ['hammer', null, null, null]);
  assert.deepEqual(kinds(inv, 'glove'), ['buy']);
  assert.deepEqual(itemButtons(inv, 'hammer'), [{ kind: 'buy' }, { kind: 'unequip', slot: 0 }]);
});

test('예약·부활 = 상점 가기(0개면 상점에서 사기), 고른 것 없음 = 상점 가기, 상점이 없으면 상점 버튼 없음', () => {
  const inv = make({ revive: 1, booster_line: 0 }, [null, null, null, null]);
  assert.deepEqual(kinds(inv, 'revive'), ['shop']);
  assert.deepEqual(kinds(inv, 'booster_line'), ['buy']);
  assert.deepEqual(kinds(inv, null), ['shop']);
  assert.deepEqual(kinds(inv, 'revive', false), []);
});

test('어떤 경우에도 버튼 최대 2개, 상점으로 가는 버튼은 하나', () => {
  const inv = make({ hammer: 1, glove: 0, revive: 0, dye: 3 }, ['hammer', 'glove', null, null]);
  for (const id of [null, ...Object.keys(ITEMS.items)]) {
    const k = kinds(inv, id);
    assert.ok(k.length <= 2, `${id}`);
    assert.ok(k.filter((x) => x === 'buy' || x === 'shop').length <= 1, `${id}`);
  }
});

test('층 진행 중이면 pending 장착 기준', () => {
  const inv = make({ hammer: 1, glove: 1 }, ['hammer', null, null, null]);
  inv.beginFloor();
  inv.equip(1, 'glove');
  assert.deepEqual(itemButtons(inv, 'glove')[0], { kind: 'unequip', slot: 1 });
});

test('분류 탭 필터: 전체 = 예약 제외 전부, 보드/전투 = hotbar kind, 기타 = 부활', () => {
  const ids = Object.keys(ITEMS.items).filter((id) => (ITEMS.items[id].unlockFloor ?? 1) <= 1);
  const all = filterItems(ITEMS, ids, 'all');
  assert.ok(!all.some((id) => ITEMS.items[id].group === 'preFloor'));
  const board = filterItems(ITEMS, ids, 'board');
  const battle = filterItems(ITEMS, ids, 'battle');
  const other = filterItems(ITEMS, ids, 'other');
  assert.ok(board.every((id) => ITEMS.items[id].kind === 'board') && board.includes('hammer'));
  assert.ok(battle.every((id) => ITEMS.items[id].kind === 'battle') && battle.includes('repair'));
  assert.deepEqual(other, ['revive']);
  assert.equal(board.length + battle.length + other.length, all.length);
});
