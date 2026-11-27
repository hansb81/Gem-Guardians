// 랭킹 팝업(명예의 전당 + 내 기록 카드 / 목록) 확인 스크린샷 - 가짜 순위표(?rankPlayers=N)로 두 탭을 찍는다.
// 사용: npx vite --port 5199 를 띄운 뒤 node tools/screenshot_ranking.mjs [baseUrl]  -> preview/ranking-hall/*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://localhost:5199/';
const out = 'preview/ranking-hall';
mkdirSync(out, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
for (const n of [3, 30]) {
  const page = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error(`[${n}] ${e.message}`));
  await page.goto(`${base}?dev=1&rankPlayers=${n}`);
  await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
  await page.addStyleTag({ content: 'body > div:not(#banner-slot) { display: none !important; }' }); // 개발 패널 숨김
  await page.waitForFunction(() => window.__gg.titleScreen.tapReady, null, { timeout: 60000 });
  await wait(1500);
  await page.keyboard.press('Enter');
  await wait(3500);
  for (const tab of ['normal', 'comp']) {
    await page.evaluate((tab) => {
      const { ranking, playerState } = window.__gg;
      playerState.ranking.profile.nickname ||= '봉식이아빠';
      ranking.devCompState = 1; // 경쟁 탭 = 평소(잠김 덮개 없이)
      if (!ranking.isOpen) ranking.open();
      ranking.state.tab = tab;
    }, tab);
    await wait(800);
    await page.screenshot({ path: `${out}/${tab}_${n < 10 ? 'B' : 'C'}_${n}.png` });
  }
  await page.close();
}
await browser.close();
