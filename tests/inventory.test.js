// 인벤토리(docs/inventory.md) - src/core/inventory(순수 계산·마이그레이션) + src/game/inventory.js(API).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { migrateSave, defaultSkillLevels, ITEM_CAP } from '../src/core/inventory/inventory.js';
import { applySkillLevels, isAdFree } from '../src/core/shop/shop.js';
import { ko } from '../src/config/locales/ko.js';
import { en } from '../src/config/locales/en.js';
import { Inventory } from '../src/game/inventory.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../config/${name}`, import.meta.url), 'utf8'));
const ITEMS = load('items.json');
const SHOP = { ...load('shop.json'), products: load('products.json') };
const SKILLS = load('skills.json');

function make(data = null) {
  const wallet = { gold: 0, diamonds: 0 };
  let saves = 0;
  const inv = new Inventory(data, { wallet, config: ITEMS, save: () => saves++, clock: () => 1 });
  return { inv, wallet, saves: () => saves };
}

test('grant/spend 기본: 지갑·아이템·스킬·플래그, log + onChange + 저장', () => {
  const { inv, wallet, saves } = make();
  let changed = 0;
  inv.onChange(() => changed++);
  const r = inv.grant({ gold: 100, diamonds: 5, items: { hammer: 3 }, skills: { lava: '+1' }, flags: ['adFree'] }, { src: 'test' });
  assert.equal(r.ok, true);
  assert.deepEqual([wallet.gold, wallet.diamonds, inv.count('hammer'), inv.skillLevel('lava')], [100, 5, 3, 1]);
  assert.ok(inv.isUnlocked('adFree'));
  assert.equal(inv.data.log.at(-1).src, 'test');
  assert.equal(changed, 1);
  assert.equal(saves(), 1);

  assert.deepEqual(inv.spend('hammer', 2, { src: 'use' }), { ok: true, reason: null });
  assert.equal(inv.count('hammer'), 1);
  assert.deepEqual(inv.spend('hammer', 2, { src: 'use' }), { ok: false, reason: 'noStock' });
  assert.equal(inv.count('hammer'), 1, '부족하면 일부만 빼지 않는다');
});

test('젬 스킬: +1은 최대 5, 숫자는 그 레벨로', () => {
  const { inv } = make();
  for (let i = 0; i < 7; i++) inv.grant({ skills: { red: '+1' } }, { src: 't' });
  assert.equal(inv.skillLevel('red'), 5);
  inv.grant({ skills: { blue: 3 } }, { src: 't' });
  assert.equal(inv.skillLevel('blue'), 3);
});

test('buy: 차감과 지급을 한 번에, 돈이 모자라거나 상한을 넘으면 아무것도 안 바뀜', () => {
  const { inv, wallet } = make();
  wallet.gold = 1000;
  assert.equal(inv.buy({ cost: { gold: 300 }, bundle: { items: { hammer: 2 } }, src: 'shopGold' }).ok, true);
  assert.deepEqual([wallet.gold, inv.count('hammer')], [700, 2]);
  assert.deepEqual(inv.data.log.at(-1).d, { hammer: 2, gold: -300 });

  const before = JSON.stringify(inv.data);
  assert.equal(inv.buy({ cost: { gold: 701 }, bundle: { items: { hammer: 1 } }, src: 'shopGold' }).reason, 'noMoney');
  assert.equal(inv.buy({ cost: { diamonds: 1 }, bundle: { items: { hammer: 1 } }, src: 'shopDia' }).reason, 'noMoney');
  assert.equal(inv.buy({ cost: { gold: 1 }, bundle: { items: { hammer: ITEM_CAP } }, src: 'shopGold' }).reason, 'cap');
  assert.equal(wallet.gold, 700);
  assert.equal(JSON.stringify(inv.data), before);
});

test('같은 txId 두 번 grant -> 한 번만 들어감(buy도 같음)', () => {
  const { inv, wallet } = make();
  assert.equal(inv.grant({ items: { revive: 1 } }, { src: 'iap', txId: 'iap:x:1' }).ok, true);
  assert.deepEqual(inv.grant({ items: { revive: 1 } }, { src: 'iap', txId: 'iap:x:1' }), { ok: false, reason: 'duplicate' });
  assert.equal(inv.count('revive'), 1);
  wallet.gold = 10;
  assert.equal(inv.buy({ cost: { gold: 1 }, bundle: {}, src: 's', txId: 'iap:x:1' }).reason, 'duplicate');
  assert.equal(wallet.gold, 10);
});

