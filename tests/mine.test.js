// 저주받은 수정 광산 로직(src/core/mine/mine.js, docs/mine.md - 15장 우선). 시간은 전부 가짜(now ms).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  defaultMine, normalizeMine, veinRate, veinCost, maxVeinLevel, capHours, ratePerHour, capacity, cartAt, settle, rolloverDay,
  syncUnlocks, harvest, upgradeVein, upgradeStorage, buyBigStorage, refineGold, refineItem, boost, hasBadge, nextGoldCost, kstDate,
} from '../src/core/mine/mine.js';
import { pruneGrantedTx } from '../src/core/inventory/inventory.js';
import { Inventory } from '../src/game/inventory.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../config/${name}`, import.meta.url), 'utf8'));
const CFG = load('mine.json');
const ITEMS = load('items.json');
const HOUR = 3600e3;
const KST = (iso) => Date.parse(`${iso}+09:00`);
const T0 = KST('2026-11-20T09:00:00');

// 광맥 1개 Lv1(시간당 10, 상한 8시간 = 80)로 열린 광산 + 진짜 Inventory.
function make(over = {}) {
  const wallet = { gold: 0, diamonds: 0 };
  const inventory = new Inventory(null, { wallet, config: ITEMS, clock: () => 1 });
  const mine = { ...defaultMine(), unlocked: true, veins: [1, 0, 0, 0, 0], anchorAt: T0, ...over };
  const ctx = (now = T0, more = {}) => ({ now, pass: false, bestFloor: 11, R: 250, inventory, ...more });
  return { mine, wallet, inventory, ctx };
}

test('config: 아이템 키가 config/items.json에 있고, 10장 초안 값 그대로', () => {
  for (const id of Object.keys(CFG.items.costs)) assert.ok(ITEMS.items[id], id);
  assert.deepEqual(CFG.gold.costs, [50, 100, 200, 400]);
  assert.deepEqual(CFG.storage.hours, [8, 9, 10, 11, 12]);
  assert.deepEqual(CFG.veins.map((v) => v.unlockBossFloor), [10, 20, 30, 40, 50]);
});

test('5-1 표: 비용 Lv5 83 / Lv20 1278 / Lv25 3180, 생산 Lv5 15.7 / Lv20 86.1', () => {
  assert.equal(veinCost(CFG, 1), 40);
  assert.equal(veinCost(CFG, 5), 83);
  assert.equal(veinCost(CFG, 20), 1278);
  assert.equal(veinCost(CFG, 25), 3180);
  assert.equal(veinRate(CFG, 1), 10);
  assert.equal(veinRate(CFG, 5).toFixed(1), '15.7');
  assert.equal(veinRate(CFG, 20).toFixed(1), '86.1');
});

test('4-3 표: 광맥 최대 Lv = 5 + floor(최고 층 / 5)', () => {
  for (const [floor, lv] of [[10, 7], [20, 9], [30, 11], [50, 15], [70, 19], [100, 25], [150, 35]]) assert.equal(maxVeinLevel(CFG, floor), lv);
});

test('보관 상한: 창고 Lv별 8~12시간, 큰 창고 +4시간, 월간 패스 생산 x1.25', () => {
  const { mine } = make();
  assert.equal(capHours(CFG, mine), 8);
  assert.equal(capHours(CFG, { ...mine, storageLv: 5 }), 12);
  assert.equal(capHours(CFG, { ...mine, bigStorage: true }), 12, 'Lv1 + 큰 창고');
  assert.equal(capHours(CFG, { ...mine, storageLv: 5, bigStorage: true }), 16, 'Lv5 + 큰 창고');
  assert.equal(ratePerHour(CFG, mine), 10);
  assert.equal(ratePerHour(CFG, mine, true), 12.5);
  assert.equal(capacity(CFG, mine), 80);
  assert.equal(ratePerHour(CFG, { ...mine, veins: [5, 4, 4, 3, 0] }).toFixed(1), '56.4'); // 15.7 + 14.0 + 14.0 + 12.5, 잠긴 광맥은 0
});

test('정산: 시간만큼 쌓이고 상한에서 멈춘다', () => {
  const { mine } = make();
  settle(CFG, mine, T0 + 3 * HOUR);
  assert.equal(mine.cart, 30);
  assert.equal(mine.anchorAt, T0 + 3 * HOUR);
  settle(CFG, mine, T0 + 100 * HOUR);
  assert.equal(mine.cart, 80, '상한 8시간 x 10');
  settle(CFG, mine, T0 + 200 * HOUR);
  assert.equal(mine.cart, 80);
});

