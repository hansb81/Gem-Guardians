// 메뉴 신단 받침대 = 정비 입구, 신단 옆 보물상자 = 보관함 입구(docs/inventory.md 5-3): 누르는 영역, 빨간 점 조건 2가지, 열면 새 아이템 표시 꺼짐.
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

test('받침대 영역 안에서 누르고 떼면 정비가 열린다', () => {
  const m = menu();
  assert.equal(m.handlePointerDown(270, 600), null);
  assert.equal(m.popup, null, '누르는 순간엔 안 열림');
  assert.equal(m.handlePointerUp(280, 620), 'openPrep');
  assert.equal(m.popup, null, '정비는 main.js의 정비 팝업(village)이 연다 - 메뉴 팝업은 안 바뀜');
  assert.equal(m.chestOpenAt, null);
});

test('상자 영역 안에서 누르고 떼면 openVault + 열기 연출 시작, 연출 중(팝업이 닫히기 전)에는 다시 안 열린다', () => {
  const m = menu();
  assert.equal(m.handlePointerDown(460, 650), null);
  assert.equal(m.chestOpenAt, null, '누르는 순간엔 연출 없음');
  assert.equal(m.handlePointerUp(470, 700), 'openVault'); // 이름판 [417,678,96,36] 위
  assert.notEqual(m.chestOpenAt, null);
  assert.equal(m.chestOpenMs(), 340);
  m.handlePointerDown(460, 650);
  assert.equal(m.handlePointerUp(460, 650), null);
  m.handlePointerDown(270, 600); // 신단도 안 받는다
  assert.equal(m.handlePointerUp(270, 600), null);
  m.chestOpenAt = null; // main.js: 보관함 팝업이 닫힘
  m.handlePointerDown(460, 650);
  assert.equal(m.handlePointerUp(460, 650), 'openVault');
});

test('상자: 밖으로 끌고 나가서 떼거나 신단에서 눌러 상자에서 떼면 안 열린다, manifest가 없어도 같은 자리(DEFAULT_CHEST)', () => {
  const m = menu();
  m.handlePointerDown(460, 650);
  assert.equal(m.handlePointerUp(460, 740), null);
  m.handlePointerDown(270, 600);
  assert.equal(m.handlePointerUp(460, 650), null);
  assert.equal(m.chestOpenAt, null);
  m.manifest = null;
  m.handlePointerDown(460, 650);
  assert.equal(m.handlePointerUp(460, 650), 'openVault');
  assert.equal(m.chestOpenMs(), 340);
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
  assert.equal(m.handlePointerUp(270, 480), 'openRanking'); // 이름판 [204,466,132,36] 위
  m.crystalTapAt = null; // main.js: 누름 연출이 끝나 랭킹을 엶
  m.handlePointerDown(270, 400);
  assert.equal(m.handlePointerUp(270, 600), null);
  m.handlePointerDown(270, 506); // 원석 끝(504)과 받침대 시작(510) 사이 = 아무것도 아님
  assert.equal(m.handlePointerUp(270, 506), null);
  assert.equal(m.popup, null);
});

test('신단·상자의 누르는 영역이 플레이 버튼·재화 바·모서리 아이콘·결정 자리, 그리고 서로와 겹치지 않는다', () => {
  const altar = MANIFEST.altarInventory.hitArea_screenPx;
  const chest = MANIFEST.vaultChest.hitArea_screenPx;
  const L = MANIFEST.layoutA_screenPx;
  const others = [L.playButton, L.currencyBar, L.attendance, L.event, L.mail, L.settings, L.shop, L.mine, MANIFEST.altarInventory.crystalReserved_screenPx].filter(Boolean);
  for (const [ax, ay, aw, ah] of [altar, chest]) {
    for (const [x, y, w, h] of [...others, altar, chest]) {
      if (x === ax && y === ay) continue; // 자기 자신
      assert.ok(x >= ax + aw || x + w <= ax || y >= ay + ah || y + h <= ay, `${[ax, ay, aw, ah]} x ${[x, y, w, h]}`);
    }
  }
  assert.ok(chest[2] >= 44 && chest[3] >= 44 && chest[0] + chest[2] <= 540, '터치 44 이상, 화면 안');
  // 이름판은 누르는 영역 안.
  const [px, py, pw, ph] = MANIFEST.vaultChest.plate_screenPx;
  assert.ok(px >= chest[0] && py >= chest[1] && px + pw <= chest[0] + chest[2] && py + ph <= chest[1] + chest[3]);
});

test('상자 idle 조각: 32프레임 순서, 금빛 훑기(1~6)가 신단 idle(프레임 0~15) 뒤쪽 반에만', () => {
  const { idle, open } = MANIFEST.vaultChest;
  assert.equal(idle.seq.length, idle.periodFrames);
  assert.ok(idle.seq.every((k) => k >= 0 && k < idle.frames));
  assert.deepEqual(idle.seq.slice(0, 8), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(open.frameMs.length, open.frames);
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

test('원석: 손을 떼면 누름 연출(3프레임 x 80ms = 240ms) 시작, 연출 중에는 다른 입력을 안 받는다', () => {
  const m = menu();
  assert.equal(m.crystalTapMs(), 240);
  m.handlePointerDown(270, 400);
  assert.equal(m.crystalTapAt, null, '누르는 순간엔 연출 없음');
  assert.equal(m.handlePointerUp(270, 400), 'openRanking');
  assert.notEqual(m.crystalTapAt, null);
  const [px, py] = MANIFEST.layoutA_screenPx.playButton;
  assert.equal(m.handlePointerDown(px + 10, py + 10), null);
  assert.equal(m.popup, null, '플레이 버튼 안 눌림');
  m.handlePointerDown(270, 600);
  assert.equal(m.handlePointerUp(270, 600), null, '신단도 안 받는다');
  m.handlePointerDown(270, 400);
  assert.equal(m.handlePointerUp(270, 400), null, '원석 두 번 안 열림');
  m.crystalTapAt = null;
  m.handlePointerDown(270, 600);
  assert.equal(m.handlePointerUp(270, 600), 'openPrep');
});

test('왕관·오라·누름·소용돌이 시트(manifest.symbols): 프레임 수·순서·파일이 맞다', () => {
  const s = MANIFEST.symbols;
  assert.equal(s.rankCrown.seq.length * s.rankCrown.frameMs, 3200, '3.2초마다 한 번 훑음');
  assert.ok(s.rankCrown.seq.every((k) => k >= 0 && k < 9));
  assert.deepEqual(Object.keys(s.rankCrown.sheets), ['iron', 'bronze', 'silver', 'gold']);
  assert.equal(s.rankAura.sheets.iron, undefined, 'iron은 오라 없음');
  assert.deepEqual([s.rankCrown.x, s.rankCrown.y, s.rankAura.x, s.rankAura.y], [81, 80, 72, 75]);
  assert.equal(s.seasonSwirl.frames, 16);
  assert.equal(s.seasonSwirl.cols, 8);
  for (const sh of [...Object.values(s.rankCrown.sheets), ...Object.values(s.rankAura.sheets), s.crystalTap, s.seasonSwirl]) {
    assert.doesNotThrow(() => readFileSync(new URL(`../assets/${sh.file}`, import.meta.url)), sh.file);
  }
});
