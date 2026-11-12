// 상점 규칙(src/core/shop/shop.js) - 실제 config/*.json 그대로(tests/items.test.js와 같은 방식).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRail, buyProduct, grantPaidProduct, revokePaidProduct, defaultShopSave, normalizeShopSave, refreshOffers, offerBossPack, rolloverDay, applySkillLevels, hasNewPack, skillLevelCap } from '../src/core/shop/shop.js';
import { itemPrice, normalFloorReward } from '../src/core/economy/economy.js';
import { defaultSkillLevels } from '../src/core/inventory/inventory.js';
import { Inventory } from '../src/game/inventory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(__dirname, '..', 'config', name), 'utf8'));
const DATA = { balance: load('balance.json'), enemies: load('enemies.json'), obstacles: load('obstacles.json'), floorsData: load('floors.json') };
const ITEMS = load('items.json');
const SHOP = { ...load('shop.json'), products: load('products.json') };
const SKILLS = load('skills.json');
const NOW = 1_700_000_000_000;
const TODAY = '2026-11-07';

function makePlayer(over = {}) {
  const player = { gold: 0, diamonds: 0, bestFloor: 12, shop: defaultShopSave(SHOP), ...over };
  player.inventory = new Inventory({ perm: { skills: defaultSkillLevels(SHOP.skills) } }, { wallet: player, config: ITEMS });
  Object.defineProperty(player, 'items', { get: () => player.inventory.data.items }); // 테스트 읽기 편의.
  return player;
}
const lvOf = (lv) => (k) => lv[k];
const ctxOf = (player, over = {}) => ({ cfg: SHOP, itemsConfig: ITEMS, data: DATA, player, now: NOW, today: TODAY, ...over });
const ids = (rail, ctx) => buildRail(ctx, rail).filter((e) => e.id).map((e) => e.id);

test('골드 아이템: 가격 = economy.itemPrice, 사면 골드가 줄고 보유 수가 는다(수량)', () => {
  const player = makePlayer({ gold: 100000 });
  const ctx = ctxOf(player);
  const price = itemPrice(DATA, ITEMS, 'hammer', 12);
  assert.equal(buildRail(ctx, 'items').find((p) => p.id === 'item.hammer').price, price);
  const r = buyProduct(ctx, 'item.hammer', 5);
  assert.ok(r.ok);
  assert.equal(player.gold, 100000 - price * 5);
  assert.equal(player.items.hammer, 5);
});

test('재화 부족이면 실패하고 아무것도 안 바뀐다', () => {
  const player = makePlayer({ gold: 1, diamonds: 0 });
  const r = buyProduct(ctxOf(player), 'item.repair', 1);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'poor');
  assert.equal(player.gold, 1);
  assert.equal(player.items.repair, undefined);
  assert.equal(buyProduct(ctxOf(player), 'dg.revive').reason, 'poor');
});

test('잠금 조건 전엔 구매 불가: 해제 부적 21층, 특수 기술 A안 보스 첫 처치', () => {
  const player = makePlayer({ gold: 1e9, bestFloor: 12 });
  assert.equal(buyProduct(ctxOf(player), 'item.defuse').reason, 'locked');
  assert.equal(buyProduct(ctxOf(player), 'skill.soul').reason, 'locked'); // 20층 보스 전
  assert.equal(player.inventory.skillLevel('soul'), 0);
  assert.ok(buyProduct(ctxOf(player), 'skill.lava').ok, '10층 보스를 잡았으면(최고 층 12) 골드로 해금');
  assert.equal(player.inventory.skillLevel('lava'), 1);
  player.bestFloor = 21;
  assert.ok(buyProduct(ctxOf(player), 'item.defuse').ok);
  assert.ok(buyProduct(ctxOf(player), 'skill.soul').ok);
});

test('젬 스킬: 가시는 처음부터 Lv 1, 색 효과는 Lv 5에서 더 못 올린다', () => {
  const player = makePlayer({ gold: 1e9, bestFloor: 100 }); // 100층이면 층 단계 잠금 상한 = 5
  const ctx = ctxOf(player);
  assert.equal(player.inventory.skillLevel('spike'), 1);
  assert.equal(player.inventory.skillLevel('ult'), 0);
  for (let i = 0; i < 4; i++) assert.ok(buyProduct(ctx, 'skill.red').ok);
  assert.equal(player.inventory.skillLevel('red'), 5);
  const gold = player.gold;
  const r = buyProduct(ctx, 'skill.red');
  assert.equal(r.reason, 'sold');
  assert.equal(player.inventory.skillLevel('red'), 5);
  assert.equal(player.gold, gold);
  // 레벨업 비용 = levelCost 배수 x 일반 층 보상.
  const p = buildRail(ctx, 'skills').find((e) => e.id === 'skill.blue');
  assert.equal(p.price, Math.round(SHOP.skills.levelCost[0] * normalFloorReward(DATA, 100)));
});