test('상한 999: 넘친 양은 log에만', () => {
  const { inv } = make();
  inv.grant({ items: { hammer: 990 } }, { src: 't' });
  inv.grant({ items: { hammer: 20 } }, { src: 't' });
  assert.equal(inv.count('hammer'), ITEM_CAP);
  assert.deepEqual(inv.data.log.at(-1).d, { hammer: 9, over: { hammer: 11 } });
});

test('log는 최근 50건', () => {
  const { inv } = make();
  for (let i = 0; i < 60; i++) inv.grant({ items: { hammer: 1 } }, { src: `s${i}` });
  assert.equal(inv.data.log.length, 50);
  assert.equal(inv.data.log[0].src, 's10');
});

test('장착: hotbar 아닌 그룹 거절, 같은 아이템은 자리 바꾸기, 0개여도 유지', () => {
  const { inv } = make({ loadout: { hotbar: ['hammer', 'scythe_h', 'repair', null] }, items: { hammer: 1 } });
  assert.equal(inv.equip(0, 'booster_line').reason, 'notEquipable');
  assert.equal(inv.equip(0, 'revive').reason, 'notEquipable');
  assert.equal(inv.equip(0, 'hammer').reason, 'alreadyEquipped');
  assert.equal(inv.equip(2, 'hammer').ok, true);
  assert.deepEqual(inv.hotbar(), ['repair', 'scythe_h', 'hammer']);
  inv.spend('hammer', 1, { src: 'use' });
  assert.equal(inv.count('hammer'), 0);
  assert.deepEqual(inv.hotbar(), ['repair', 'scythe_h', 'hammer'], '0개여도 장착 유지');
  assert.equal(inv.swapSlots(0, 1).ok, true);
  assert.deepEqual(inv.hotbar(), ['scythe_h', 'repair', 'hammer']);
  assert.equal(inv.unequip(1).ok, true);
  assert.deepEqual(inv.hotbar(), ['scythe_h', null, 'hammer']);
});

test('층 진행 중 장착 변경은 pendingHotbar -> 층 시작 때 적용, 층 밖에서는 즉시', () => {
  const { inv } = make({ loadout: { hotbar: ['hammer', 'scythe_h', 'repair', null] }, items: Object.fromEntries(Object.keys(ITEMS.items).map((id) => [id, 1])) });
  inv.beginFloor();
  const r = inv.equip(0, 'dye');
  assert.deepEqual(r, { ok: true, reason: null, pending: true });
  assert.deepEqual(inv.hotbar(), ['hammer', 'scythe_h', 'repair'], '지금 층 하단 바는 그대로');
  assert.deepEqual(inv.pendingHotbar(), ['dye', 'scythe_h', 'repair']);
  inv.swapSlots(1, 2);
  assert.deepEqual(inv.pendingHotbar(), ['dye', 'repair', 'scythe_h'], 'pending 위에서 계속 바뀜');
  inv.beginFloor(); // 다음 층 시작
  assert.deepEqual(inv.hotbar(), ['dye', 'repair', 'scythe_h']);
  assert.equal(inv.pendingHotbar(), null);

  inv.equip(0, 'hammer');
  inv.endFloor(); // 클리어·패배 팝업 = 바로 적용
  assert.deepEqual(inv.hotbar(), ['hammer', 'repair', 'scythe_h']);
  assert.equal(inv.equip(0, 'glove').pending, undefined, '층 밖에서는 즉시');
  assert.equal(inv.hotbar()[0], 'glove');
});

test('새 아이템 처음 얻고 빈 칸 있으면 자동 장착(이미 가져 본 것은 안 함)', () => {
  const { inv } = make({ loadout: { hotbar: ['hammer', null, null, null] }, items: { hammer: 1, glove: 0 } });
  inv.grant({ items: { glove: 1, dye: 1, booster_line: 1 } }, { src: 't' });
  assert.deepEqual(inv.hotbar(), ['hammer', 'dye', null], 'glove는 키가 있었음, booster는 hotbar 아님');
});

