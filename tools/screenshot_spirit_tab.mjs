// 수호의 제단 정령 탭(무대 5칸 + 정보 카드 + 스크롤 목록) 확인 스크린샷 + 끌기/터치 동작 확인.
// 사용: npx vite --port 5199 를 띄운 뒤 node tools/screenshot_spirit_tab.mjs [baseUrl]  -> preview/spirit-tab/*.png
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const base = process.argv[2] ?? 'http://localhost:5199/';
const out = 'preview/spirit-tab';
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

async function open(width, height) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(`${base}?dev=1`);
  await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
  await page.addStyleTag({ content: 'body > div:not(#banner-slot) { display: none !important; }' }); // 개발 패널 숨김
  await page.waitForFunction(() => window.__gg.titleScreen.tapReady, null, { timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  // 전부 보유 + 첫 수호자에 같은 속성 정령 하나(공명), 나머지 칸은 비움.
  await page.evaluate(() => {
    const g = window.__gg;
    const inv = g.playerState.inventory;
    g.playerState.tutorial = { ...g.playerState.tutorial, done: true };
    g.controller.devGrantAllSpirits();
    for (let i = 0; i < 5; i++) inv.equipSpirit(i, null);
    g.openPrep('village', 'spirit');
  });
  await page.waitForTimeout(400);
  return page;
}

// 터치 사각형(basis) 가운데의 화면 좌표.
const point = (page, type, pick = '() => true', fy = 0.5) =>
  page.evaluate(([ty, fn, fy]) => {
    const L = window.__gg.renderer.prepLayout;
    const h = (L.spiritHits ?? []).find((x) => x.hit.type === ty && eval(fn)(x.hit));
    if (!h) return null;
    const f = document.querySelector('canvas').getBoundingClientRect();
    const u = f.u ?? 1;
    return { x: f.left + (h.r.x + h.r.width / 2) * L.scale * u, y: f.top + (h.r.y + h.r.height * fy) * L.scale * u };
  }, [type, pick, fy]);
const tap = async (page, type, pick) => {
  const p = await point(page, type, pick);
  if (!p) throw new Error(`hit 없음: ${type}`);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
};
for (const [name, w, h] of [['', 540, 960], ['small_', 360, 640]]) {
  const page = await open(w, h);
  // 1) 첫 수호자 색과 같은 속성 정령을 장착(공명). 전부 보유라 목록은 30칸.
  // 속성은 설정에서 읽는다(런타임 객체 경로에 기대지 않게).
  const cfg = await (await fetch(`${base}config/spirits.json`)).json();
  const color0 = await page.evaluate(() => window.__gg.controller.battleState.towers[0].color);
  const id = Object.keys(cfg.spirits).find((k) => cfg.spirits[k].element === color0);
  await page.evaluate((id) => window.__gg.playerState.inventory.equipSpirit(0, id), id);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${name}1_equipped_resonance.png` });
  if (name) { // 작은 화면은 1장
    await page.close();
    continue;
  }

  // 2) 빈 칸 선택
  await tap(page, 'spiritSlot', '(h) => h.index === 2');
  await page.screenshot({ path: `${out}/2_empty_selected.png` });

  // 3) 끌기: 목록 가운데에서 위로 120px -> 스크롤만 되고 상세는 안 열린다.
  const p = await point(page, 'spiritList');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x, p.y - 60, { steps: 4 });
  await page.mouse.move(p.x, p.y - 120, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  assert.ok(await point(page, 'spiritList'), '끌고 나면 목록 그대로(상세 안 열림)');
  assert.equal(await point(page, 'spiritBack'), null);
  // 휠로 맨 아래까지
  await page.mouse.wheel(0, 5000);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${out}/3_scrolled_bottom.png` });
  // 그냥 누르면 상세가 열리고, 닫으면 스크롤 위치 그대로(맨 아래 = 같은 화면).
  await tap(page, 'spiritItem');
  assert.ok(await point(page, 'spiritBack'), '터치 = 상세');
  await page.screenshot({ path: `${out}/4_detail.png` });
  await tap(page, 'spiritBack');
  await page.screenshot({ path: `${out}/5_back_same_scroll.png` });
  // 카드의 "해제"
  await tap(page, 'spiritSlot', '(h) => h.index === 0');
  await tap(page, 'spiritEquip', '(h) => h.id === null');
  assert.equal(await page.evaluate(() => window.__gg.playerState.inventory.spiritSlots()[0] ?? null), null, '해제됨');
  await page.close();
}
await browser.close();
console.log('ok');
