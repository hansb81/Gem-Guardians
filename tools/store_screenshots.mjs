// 스토어 스크린샷: 게임 화면을 찍고(1단계) 위에 캡션 띠를 붙여 1080x1920으로 합성(2단계).
// 사용: npx vite --port 5199 를 띄운 뒤 node tools/store_screenshots.mjs [baseUrl]
//   -> store/screenshots/play_1080x1920/*.png (제출용). 게임 화면만 찍은 중간 파일은 OS 임시 폴더.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// --toss = 앱인토스 미리보기 636x1048(캡션 띠·글씨는 같은 비율로 줄임).
const toss = process.argv.includes('--toss');
const base = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'http://localhost:5199/';
const [OW, OH] = toss ? [636, 1048] : [1080, 1920];
const RAW = join(tmpdir(), toss ? 'gg-store-raw-toss' : 'gg-store-raw');
const OUT = `store/screenshots/${toss ? 'toss' : 'play'}_${OW}x${OH}`;
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// 캡션 띠 높이(1080 기준 240px). 게임 화면은 그 아래 OW x (OH - BAND).
const BAND = Math.round((240 * OW) / 1080 / 2) * 2;
const FONT = Math.round((66 * OW) / 1080);
const W = OW / 2, H = (OH - BAND) / 2; // CSS px, dpr 2

const SHOTS = [
  ['01_menu', '잊혀진 지하 신단을 지켜라'],
  ['02_battle', '보석을 맞추면 수호자가 공격해요'],
  ['03_combo', '특수 잼 콤보로 싹 쓸어버려요'],
  ['04_boss', '10층마다 기다리는 보스'],
  ['05_spirit', '정령과 함께 더 강하게'],
  ['06_ranking', '매주 펼쳐지는 랭킹 경쟁'],
];

const browser = await chromium.launch();

async function open(query = '') {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${base}?dev=1${query}`);
  await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
  await page.addStyleTag({ content: 'body > div:not(#banner-slot), body > button { display: none !important; }' }); // 개발 패널·치트 버튼 숨김
  await page.waitForFunction(() => window.__gg.titleScreen.tapReady, null, { timeout: 60000 });
  await wait(1500);
  await page.keyboard.press('Enter');
  await wait(3500);
  await page.evaluate(() => {
    const g = window.__gg;
    g.playerState.tutorial = { ...g.playerState.tutorial, done: true };
    g.playerState.gold = 128450;
    g.playerState.diamonds = 1250;
    g.playerState.ranking.profile.nickname ||= '수호자';
  });
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${RAW}/${name}.png` });

// 전투: 층 이동 + 탑 레벨 + 정령 장착 후 게임 진입.
async function battle(page, floor, level) {
  await page.evaluate(([floor, level]) => {
    const g = window.__gg;
    g.controller.devSetFloor(floor);
    g.controller.devSetAllTowerLevels(level);
    g.controller.devGrantAllSpirits();
    g.enterGame();
  }, [floor, level]);
  await wait(7000); // 소환 연출 + 적 등장
}