test('slot4: 보스·구매 두 경로 중복 없음, 없으면 4번째 칸 장착 거절(locked)', () => {
  const { inv } = make({ items: { hammer: 1 } });
  assert.equal(inv.slotCount(), 3);
  assert.equal(inv.equip(3, 'hammer').reason, 'locked');
  inv.grant({ flags: ['slot4'] }, { src: 'bossReward', txId: 'boss:20' });
  inv.grant({ flags: ['slot4'], items: { rainbow: 3 } }, { src: 'iap', txId: 'iap:pack.slot4:1' });
  assert.deepEqual(inv.data.perm.flags, ['slot4']);
  assert.equal(inv.slotCount(), 4);
  assert.equal(inv.hotbar().length, 4);
  assert.equal(inv.equip(3, 'hammer').ok, true);
});

test('예약: 켜기만으론 소모 없음, 층 시작 때 1개씩 소모, 0개면 꺼짐', () => {
  const { inv } = make({ items: { booster_line: 1, gold_coin: 0 } });
  assert.equal(inv.setReserve('gold_coin', true).reason, 'noStock');
  assert.equal(inv.setReserve('hammer', true).reason, 'notEquipable');
  assert.equal(inv.setReserve('booster_line', true).ok, true);
  assert.deepEqual(inv.reservations(), ['booster_line']);
  assert.equal(inv.count('booster_line'), 1, '켜기만으론 소모 없음');
  assert.deepEqual(inv.consumeReservations(), ['booster_line']);
  assert.equal(inv.count('booster_line'), 0);
  assert.deepEqual(inv.reservations(), [], '1회 예약: 소모되면 꺼짐');
  inv.grant({ items: { booster_line: 2 } }, { src: 't' });
  inv.setReserve('booster_line', true);
  inv.spend('booster_line', 2);
  assert.deepEqual(inv.consumeReservations(), [], '시작 때 0개면 소모 없이');
  assert.deepEqual(inv.reservations(), [], '꺼짐');
});

test('visibleItems: 해제 부적은 21층 전엔 빠지지만 개수 보존', () => {
  const { inv } = make({ items: { defuse: 3 } });
  assert.ok(!inv.visibleItems(20).includes('defuse'));
  assert.ok(inv.visibleItems(21).includes('defuse'));
  assert.equal(inv.count('defuse'), 3);
});

// v1 저장 예(아이템·상점 작업이 만든 형식).
const V1 = {
  gold: 500, diamonds: 7, floor: 22, bestFloor: 22, towerLevels: [1, 2, 3, 4, 5],
  items: { hammer: 2, scythe_h: 0, defuse: 3, removed_item: 4 },
  equipped: ['hammer', 'scythe_h', 'repair', 'dye'],
  preFloor: { booster_line: true, gold_coin: false },
  shop: { purchasedOnce: ['pack.adfree'], skillLv: { red: 3, lava: 1, soul: 0 }, passes: {} },
};

test('마이그레이션: v1 -> v2, 옛 필드 삭제, 두 번 돌려도 같음, 모르는 id 보존', () => {
  const v2 = migrateSave(structuredClone(V1));
  assert.equal(v2.saveVersion, 3);
  for (const k of ['items', 'equipped', 'preFloor']) assert.equal(k in v2, false, k);
  assert.equal('skillLv' in v2.shop, false);
  assert.deepEqual(v2.shop.purchasedOnce, ['pack.adfree']);
  assert.deepEqual(v2.inv.items, V1.items);
  assert.equal(v2.inv.items.removed_item, 4, '모르는 id 보존');
  assert.deepEqual(v2.inv.loadout.hotbar, ['hammer', 'scythe_h', 'repair', 'dye']);
  assert.ok(v2.inv.perm.flags.includes('slot4'), '4칸이었으면 slot4');
  assert.deepEqual(v2.inv.perm.skills, { red: 3, lava: 1, soul: 0 });
  assert.deepEqual(v2.inv.loadout.preFloor, V1.preFloor);
  assert.deepEqual(v2.inv.grantedTx, Object.keys(V1.items).map((id) => `start:${id}`), '옛 items의 id(0개 포함)는 start:{id}');
  assert.ok(v2.inv.perm.flags.includes('adFree'), 'purchasedOnce의 광고 제거 -> adFree 플래그');
  assert.equal(v2.inv.log.at(-1).src, 'migrate', '마이그레이션은 log에 남김');
  assert.equal(v2.gold, 500);
  assert.deepEqual(migrateSave(structuredClone(v2)), v2, '두 번 돌려도 같음');

  const three = migrateSave({ ...structuredClone(V1), equipped: ['hammer', null, null] });
  assert.deepEqual(three.inv.loadout.hotbar, ['hammer', null, null, null]);
  assert.ok(!three.inv.perm.flags.includes('slot4'));

  const inv = new Inventory(v2.inv, { config: ITEMS });
  assert.equal(inv.count('removed_item'), 4);
  assert.ok(!inv.visibleItems(99).includes('removed_item'), '화면에만 안 보임');
  assert.equal(migrateSave(null), null);
});