test('가속으로 상한을 넘긴 분량은 줄지 않고, 그동안 시간 누적도 없다(15-2 #5)', () => {
  const { mine, ctx } = make({ cart: 75 });
  assert.equal(boost(CFG, mine, 'ad', ctx()).amount, 20, '2시간 분량');
  assert.equal(mine.cart, 95);
  settle(CFG, mine, T0 + 50 * HOUR);
  assert.equal(mine.cart, 95, '상한(80) 위 - 그대로');
  assert.equal(harvest(CFG, mine, ctx(T0 + 50 * HOUR)).amount, 95);
  settle(CFG, mine, T0 + 51 * HOUR);
  assert.equal(mine.cart, 10, '수확 뒤에는 다시 쌓인다');
});

test('시계를 뒤로 돌리면 경과 0, anchorAt만 지금으로', () => {
  const { mine } = make({ cart: 12 });
  settle(CFG, mine, T0 - 5 * HOUR);
  assert.equal(mine.cart, 12);
  assert.equal(mine.anchorAt, T0 - 5 * HOUR);
  settle(CFG, mine, T0 - 4 * HOUR);
  assert.equal(mine.cart, 22, '돌린 시각부터 다시 흐른다');
});

test('레벨업 직전 정산: 지난 시간은 옛 생산량으로 계산된다', () => {
  const { mine, ctx } = make({ ore: 40 });
  const res = upgradeVein(CFG, mine, 0, ctx(T0 + 2 * HOUR));
  assert.deepEqual({ ok: res.ok, cost: res.cost, level: res.level }, { ok: true, cost: 40, level: 2 });
  assert.equal(mine.cart, 20, '2시간 x Lv1 10 (Lv2 11.2가 아님)');
  assert.equal(mine.ore, 0);
  settle(CFG, mine, T0 + 3 * HOUR);
  assert.equal(mine.cart.toFixed(1), '31.2');
});

test('광맥 레벨업 거절: 잠김 / 원석 부족 / 최대 레벨(최고 층에 묶임)', () => {
  const { mine, ctx } = make({ ore: 39 });
  assert.equal(upgradeVein(CFG, mine, 1, ctx()).reason, 'locked');
  assert.equal(upgradeVein(CFG, mine, 0, ctx()).reason, 'noOre');
  mine.veins[0] = 7;
  mine.ore = 99999;
  assert.equal(upgradeVein(CFG, mine, 0, ctx()).reason, 'max', '최고 층 11 -> 최대 7');
  assert.equal(upgradeVein(CFG, mine, 0, ctx(T0, { bestFloor: 15 })).ok, true, '15층 도달 -> 최대 8');
  assert.equal(mine.veins[0], 8);
});

test('수확: 정산 후 정수만 지갑으로, 소수는 수레에 남는다', () => {
  const { mine, ctx } = make({ veins: [2, 0, 0, 0, 0] });
  assert.equal(harvest(CFG, mine, ctx()).reason, 'empty');
  const res = harvest(CFG, mine, ctx(T0 + HOUR));
  assert.equal(res.amount, 11);
  assert.equal(mine.ore, 11);
  assert.equal(mine.cart.toFixed(1), '0.2');
  assert.equal(mine.stats.totalOre, 11);
});

test('창고 강화: 150/400/900/2000, Lv5에서 끝. 강화 직전 정산', () => {
  const { mine, ctx } = make({ ore: 3450 });
  const res = upgradeStorage(CFG, mine, ctx(T0 + 100 * HOUR));
  assert.equal(res.cost, 150);
  assert.equal(mine.cart, 80, '강화 전 상한(8시간)으로 정산');
  for (const cost of [400, 900, 2000]) assert.equal(upgradeStorage(CFG, mine, ctx(T0 + 100 * HOUR)).cost, cost);
  assert.equal(mine.storageLv, 5);
  assert.equal(mine.ore, 0);
  assert.equal(upgradeStorage(CFG, mine, ctx()).reason, 'max');
  assert.equal(upgradeStorage(CFG, { ...mine, storageLv: 1, ore: 149 }, ctx()).reason, 'noOre');
});

test('큰 창고: 다이아 150, 1회', () => {
  const { mine, wallet, ctx } = make();
  wallet.diamonds = 149;
  assert.equal(buyBigStorage(CFG, mine, ctx()).reason, 'noMoney');
  wallet.diamonds = 400;
  assert.equal(buyBigStorage(CFG, mine, ctx()).ok, true);
  assert.equal(wallet.diamonds, 250);
  assert.equal(capHours(CFG, mine), 12, '8 + 4');
  assert.equal(buyBigStorage(CFG, mine, ctx()).reason, 'owned');
  assert.equal(wallet.diamonds, 250);
});