test('젬 스킬 층 단계 잠금: 최대 Lv = 1 + floor(최고 층/20), 상한 5, 넘은 세이브는 안 낮춤', () => {
  const cap = (f) => skillLevelCap(SHOP.skills, f);
  assert.deepEqual([1, 19, 20, 40, 80, 100].map(cap), [1, 1, 2, 3, 5, 5]);
  const player = makePlayer({ gold: 1e9, bestFloor: 25 });
  const ctx = ctxOf(player);
  assert.ok(buyProduct(ctx, 'skill.red').ok); // Lv 1 -> 2
  const p = buildRail(ctx, 'skills').find((e) => e.id === 'skill.red');
  assert.equal(p.state, 'locked');
  assert.deepEqual([p.lockFloor, p.lockLv], [40, 3]);
  const gold = player.gold;
  assert.equal(buyProduct(ctx, 'skill.red').reason, 'locked');
  assert.equal(player.gold, gold);
  assert.equal(player.inventory.skillLevel('red'), 2);
  player.bestFloor = 1; // 상한(1)보다 높은 세이브: 레벨은 그대로, 카드만 잠김
  assert.equal(buildRail(ctx, 'skills').find((e) => e.id === 'skill.red').state, 'locked');
  assert.equal(player.inventory.skillLevel('red'), 2);
});

test('1회 상품은 산 뒤 다시 안 보인다(스타터·광고 제거·4번째 슬롯), 챕터 팩은 챕터당 1회', () => {
  const player = makePlayer({ bestFloor: 12 });
  const ctx = ctxOf(player);
  assert.ok(!ids('packs', ctx).includes('pack.starter'), '처음 보기 전엔 타이머가 없다');
  assert.ok(refreshOffers(ctx));
  assert.ok(ids('packs', ctx).includes('pack.starter'));
  assert.ok(hasNewPack(ctx));
  assert.ok(buildRail(ctx, 'packs')[0].banner);
  assert.ok(buyProduct(ctx, 'pack.starter').ok);
  assert.equal(player.diamonds, 300);
  assert.equal(player.items.hammer, 5);
  for (const id of ['pack.adfree', 'pack.slot4', 'pack.chapter']) assert.ok(buyProduct(ctx, id).ok, id);
  const after = ids('packs', ctx);
  for (const id of ['pack.starter', 'pack.adfree', 'pack.slot4', 'pack.chapter']) assert.ok(!after.includes(id), id);
  assert.equal(buyProduct(ctx, 'pack.starter').reason, 'missing');
  assert.equal(player.inventory.slotCount(), ITEMS.slots.max);
  assert.ok(!refreshOffers(ctx), '산 뒤엔 다시 열리지 않는다');
  player.bestFloor = 21; // 다음 챕터
  assert.ok(ids('packs', ctxOf(player)).includes('pack.chapter'));
});

test('스타터 팩 72시간이 지나면 사라진다, 보스 돌파 팩은 보스당 1회 24시간', () => {
  const player = makePlayer({ bestFloor: 12 });
  refreshOffers(ctxOf(player));
  assert.ok(!ids('packs', ctxOf(player, { now: NOW + 73 * 3600e3 })).includes('pack.starter'));
  assert.ok(offerBossPack(player.shop, SHOP, 10, NOW));
  assert.ok(!offerBossPack(player.shop, SHOP, 10, NOW + 1000), '같은 보스로 다시 져도 기간을 늘리지 않는다');
  assert.ok(ids('packs', ctxOf(player)).includes('pack.boss'));
  assert.ok(!ids('packs', ctxOf(player, { now: NOW + 25 * 3600e3 })).includes('pack.boss'));
  assert.ok(buyProduct(ctxOf(player), 'pack.boss').ok);
  assert.equal(player.items.revive, 2);
  assert.ok(!offerBossPack(player.shop, SHOP, 10, NOW + 5), '산 보스는 다시 안 뜬다');
});

