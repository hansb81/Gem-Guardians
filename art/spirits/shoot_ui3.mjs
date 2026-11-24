// 정령 G 단계 화면 확인: 전설·보조 효과 문구(정령 탭·도감), 전투에서 전설 발동(불사조 회복·기린 번개) 때 오류 없는지.
// 사용: 저장소 루트에서 python serve.py 8000 띄운 뒤 node art/spirits/shoot_ui3.mjs -> art/spirits/preview/ui3_*.png
import { chromium } from 'playwright';

const OUT = 'art/spirits/preview';
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto('http://localhost:8000/?dev=1');
await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
await page.addStyleTag({ content: 'body > div:not(#banner-slot) { display: none !important; }' });
await page.waitForTimeout(2500);
await page.keyboard.press('Enter');
await page.waitForTimeout(3500);
const shot = (name) => page.screenshot({ path: `${OUT}/ui3_${name}.png` });

await page.evaluate(() => {
  const g = window.__gg;
  g.playerState.tutorial = { ...g.playerState.tutorial, done: true };
  g.controller.devGrantAllSpirits();
  ['phoenix', 'frost_whale', 'storm_kirin', 'elder_treant', 'wraith_queen'].forEach((id, i) => g.playerState.inventory.equipSpirit(i, id));
  g.openPrep('village', 'spirit');
});
await page.waitForTimeout(600);
await shot('tab_legend');
await page.evaluate(() => {
  const inv = window.__gg.playerState.inventory;
  ['sup_cascade', 'sup_clock', 'sup_tinker', 'sup_breaker', 'sup_paint'].forEach((id, i) => inv.equipSpirit(i, id));
});
await page.waitForTimeout(400);
await shot('tab_support');

// 전투: 전설 5마리로 사격 + 성벽을 30% 아래로 깎아 불사조 발동.
await page.evaluate(() => {
  const g = window.__gg;
  ['phoenix', 'frost_whale', 'storm_kirin', 'elder_treant', 'wraith_queen'].forEach((id, i) => g.playerState.inventory.equipSpirit(i, id));
  g.back();
  g.enterGame();
  g.controller.devSetFloor(15);
});
await page.waitForTimeout(8000);
const info = await page.evaluate(() => {
  const bs = window.__gg.controller.battleState;
  for (let n = 0; n < 9; n++) bs.applyGemClear('yellow', 1, 1); // 기린: 10발째 직전까지
  return { spirits: bs.spirits.map((s) => s?.key), every: bs.spirits.map((s) => s?.every), enemies: bs.enemies.length };
});
console.log('battle', JSON.stringify(info));
await page.evaluate(() => {
  const bs = window.__gg.controller.battleState;
  bs.applyGemClear('yellow', 1, 1); // 10발째 = 번개
  bs.applyObstacleWallDamage(0.75); // 성벽 25% -> 불사조
});
await page.waitForTimeout(120);
await shot('battle_proc');
await page.waitForTimeout(200);
await shot('battle_proc2');
console.log('after', JSON.stringify(await page.evaluate(() => {
  const bs = window.__gg.controller.battleState;
  return { wall: bs.wallHealth, max: bs.wallMaxHealth, phoenixUsed: bs._phoenixUsed, status: bs.status, treant: bs._treantStacks };
})));
console.log('errors', JSON.stringify(errors));
await browser.close();
