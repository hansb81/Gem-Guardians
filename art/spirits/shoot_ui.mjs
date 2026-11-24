// 정령 화면 확인용 스크린샷(F 단계). 사용: 저장소 루트에서 python serve.py 8000 띄운 뒤
// node art/spirits/shoot_ui.mjs  ->  art/spirits/preview/ui_*.png
import { chromium } from 'playwright';

const OUT = 'art/spirits/preview';
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8000/?dev=1');
await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
await page.addStyleTag({ content: 'body > div:not(#banner-slot) { display: none !important; }' }); // 개발 패널 숨김
await page.waitForTimeout(2500);
await page.keyboard.press('Enter');
await page.waitForTimeout(3500);

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });
// 정비 팝업 정령 탭의 터치 사각형을 실제로 누른다(type + 조건으로 찾기).
const tap = async (type, pick = '() => true') => {
  const p = await page.evaluate(([ty, fn]) => {
    const L = window.__gg.renderer.prepLayout;
    const h = (L.spiritHits ?? []).find((x) => x.hit.type === ty && eval(fn)(x.hit));
    if (!h) return null;
    const f = document.querySelector('canvas').getBoundingClientRect(); // main.js가 frame 기준(left/top/u)으로 바꿔 둔 값
    return { x: f.left + (h.r.x + h.r.width / 2) * L.scale * f.u, y: f.top + (h.r.y + h.r.height / 2) * L.scale * f.u };
  }, [type, pick]);
  if (!p) throw new Error(`hit 없음: ${type}`);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
};

// ---- 전투: 1층 + 4번째 슬롯이 열린 층 ----
await page.evaluate(() => {
  const g = window.__gg;
  const c = g.controller;
  const inv = g.playerState.inventory;
  g.playerState.tutorial = { ...g.playerState.tutorial, done: true };
  c.devGrantAllSpirits();
  c.devAddSpiritStones(50);
  g.playerState.addGold(50000);
  ['fire_wisp', 'snow_fairy', 'copper_squirrel', 'seedling', 'bone_crow'].forEach((id, i) => inv.equipSpirit(i, id)); // 공격·속성·재물·수호·공격
  g.enterGame();
  c.devSetFloor(1);
});
await page.waitForTimeout(7000);
await shot('ui_battle_f1');
await page.evaluate(() => {
  const g = window.__gg;
  g.playerState.inventory.grant({ flags: ['slot4'], items: { hammer: 3, repair: 3, hourglass: 3, barrier: 3 } }, { src: 'dev' });
  ['hammer', 'repair', 'hourglass', 'barrier'].forEach((id, i) => g.playerState.inventory.equip(i, id));
  g.controller.devSetFloor(21);
});
await page.waitForTimeout(7000);
await shot('ui_battle_slot4');
// 성벽을 깎아 두고 사격: 추가 사격·수호 회복·재물 "+"가 나오는 순간을 몇 장.
await page.evaluate(() => {
  const bs = window.__gg.controller.battleState;
  bs.wallHealth = Math.round(bs.wallMaxHealth * 0.5);
  window.__fire = setInterval(() => {
    for (const color of ['red', 'blue', 'yellow', 'green', 'purple']) bs.applyGemClear(color, 2, 1);
  }, 250);
});
for (let i = 0; i < 4; i++) {
  await page.waitForTimeout(700);
  await shot(`ui_battle_fire${i}`);
}
await page.evaluate(() => clearInterval(window.__fire));

// ---- 정령 탭 / 상세 ----
await page.evaluate(() => window.__gg.openPrep('village', 'spirit'));
await page.waitForTimeout(600);
await shot('ui_tab');
await tap('spiritFilter', '(h) => h.kind === "element" && h.key === "red"');
await shot('ui_tab_filter');
await tap('spiritFilter', '(h) => h.kind === "element" && h.key === null');
await tap('spiritSlot', '(h) => h.index === 1');
await tap('spiritItem', '(h) => h.id === "ice_owl"');
await shot('ui_detail');
await tap('spiritLevelUp');
await tap('spiritEquip');
await shot('ui_detail_after');
const state = await page.evaluate(() => {
  const inv = window.__gg.playerState.inventory;
  return { owl: inv.spirit('ice_owl'), slots: inv.spiritSlots(), pending: inv.pendingSpirits(), stones: inv.spiritStones };
});
console.log('after levelUp+equip', JSON.stringify(state));
const close = await page.evaluate(() => {
  const L = window.__gg.renderer.prepLayout;
  const f = document.querySelector('canvas').getBoundingClientRect();
  return { x: f.left + (L.close.x + 22) * L.scale * f.u, y: f.top + (L.close.y + 22) * L.scale * f.u };
});
await page.mouse.click(close.x, close.y);
await page.waitForTimeout(300);

// ---- 보스 첫 처치 보상(30층 - devSetFloor가 최고 층도 올려서 그 위 보스층이어야 첫 클리어) ----
await page.evaluate(() => {
  const c = window.__gg.controller;
  c.devSetFloor(30);
  window.__kill = setInterval(() => {
    const bs = c.battleState;
    if (bs.status !== 'active') return clearInterval(window.__kill);
    for (const e of bs.enemies) if (e.state === 'alive') bs.resolveTowerAttack({ targetEnemyId: e.id, damage: e.currentHealth + 1, towerId: bs.towers[0].id });
  }, 100);
});
await page.waitForFunction(() => window.__gg.controller.lastClearReward, null, { timeout: 120000 });
await page.waitForTimeout(2500);
await shot('ui_boss_reward');
console.log('clear spirit', JSON.stringify(await page.evaluate(() => window.__gg.controller.lastClearReward.spirit)));

// ---- 상점 도감 ----
await page.keyboard.press('Escape'); // 획득 팝업 닫기(뒤로가기 = 확인)
await page.evaluate(() => {
  const g = window.__gg;
  g.back();
  for (const id of ['phoenix', 'frost_bat', 'stag', 'wraith_queen', 'storm_kirin', 'sup_paint']) delete g.playerState.inventory.data.perm.spirits[id]; // 없는 정령 = 실루엣 확인
  g.enterShop('spirit');
});
await page.waitForTimeout(1500);
await shot('ui_shop');
const cell = await page.evaluate(() => {
  const s = window.__gg.shopScreen;
  const row = s.entries.find((r) => r.e.spirit === 'ice_owl');
  const r = s._screenRect([row.x + 10, 104 + row.y - s.scroll + 10, 1, 1]);
  const f = document.querySelector('canvas').getBoundingClientRect();
  return { x: f.left + r.x * f.u, y: f.top + r.y * f.u };
});
await page.mouse.click(cell.x, cell.y);
await page.waitForTimeout(400);
await shot('ui_shop_sel');
console.log('errors', JSON.stringify(errors));
await browser.close();