test('다이아 첫 구매 2배는 묶음마다 한 번만', () => {
  const player = makePlayer();
  const ctx = ctxOf(player);
  // dia.1 = 300 + 보너스 30(products.json grant 330, shop.json bonus 30) - 첫 구매는 기본 300을 한 번 더.
  assert.ok(buyProduct(ctx, 'dia.1').ok);
  assert.equal(player.diamonds, 630);
  assert.ok(buyProduct(ctx, 'dia.1').ok);
  assert.equal(player.diamonds, 630 + 330);
  assert.equal(buildRail(ctx, 'dia').find((p) => p.id === 'dia.1').price, 5900);
  assert.equal(buildRail(ctx, 'dia').find((p) => p.id === 'dia.1').first, false);
  assert.equal(buildRail(ctx, 'dia').find((p) => p.id === 'dia.0').first, true);
});

test('패스: 사면 즉시 다이아, 다음 날부터 하루 한 번 받기', () => {
  const player = makePlayer();
  const ctx = ctxOf(player);
  const pass = { ...SHOP.packs.weekly.pass, now: SHOP.products['pack.weekly'].grant.diamonds };
  assert.equal(pass.now, 100);
  assert.ok(buyProduct(ctx, 'pack.weekly').ok);
  assert.equal(player.diamonds, pass.now);
  assert.equal(buyProduct(ctx, 'pass.weekly').reason, 'sold', '산 날은 못 받는다');
  assert.ok(rolloverDay(player.shop, '2026-11-08'));
  assert.ok(buyProduct(ctx, 'pass.weekly').ok);
  assert.equal(player.diamonds, pass.now + pass.daily);
  assert.equal(player.shop.passes.weekly.daysLeft, pass.days - 1);
  assert.equal(buyProduct(ctx, 'pass.weekly').reason, 'sold', '하루 한 번');
});

test('오늘의 무료 1개는 하루 한 번', () => {
  const player = makePlayer();
  assert.ok(buyProduct(ctxOf(player), 'free').ok);
  assert.equal(player.items.dye, 1);
  assert.equal(buyProduct(ctxOf(player), 'free').reason, 'sold');
  assert.ok(buyProduct(ctxOf(player, { today: '2026-11-08' }), 'free').ok);
});

test('골드 교환·토템', () => {
  const player = makePlayer({ diamonds: 1000 });
  const r = buyProduct(ctxOf(player), 'goldex.small');
  assert.ok(r.ok);
  const small = SHOP.goldExchange.find((e) => e.id === 'small'); // 수치는 shop.json에서 읽는다
  assert.equal(player.gold, Math.round(small.floors * normalFloorReward(DATA, 12)));
  assert.equal(player.diamonds, 1000 - small.dia);
  assert.equal(buyProduct(ctxOf(player), 'totem.1').reason, 'locked');
});

test('applySkillLevels: Lv 1이면 skills.json 그대로(특수 기술 잠금만), 레벨은 배율만 곱한다', () => {
  const lv1 = defaultSkillLevels(SHOP.skills);
  const a = applySkillLevels(SKILLS, SHOP.skills, lvOf(lv1));
  assert.deepEqual(a.colorEffects, SKILLS.colorEffects);
  assert.deepEqual(a.specialSkills, SKILLS.specialSkills);
  assert.equal(a.unlocked.specialSkills.line, true);
  assert.equal(a.unlocked.specialSkills.bomb, false);
  assert.equal(a.unlocked.specialSkills.color_color, false, '궁극기 해금 전엔 대폭발도 잠김');
  const b = applySkillLevels(SKILLS, SHOP.skills, lvOf({ ...lv1, red: 3, blue: 5, ult: 5 }));
  // 레벨 N의 값 = shop.json values[N-1] (수치를 여기 다시 적지 않는다)
  const { color: colors, special: specials } = SHOP.skills;
  assert.ok(Math.abs(b.colorEffects.red.ratio - colors.red.values[2]) < 1e-9);
  assert.ok(Math.abs(b.colorEffects.blue.mul - colors.blue.values[4]) < 1e-9);
  assert.ok(Math.abs(b.specialSkills.color.mul - specials.ult.values[4]) < 1e-9);
  assert.equal(b.unlocked.specialSkills.color_color, true);
  assert.equal(SKILLS.colorEffects.red.ratio, 0.4, '원본은 그대로');
});

test('normalizeShopSave: 빠진 키만 채운다(젬 스킬 레벨은 inventory로 옮겨서 shop엔 없음)', () => {
  const s = normalizeShopSave({ skillLv: { red: 3 }, purchasedOnce: ['pack.adfree'] }, SHOP);
  assert.equal(s.skillLv, undefined);
  assert.deepEqual(s.passes.monthly, { daysLeft: 0, claimedToday: false });
  assert.deepEqual(s.purchasedOnce, ['pack.adfree']);
});

