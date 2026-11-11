// 화면 맞춤(안전 frame + 블리드) 확인 스크린샷 - 뷰포트별 실제 deviceScaleFactor로 타이틀/메뉴/전투/상점을 찍는다.
// 사용: python serve.py 8000 을 띄운 뒤 node tools/screenshot_fit.mjs [baseUrl]  -> preview/screen-fit/*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:8000/';
const out = 'preview/screen-fit';
mkdirSync(out, { recursive: true });
const VIEWPORTS = [
  [360, 640, 3], [360, 780, 3], [393, 873, 2.75], [412, 915, 2.625], [430, 932, 3],
  [768, 1024, 2], [800, 1280, 2], [673, 841, 2.5], [1280, 720, 1],
];
const RUNS = [
  ...VIEWPORTS.map(([w, h, d]) => ({ w, h, d, q: '', tag: '' })),
  { w: 393, h: 873, d: 2.75, q: '&insets=40,0,30,0', tag: '_insets' },
  { w: 393, h: 873, d: 2.75, q: '&banner=50', tag: '_banner' },
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
for (const { w, h, d, q, tag } of RUNS) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: d });
  page.on('pageerror', (e) => console.error(`[${w}x${h}] ${e.message}`));
  await page.goto(`${base}?dev=1${q}`);
  await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
  await page.addStyleTag({ content: 'body > div:not(#banner-slot) { display: none !important; }' }); // 개발 패널 숨김
  const name = (scene) => `${out}/${w}x${h}@${d}${tag}_${scene}.png`;
  await wait(2500);
  await page.screenshot({ path: name('title') });
  await page.keyboard.press('Enter');
  await wait(3500);
  await page.screenshot({ path: name('menu') });
  await page.evaluate(() => window.__gg.enterGame());
  await wait(1500);
  await page.screenshot({ path: name('battle') });
  await page.evaluate(() => window.__gg.enterShop());
  await wait(1500);
  await page.screenshot({ path: name('shop') });
  await page.close();
}
await browser.close();
