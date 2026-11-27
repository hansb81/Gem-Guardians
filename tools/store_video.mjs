// 스토어 홍보 영상(세로 1080x1920, 30fps): 가짜 시계로 1/30초씩 진행하며 프레임을 찍고 ffmpeg로 합친다.
// 사용: npx vite --port 5199 를 띄운 뒤 node tools/store_video.mjs [baseUrl]  -> store/video/promo_1080x1920.mp4
// ffmpeg: PATH의 ffmpeg, 없으면 python imageio-ffmpeg의 실행 파일.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5199/';
const TMP = join(tmpdir(), 'gg-store-video');
const OUT_DIR = 'store/video';
const OUT = `${OUT_DIR}/promo_1080x1920.mp4`;
const FPS = 30;
const BAND = 240; // 캡션 띠(1080 기준 px), 스크린샷(tools/store_screenshots.mjs)과 같은 모양
const W = 540, H = (1920 - BAND) / 2; // CSS px, dpr 2
rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

function ffmpegPath() {
  try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); return 'ffmpeg'; } catch {}
  return execFileSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim();
}
const FF = ffmpegPath();
const ff = (args) => execFileSync(FF, ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();

async function open(query = '', { enter = true } = {}) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.clock.install(); // 실시간으로 흐르다가 record()에서 멈추고 한 프레임씩 진행
  await page.goto(`${base}?dev=1${query}`);
  await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
  await page.addStyleTag({ content: 'body > div:not(#banner-slot), body > button { display: none !important; }' }); // 개발 패널·치트 버튼 숨김
  await page.waitForFunction(() => window.__gg.titleScreen.tapReady, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const g = window.__gg;
    g.playerState.tutorial = { ...g.playerState.tutorial, done: true };
    g.playerState.gold = 128450;
    g.playerState.diamonds = 1250;
    g.playerState.ranking.profile.nickname ||= '수호자';
    const { findAnyValidMove } = await import('/src/core/moves.js');
    // 무작위로 고른 가능한 수 하나를 둔다(안정 칸만). 매번 보드 맨 위의 같은 수가 되지 않게 일부 후보를 건너뛴다.
    g.autoMove = () => {
      const gs = g.gameState, b = gs.board;
      const ok = (r1, c1, r2, c2) => b.isCellStable(r1, c1) && b.isCellStable(r2, c2) && !b.occupants[b.index(r1, c1)] && !b.occupants[b.index(r2, c2)];
      const m = findAnyValidMove(b, (...a) => ok(...a) && Math.random() < 0.3) ?? findAnyValidMove(b, ok);
      if (m) gs.trySwap(m.from.row, m.from.col, m.to.row, m.to.col);
    };
  });
  await wait(1500);
  if (enter) {
    await page.keyboard.press('Enter');
    await wait(3500);
  }
  return page;
}

// 전투 진입(층·레벨·정령) 후 실시간으로 소환 연출이 끝날 때까지
async function battle(page, floor, level) {
  await page.evaluate(([floor, level]) => {
    const g = window.__gg;
    g.controller.devSetFloor(floor);
    g.controller.devSetAllTowerLevels(level);
    g.controller.devGrantAllSpirits();
    g.enterGame();
  }, [floor, level]);
  await wait(7000);
}

// 장면 하나를 sec초 동안 프레임 단위로 찍는다. actions = { 프레임번호: async (page) => {} }
const scenes = [];
async function record(page, name, caption, sec, actions = {}) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  const now = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(now + 50);
  const n = Math.round(sec * FPS);
  for (let i = 0; i < n; i++) {
    if (actions[i]) await actions[i](page);
    await page.clock.runFor(1000 / FPS);
    await page.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  await page.clock.resume();
  scenes.push({ name, caption, dir, frames: n });
  console.log(`${name}: ${n} frames`);
}
// every초마다 자동 수(시작 offset초)
const autoplay = (sec, every, offset = 0.2, extra = {}) => {
  const a = { ...extra };
  for (let t = offset; t < sec - 0.5; t += every) a[Math.round(t * FPS)] ??= (p) => p.evaluate(() => window.__gg.autoMove());
  return a;
};

