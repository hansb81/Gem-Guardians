// 메뉴 신단 받침대 = 보관함 입구(docs/inventory.md 5-3): 누르는 영역, 빨간 점 조건 2가지, 열면 새 아이템 표시 꺼짐.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Inventory } from '../src/game/inventory.js';

globalThis.Image ??= class {}; // MainMenuScreen 생성자가 배경 폴백을 로드한다 - Node엔 Image가 없다.
const { MainMenuScreen } = await import('../src/render/mainMenuScreen.js');

const ITEMS = JSON.parse(readFileSync(new URL('../config/items.json', import.meta.url), 'utf8'));
const MANIFEST = JSON.parse(readFileSync(new URL('../assets/menu/manifest.json', import.meta.url), 'utf8'));

function menu() {
  const m = new MainMenuScreen();
  m.manifest = MANIFEST;
  m._transform = { offsetX: 0, offsetY: 0, k: 1 }; // 540x960 그대로.
  return m;
}

test('받침대 영역 안에서 누르고 떼면 보관함이 열린다', () => {
  const m = menu();
  assert.equal(m.handlePointerDown(270, 600), null);
  assert.equal(m.popup, null, '누르는 순간엔 안 열림');
  assert.equal(m.handlePointerUp(280, 620), 'openInventory');
  assert.equal(m.popup, null, '보관함은 main.js의 정비 팝업(village)이 연다 - 메뉴 팝업은 안 바뀜');
});

test('밖으로 끌고 나가서 떼거나 pointercancel이면 안 열린다', () => {
  const m = menu();
  m.handlePointerDown(270, 600);
  assert.equal(m.handlePointerUp(270, 720), null);
  m.handlePointerDown(270, 600);
  assert.equal(m.handlePointerUp(), null);
  assert.equal(m.popup, null);
});

test('결정 자리(crystalReserved) = 랭킹 입구: 안에서 떼면 openRanking, 받침대로 끌고 가 떼면 안 열림', () => {
  const m = menu();
  m.handlePointerDown(270, 400);
  assert.equal(m.handlePointerUp(270, 480), 'openRanking'); // 이름판 [214,466,112,36] 위
  m.handlePointerDown(270, 400);
  assert.equal(m.handlePointerUp(270, 600), null);
  m.handlePointerDown(270, 506); // 원석 끝(504)과 받침대 시작(510) 사이 = 아무것도 아님
  assert.equal(m.handlePointerUp(270, 506), null);
  assert.equal(m.popup, null);
});

test('누르는 영역이 플레이 버튼·재화 바·모서리 아이콘·결정 자리와 겹치지 않는다', () => {
  const [ax, ay, aw, ah] = MANIFEST.altarInventory.hitArea_screenPx;
  const L = MANIFEST.layoutA_screenPx;
  const others = [L.playButton, L.currencyBar, L.attendance, L.event, L.settings, L.shop, MANIFEST.altarInventory.crystalReserved_screenPx];
  for (const [x, y, w, h] of others) assert.ok(x >= ax + aw || x + w <= ax || y >= ay + ah || y + h <= ay, `${[x, y, w, h]}`);
});

test('빨간 점 1: 새 아이템을 얻고 보관함을 안 열었을 때 - 열면(markItemsSeen) 꺼진다', () => {
  const inv = new Inventory({ items: { hammer: 1 }, seenItems: ['hammer'], loadout: { hotbar: ['hammer', null, null, null] } }, { config: ITEMS });
  assert.equal(inv.hasUnseenItems(1), false);
  inv.grant({ items: { hammer: 2 } }, { src: 'test' });
  assert.equal(inv.hasUnseenItems(1), false, '이미 본 아이템이 늘어난 건 새 아이템 아님');
  inv.grant({ items: { revive: 1 } }, { src: 'test' });
  assert.equal(inv.hasUnseenItems(1), true);
  inv.markItemsSeen(1);
  assert.equal(inv.hasUnseenItems(1), false);
  assert.ok(inv.data.seenItems.includes('revive'));
});

test('빨간 점 2: 빈 장착 칸 + 넣을 수 있는 아이템(보유 1개 이상, 안 꽂힌 hotbar)', () => {
  const full = new Inventory({ items: { hammer: 1, scythe_h: 1, repair: 1, glove: 1 }, loadout: { hotbar: ['hammer', 'scythe_h', 'repair', null] } }, { config: ITEMS });
  assert.equal(full.hasFillableSlot(1), false, '보이는 3칸이 다 참(4번째는 잠김)');
  const inv = new Inventory({ items: { hammer: 1, revive: 3, booster_line: 2 }, loadout: { hotbar: ['hammer', null, null, null] } }, { config: ITEMS });
  assert.equal(inv.hasFillableSlot(1), false, '부활·예약 아이템은 칸에 못 넣음');
  inv.grant({ items: { glove: 1 } }, { src: 'test' }); // 처음 얻은 hotbar 아이템은 빈 칸에 자동 장착된다.
  assert.equal(inv.hasFillableSlot(1), false);
  inv.unequip(1);
  assert.equal(inv.hasFillableSlot(1), true);
  inv.spend('glove');
  assert.equal(inv.hasFillableSlot(1), false, '0개면 못 넣음');
});

test('seenItems는 저장·불러오기에 남는다(옛 저장은 빈 배열)', () => {
  const inv = new Inventory({ items: { hammer: 1 } }, { config: ITEMS });
  assert.deepEqual(inv.data.seenItems, []);
  inv.markItemsSeen(1);
  assert.deepEqual(new Inventory(JSON.parse(JSON.stringify(inv.data)), { config: ITEMS }).data.seenItems, ['hammer']);
});
