// 정령 G 판정 확인: (1) 영어 화면에서 효과 문구 10종(정령 탭·상세·도감)이 칸을 넘치지 않는지, (2) 서리 고래 빙결·망령 여왕 발동 장면.
// 사용: 저장소 루트에서 python serve.py 8000 띄운 뒤 node art/spirits/shoot_ui4.mjs -> art/spirits/preview/ui4_*.png
import { chromium } from 'playwright';

const OUT = 'art/spirits/preview';
const LEGENDS = ['phoenix', 'frost_whale', 'storm_kirin', 'elder_treant', 'wraith_queen']; // 수호자 순서(공명 자리)
const SUPPORTS = ['sup_cascade', 'sup_clock', 'sup_tinker', 'sup_breaker', 'sup_paint'];
const browser = await chromium.launch();
const errors = [];

async function open(locale) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
  if (locale) await ctx.addInitScript((l) => { localStorage.setItem('dataEpoch', '1'); localStorage.setItem('locale', JSON.stringify(l)); }, locale);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8000/?dev=1');
  await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
  await page.addStyleTag({ content: 'body > div:not(#banner-slot) { display: none !important; }' });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  await page.evaluate(() => {
    const g = window.__gg;
    g.playerState.tutorial = { ...g.playerState.tutorial, done: true };
    g.controller.devGrantAllSpirits();
  });
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/ui4_${name}.png` });
const equip = (page, ids) => page.evaluate((list) => list.forEach((id, i) => window.__gg.playerState.inventory.equipSpirit(i, id)), ids);
const tapHit = async (page, type, pick) => {
  const p = await page.evaluate(([ty, fn]) => {
    const L = window.__gg.renderer.prepLayout;
    const h = (L.spiritHits ?? []).find((x) => x.hit.type === ty && eval(fn)(x.hit));
    const f = document.querySelector('canvas').getBoundingClientRect();
    return h && { x: f.left + (h.r.x + h.r.width / 2) * L.scale * f.u, y: f.top + (h.r.y + h.r.height / 2) * L.scale * f.u };
  }, [type, pick]);
  if (!p) throw new Error(`hit 없음: ${type}`);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
};

// ---- 1. 영어 ----
{
  const page = await open('en');
  for (const [name, ids] of [['legend', LEGENDS], ['support', SUPPORTS]]) {
    await equip(page, ids);
    await page.evaluate(() => window.__gg.openPrep('village', 'spirit'));
    await page.waitForTimeout(500);
    await shot(page, `en_tab_${name}`);
    // 상세: 수호자 칸마다 그 정령(지금/다음 레벨 두 줄)
    for (let i = 0; i < ids.length; i++) {
      await tapHit(page, 'spiritSlot', `(h) => h.index === ${i}`);
      await tapHit(page, 'spiritItem', `(h) => h.id === "${ids[i]}"`);
      await shot(page, `en_detail_${ids[i]}`);
      await tapHit(page, 'spiritBack', '() => true');
    }
    await page.evaluate(() => window.__gg.back());
  }
  await page.evaluate(() => window.__gg.enterShop('spirit'));
  await page.waitForTimeout(1500);
  for (const id of [...LEGENDS, ...SUPPORTS]) {
    const cell = await page.evaluate((sid) => {
      const s = window.__gg.shopScreen;
      const row = s.entries.find((r) => r.e.spirit === sid);
      const r = s._screenRect([row.x + 10, 104 + row.y - s.scroll + 10, 1, 1]);
      const f = document.querySelector('canvas').getBoundingClientRect();
      return { x: f.left + r.x * f.u, y: f.top + r.y * f.u };
    }, id);
    await page.mouse.click(cell.x, cell.y);
    await page.waitForTimeout(300);
    await shot(page, `en_shop_${id}`);
  }
  await page.context().close();
}

// ---- 2. 서리 고래 빙결 / 망령 여왕 ----
{
  const page = await open(null);
  await equip(page, LEGENDS);
  await page.evaluate(() => {
    const g = window.__gg;
    g.enterGame();
    g.controller.devSetFloor(15);
  });
  await page.waitForTimeout(9000);
  const whale = await page.evaluate(() => {
    const bs = window.__gg.controller.battleState;
    bs.enemies.forEach((e) => (e.currentHealth = e.maxHealth = 1e7)); // 사격으로 죽지 않게
    const every = bs.spirits[1].every;
    for (let n = 0; n < every; n++) bs.applyGemClear('blue', 1, 1);
    const front = bs._frontmostEnemy();
    return { every, frontId: front.id, freeze: front.spiritFreeze, frozenCount: bs.enemies.filter((e) => e.spiritFreeze > 0).length, allFrozen: bs.frozen, proc: bs.events.filter((e) => e.key === 'frost_whale').length };
  });
  console.log('frost_whale', JSON.stringify(whale));
  await page.waitForTimeout(500);
  await shot(page, 'whale_freeze');
  await page.waitForTimeout(2500);
  console.log('after 3s', JSON.stringify(await page.evaluate(() => window.__gg.controller.battleState.enemies.filter((e) => e.spiritFreeze > 0).length)));

  const queen = await page.evaluate(() => {
    const bs = window.__gg.controller.battleState;
    const order = bs._enemiesFrontToBack();
    const dead = order[0];
    Object.assign(dead.effects.poison, { stacks: 3, base: 500, time: 2.5, tickTimer: 0, carry: 0, source: 4 });
    bs.resolveTowerAttack({ targetEnemyId: dead.id, damage: dead.currentHealth, towerId: bs.towers[4].id });
    const ev = bs.events.find((e) => e.key === 'wraith_queen');
    const to = bs.enemies.find((e) => e.id === ev?.enemyId);
    return { deadId: dead.id, event: ev && { towerIndex: ev.towerIndex, enemyId: ev.enemyId, fromEnemyId: ev.fromEnemyId }, poison: to && { stacks: to.effects.poison.stacks, time: to.effects.poison.time, base: to.effects.poison.base } };
  });
  console.log('wraith_queen', JSON.stringify(queen));
  await page.waitForTimeout(100);
  await shot(page, 'queen_proc');
  await page.waitForTimeout(1200);
  await shot(page, 'queen_poison_tick');
  await page.context().close();
}
console.log('errors', JSON.stringify(errors));
await browser.close();
