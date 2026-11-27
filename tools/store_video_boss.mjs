// 홍보 영상 - 보스·이펙트 편(세로 1080x1920, 30fps). tools/store_video.mjs와 같은 방식(가짜 시계로 한 프레임씩 찍고 ffmpeg로 합침).
// 보스 층(20·50·80·100)마다: 소환 연출 뒤 가짜 시계를 빨리 감아 보스가 화면 안쪽까지 걸어 들어오게 하고(앞의 졸개는 정리),
// 거기서부터 자동 수 + 특수 잼 조합을 연달아 터뜨리며 찍는다. 마지막 보스는 끝에 쓰러뜨린다.
// 사용: npx vite --port 5199 를 띄운 뒤 node tools/store_video_boss.mjs [baseUrl] -> store/video/promo_boss_1080x1920.mp4
// shortcut: store_video.mjs와 브라우저·합성 부분이 겹친다 - 영상 스크립트가 하나 더 생기면 공용 모듈로 뺀다.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const base = process.argv[2] ?? 'http://localhost:5199/';
const TMP = join(tmpdir(), 'gg-store-video-boss');
const OUT_DIR = 'store/video';
const OUT = `${OUT_DIR}/promo_boss_1080x1920.mp4`;
const FPS = 30;
const BAND = 240;
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
const at = (sec) => Math.round(sec * FPS);

const browser = await chromium.launch();

async function open() {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.clock.install();
  await page.goto(`${base}?dev=1`);
  await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
  await page.addStyleTag({ content: 'body > div:not(#banner-slot), body > button { display: none !important; }' });
  await page.waitForFunction(() => window.__gg.titleScreen.tapReady, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const g = window.__gg;
    g.playerState.tutorial = { ...g.playerState.tutorial, done: true };
    g.playerState.gold = 128450;
    g.playerState.diamonds = 1250;
    const { findAnyValidMove } = await import('/src/core/moves.js');
    g.autoMove = () => {
      const gs = g.gameState, b = gs.board;
      const ok = (r1, c1, r2, c2) => b.isCellStable(r1, c1) && b.isCellStable(r2, c2) && !b.occupants[b.index(r1, c1)] && !b.occupants[b.index(r2, c2)];
      const m = findAnyValidMove(b, (...a) => ok(...a) && Math.random() < 0.3) ?? findAnyValidMove(b, ok);
      if (m) gs.trySwap(m.from.row, m.from.col, m.to.row, m.to.col);
    };
    const bs = () => g.controller.battleState;
    g.boss = () => bs().enemies.find((e) => e.rank === 'boss' && e.state === 'alive') ?? null;
    // 성벽 채우고, 맨 앞이 보스가 아니면 그 졸개를 수호자 탄으로 처치
    g.tidy = () => {
      const s = bs();
      s.wallHealth = s.wallMaxHealth;
      const front = s.enemies.filter((e) => e.state === 'alive').sort((a, b) => b.progress - a.progress)[0];
      if (front && front.rank !== 'boss') g.renderer._battleRenderer.devShoot(s, true);
    };
  });
  await wait(1500);
  await page.keyboard.press('Enter');
  await wait(3500);
  return page;
}

// 보스 층 진입 -> 소환 연출(실시간) -> 가짜 시계 빨리 감기: 보스가 progress만큼 들어올 때까지 졸개 정리.
async function bossFloor(page, floor, level, progress = 0.45) {
  await page.evaluate(([floor, level]) => {
    const g = window.__gg;
    g.controller.devSetFloor(floor);
    g.controller.devSetAllTowerLevels(level);
    g.controller.devGrantAllSpirits();
    g.enterGame();
  }, [floor, level]);
  await wait(7000);
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 50);
  for (let i = 0; i < 600; i++) {
    await page.clock.runFor(250);
    const p = await page.evaluate(() => (window.__gg.tidy(), window.__gg.boss()?.progress ?? -1));
    if (p >= progress) break;
  }
  // 남은 졸개 마저 정리 + 화면에 특수 잼 몇 개
  for (let i = 0; i < 12; i++) {
    await page.clock.runFor(250);
    await page.evaluate(() => window.__gg.tidy());
  }
  await page.evaluate(() => {
    for (const k of ['bomb', 'line', 'line', 'bomb']) window.__gg.addSpecial(k);
    const s = window.__gg.controller.battleState;
    s.wallHealth = s.wallMaxHealth;
  });
  await page.clock.resume();
  await wait(300);
  const hp = await page.evaluate(() => window.__gg.boss()?.currentHealth ?? null);
  console.log(`floor ${floor}: boss ${hp == null ? '없음' : `HP ${Math.round(hp)}`}`);
}