test('골드 주머니: 50/100/200/400, 골드 R x 2, 5번째 거부, txId mine:gold:{KST날짜}:{n}', () => {
  const { mine, wallet, inventory, ctx } = make({ ore: 800 });
  for (const cost of [50, 100, 200, 400]) {
    const res = refineGold(CFG, mine, ctx());
    assert.deepEqual({ ok: res.ok, cost: res.cost, gold: res.gold }, { ok: true, cost, gold: 500 });
  }
  assert.equal(mine.ore, 50);
  assert.equal(wallet.gold, 2000, '하루 최대 R x 8');
  assert.equal(mine.stats.totalGold, 2000);
  assert.equal(refineGold(CFG, mine, ctx()).reason, 'limit');
  assert.equal(wallet.gold, 2000);
  assert.deepEqual(inventory.data.grantedTx, [1, 2, 3, 4].map((n) => `mine:gold:2026-11-20:${n}`));
  assert.equal(nextGoldCost(CFG, mine, ctx()), null);
});

test('골드 주머니: 원석이 모자라면 거부하고 아무것도 안 바뀐다', () => {
  const { mine, wallet, ctx } = make({ ore: 49 });
  assert.equal(refineGold(CFG, mine, ctx()).reason, 'noOre');
  assert.deepEqual([mine.ore, mine.daily.gold, wallet.gold], [49, 0, 0]);
});

test('아이템 정제: 하루 합계 3개, 4번째 거부, 모르는 아이템 거부', () => {
  const { mine, inventory, ctx } = make({ ore: 1000 });
  assert.equal(refineItem(CFG, mine, 'rainbow', ctx()).reason, 'unknown', '다이아 전용은 정제 불가');
  assert.equal(refineItem(CFG, mine, 'hammer', ctx()).cost, 80);
  assert.equal(refineItem(CFG, mine, 'dye', ctx()).cost, 120);
  assert.equal(refineItem(CFG, mine, 'hammer', ctx()).ok, true);
  assert.equal(refineItem(CFG, mine, 'shuffle', ctx()).reason, 'limit');
  assert.deepEqual([inventory.count('hammer'), inventory.count('dye'), inventory.count('shuffle')], [2, 1, 0]);
  assert.equal(mine.ore, 720);
  assert.ok(inventory.data.grantedTx.includes('mine:item:2026-11-20:3'));
});

test('하루 초기화: KST 날짜가 바뀌면 daily 0, 서버 날짜가 있으면 그것이 우선', () => {
  const { mine, ctx } = make({ ore: 5000 });
  const late = KST('2026-11-20T23:59:00');
  for (let i = 0; i < 4; i++) refineGold(CFG, mine, ctx(late));
  refineItem(CFG, mine, 'hammer', ctx(late));
  boost(CFG, mine, 'ad', ctx(late));
  assert.deepEqual(mine.daily, { gold: 4, items: 1, ads: 1, diaBoost: 0 });
  assert.equal(nextGoldCost(CFG, mine, ctx(KST('2026-11-21T00:00:00'))), 50, '자정 지나면 조회만으로도 0번째');
  assert.equal(refineGold(CFG, mine, ctx(KST('2026-11-21T00:00:00'))).cost, 50);
  assert.deepEqual(mine.daily, { gold: 1, items: 0, ads: 0, diaBoost: 0 });
  assert.equal(mine.day, '2026-11-21');
  // 기기 시계는 아직 21일이지만 서버가 22일이라고 하면 22일 키로 초기화
  assert.equal(refineGold(CFG, mine, ctx(KST('2026-11-21T10:00:00'), { today: '2026-11-22' })).cost, 50);
  assert.equal(mine.day, '2026-11-22');
  assert.equal(kstDate(Date.parse('2026-11-20T15:00:00Z')), '2026-11-21', 'UTC 15시 = KST 0시');
  assert.equal(rolloverDay(mine, '2026-11-22'), false);
});

test('txId 중복 지급 방지: 시계를 돌려 같은 날짜로 돌아와도 골드·아이템은 다시 안 들어온다', () => {
  const { mine, wallet, inventory, ctx } = make({ ore: 5000 });
  for (let i = 0; i < 4; i++) refineGold(CFG, mine, ctx());
  refineItem(CFG, mine, 'hammer', ctx());
  assert.equal(wallet.gold, 2000);
  refineGold(CFG, mine, ctx(T0 + 24 * HOUR)); // 다음 날로 넘겼다가
  const ore = mine.ore;
  const res = refineGold(CFG, mine, ctx()); // 다시 20일로
  assert.deepEqual({ ok: res.ok, reason: res.reason }, { ok: false, reason: 'duplicate' });
  assert.equal(wallet.gold, 2500, '21일 1번째만 추가');
  assert.equal(mine.ore, ore, '거부되면 원석도 안 뺀다');
  assert.equal(mine.daily.gold, 1, '횟수는 맞춰서 다음 호출이 2번째를 본다');
  assert.equal(refineItem(CFG, mine, 'hammer', ctx()).reason, 'duplicate');
  assert.equal(inventory.count('hammer'), 1);
});

