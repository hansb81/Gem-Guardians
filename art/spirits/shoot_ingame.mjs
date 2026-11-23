// in_game.png용 전투 화면 스크린샷 + 수호자 발 위치(화면 픽셀). 사용: 저장소 루트에서 python serve.py 8000 띄운 뒤
// node art/spirits/shoot_ingame.mjs  ->  art/spirits/preview/_battle.png, _feet.json (합성은 compose_ingame.py)
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const D = 3;
const browser = await chromium.launch();
const errors = [];
const page = await browser.newPage({ viewport: { width: 360, height: 780 }, deviceScaleFactor: D });
page.on('pageerror', (e) => errors.push(e.message));
page.on('response', (r) => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
await page.goto('http://localhost:8000/?dev=1');
await page.waitForFunction(() => window.__gg, null, { timeout: 30000 });
await page.addStyleTag({ content: 'body > div:not(#banner-slot) { display: none !important; }' }); // 개발 패널 숨김
await page.waitForTimeout(2500);
await page.keyboard.press('Enter');
await page.waitForTimeout(3500);
await page.evaluate(() => {
  window.__gg.enterGame();
  const br = window.__gg.renderer._battleRenderer;
  const orig = br._drawTowers;
  br._drawTowers = function (ctx, towerArea, towers, assets, ...rest) {
    const { frameW, frameH } = this._towerFrameSize(assets, towerArea);
    const m = ctx.getTransform();
    const k = devicePixelRatio; // 캔버스 픽셀 = 스크린샷 픽셀(백킹이 화면 전체에 1:1)
    window.__feet = this._computeTowerFootPositions(towerArea, frameH).map((f, i) => ({
      color: towers[i].color,
      x: (m.a * f.x + m.e) / k, y: (m.d * f.y + m.f) / k,
      frameW: (frameW * m.a) / k, frameH: (frameH * m.d) / k,
      scale: ((assets.towerAnims?.get(`tower_idle_${towers[i].color}`)?.drawScale ?? 0) * m.a) / k,
    }));
    return orig.call(this, ctx, towerArea, towers, assets, ...rest);
  };
});
await page.waitForTimeout(4000); // 소환 연출이 끝날 때까지
await page.evaluate(() => { const t = window.__gg.tutorial; if (t) { t.openSkip(); t.confirmSkip(); } }); // 튜토리얼(소환 뒤에 생긴다)이 화면을 어둡게 가린다
await page.waitForTimeout(2500);
await page.screenshot({ path: 'art/spirits/preview/_battle.png' });
const feet = await page.evaluate(() => window.__feet);
writeFileSync('art/spirits/preview/_feet.json', JSON.stringify({ dpr: D, feet }, null, 1));
console.log(JSON.stringify(feet));
// 로더 확인 + 정령 탭·상점 정령 줄(아직 잠금 화면)
console.log('spirits', JSON.stringify(await page.evaluate(() => {
  const a = window.__gg.renderer.assets;
  return { ids: Object.keys(a?.spiritManifest?.spirits ?? {}).length, loaded: !!a?.spiritSheet?.loaded, size: [a?.spiritSheet?.img.naturalWidth, a?.spiritSheet?.img.naturalHeight],
    portraits: [a?.spiritPortraitSheet?.img.naturalWidth, a?.spiritPortraitSheet?.img.naturalHeight], portraitIds: Object.keys(a?.spiritManifest?.portraits ?? {}).length,
    stone: [a?.uiImages?.get('icons/spirit_stone.png')?.img?.naturalWidth, !!a?.uiImages?.get('icons/spirit_stone.png')?.loaded] };
})));
await page.evaluate(() => window.__gg.openPrep('village', 'spirit'));
await page.waitForTimeout(800);
await page.screenshot({ path: 'art/spirits/preview/shot_spirit_tab.png' });
await page.evaluate(() => window.__gg.enterShop('spirit'));
await page.waitForTimeout(1500);
await page.screenshot({ path: 'art/spirits/preview/shot_shop_spirit.png' });
console.log('errors', JSON.stringify(errors));
await browser.close();