const scenes = [];
async function record(page, name, caption, sec, actions = {}) {
  const dir = join(TMP, name);
  mkdirSync(dir, { recursive: true });
  await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 50);
  const n = at(sec);
  for (let i = 0; i < n; i++) {
    if (actions[i]) await actions[i](page);
    if (i % 15 === 0) await page.evaluate(() => { const s = window.__gg.controller.battleState; s.wallHealth = Math.max(s.wallHealth, s.wallMaxHealth * 0.7); });
    await page.clock.runFor(1000 / FPS);
    await page.screenshot({ path: join(dir, `${String(i).padStart(4, '0')}.jpg`), type: 'jpeg', quality: 92 });
  }
  await page.clock.resume();
  scenes.push({ name, caption, dir, frames: n });
  console.log(`${name}: ${n} frames`);
}
const combo = (a, b) => (p) => p.evaluate(([a, b]) => window.__gg.triggerCombo(a, b), [a, b]);
// every초마다 자동 수 + 정해 둔 조합(같은 프레임이면 조합 우선)
const play = (sec, every, combos = {}) => {
  const a = {};
  for (const [t, [x, y]] of Object.entries(combos)) a[at(Number(t))] = combo(x, y);
  for (let t = 0.2; t < sec - 0.4; t += every) a[at(t)] ??= (p) => p.evaluate(() => window.__gg.autoMove());
  return a;
};
const killBoss = (p) => p.evaluate(() => {
  const g = window.__gg, s = g.controller.battleState, b = g.boss();
  if (!b) return;
  for (const e of s.enemies) if (e.state === 'alive' && e !== b) e.progress = Math.min(e.progress, b.progress - 0.01); // 보스가 맨 앞
  g.renderer._battleRenderer.devShoot(s, true);
});

// 1) 여는 장면: 무지개+무지개
{
  const page = await open();
  await bossFloor(page, 20, 10);
  await record(page, '1_boss20', '10층마다 거대한 보스가 나타나요', 6,
    play(6, 0.7, { 0.3: ['color', 'color'], 2.6: ['line', 'bomb'], 4.4: ['bomb', 'bomb'] }));
  await bossFloor(page, 50, 20);
  await record(page, '2_boss50', '특수 잼 조합으로 한 방에!', 5.5,
    play(5.5, 0.7, { 0.3: ['bomb', 'color'], 2.4: ['box', 'bomb'], 4.2: ['line', 'line'] }));
  await page.close();
}
{
  const page = await open();
  await bossFloor(page, 80, 30);
  await record(page, '3_boss80', '깊이 내려갈수록 강해지는 적', 5.5,
    play(5.5, 0.7, { 0.3: ['line', 'color'], 2.3: ['box', 'box'], 4.1: ['bomb', 'line'] }));
  await bossFloor(page, 100, 38);
  await record(page, '4_boss100', '100층의 거대 악마를 쓰러뜨려라', 7,
    { ...play(7, 0.6, { 0.3: ['color', 'color'], 2.2: ['box', 'color'], 3.8: ['bomb', 'bomb'], 5.0: ['line', 'bomb'] }), [at(5.6)]: killBoss });
  await page.close();
}

// 캡션 띠 + 로고 카드(store_video.mjs와 같은 모양)
const font = readFileSync('assets/fonts/Galmuri11.woff2').toString('base64');
const logo = readFileSync('assets/title/logo.png').toString('base64');
const style = `@font-face { font-family: G; src: url(data:font/woff2;base64,${font}); }
  html, body { margin: 0; background: #0d0a10; overflow: hidden; -webkit-font-smoothing: none; }
  .band { width: 1080px; height: ${BAND}px; display: flex; align-items: center; justify-content: center;
    font: 60px G; color: #f3d77a; letter-spacing: 2px; text-shadow: 4px 4px 0 #2a0a14;
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
  '-vf', 'scale=out_range=tv,format=yuv420p,fade=t=in:st=0:d=0.4', '-c:v', 'libx264', '-crf', '18', '-r', String(FPS), endPart]);
parts.push(endPart);
const list = join(TMP, 'list.txt');
writeFileSync(list, parts.map((p) => `file '${p.replace(/\\/g, '/')}'`).join('\n'));
const silent = join(TMP, 'silent.mp4');
ff(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', silent]);
const dur = scenes.reduce((a, s) => a + s.frames / FPS, 0) + 2.5;
ff(['-i', silent, '-i', 'assets/audio/bgm/bgm_boss.mp3',
  '-filter_complex', `[1:a]atrim=0:${dur},afade=t=in:d=0.5,afade=t=out:st=${Math.max(0, dur - 2)}:d=2[a]`,
  '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT]);
console.log(`done ${OUT} (${dur.toFixed(1)}s)`);