test('BattleController: shopConfig가 있으면 층마다 젬 스킬 레벨을 반영, 없으면 skills.json 그대로', async () => {
  const { BattleController } = await import('../src/game/battleController.js');
  const { playerState } = await import('../src/game/playerState.js');
  const make = (shopConfig) => new BattleController({
    ...DATA, towersBaseData: DATA.balance.tower.towers, shopConfig,
    battleConfig: { cascadeBonusPerStep: 0, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: {}, skills: SKILLS },
  });
  assert.deepEqual(make(null).battleState.skills, SKILLS);
  const c = make(SHOP);
  assert.equal(c.battleState.skills.unlocked.specialSkills.bomb, false, '용암탄 해금 전');
  playerState.inventory.grant({ skills: { red: 3, lava: 2 } }, { src: 'test' });
  c.retryFloor();
  assert.ok(Math.abs(c.battleState.skills.colorEffects.red.ratio - SHOP.skills.color.red.values[2]) < 1e-9);
  assert.equal(c.battleState.skills.unlocked.specialSkills.bomb, true);
  assert.ok(Math.abs(c.battleState.skills.specialSkills.bomb.mul - SHOP.skills.special.lava.values[1]) < 1e-9);
  assert.equal(SKILLS.colorEffects.red.ratio, 0.4);
});

test('A안 잠금: 특수 기술만 빠지고, 그 잼이 지운 칸의 기본 사격은 그대로 나간다', async () => {
  const { BattleState } = await import('../src/battle/battleState.js');
  const { PuzzleBattleBridge } = await import('../src/game/puzzleBattleBridge.js');
  const colors = ['red', 'blue', 'purple', 'yellow', 'green'];
  const run = (skillLv) => {
    const bs = new BattleState({
      towersData: colors.map((c) => ({ id: `tower_${c}`, color: c, stats: { attack: 100 } })),
      resolvedFloor: { wallHp: 1000, interval: 0, spawns: [{ type: 'e', rank: 'normal', name: 'E', hp: 1e6, def: 0, speed: 0.1, wallDmg: 5, gold: 1 }] },
      battleConfig: {
        cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1,
        effectDurationsMs: { towerAttack: 1e9, skillCast: 1e9, enemyHit: 1e9 },
        skills: applySkillLevels(SKILLS, SHOP.skills, lvOf(skillLv)),
      },
    });
    bs.update(0);
    // 폭탄 잼(빨강, GEM_TYPES 0번) 발동 + 그 폭발로 지워진 빨강 3칸.
    new PuzzleBattleBridge(bs).update({
      board: { cols: 3, cellStates: [0, 1, 2].map(() => ({ phase: 'clearing', value: 0 })) },
      resolutions: [{ id: 1, phase: 'clearing', cascadeIndex: 1, watchCells: [0, 1, 2].map((col) => ({ row: 0, col })) }],
      effects: [{ type: 'specialActivate', kind: 'bomb', gemColor: 0, elapsedMs: 0, cascadeIndex: 1 }],
    });
    const types = bs.events.map((e) => e.type);
    return { shots: types.filter((x) => x === 'towerAttack').length, casts: bs.events.filter((e) => e.type === 'skillCast').length };
  };
  const lv = defaultSkillLevels(SHOP.skills); // 새 플레이어: 용암탄 Lv 0
  assert.deepEqual(run(lv), { shots: 1, casts: 0 }, '잠김: 기본 사격 1발(빨강 3칸), 용암탄 없음');
  assert.deepEqual(run({ ...lv, lava: 1 }), { shots: 1, casts: 1 }, '해금: 기본 사격 그대로 + 용암탄');
});

test('products.json: 현금 상품 = 상점 krw 상품과 1:1, 지급은 txId iap:{키}:{주문} 한 번만', () => {
  const player = makePlayer({ bestFloor: 6 });
  player.shop.offers.boss = { floor: 10, expiresAt: NOW + 1000 };
  player.shop.offers.starter = NOW + 1000;
  const ctx = ctxOf(player);
  const krw = ['packs', 'dia'].flatMap((r) => buildRail(ctx, r)).filter((p) => p.cur === 'krw');
  assert.ok(krw.length >= 13, '팩 7 + 다이아 6이 다 보이는 상태에서 확인');
  const keys = Object.keys(SHOP.products).filter((k) => !k.startsWith('_'));
  for (const p of krw) assert.ok(keys.includes(p.id), p.id);
  for (const k of keys) {
    const prod = SHOP.products[k];
    assert.ok(Number.isInteger(prod.priceKRW) && prod.priceKRW > 0, k);
    assert.ok(prod.grant && prod.ids, k);
  }
  assert.ok(buyProduct(ctx, 'pack.adfree', 1, 'iap:pack.adfree:o1').ok);
  assert.equal(player.diamonds, 200);
  assert.equal(buyProduct(ctx, 'pack.weekly', 1, 'iap:pack.weekly:o2').ok, true);
  assert.equal(buyProduct(ctx, 'dia.0', 1, 'iap:dia.0:o3').ok, true);
  assert.equal(buyProduct(ctx, 'dia.0', 1, 'iap:dia.0:o3').reason, 'sold', '같은 주문 id는 두 번 지급 안 됨');
});