// 1) 메뉴
{
  const page = await open();
  await shot(page, '01_menu');
  // 2) 일반 전투 - 특수 잼 몇 개 깔아 둔 보드
  await battle(page, 34, 14);
  await page.evaluate(() => { for (const k of ['line', 'bomb', 'line', 'color']) window.__gg.addSpecial(k); });
  await wait(600);
  await shot(page, '02_battle');
  // 3) 콤보 - 조합 스왑 직후(연출 한가운데)
  await page.evaluate(() => window.__gg.triggerCombo('bomb', 'line'));
  await wait(350);
  await shot(page, '03_combo');
  await page.close();
}
// 4) 보스
{
  const page = await open();
  await battle(page, 40, 16);
  // 40층 보스는 마지막(약 19초)에 나와서 천천히 걸어 들어온다. 그동안 깎인 성벽은 스크린샷용으로 채움.
  // 성벽 앞에 몰린 적은 이름표가 겹쳐 보여서, 보스가 아닌 맨 앞 적을 수호자 탄(devShoot)으로 정리한다(3마리는 남김).
  const tidy = () => page.evaluate(() => {
    const g = window.__gg, bs = g.controller.battleState;
    bs.wallHealth = bs.wallMaxHealth;
    const alive = bs.enemies.filter((e) => e.state === 'alive').sort((a, b) => b.progress - a.progress);
    if (alive.length > 3 && alive[0].rank !== 'boss') g.renderer._battleRenderer.devShoot(bs, true);
  });
  for (let i = 0; i < 16; i++) { await wait(1500); await tidy(); }
  await page.evaluate(() => {
    const bs = window.__gg.controller.battleState;
    bs.wallHealth = bs.wallMaxHealth * 0.8; // 그동안 깎인 성벽을 스크린샷용으로 채움
    for (const k of ['bomb', 'line']) window.__gg.addSpecial(k);
  });
  await wait(1500);
  await shot(page, '04_boss');
  await page.close();
}
// 5) 정령 탭 - 다섯 수호자에 같은 속성 정령(공명)
{
  const page = await open();
  const cfg = await (await fetch(`${base}config/spirits.json`)).json();
  await page.evaluate((spirits) => {
    const g = window.__gg;
    g.controller.devGrantAllSpirits();
    g.controller.devMaxAllSpirits();
    const towers = g.controller.battleState.towers;
    const order = ['legend', 'epic', 'rare', 'common'];
    towers.forEach((t, i) => {
      const ids = Object.keys(spirits).filter((k) => spirits[k].element === t.color && spirits[k].role !== 'support');
      ids.sort((a, b) => order.indexOf(spirits[a].grade) - order.indexOf(spirits[b].grade));
      g.playerState.inventory.equipSpirit(i, ids[0] ?? null);
    });
    g.openPrep('village', 'spirit');
  }, cfg.spirits);
  await wait(800);
  await shot(page, '05_spirit');
  await page.close();
}
// 6) 랭킹 - 가짜 순위표 30명
{
  const page = await open('&rankPlayers=30');
  await page.evaluate(() => {
    const { ranking } = window.__gg;
    ranking.devCompState = 1;
    if (!ranking.isOpen) ranking.open();
    ranking.state.tab = 'comp';
  });
  await wait(800);
  await shot(page, '06_ranking');
  await page.close();
}

// 2단계: 캡션 띠 + 게임 화면 합성(폰트는 게임과 같은 Galmuri11)
const font = readFileSync('assets/fonts/Galmuri11.woff2').toString('base64');
const comp = await browser.newPage({ viewport: { width: OW, height: OH }, deviceScaleFactor: 1 });
for (const [name, caption] of SHOTS) {
  const img = readFileSync(`${RAW}/${name}.png`).toString('base64');
  await comp.setContent(`<!doctype html><style>
    @font-face { font-family: G; src: url(data:font/woff2;base64,${font}); }
    html, body { margin: 0; width: ${OW}px; height: ${OH}px; background: #0d0a10; overflow: hidden; }
    .band { height: ${BAND}px; display: flex; align-items: center; justify-content: center;
      font: ${FONT}px G; color: #f3d77a; letter-spacing: 2px; text-shadow: ${toss ? 2 : 4}px ${toss ? 2 : 4}px 0 #2a0a14;
      border-bottom: ${toss ? 4 : 6}px solid #8a6a2a; box-sizing: border-box; -webkit-font-smoothing: none; }
    img { display: block; width: ${OW}px; height: ${OH - BAND}px; image-rendering: pixelated; }
  </style><div class="band">${caption}</div><img src="data:image/png;base64,${img}">`);
  await comp.evaluate(() => document.fonts.ready);
  await comp.screenshot({ path: `${OUT}/${name}.png` });
}
await browser.close();
console.log('done');