// 1) 타이틀 → 문 열림 → 메뉴
{
  const page = await open('', { enter: false });
  await record(page, '1_title', '잊혀진 지하 신단을 지켜라', 4.5, {
    [Math.round(1.8 * FPS)]: (p) => p.keyboard.press('Enter'),
  });
  // 2) 일반 전투 - 자동 플레이
  await wait(3000);
  await battle(page, 34, 14);
  await page.evaluate(() => { for (const k of ['line', 'bomb']) window.__gg.addSpecial(k); });
  await record(page, '2_battle', '보석을 맞추면 수호자가 공격해요', 6, autoplay(6, 0.8));
  // 3) 특수 잼 조합
  await record(page, '3_combo', '특수 잼 콤보로 싹 쓸어버려요', 5, {
    3: (p) => p.evaluate(() => window.__gg.triggerCombo('bomb', 'line')),
    [Math.round(2.4 * FPS)]: (p) => p.evaluate(() => window.__gg.triggerCombo('color', 'bomb')),
  });
  await page.close();
}
// 4) 보스 - 보스가 걸어 들어올 때까지 실시간으로 기다리며 성벽 앞 적 정리(스크린샷 스크립트와 같은 방법)
{
  const page = await open();
  await battle(page, 40, 16);
  const tidy = () => page.evaluate(() => {
    const g = window.__gg, bs = g.controller.battleState;
    bs.wallHealth = bs.wallMaxHealth;
    const alive = bs.enemies.filter((e) => e.state === 'alive').sort((a, b) => b.progress - a.progress);
    if (alive.length > 3 && alive[0].rank !== 'boss') g.renderer._battleRenderer.devShoot(bs, true);
  });
  for (let i = 0; i < 14; i++) { await wait(1500); await tidy(); }
  await page.evaluate(() => { for (const k of ['bomb', 'line', 'line']) window.__gg.addSpecial(k); });
  await record(page, '4_boss', '10층마다 기다리는 보스', 6, autoplay(6, 0.7, 0.2, {
    [Math.round(3 * FPS)]: (p) => p.evaluate(() => window.__gg.triggerCombo('line', 'line')),
  }));
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
    const order = ['legend', 'epic', 'rare', 'common'];
    g.controller.battleState.towers.forEach((t, i) => {
      const ids = Object.keys(spirits).filter((k) => spirits[k].element === t.color && spirits[k].role !== 'support');
      ids.sort((a, b) => order.indexOf(spirits[a].grade) - order.indexOf(spirits[b].grade));
      g.playerState.inventory.equipSpirit(i, ids[0] ?? null);
    });
    g.openPrep('village', 'spirit');
  }, cfg.spirits);
  await wait(800);
  await record(page, '5_spirit', '정령과 함께 더 강하게', 4);
  await page.close();
}
// 6) 랭킹
{
  const page = await open('&rankPlayers=30');
  await page.evaluate(() => {
    const { ranking } = window.__gg;
    ranking.devCompState = 1;
    if (!ranking.isOpen) ranking.open();
    ranking.state.tab = 'comp';
  });
  await wait(800);
  await record(page, '6_ranking', '매주 펼쳐지는 랭킹 경쟁', 3.5);
  await page.close();
}

// 캡션 띠와 마지막 로고 카드(게임 폰트 Galmuri11, 로고는 타이틀 logo.png 정수배)
const font = readFileSync('assets/fonts/Galmuri11.woff2').toString('base64');
const logo = readFileSync('assets/title/logo.png').toString('base64');
const style = `@font-face { font-family: G; src: url(data:font/woff2;base64,${font}); }
  html, body { margin: 0; background: #0d0a10; overflow: hidden; -webkit-font-smoothing: none; }
  .band { width: 1080px; height: ${BAND}px; display: flex; align-items: center; justify-content: center;
    font: 66px G; color: #f3d77a; letter-spacing: 2px; text-shadow: 4px 4px 0 #2a0a14;
    border-bottom: 6px solid #8a6a2a; box-sizing: border-box; }`;
const comp = await browser.newPage({ viewport: { width: 1080, height: BAND }, deviceScaleFactor: 1 });
for (const s of scenes) {
  await comp.setContent(`<!doctype html><style>${style}</style><div class="band">${s.caption}</div>`);
  await comp.evaluate(() => document.fonts.ready);
  s.band = join(TMP, `${s.name}_band.png`);
  await comp.screenshot({ path: s.band });
}
await comp.setViewportSize({ width: 1080, height: 1920 });
await comp.setContent(`<!doctype html><style>${style}
  .end { width: 1080px; height: 1920px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 80px; }
  img { width: 912px; image-rendering: pixelated; }
  p { margin: 0; font: 60px G; color: #f3d77a; text-shadow: 4px 4px 0 #2a0a14; }</style>
  <div class="end"><img src="data:image/png;base64,${logo}"><p>지금 탑의 수호자가 되세요</p></div>`);
await comp.evaluate(() => document.fonts.ready);
const endCard = join(TMP, 'end.png');
await comp.screenshot({ path: endCard });
await browser.close();

// 장면별 mp4(캡션 띠 + 게임 화면) → 이어 붙이기 → BGM
const parts = [];
for (const s of scenes) {
  const part = join(TMP, `${s.name}.mp4`);
  ff(['-framerate', String(FPS), '-i', join(s.dir, '%04d.jpg'), '-i', s.band,
    '-filter_complex', '[1:v][0:v]vstack=inputs=2,scale=out_range=tv,format=yuv420p[v]', '-map', '[v]',
    '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', '-r', String(FPS), part]);
  parts.push(part);
}
const endPart = join(TMP, 'end.mp4');
ff(['-loop', '1', '-framerate', String(FPS), '-t', '2.5', '-i', endCard,
  '-vf', `scale=out_range=tv,format=yuv420p,fade=t=in:st=0:d=0.4`, '-c:v', 'libx264', '-crf', '18', '-r', String(FPS), endPart]);
parts.push(endPart);
const list = join(TMP, 'list.txt');
writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
const silent = join(TMP, 'silent.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
const dur = scenes.reduce((a, s) => a + s.frames / FPS, 0) + 2.5;
ff(['-i', silent, '-i', 'assets/audio/bgm/bgm_battle.mp3',
  '-filter_complex', `[1:a]atrim=0:${dur},afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, dur - 2)}:d=2[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT]);
console.log(`done ${OUT} (${dur.toFixed(1)}s)`);
