// 정령 도감을 정령 탭으로 옮긴 뒤 확인: 짧은 화면(360x640 = 540x960 비율) 한글·영어로 보유 목록 / 도감 / 도감 설명(가진 것·없는 것),
// "보유 목록에서 보기", 상점 레일에 정령이 없는지. 사용: python serve.py 8000 뒤 node art/spirits/shoot_ui6.mjs -> art/spirits/preview/ui6_*.png
import { chromium } from 'playwright';

const OUT = 'art/spirits/preview';
const MISSING = ['phoenix', 'frost_bat', 'stag', 'wraith_queen', 'storm_kirin', 'sup_paint']; // 없는 정령 = 실루엣 확인
const browser = await chromium.launch();
const errors = [];

for (const locale of ['ko', 'en']) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 3 });
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
  await page.evaluate((missing) => {
    const g = window.__gg;
    g.playerState.tutorial = { ...g.playerState.tutorial, done: true };
    g.controller.devGrantAllSpirits();
    for (const id of missing) delete g.playerState.inventory.data.perm.spirits[id];
    g.openPrep('village', 'spirit');
  }, MISSING);
  await page.waitForTimeout(600);
  const shot = (name) => page.screenshot({ path: `${OUT}/ui6_${locale}_${name}.png` });
  const tap = async (type, pick = '() => true') => {
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
  await shot('owned');
  await tap('spiritView', '(h) => h.view === "dex"');
  await shot('dex');
  await tap('spiritFilter', '(h) => h.kind === "grade" && h.key === "legend"');
  await shot('dex_legend');
  await tap('spiritFilter', '(h) => h.kind === "grade" && h.key === "legend"'); // 다시 누르면 해제
  await tap('spiritDexItem', '(h) => h.id === "stag"');
  await shot('dex_info_missing');
  await tap('spiritDexBack');
  await tap('spiritFilter', '(h) => h.kind === "element" && h.key === "blue"');
  await tap('spiritDexItem', '(h) => h.id === "ice_owl"');
  await shot('dex_info_owned');
  await tap('spiritDexOpen');
  await shot('open_owned');
  console.log(locale, JSON.stringify(await page.evaluate(() => ({ sel: window.__gg.renderer.prepLayout && null, rails: window.__gg.shopScreen.rails }))));
  await page.evaluate(() => { window.__gg.back(); window.__gg.enterShop('spirit'); });
  await page.waitForTimeout(1500);
  console.log(locale, 'shop rails', JSON.stringify(await page.evaluate(() => ({ rails: window.__gg.shopScreen.rails, rail: window.__gg.shopScreen.rail }))));
  await shot('shop');
  await ctx.close();
}
console.log('errors', JSON.stringify(errors));
await browser.close();
