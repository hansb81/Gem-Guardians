// 상점 규칙(src/core/shop/shop.js) - 실제 config/*.json 그대로(tests/items.test.js와 같은 방식).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRail, buyProduct, defaultShopSave, normalizeShopSave, refreshOffers, offerBossPack, rolloverDay, applySkillLevels, hasNewPack } from '../src/core/shop/shop.js';
import { itemPrice, normalFloorReward } from '../src/core/economy/economy.js';
import { defaultSkillLevels } from '../src/core/inventory/inventory.js';
import { Inventory } from '../src/game/inventory.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const load = (name) => JSON.parse(readFileSync(join(__dirname, '..', 'config', name), 'utf8'));
const DATA = { balance: load('balance.json'), enemies: load('enemies.json'), obstacles: load('obstacles.json'), floorsData: load('floors.json') };
const ITEMS = load('items.json');
const SHOP = load('shop.json');
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
  const player = makePlayer({ gold: 1e9 });
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
  assert.equal(p.price, Math.round(SHOP.skills.levelCost[0] * normalFloorReward(DATA, 12)));
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
  const b = SHOP.diaBundles[1];
  assert.ok(buyProduct(ctx, 'dia.1').ok);
  assert.equal(player.diamonds, b.dia * 2 + b.bonus);
  assert.ok(buyProduct(ctx, 'dia.1').ok);
  assert.equal(player.diamonds, b.dia * 2 + b.bonus + b.dia + b.bonus);
  assert.equal(buildRail(ctx, 'dia').find((p) => p.id === 'dia.1').first, false);
  assert.equal(buildRail(ctx, 'dia').find((p) => p.id === 'dia.0').first, true);
});

test('패스: 사면 즉시 다이아, 다음 날부터 하루 한 번 받기', () => {
  const player = makePlayer();
  const ctx = ctxOf(player);
  const pass = SHOP.packs.weekly.pass;
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
  assert.equal(player.gold, Math.round(5 * normalFloorReward(DATA, 12)));
  assert.equal(player.diamonds, 980);
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
  assert.ok(Math.abs(b.colorEffects.red.ratio - 0.5) < 1e-9);
  assert.ok(Math.abs(b.colorEffects.blue.mul - 0.58) < 1e-9);
  assert.ok(Math.abs(b.specialSkills.color.mul - 1.5) < 1e-9);
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
  assert.ok(Math.abs(c.battleState.skills.colorEffects.red.ratio - 0.5) < 1e-9);
  assert.equal(c.battleState.skills.unlocked.specialSkills.bomb, true);
  assert.ok(Math.abs(c.battleState.skills.specialSkills.bomb.mul - 2.2) < 1e-9);
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
