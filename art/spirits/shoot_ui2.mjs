// 정령 화면 추가 확인(F 판정): 짧은 화면 30종 / 소급 지급 알림 / 영어 / 결계·모래시계 상태 아이콘.
// 사용: 저장소 루트에서 python serve.py 8000 띄운 뒤 node art/spirits/shoot_ui2.mjs -> art/spirits/preview/ui2_*.png
import { chromium } from 'playwright';

const OUT = 'art/spirits/preview';
const browser = await chromium.launch();
const errors = [];
const SPIRITS5 = ['fire_wisp', 'snow_fairy', 'copper_squirrel', 'seedling', 'bone_crow'];
// bestFloor 37인 옛 저장(v3, 정령 없음): 10·20·30층 보스 정령을 소급 지급받아야 한다.
const OLD_SAVE = {
  saveVersion: 3, gold: 5000, diamonds: 0, floor: 37, bestFloor: 37, towerLevels: [20, 20, 20, 20, 20], tutorial: { done: true, version: 1 },
  inv: { items: { hammer: 2 }, loadout: { hotbar: ['hammer', null, null, null], pendingHotbar: null, preFloor: {} }, perm: { skills: {}, flags: [] }, grantedTx: ['boss:10', 'boss:20', 'boss:30'], log: [] },
};

async function open({ width = 360, height = 780, store = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 3 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // 저장은 게임이 뜨기 전에 한 번만 심는다(뜬 뒤에 쓰면 게임이 자기 저장으로 덮어쓴다). dataEpoch가 맞아야 안 지워진다.
  if (store) {
    await ctx.addInitScript((s) => {
      if (localStorage.getItem('__seeded')) return;
      localStorage.setItem('__seeded', '1');
      localStorage.setItem('dataEpoch', '1');
      for (const [k, v] of Object.entries(s)) localStorage.setItem(k, JSON.stringify(v));
    }, store);
  }
  await page.goto('http://localhost:8000/?dev=1');
  await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
  await start(page, false);
  return page;
}

// 타이틀 -> 메뉴. reload면 저장을 다시 읽게 새로 고친다.
async function start(page, reload) {
  if (reload) {
    await page.waitForTimeout(800); // 저장 flush(300ms 디바운스)
    await page.goto('http://localhost:8000/?dev=1');
    await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
  }
  await page.addStyleTag({ content: 'body > div:not(#banner-slot) { display: none !important; }' }); // 개발 패널 숨김
  await page.waitForTimeout(2500);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
}

const shot = (page, name) => page.screenshot({ path: `${OUT}/ui2_${name}.png` });
const tap = async (page, type, pick = '() => true') => {
  const p = await page.evaluate(([ty, fn]) => {
    const L = window.__gg.renderer.prepLayout;
    const h = (L.spiritHits ?? []).find((x) => x.hit.type === ty && eval(fn)(x.hit));
    if (!h) return null;
    const f = document.querySelector('canvas').getBoundingClientRect();
    return { x: f.left + (h.r.x + h.r.width / 2) * L.scale * f.u, y: f.top + (h.r.y + h.r.height / 2) * L.scale * f.u };
  }, [type, pick]);
  if (!p) throw new Error(`hit 없음: ${type}`);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(300);
};
const grantAll = (page) => page.evaluate((ids) => {
  const g = window.__gg;
  g.playerState.tutorial = { ...g.playerState.tutorial, done: true };
  g.controller.devGrantAllSpirits();
  g.controller.devAddSpiritStones(50);
  g.playerState.addGold(50000);
  ids.forEach((id, i) => g.playerState.inventory.equipSpirit(i, id));
}, SPIRITS5);
const noticeState = (page) => page.evaluate(() => {
  const inv = window.__gg.playerState.inventory;
  return { notice: inv.data.pendingSpiritNotice.length, spirits: Object.keys(inv.data.perm.spirits), stones: inv.spiritStones, tx: inv.data.grantedTx.filter((x) => x.startsWith('boss-spirit')) };
});

// ---- A. 짧은 화면(540x960 비율) + 30종 ----
{
  const page = await open({ width: 360, height: 640 });
  await grantAll(page);
  await page.evaluate(() => window.__gg.openPrep('village', 'spirit'));
  await page.waitForTimeout(600);
  await shot(page, 'short_tab');
  await tap(page, 'spiritItem', '(h) => h.id === "ice_owl"');
  await shot(page, 'short_detail');
  await page.context().close();
}

// ---- B. 소급 지급 알림: bestFloor 37 옛 저장 -> 한 번 뜨고, 다시 켜면 안 뜬다 ----
{
  const page = await open({ store: { 'gemGuardians.save.v2': OLD_SAVE } });
  await page.waitForTimeout(1500);
  await shot(page, 'retro_first');
  console.log('retro 1', JSON.stringify(await noticeState(page)));
  await start(page, true);
  await page.waitForTimeout(1500);
  await shot(page, 'retro_second');
  console.log('retro 2', JSON.stringify(await noticeState(page)));
  await page.context().close();
}

// ---- C. 영어: 알림 팝업 / 정령 탭 / 상세 / 도감 ----
{
  const page = await open({ store: { 'gemGuardians.save.v2': OLD_SAVE, locale: 'en' } });
  await page.waitForTimeout(1500);
  await shot(page, 'en_retro');
  // 획득 팝업은 카드 밖을 누르면 닫힌다.
  const f = await page.evaluate(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: r.left + 6, y: r.top + 6 }; });
  await page.mouse.click(f.x, f.y);
  await page.waitForTimeout(300);
  await grantAll(page);
  await page.evaluate(() => window.__gg.openPrep('village', 'spirit'));
  await page.waitForTimeout(600);
  await shot(page, 'en_tab');
  await tap(page, 'spiritSlot', '(h) => h.index === 3');
  await tap(page, 'spiritItem', '(h) => h.id === "lava_turtle"'); // 가장 긴 효과 문구(수호)
  await shot(page, 'en_detail');
  await page.evaluate(() => { window.__gg.back(); window.__gg.enterShop('spirit'); });
  await page.waitForTimeout(1500);
  for (const id of ['sup_clock', 'lava_turtle']) {
    const cell = await page.evaluate((sid) => {
      const s = window.__gg.shopScreen;
      const row = s.entries.find((r) => r.e.spirit === sid);
      const r = s._screenRect([row.x + 10, 104 + row.y - s.scroll + 10, 1, 1]);
      const f = document.querySelector('canvas').getBoundingClientRect();
      return { x: f.left + r.x * f.u, y: f.top + r.y * f.u };
    }, id);
    await page.mouse.click(cell.x, cell.y);
    await page.waitForTimeout(400);
    await shot(page, `en_shop_${id}`);
  }
  await page.context().close();
}

// ---- D. 결계·모래시계 상태 아이콘 + 오른쪽 줄 정령 ----
{
  const page = await open();
  await grantAll(page);
  await page.evaluate(() => {
    const g = window.__gg;
    g.enterGame();
    g.controller.devSetFloor(1);
  });
  await page.waitForTimeout(7000);
  await page.evaluate(() => {
    const bs = window.__gg.controller.battleState;
    bs.wallShieldSec = 8; // 결계
    bs.freezeEnemies(5, 1); // 모래시계
  });
  await page.waitForTimeout(400);
  await shot(page, 'status_icons');
  await page.context().close();
}
console.log('errors', JSON.stringify(errors));
await browser.close();
