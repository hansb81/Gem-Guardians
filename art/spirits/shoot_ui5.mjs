// 마지막 수치 조정 뒤 바뀐 효과 문구 3종(속성·증폭·망령 여왕)이 영어·한글 화면에서 칸을 넘치지 않는지.
// 사용: python serve.py 8000 뒤 node art/spirits/shoot_ui5.mjs -> art/spirits/preview/ui5_*.png
import { chromium } from 'playwright';
const IDS = ['flame_fox', 'ice_owl', 'thunder_hawk', 'stag', 'wraith_queen']; // 수호자 순서(빨강·파랑·노랑·초록·보라)
const browser = await chromium.launch();
const errors = [];
for (const locale of ['en', 'ko']) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, deviceScaleFactor: 3 });
  await ctx.addInitScript((l) => { localStorage.setItem('dataEpoch', '1'); localStorage.setItem('locale', JSON.stringify(l)); }, locale);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:8000/?dev=1');
  await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
  await page.addStyleTag({ content: 'body > div:not(#banner-slot) { display: none !important; }' });
  await page.waitForTimeout(2500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  await page.evaluate((ids) => {
    const g = window.__gg;
    g.playerState.tutorial = { ...g.playerState.tutorial, done: true };
    g.controller.devGrantAllSpirits();
    g.controller.devMaxAllSpirits();
    ids.forEach((id, i) => g.playerState.inventory.equipSpirit(i, id));
    g.openPrep('village', 'spirit');
  }, IDS);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `art/spirits/preview/ui5_${locale}_tab.png` });
  await page.evaluate(() => { window.__gg.back(); window.__gg.enterShop('spirit'); });
  await page.waitForTimeout(1500);
  for (const id of ['thunder_hawk', 'storm_cat', 'wraith_queen']) {
    const cell = await page.evaluate((sid) => {
      const s = window.__gg.shopScreen;
      const row = s.entries.find((r) => r.e.spirit === sid);
      const r = s._screenRect([row.x + 10, 104 + row.y - s.scroll + 10, 1, 1]);
      const f = document.querySelector('canvas').getBoundingClientRect();
      return { x: f.left + r.x * f.u, y: f.top + r.y * f.u };
    }, id);
    await page.mouse.click(cell.x, cell.y);
    await page.waitForTimeout(300);
    await page.screenshot({ path: `art/spirits/preview/ui5_${locale}_shop_${id}.png` });
  }
  await ctx.close();
}
console.log('errors', JSON.stringify(errors));
await browser.close();