test('젬 스킬 레벨 1(기본값·마이그레이션 둘 다)에서 전투 수치가 skills.json과 같음', () => {
  const fresh = make({ perm: { skills: defaultSkillLevels(SHOP.skills) } }).inv;
  const allOne = Object.fromEntries(Object.keys(defaultSkillLevels(SHOP.skills)).map((k) => [k, 1]));
  const migrated = new Inventory(migrateSave({ shop: { skillLv: allOne } }).inv);
  for (const inv of [fresh, migrated]) {
    const s = applySkillLevels(SKILLS, SHOP.skills, (k) => inv.skillLevel(k));
    assert.deepEqual(s.colorEffects, SKILLS.colorEffects);
    assert.deepEqual(s.specialSkills, SKILLS.specialSkills);
  }
  const s = applySkillLevels(SKILLS, SHOP.skills, (k) => migrated.skillLevel(k));
  assert.deepEqual(s.unlocked, SKILLS.unlocked, '전부 Lv 1이면 잠금도 skills.json 그대로');
});

// ---------------- 인벤토리 B(docs/inventory.md 8장) ----------------

test('임시 지급 start:{id}: 첫 실행 전부, 옛 start 한 줄은 풀어서 바꾸고, config 새 아이템만 한 번', async () => {
  const { playerState } = await import('../src/game/playerState.js');
  const saved = { inventory: playerState.inventory, bestFloor: playerState.bestFloor };
  const startIds = Object.keys(ITEMS.items).filter((id) => (ITEMS.items[id].unlockFloor ?? 1) <= 1);
  try {
    playerState.bestFloor = 1;
    playerState.inventory = new Inventory(null, { wallet: playerState });
    playerState.initItems(ITEMS);
    const inv = playerState.inventory;
    assert.deepEqual(inv.data.grantedTx.filter((t) => t.startsWith('start')).sort(), startIds.map((id) => `start:${id}`).sort());
    assert.deepEqual(inv.hotbar(), ITEMS.starter.equipped, '첫 실행 기본 장착');
    playerState.initItems(ITEMS);
    assert.equal(inv.count('hammer'), ITEMS.starter.count, '두 번 안 준다');

    // 인벤토리 A 저장: 'start' 한 줄. 그 뒤 config에 새 아이템 newgem 추가.
    playerState.inventory = new Inventory({ items: { hammer: 0 }, grantedTx: ['start', 'boss:10'] }, { wallet: playerState });
    playerState.initItems(ITEMS);
    const inv2 = playerState.inventory;
    assert.ok(!inv2.data.grantedTx.includes('start'));
    assert.ok(inv2.data.grantedTx.includes('start:hammer') && inv2.data.grantedTx.includes('boss:10'));
    assert.equal(inv2.count('hammer'), 0, '풀어 쓴 아이템은 다시 안 준다');
    assert.equal(inv2.data.log.at(-1).src, 'migrate');
    const cfg = structuredClone(ITEMS);
    cfg.items.newgem = { ...cfg.items.dye, starterCount: 2 };
    playerState.initItems(cfg);
    assert.equal(inv2.count('newgem'), 2, 'config 새 아이템만 지급');
    assert.equal(inv2.count('hammer'), 0);
    playerState.initItems(cfg);
    assert.equal(inv2.count('newgem'), 2, '한 번만');
  } finally {
    Object.assign(playerState, saved);
  }
});