test('가속: 광고 하루 2회, 다이아 20/40/80 하루 3회, 상한과 무관하게 2시간 분량', () => {
  const { mine, wallet, ctx } = make({ cart: 80 });
  assert.equal(boost(CFG, mine, 'ad', ctx()).amount, 20);
  assert.equal(boost(CFG, mine, 'ad', ctx()).ok, true);
  assert.equal(boost(CFG, mine, 'ad', ctx()).reason, 'limit');
  assert.equal(mine.cart, 120);
  assert.equal(boost(CFG, mine, 'dia', ctx()).reason, 'noMoney');
  wallet.diamonds = 140;
  for (const left of [120, 80, 0]) {
    assert.equal(boost(CFG, mine, 'dia', ctx()).ok, true);
    assert.equal(wallet.diamonds, left);
  }
  assert.equal(boost(CFG, mine, 'dia', ctx()).reason, 'limit');
  assert.equal(mine.cart, 180);
  assert.equal(boost(CFG, mine, 'ad', ctx(T0, { pass: true })).reason, 'limit');
  assert.equal(boost(CFG, { ...mine, daily: { ...mine.daily, ads: 0 } }, 'ad', ctx(T0, { pass: true })).amount, 25, '패스면 2시간 x 12.5');
});

test('가속 직전 정산: 지난 시간이 먼저 쌓인 뒤 더해진다', () => {
  const { mine, ctx } = make();
  boost(CFG, mine, 'ad', ctx(T0 + 3 * HOUR));
  assert.equal(mine.cart, 50);
  assert.equal(mine.anchorAt, T0 + 3 * HOUR);
});

test('메뉴 배지: 수레 80% 이상이거나, 주머니가 남았고 원석이 다음 비용 이상', () => {
  const { mine, ctx } = make();
  assert.equal(hasBadge(CFG, mine, ctx()), false);
  assert.equal(hasBadge(CFG, mine, ctx(T0 + 6.3 * HOUR)), false, '63/80');
  assert.equal(hasBadge(CFG, mine, ctx(T0 + 6.4 * HOUR)), true, '64/80 = 80%');
  assert.equal(mine.cart, 0, '조회는 상태를 안 바꾼다');
  mine.ore = 50;
  assert.equal(hasBadge(CFG, mine, ctx()), true, '1번째 비용 50');
  mine.day = '2026-11-20';
  mine.daily.gold = 1;
  assert.equal(hasBadge(CFG, mine, ctx()), false, '2번째 비용 100');
  mine.daily.gold = 4;
  mine.ore = 9999;
  assert.equal(hasBadge(CFG, mine, ctx()), false, '오늘 다 씀');
  assert.equal(hasBadge(CFG, mine, ctx(T0 + 24 * HOUR)), true, '다음 날');
  assert.equal(hasBadge(CFG, { ...mine, unlocked: false }, ctx(T0 + 24 * HOUR)), false);
});

test('해금 순서: 10층 보스 = 광산 + 에메랄드 Lv1 + 선물 50, 20~50층 보스 = 다음 광맥', () => {
  const mine = defaultMine();
  assert.deepEqual(syncUnlocks(CFG, mine, 9, T0), []);
  assert.equal(mine.unlocked, false);
  assert.equal(harvest(CFG, mine, { now: T0 }).reason, 'locked');
  assert.deepEqual(syncUnlocks(CFG, mine, 10, T0), ['emerald']);
  assert.deepEqual([mine.unlocked, mine.veins, mine.cart, mine.anchorAt], [true, [1, 0, 0, 0, 0], 50, T0]);
  assert.deepEqual(syncUnlocks(CFG, mine, 10, T0 + HOUR), [], '같은 층을 다시 불러도 한 번만');
  assert.equal(mine.cart, 50);
  assert.deepEqual(syncUnlocks(CFG, mine, 19, T0 + HOUR), []);
  // 20층 보스: 열기 전에 정산 - 지난 1시간은 에메랄드 혼자 캔 것(60), 사파이어는 지금부터
  assert.deepEqual(syncUnlocks(CFG, mine, 20, T0 + HOUR), ['sapphire']);
  assert.equal(mine.cart, 60);
  settle(CFG, mine, T0 + 2 * HOUR);
  assert.equal(mine.cart, 80);
  assert.deepEqual(syncUnlocks(CFG, mine, 30, T0 + 2 * HOUR), ['topaz']);
  assert.deepEqual(syncUnlocks(CFG, mine, 40, T0 + 2 * HOUR), ['ruby']);
  assert.deepEqual(syncUnlocks(CFG, mine, 50, T0 + 2 * HOUR), ['amethyst']);
  assert.deepEqual(mine.veins, [1, 1, 1, 1, 1]);
});

