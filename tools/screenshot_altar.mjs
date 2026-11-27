// 수호의 제단 수호자 탭(무대 칸 + 강화 연출) 확인 스크린샷.
// 사용: npx vite --port 5199 를 띄운 뒤 node tools/screenshot_altar.mjs [baseUrl]  -> preview/altar-stage/*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5199/';
const out = 'preview/altar-stage';
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.error(e.message));
await page.goto(`${base}?dev=1`);
await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
await page.addStyleTag({ content: 'body > div:not(#banner-slot) { display: none !important; }' }); // 개발 패널 숨김
await page.waitForFunction(() => window.__gg.titleScreen.tapReady, null, { timeout: 60000 });
await wait(1500);
await page.keyboard.press('Enter');
await wait(3500);

const open = (context) => page.evaluate((context) => {
  window.__gg.playerState.gold = 5e6;
  window.__gg.openPrep(context, 'statue');
}, context);
// 540x960(dpr 1)에선 팝업 basis 좌표 = CSS 좌표.
const center = (pick) => page.evaluate((pick) => {
  const s = window.__gg.renderer.prepLayout.statue;
  const r = pick === 'all' ? s.all : s.rows[pick].upgrade;
  return [r.x + r.width / 2, r.y + r.height / 2];
}, pick);

await open('village');
await wait(600);
await page.screenshot({ path: `${out}/1_village_idle.png` });

// 강화 순간 - 번쩍임(통칠 80ms + 체크 80ms)이 잡히게 연달아 찍는다.
await page.mouse.click(...(await center(1)));
for (let i = 0; i < 4; i++) await page.screenshot({ path: `${out}/2_upgrade_${i}.png` });
await wait(900);

await page.mouse.click(...(await center('all')));
for (let i = 0; i < 4; i++) await page.screenshot({ path: `${out}/3_all_${i}.png` });
await wait(900);

await open('floorClear');
await wait(600);
console.log('floorClear rowH', await page.evaluate(() => window.__gg.renderer.prepLayout.statue.rows[0].card.height));
await page.screenshot({ path: `${out}/4_floorclear_idle.png` });
await browser.close();