test('cap: 999 넘는 구매는 cap, 토스트 문구 ko/en', () => {
  const { inv, wallet } = make({ items: { hammer: 995 } });
  wallet.gold = 100;
  assert.equal(inv.buy({ cost: { gold: 1 }, bundle: { items: { hammer: 5 } }, src: 'shopGold' }).reason, 'cap');
  assert.equal(inv.buy({ cost: { gold: 1 }, bundle: { items: { hammer: 4 } }, src: 'shopGold' }).ok, true, '999 - 보유 수까지는 됨');
  assert.equal(ko.shop.toast.cap, '최대 999개까지 가질 수 있어요');
  assert.equal(en.shop.toast.cap, 'You can hold up to 999.');
});

test('log는 지급·구매·마이그레이션만 - use·예약 소모(spend)는 안 남김', () => {
  const { inv } = make({ items: { hammer: 3, booster_line: 1 } });
  inv.grant({ items: { hammer: 1 } }, { src: 'dev' });
  const n = inv.data.log.length;
  inv.spend('hammer', 1);
  inv.setReserve('booster_line', true);
  inv.consumeReservations();
  assert.equal(inv.data.log.length, n);
});

test('isAdFree는 inv.perm.flags의 adFree만 본다', () => {
  const { inv } = make();
  const player = { shop: { purchasedOnce: ['pack.adfree'] }, inventory: inv };
  assert.equal(isAdFree(player), false, 'purchasedOnce만으론 아님');
  inv.grant({ flags: ['adFree'] }, { src: 'iap' });
  assert.equal(isAdFree(player), true);
});

test('equip은 보유 1개 이상만, 꽂힌 게 0개가 되는 건 유지, 자동 장착도 1개 이상만', () => {
  const { inv } = make({ items: { hammer: 1, dye: 0 }, loadout: { hotbar: ['hammer', null, null, null] } });
  assert.deepEqual(inv.equip(1, 'dye'), { ok: false, reason: 'noStock' });
  assert.deepEqual(inv.equip(1, 'glove'), { ok: false, reason: 'noStock' }, '가져 본 적 없는 것도');
  inv.spend('hammer', 1);
  assert.deepEqual(inv.hotbar(), ['hammer', null, null]);
  inv.grant({ items: { glove: 0, rainbow: 1 } }, { src: 't' });
  assert.deepEqual(inv.hotbar(), ['hammer', 'rainbow', null], '0개로 처음 들어온 glove는 자동 장착 안 함');
});

test('패배 팝업 = 층 진행 중: 장착 변경은 pending, 부활하면 하단 바 그대로, 재도전 새 층에서 적용', async () => {
  const { BattleController } = await import('../src/game/battleController.js');
  const { playerState } = await import('../src/game/playerState.js');
  const balance = load('balance.json');
  const c = new BattleController({
    balance, enemies: load('enemies.json'), obstacles: load('obstacles.json'), floorsData: load('floors.json'),
    towersBaseData: balance.tower.towers, itemsConfig: ITEMS,
    battleConfig: { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: {} },
  });
  const inv = playerState.inventory;
  c.devSetFloor(1);
  inv.grant({ items: { dye: 1, revive: 2 } }, { src: 'test' });
  c.update(0.016);
  const before = inv.hotbar().slice();
  assert.notEqual(before[0], 'dye');
  c.battleState.applyObstacleWallDamage(1);
  c.update(0.016);
  assert.equal(c.battleState.status, 'failed');
  assert.equal(inv.inFloor, true);
  assert.equal(inv.equip(0, 'dye').pending, true);
  assert.deepEqual(inv.hotbar(), before);
  assert.equal(c.revive(), true);
  assert.deepEqual(inv.hotbar(), before, '부활: 지금 하단 바 그대로');
  c.battleState.applyObstacleWallDamage(1);
  c.update(0.016);
  c.retryFloor();
  c.update(0.016);
  assert.equal(inv.hotbar()[0], 'dye', '재도전 새 층에서 적용');
});