test('canSell: 못 파는 현금 상품은 목록·구매에서 빠지고, 이미 산 패스 받기는 남는다', () => {
  const player = makePlayer({ bestFloor: 6 });
  player.shop.offers.starter = NOW + 1000;
  player.shop.passes.weekly = { daysLeft: 3, claimedToday: false };
  const ctx = ctxOf(player, { canSell: () => false });
  const packs = buildRail(ctx, 'packs').filter((e) => e.id);
  assert.deepEqual(packs.map((e) => e.id), ['pass.weekly']);
  const dia = buildRail(ctx, 'dia');
  assert.ok(!dia.some((e) => e.kind === 'diaBundle' || e.hdr === 'diaBuy'));
  assert.ok(dia.some((e) => e.kind === 'diaItem'), '다이아로 사는 상품은 그대로');
  assert.equal(buyProduct(ctx, 'dia.0', 1, 'iap:dia.0:x').reason, 'missing');
  const some = ctxOf(player, { canSell: (k) => k === 'dia.2' });
  assert.deepEqual(buildRail(some, 'dia').filter((e) => e.kind === 'diaBundle').map((e) => e.id), ['dia.2']);
});

test('grantPaidProduct: 미지급 복구/복원 - 목록에 있으면 상점 규칙대로, 이미 받았으면 성공, 목록에 없으면 products.json 지급만', () => {
  const player = makePlayer({ bestFloor: 6 });
  const ctx = ctxOf(player);
  assert.ok(grantPaidProduct(ctx, 'pack.adfree', 'iap:pack.adfree:o1').ok);
  assert.equal(player.diamonds, 200);
  assert.ok(player.shop.purchasedOnce.includes('pack.adfree'), '상점 1회 구매 기록');
  const again = grantPaidProduct(ctx, 'pack.adfree', 'iap:pack.adfree:o1');
  assert.deepEqual([again.ok, again.duplicate], [true, true], '같은 주문은 두 번 안 주고 성공으로(스토어에 완료 알림)');
  assert.equal(player.diamonds, 200);
  // 기간이 끝난 보스 팩(지금 목록에 없음)도 산 것은 준다.
  assert.ok(grantPaidProduct(ctx, 'pack.boss', 'iap:pack.boss:o2').ok);
  assert.equal(player.items.revive, 2);
  assert.equal(grantPaidProduct(ctx, 'nope', 'iap:nope:o3').ok, false);
});

test('복원·환불: 목록에 없는 1회 팩도 기록이 되살아나고, 환불은 광고 제거만 한 번 회수(slot4는 유지)', () => {
  const player = makePlayer({ bestFloor: 30 }); // 스타터 노출 기간 아님 -> 목록에 없음
  const ctx = ctxOf(player);
  assert.ok(grantPaidProduct(ctx, 'pack.starter', 'iap:pack.starter:o1').ok);
  assert.ok(player.shop.purchasedOnce.includes('pack.starter'), '1회 팩 기록 복원');
  assert.ok(grantPaidProduct(ctx, 'pack.adfree', 'iap:pack.adfree:o2').ok);
  player.inventory.grant({ flags: ['slot4'] }, { src: 'bossReward', txId: 'boss:20' });
  assert.ok(player.inventory.isUnlocked('adFree'));
  const r = revokePaidProduct(ctx, 'pack.adfree', 'o2');
  assert.deepEqual(r.removed, ['adFree']);
  assert.equal(player.inventory.isUnlocked('adFree'), false);
  assert.equal(revokePaidProduct(ctx, 'pack.adfree', 'o2').reason, 'duplicate', '같은 환불은 한 번만');
  assert.deepEqual(revokePaidProduct(ctx, 'pack.slot4', 'o3').removed, [], 'slot4는 다른 경로로도 얻으므로 회수 안 함');
  assert.ok(player.inventory.isUnlocked('slot4'));
});