test('기존 저장 마이그레이션: mine 블록이 없으면 기본값, 이미 넘긴 층의 광맥은 전부 열린다', () => {
  const mine = normalizeMine(undefined, CFG);
  assert.deepEqual(mine, defaultMine());
  // bestFloor 57(= 56층까지 깸) 저장을 불러온 경우
  assert.deepEqual(syncUnlocks(CFG, mine, 56, T0), ['emerald', 'sapphire', 'topaz', 'ruby', 'amethyst']);
  assert.deepEqual([mine.unlocked, mine.veins, mine.cart, mine.anchorAt], [true, [1, 1, 1, 1, 1], 50, T0]);
  // 35층까지 깬 저장은 3개만
  const mid = normalizeMine(null, CFG);
  syncUnlocks(CFG, mid, 35, T0);
  assert.deepEqual(mid.veins, [1, 1, 1, 0, 0]);
});

test('normalizeMine: 깨진 값만 고치고 정상 값은 그대로(여러 번 돌려도 같다)', () => {
  const saved = { unlocked: true, veins: [4, 3, 3, 0, 0], storageLv: 2, bigStorage: false, ore: 1234, cart: 87.5, anchorAt: 1763620800000,
    day: '2026-11-20', daily: { gold: 2, items: 1, ads: 0, diaBoost: 0 }, tutorialDone: true, stats: { totalOre: 15320, totalGold: 4200 } };
  assert.deepEqual(normalizeMine(saved, CFG), saved, '9장 예시 그대로');
  assert.deepEqual(normalizeMine(normalizeMine(saved, CFG), CFG), saved);
  const bad = normalizeMine({ unlocked: 1, veins: [2, -1, 'x'], storageLv: 99, ore: -5, cart: NaN, daily: { gold: 2 } }, CFG);
  assert.deepEqual([bad.unlocked, bad.veins, bad.storageLv, bad.ore, bad.cart, bad.daily], [false, [2, 0, 0, 0, 0], 5, 0, 0, { gold: 2, items: 0, ads: 0, diaBoost: 0 }]);
});

test('cartAt: 잠긴 광산·경과 0은 그대로', () => {
  const { mine } = make({ cart: 5 });
  assert.equal(cartAt(CFG, mine, T0), 5);
  assert.equal(cartAt(CFG, { ...mine, veins: [0, 0, 0, 0, 0] }, T0 + HOUR), 5, '생산 0이면 상한도 0');
});

test('grantedTx 90일 정리에 mine:gold / mine:item 포함(하루짜리), mine:bigStorage는 평생', () => {
  const list = ['mine:gold:2026-01-01:1', 'mine:item:2026-01-01:3', 'mine:gold:2026-11-19:4', 'mine:bigStorage'];
  assert.deepEqual(pruneGrantedTx(list, '2026-11-20'), ['mine:gold:2026-11-19:4', 'mine:bigStorage']);
});

test('playerState: 저장 snapshot에 mine 블록이 들어간다(클라우드 저장은 snapshot을 그대로 올린다) + 해금 연결', async () => {
  const { playerState } = await import('../src/game/playerState.js');
  assert.deepEqual(playerState.snapshot().mine, defaultMine(), '블록이 없던 저장 = 기본값');
  assert.deepEqual(playerState.unlockMineVeins(10, T0), [], 'config 전에는 아무것도 안 함');
  const best = playerState.bestFloor;
  playerState.bestFloor = 31; // 30층까지 깬 기존 저장
  playerState.initMine(CFG, T0);
  assert.deepEqual(playerState.mine.veins, [1, 1, 1, 0, 0]);
  assert.equal(playerState.mine.cart, 50);
  assert.deepEqual(playerState.unlockMineVeins(40, T0 + HOUR), ['ruby']);
  assert.equal(playerState.snapshot().mine, playerState.mine);
  assert.equal(playerState.hasMonthlyPass(), false);
  playerState.bestFloor = best;
});
