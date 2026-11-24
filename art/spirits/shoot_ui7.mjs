// 정령 탭 목록 하나 + 필터 버튼 3개(속성·등급·보유) 확인: 짧은 화면(360x640)·긴 화면(360x780) x 한글·영어.
// 사용: python serve.py 8000 뒤 node art/spirits/shoot_ui7.mjs -> art/spirits/preview/ui7_*.png
import { chromium } from 'playwright';

const OUT = 'art/spirits/preview';
const MISSING = ['phoenix', 'frost_bat', 'stag', 'wraith_queen', 'storm_kirin', 'sup_paint'];
const browser = await chromium.launch();
const errors = [];
const log = [];

for (const [locale, h] of [['ko', 640], ['ko', 780], ['en', 640], ['en', 780]]) {
  const ctx = await browser.newContext({ viewport: { width: 360, height: h }, deviceScaleFactor: 3 });
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
  const tag = `${locale}${h}`;
  const shot = (name) => page.screenshot({ path: `${OUT}/ui7_${tag}_${name}.png` });
  const at = async (type, pick = '() => true') => {
    const p = await page.evaluate(([ty, fn]) => {
      const L = window.__gg.renderer.prepLayout;
      const hh = (L.spiritHits ?? []).find((x) => x.hit.type === ty && eval(fn)(x.hit));
      const f = document.querySelector('canvas').getBoundingClientRect();
      return hh && { x: f.left + (hh.r.x + hh.r.width / 2) * L.scale * f.u, y: f.top + (hh.r.y + hh.r.height / 2) * L.scale * f.u };
    }, [type, pick]);
    if (!p) throw new Error(`hit 없음: ${type}`);
    return p;
  };
  const tap = async (type, pick) => {
    const p = await at(type, pick);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
  };
  const hold = async (type, pick) => {
    const p = await at(type, pick);
    await page.mouse.move(p.x, p.y);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await page.waitForTimeout(250);
  };
  const sel = () => page.evaluate(() => { const s = window.__gg.renderer.prepLayout && window.__gg; return null; });
  await shot('owned');
  await tap('spiritFilter', '(h) => h.kind === "ownedOnly"'); // 보유만 -> 전체
  await shot('all');
  await tap('spiritFilter', '(h) => h.kind === "element"'); // 불
  await tap('spiritFilter', '(h) => h.kind === "element"'); // 얼음
  await tap('spiritFilter', '(h) => h.kind === "grade"'); // 일반
  await tap('spiritFilter', '(h) => h.kind === "grade"'); // 희귀
  await tap('spiritFilter', '(h) => h.kind === "grade"'); // 영웅
  await tap('spiritFilter', '(h) => h.kind === "grade"'); // 전설
  await shot('ice_legend');
  await tap('spiritItem', '(h) => h.id === "frost_whale"'); // 가진 전설 = 상세
  await shot('detail_owned');
  await tap('spiritBack');
  await hold('spiritFilter', '(h) => h.kind === "grade"'); // 길게 = 등급 전체
  await tap('spiritFilter', '(h) => h.kind === "element"'); // 얼음 -> 숲
  await shot('forest_all');
  await tap('spiritItem', '(h) => h.id === "stag"'); // 안 가진 정령 = 도감 설명
  await shot('info_missing');
  await tap('spiritBack');
  for (let i = 0; i < 2; i++) await tap('spiritFilter', '(h) => h.kind === "element"'); // 숲 -> 독 -> 번개
  await tap('spiritFilter', '(h) => h.kind === "ownedOnly"'); // 전체 -> 보유만
  for (let i = 0; i < 4; i++) await tap('spiritFilter', '(h) => h.kind === "grade"'); // 전설(번개 전설 = 없음)
  await shot('empty');
  await ctx.close();
}
console.log('errors', JSON.stringify(errors));
await browser.close();
