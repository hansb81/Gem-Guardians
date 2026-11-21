// 저주받은 수정 광산 화면(docs/mine.md 15장 - 시안 C, mockups/mine.html). 좌표는 전부 540x960("basis")이고
// 상점(shopScreen.js)과 같은 방식으로 캔버스에 맞춘다. 광산 그림(assets/mine)은 네이티브 x3, UI 팩은 x2.
// 규칙·수치는 전부 src/core/mine/mine.js가 정하고 여기서는 그리기·입력·연출만 한다.
import { ShopScreen } from './shopScreen.js';
import { drawDamage, getUiFont, uiReady } from './uiKit.js';
import { loadImage } from './assetLoader.js';
import { drawImageSnapped, screen } from './screenFit.js';
import { t } from '../config/i18n.js';
import { audio } from '../audio/AudioManager.js';
import { createRng } from '../core/rng.js';
import { ITEM_CAP } from '../core/inventory/inventory.js';
import {
  veinRate, veinCost, maxVeinLevel, nextMaxLevelFloor, capHours, ratePerHour, capacity, cartAt, hoursToFull, cartState, settle, rolloverDay,
  harvest, upgradeVein, upgradeStorage, buyBigStorage, refineGold, refineItem, boost, nextGoldCost, pouchGold, upgradeBlocksGold,
  goldNeedsConfirm, dailyLeft, boostAmount, syncUnlocks, kstDate, hasBadge,
} from '../core/mine/mine.js';

const NATIVE_W = 180;
const NATIVE_H = 320;
const DRAW_SCALE = 3;
const BASIS_H = 960;
const DIR = 'assets/mine/';
const HOUR_MS = 3600e3;

const C = { outline: '#0d0a10', bg1: '#221c2b', bg3: '#655a74', bone: '#e8dcc0', dim: '#a59cb2', goldL: '#f2d264', gold: '#c28a20', grnL: '#9cd872', redL: '#ec6a6a' };
// 광맥의 가장 밝은 색(곡괭이 불꽃) - config/mine.json veins 순서.
const VEIN_BRIGHT = { emerald: '#9cd872', sapphire: '#8cc4ee', topaz: '#f2d264', ruby: '#ec6a6a', amethyst: '#c48ce6' };

// 배치(basis px) - mockups/mine.html 시안 C 그대로.
const TOP = [8, 20, 524, 100];
const BACK = [16, 28, 48, 48];
const ORE_BOX = [400, 34, 120, 36];
const ROW = { y: 124, h: 96, slot: [12, 12, 72], textX: 94, btn: [396, 16, 132, 64] };
const WORK = [0, 604, 540, 357];
const REFINERY = [12, 631, 249, 180];
const FIRE = { x: 87, y: 721, w: 57, h: 45, frames: 4, ms: 160 };
const CART = [276, 631, 252, 180];
const SPARKLE = { at: [[84, 12], [132, 3], [171, 21]], size: 21, ms: 350 };
const QUICK = [12, 824, 250, 64];
const STORE = [270, 824, 125, 64];
const BOOST = [403, 824, 125, 64];
const TOAST = [40, 426, 460];
const TOAST_POPUP_Y = 740;
const POP_WIDE = { x: 12, w: 516 };
const POP_SM = { x: 40, w: 460 };
const POP_BORDER = 32;
const GUARD_MS = 2000; // "한 번 더 탭" 유지 시간
const HOLD = { firstMs: 300, intervalMs: 150, minMs: 50, accel: 0.85 }; // 기존 강화 팝업(main.js upgradeHold)과 같은 간격
// 수확 연출(basis px, ms): 수레 눌림, 조각 튀어 오름, "+받은 양" 숫자, 상단 숫자 오름 + 테두리 깜빡임
const HARVEST = { pressMs: 120, pressPx: 2, max: 8, popMs: 350, gapMs: 15, numMs: 600, numRise: 20, countMs: 400, blinkMs: 150 };
const SPARK = { minMs: 2000, maxMs: 3000, lifeMs: 450, max: 5 };
const GUIDE_KEYS = ['guide1', 'guide2', 'guide3'];

const inRect = (x, y, r) => !!r && x >= r[0] && x < r[0] + r[2] && y >= r[1] && y < r[1] + r[3];
const fmt = (n) => Math.floor(n).toLocaleString('en-US');
const fmtRate = (x) => (x >= 100 ? fmt(Math.round(x)) : x.toFixed(1));
const fmtHours = (h) => `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
const stageOf = (lv) => (lv <= 5 ? 0 : lv <= 15 ? 1 : 2); // 수정 그림 단계(Lv1~5 / 6~15 / 16+)

export class MineScreen {
  constructor() {
    this.env = null; // { cfg, player, save(), floorGold(), serverToday(), itemIcons(), guide, canAd(), adFree(), watchAd() }
    this.popup = null; // null | 'ref' | 'store' | 'boost'
    this.tab = 'gold';
    this.toast = null; // { msg, lines, until, action: [label, 돌려줄 값] | null }
    this._badge = false;
    this._badgeAt = 0;
    this._adBusy = false;
    this.armed = null; // 'up0'..'up4' | 'gold' - 한 번 더 누르면 실행
    this._armedUntil = 0;
    this.hold = null; // { index, nextMs, intervalMs } - 강화 버튼 꾹 누르기
    this._saveLater = false;
    this.guide = -1; // 첫 진입 안내 단계(0~2), 아니면 -1
    this.devOffsetMs = 0; // 개발용 시간 앞당기기
    this.v = null; // 화면에 그릴 값(1초마다·행동 뒤에만 다시 만든다 - 매 프레임 문자열을 만들지 않는다)
    this._imgs = null;
    this._pressed = null;
    this._transform = null;
    this._assets = null;
    this._tickAt = 0;
    this._pb = {}; // 팝업 버튼 사각형(그릴 때 채우고 터치 판정이 읽는다)
    this._ctxObj = { now: 0, pass: false, bestFloor: 1, today: null, R: 0, inventory: null };
    this._rng = createRng(20261121); // 연출용(불꽃 간격·방향)
    this._fly = { t0: -1e9, n: 0, gain: '', dx: new Float32Array(HARVEST.max), h: new Float32Array(HARVEST.max) };
    this._oreAnim = { from: 0, to: 0, t0: -1e9 };
    this._sparks = []; // 광맥마다 { nextAt, t0, n, vx[], vy[] }
    this._rowBtns = [];
  }

  setEnv(env) {
    this.env = env;
    this._sparks = env.cfg.veins.map(() => ({ nextAt: 0, t0: -1e9, n: 0, vx: new Float32Array(SPARK.max), vy: new Float32Array(SPARK.max) }));
  }

  get ready() {
    return !!this.env && this.env.player.mine.unlocked;
  }

  // 광산에 들어올 때. 그림은 처음 열 때 한 번만 읽는다.
  open() {
    if (!this._imgs) {
      this._imgs = new Map();
      const names = ['workshop', 'refinery', 'refinery_fire', 'cart', 'cart_sparkle', 'row_locked'];
      for (const v of this.env.cfg.veins) names.push(`row_${v.id}`, `crystals_${v.id}`);
      for (const n of names) loadImage(`${DIR}${n}.png`).then((s) => this._imgs.set(n, s));
    }
    this.popup = null;
    this.toast = null;
    this.armed = null;
    this.hold = null;
    this._ctxObj.R = this.env.floorGold();
    const mine = this.env.player.mine;
    this.guide = mine.tutorialDone ? -1 : 0;
    this._settle();
    this._oreAnim.from = this._oreAnim.to = mine.ore;
  }

  // 메인 메뉴 빨간 점(수레 80% 이상 / 골드 주머니를 살 수 있음) - 1초마다 다시 계산.
  menuBadge() {
    const now = Date.now();
    if (now - this._badgeAt >= 1000) {
      this._badgeAt = now;
      this._ctxObj.R = this.env.floorGold();
      this._badge = hasBadge(this.env.cfg, this.env.player.mine, this._lctx());
    }
    return this._badge;
  }

  // mine.js에 넘기는 ctx(객체 하나를 재사용). 서버 날짜가 있으면 그것이 우선(16-1).
  _lctx() {
    const c = this._ctxObj;
    const p = this.env.player;
    c.now = Date.now() + this.devOffsetMs;
    c.pass = p.hasMonthlyPass();
    c.bestFloor = p.bestFloor;
    c.today = this.env.serverToday?.() ?? (this.devOffsetMs ? kstDate(c.now) : null);
    c.inventory = p.inventory;
    return c;
  }

  // 정산 + 화면 값 갱신. 1초마다, 백그라운드에서 돌아왔을 때, 들어올 때.
  _settle() {
    const c = this._lctx();
    settle(this.env.cfg, this.env.player.mine, c.now, c.pass);
    this._tickAt = Date.now();
    this._refresh();
  }

  onResume() {
    if (this.ready) this._settle();
  }

  // 화면에 그릴 문자열·상태를 한 번에 만든다.
  _refresh() {
    const { cfg, player } = this.env;
    const mine = player.mine;
    const c = this._lctx();
    const { now, pass } = c;
    const cap = capacity(cfg, mine, pass);
    const cart = cartAt(cfg, mine, now, pass);
    const left = dailyLeft(cfg, mine, c);
    const maxLv = maxVeinLevel(cfg, c.bestFloor);
    const pouch = nextGoldCost(cfg, mine, c);
    const gold = pouchGold(cfg, c.R);
    const full = cart >= cap;
    const storeMax = mine.storageLv >= cfg.storage.hours.length;
    const diaCost = cfg.diaBoost.costs[cfg.diaBoost.costs.length - left.dia];
    this.v = {
      ore: mine.ore,
      rate: t('mine.perHour', { n: fmtRate(ratePerHour(cfg, mine, pass)) }),
      passPct: pass ? `+${Math.round(cfg.passBonus.monthly * 100)}%` : null,
      storeLabel: `${t('mine.store')} Lv${mine.storageLv}${mine.bigStorage ? '★' : ''}`,
      fill: cap > 0 ? Math.min(1, cart / cap) : 0,
      full,
      fullText: full ? t('mine.full') : t('mine.fullIn', { t: fmtHours(hoursToFull(cfg, mine, now, pass)) }),
      capText: t('mine.capH', { h: capHours(cfg, mine) }),
      cart: Math.floor(cart),
      cartState: cartState(cfg, mine, now, pass),
      veins: cfg.veins.map((vn, i) => {
        const lv = mine.veins[i];
        if (!(lv > 0)) return { id: vn.id, locked: true, name: `${i + 1}. ${t(`mine.vein.${vn.id}`)}`, boss: t('mine.boss', { floor: vn.unlockBossFloor }) };
        const max = lv >= maxLv;
        const cost = veinCost(cfg, lv);
        return {
          id: vn.id, locked: false, name: `${i + 1}. ${t(`mine.vein.${vn.id}`)}`, stage: stageOf(lv), lv: `Lv ${lv}`, maxLv: ` / ${maxLv}`,
          rate: `${fmtRate(veinRate(cfg, lv))}/h`, next: max ? null : fmtRate(veinRate(cfg, lv + 1)), max, cost: fmt(cost), ok: mine.ore >= cost,
          maxAt: max ? t('mine.maxAt', { floor: nextMaxLevelFloor(cfg, c.bestFloor) }) : null,
          maxAt2: max ? t('mine.maxAt2', { floor: nextMaxLevelFloor(cfg, c.bestFloor) }) : null,
        };
      }),
      sign: `${t('mine.tabGold')} ${left.gold}/${cfg.gold.perDay} · ${t('mine.tabItem')} ${left.items}/${cfg.items.perDay}`,
      left,
      pouch,
      pouchOk: pouch != null && mine.ore >= pouch,
      pouchShort: pouch != null ? t('mine.short', { n: fmt(pouch - mine.ore) }) : '',
      gold: fmt(gold),
      quick: t('mine.quick', { n: left.gold, max: cfg.gold.perDay }),
      goldLeft: t('mine.left', { n: left.gold, max: cfg.gold.perDay }),
      itemLeft: t('mine.left', { n: left.items, max: cfg.items.perDay }),
      dayMax: t('mine.dayMax', { n: fmt(gold * cfg.gold.perDay), mul: cfg.gold.rMul * cfg.gold.perDay }),
      rx: t('mine.rx', { mul: cfg.gold.rMul }),
      items: Object.entries(cfg.items.costs).map(([id, cost]) => {
        const capped = player.inventory.count(id) >= ITEM_CAP; // 16장 #9: 최대 보유면 비활성
        return { id, name: t(`item.name.${id}`), cost: fmt(cost), capped, ok: !capped && left.items > 0 && mine.ore >= cost, poor: left.items > 0 && mine.ore < cost };
      }),
      storeLv: `Lv ${mine.storageLv} / ${cfg.storage.hours.length}`,
      storeSteps: cfg.storage.hours.map((h, i) => t('mine.hrs', { h: h + (mine.bigStorage ? cfg.storage.bigBonusHours : 0) })),
      storeCur: mine.storageLv - 1,
      storeMax,
      storeNext: storeMax ? '' : `${t('mine.hrs', { h: capHours(cfg, mine) })} → ${t('mine.hrs', { h: capHours(cfg, mine) + cfg.storage.hours[mine.storageLv] - cfg.storage.hours[mine.storageLv - 1] })}`,
      storeCost: storeMax ? '' : fmt(cfg.storage.cost[mine.storageLv]),
      storeOk: !storeMax && mine.ore >= cfg.storage.cost[mine.storageLv],
      big: mine.bigStorage,
      bigDesc: t('mine.bigD', { h: cfg.storage.bigBonusHours }),
      bigCost: String(cfg.storage.bigDia),
      bigOk: !mine.bigStorage && player.diamonds >= cfg.storage.bigDia,
      dia: player.diamonds,
      boostDesc: t('mine.boostAmt', { h: cfg.ads.hours }),
      boostAmt: `+${fmt(boostAmount(cfg, mine, 'ad', pass))}`,
      adShow: !!this.env.adFree?.() || !!this.env.canAd?.(),
      adFree: !!this.env.adFree?.(),
      adLeft: t('mine.leftN', { n: left.ads, max: cfg.ads.perDay }),
      boostLabel: this.env.adFree?.() || this.env.canAd?.() ? `${t('mine.boost')} ${left.ads}` : t('mine.boost'), // 광고 없는 곳은 숫자 없이(15-2 #2)
      diaLeft: t('mine.leftN', { n: left.dia, max: cfg.diaBoost.costs.length }),
      diaCur: cfg.diaBoost.costs.length - left.dia,
      diaCost: diaCost != null ? String(diaCost) : '',
      diaOk: diaCost != null && player.diamonds >= diaCost,
    };
  }

  _commit() {
    if (this.hold) this._saveLater = true; // 연속 강화는 손을 뗐을 때 한 번(16-1)
    else this.env.save();
    this._refresh();
  }

  _showToast(msg, action = null) {
    this.toast = { msg, lines: null, until: Date.now() + (action ? 4000 : 2600), action };
  }

  _arm(key, msg) {
    this.armed = key;
    this._armedUntil = Date.now() + GUARD_MS;
    this._showToast(msg);
    audio.play('ui_click');
  }

  // ---- 행동(전부 mine.js 호출) ----

  _upgrade(i, fromHold = false) {
    const { cfg, player } = this.env;
    const c = this._lctx();
    const mine = player.mine;
    if (upgradeBlocksGold(cfg, mine, i, c) && this.armed !== `up${i}`) {
      this.hold = null; // 실수 방지 조건에 걸리면 연속 강화를 멈춘다
      this._arm(`up${i}`, t('mine.guard', { cost: nextGoldCost(cfg, mine, c) }));
      this._flushSave();
      return false;
    }
    const res = upgradeVein(cfg, mine, i, c);
    if (!res.ok) {
      if (!fromHold) audio.play('ui_purchase_fail');
      return false;
    }
    this.armed = null;
    audio.play('ui_click');
    this._commit();
    return true;
  }

  _flushSave() {
    if (!this._saveLater) return;
    this._saveLater = false;
    this.env.save();
  }

  _harvest() {
    const mine = this.env.player.mine;
    const before = mine.ore;
    const now = performance.now();
    const shown = this._oreShown(now); // 연출 중에 다시 수확해도 숫자가 뒤로 가지 않게, 보이던 값에서 이어 오른다
    const res = harvest(this.env.cfg, mine, this._lctx());
    if (!res.ok) return void audio.play('ui_purchase_fail');
    audio.play('ui_purchase');
    const f = this._fly;
    f.t0 = now; // 연출 전체를 처음부터 다시(상태가 t0 하나라 겹치지 않는다)
    f.gain = `+${fmt(mine.ore - before)}`;
    f.n = 6 + Math.floor(this._rng() * 3);
    for (let i = 0; i < f.n; i++) {
      f.dx[i] = ((i + 0.5) / f.n - 0.5) * 120 + (this._rng() - 0.5) * 8; // 부채꼴: 좌우로 고르게
      f.h[i] = 30 + this._rng() * 10;
    }
    this._oreAnim.from = shown;
    this._oreAnim.to = mine.ore;
    this._oreAnim.t0 = now;
    this._commit();
  }

  // 상단에 지금 보이는 원석 수(오르는 중이면 중간 값).
  _oreShown(nowMs) {
    const a = this._oreAnim;
    return a.from + (a.to - a.from) * Math.max(0, Math.min(1, (nowMs - a.t0) / HARVEST.countMs));
  }

  _result(res, okMsg) {
    if (res.ok) {
      audio.play('ui_purchase');
      if (okMsg) this._showToast(okMsg);
      this._oreAnim.from = this._oreAnim.to = this.env.player.mine.ore;
      this._commit();
    } else {
      audio.play('ui_purchase_fail');
      if (res.reason === 'noMoney') this._showToast(t('shop.toast.poorDia'), [t('shop.toast.toDia'), 'shopDia']); // 상점과 같은 안내(다이아 충전으로)
      this._refresh();
    }
    return res.ok;
  }

  _refineGold(confirm) {
    const { cfg, player } = this.env;
    const c = this._lctx();
    if (confirm && this.v.pouchOk && goldNeedsConfirm(cfg, player.mine, c) && this.armed !== 'gold') {
      return void this._arm('gold', t('mine.guardGold', { cost: nextGoldCost(cfg, player.mine, c) }));
    }
    this.armed = null;
    const res = refineGold(cfg, player.mine, c);
    this._result(res, res.ok ? t('mine.gotGold', { n: fmt(res.gold) }) : null);
  }

  _refineItem(id) {
    const res = refineItem(this.env.cfg, this.env.player.mine, id, this._lctx());
    this._result(res, res.ok ? t('mine.gotItem', { name: t(`item.name.${id}`) }) : null);
  }

  async _boost(kind) {
    const { cfg, player } = this.env;
    if (kind === 'ad' && !this.env.adFree?.()) {
      if (this._adBusy || this.v.left.ads <= 0 || !this.env.canAd?.()) return void audio.play('ui_purchase_fail');
      this._adBusy = true;
      let r;
      try {
        r = await this.env.watchAd(); // 광고가 닫힌 뒤에 끝난다 - 보상은 그 다음
      } finally {
        this._adBusy = false;
      }
      if (!r?.shown) return void this._showToast(t('battle.lose.adFail'));
      if (!r.rewarded) return; // 중간에 닫음 - 지급도 횟수 차감도 없음
    }
    const res = boost(cfg, player.mine, kind, this._lctx());
    this._result(res, res.ok ? t('mine.gotCart', { n: fmt(res.amount) }) : null);
  }

  // ---- 개발용 치트(?dev=1 - src/game/devPanel.js) ----
  dev(kind) {
    const { cfg, player } = this.env;
    const mine = player.mine;
    if (kind === 'ore') mine.ore += 1000;
    else if (kind === 'hour') this.devOffsetMs += HOUR_MS;
    else if (kind === 'day') rolloverDay(mine, null);
    else if (kind === 'veins') syncUnlocks(cfg, mine, cfg.veins[cfg.veins.length - 1].unlockBossFloor, Date.now() + this.devOffsetMs, player.hasMonthlyPass());
    else if (kind === 'guide') mine.tutorialDone = false;
    if (kind === 'guide') this.guide = 0;
    this._oreAnim.from = this._oreAnim.to = mine.ore;
    this.env.save();
    this._settle();
  }

  // ---- 그리기 ----

  _mimg(ctx, name, x, y, w, h, sx = 0, sw = null) {
    const s = this._imgs?.get(name);
    if (!uiReady(s)) return false;
    const { offsetX, offsetY, k } = this._transform;
    const srcW = sw ?? s.img.width;
    drawImageSnapped(ctx, s.img, sx, 0, srcW, s.img.height, offsetX + x * k, offsetY + y * k, w * k, h * k);
    return true;
  }

  // ui/font 숫자(2배). align 'center' | 'right' | 'left', x = 그 기준점, y = 위.
  _num(ctx, text, x, y, variant = 'white', align = 'center') {
    const font = this._assets?.uiFont;
    const img = getUiFont(this._assets, variant);
    if (!font || !uiReady(img)) return void this._text(ctx, text, x, y + 9, 11, C.bone, align, true);
    let w = 1;
    for (const ch of text) w += font.widths[ch] - 1;
    const cx = align === 'center' ? x : align === 'right' ? x - w : x + w;
    const { offsetX, offsetY, k } = this._transform;
    drawDamage(ctx, img.img, font, text, offsetX + cx * k, Math.round(offsetY + y * k), 2 * k);
  }

  // 아이콘 + 글자 한 줄을 가운데(cx)에. icon = ui 경로, size = basis px.
  _cost(ctx, icon, size, text, cx, cy, color = C.outline) {
    const w = size + 4 + this._measure(ctx, text, 11);
    this._img(ctx, icon, cx - w / 2, cy - size / 2, size, size);
    this._text(ctx, text, cx - w / 2 + size + 4, cy, 11, color, 'left', color !== C.outline);
  }

  _btn2(ctx, skin, rect, line1, drawLine2, id, color) {
    const down = this._pressed === id && skin.startsWith('buttons/');
    this._nine(ctx, down ? `${skin}_pressed.png` : `${skin}.png`, ...rect);
    const cx = rect[0] + rect[2] / 2;
    const cy = rect[1] + rect[3] / 2 - 1 + (down ? 2 : 0);
    const ol = color !== C.outline; // 어두운 글자가 아니면 외곽선으로 버튼 바탕과 분리한다
    if (!drawLine2) return void this._text(ctx, line1, cx, cy, 11, color, 'center', ol);
    this._text(ctx, line1, cx, cy - 9, 11, color, 'center', ol);
    drawLine2(cx, cy + 10);
  }

  draw(ctx, width, height, nowMs, assets) {
    ctx.fillStyle = C.outline;
    ctx.fillRect(0, 0, width, height);
    if (width <= 0 || height <= 0 || !this.env) return;
    this._assets = assets;
    const scale = Math.min(width / NATIVE_W, height / NATIVE_H);
    this._transform = { offsetX: (width - NATIVE_W * scale) / 2, offsetY: (height - NATIVE_H * scale) / 2, k: scale / DRAW_SCALE };
    const wall = Date.now();
    if (wall - this._tickAt >= 1000) this._settle(); // 화면에 있는 동안 1초마다 정산
    if (this.armed && wall > this._armedUntil) this.armed = null;
    if (this.hold && nowMs >= this.hold.nextMs) {
      if (this._upgrade(this.hold.index, true) && this.hold) {
        this.hold.intervalMs = Math.max(HOLD.minMs, this.hold.intervalMs * HOLD.accel);
        this.hold.nextMs = nowMs + this.hold.intervalMs;
      } else this.hold = null;
    }
    const v = this.v;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this._drawTop(ctx, v, nowMs);
    for (let i = 0; i < v.veins.length; i++) this._drawRow(ctx, v.veins[i], i, nowMs);
    this._drawWorkshop(ctx, v, nowMs);
    this._drawBottom(ctx, v);
    this._drawFly(ctx, nowMs);
    if (this.popup) this._drawPopup(ctx, v);
    if (this.toast) {
      if (wall > this.toast.until) this.toast = null;
      else this._drawToast(ctx);
    }
    if (this.guide >= 0 && !this.popup) this._drawGuide(ctx, nowMs);
    ctx.restore();
  }

  _drawTop(ctx, v, nowMs) {
    this._nine(ctx, 'menu/plate.png', ...TOP);
    this._nine(ctx, this._pressed === 'back' ? 'buttons/btn_secondary_pressed.png' : 'buttons/btn_secondary.png', ...BACK);
    this._text(ctx, '←', BACK[0] + 24, BACK[1] + 23, 22, C.bone, 'center');
    this._text(ctx, t('mine.title'), 74, 52, 22, C.goldL, 'left', true);
    // 시간당 총 생산(+ 월간 패스 표시) - 원석 칸 왼쪽
    let rx = ORE_BOX[0] - 8;
    if (v.passPct) {
      this._text(ctx, v.passPct, rx, 52, 11, C.grnL, 'right', true);
      rx -= this._measure(ctx, v.passPct, 11) + 4;
    }
    this._text(ctx, v.rate, rx, 52, 11, C.bone, 'right', true);
    this._nine(ctx, 'menu/inset.png', ...ORE_BOX);
    this._img(ctx, 'icons/ore.png', ORE_BOX[0] + 10, ORE_BOX[1] + 8, 20, 20);
    this._num(ctx, fmt(Math.floor(this._oreShown(nowMs))), ORE_BOX[0] + ORE_BOX[2] - 8, ORE_BOX[1] + 9, 'yellow', 'right');
    const bt = nowMs - this._fly.t0;
    if (bt >= 0 && bt < HARVEST.blinkMs) {
      // 수확 직후 원석 칸 테두리가 한 번 밝게
      const [bx, by, bw, bh] = ORE_BOX;
      this._fill(ctx, C.goldL, bx, by, bw, 2);
      this._fill(ctx, C.goldL, bx, by + bh - 2, bw, 2);
      this._fill(ctx, C.goldL, bx, by, 2, bh);
      this._fill(ctx, C.goldL, bx + bw - 2, by, 2, bh);
    }
    // 창고 게이지 줄
    const y = 92;
    this._text(ctx, v.storeLabel, 24, y, 11, C.dim);
    const lw = this._measure(ctx, v.storeLabel, 11);
    this._text(ctx, v.capText, 516, y, 11, C.dim, 'right');
    const cw = this._measure(ctx, v.capText, 11);
    this._text(ctx, v.fullText, 516 - cw - 6, y, 11, v.full ? C.goldL : C.bone, 'right');
    const fw = this._measure(ctx, v.fullText, 11);
    const gx = 24 + lw + 8;
    const gw = 516 - cw - 6 - fw - 8 - gx;
    this._nine(ctx, 'menu/slider_track.png', gx, y - 8, gw, 16);
    if (v.full) this._fill(ctx, C.goldL, gx + 4, y - 4, gw - 8, 8);
    else if (v.fill > 0) this._img(ctx, 'menu/slider_fill.png', gx + 4, y - 4, (gw - 8) * v.fill, 8);
  }

  // 강화 버튼 사각형(줄마다 한 번만 만든다 - 매 프레임 배열을 만들지 않는다).
  _rowBtn(i) {
    return (this._rowBtns[i] ??= [ROW.btn[0], ROW.y + i * ROW.h + ROW.btn[1], ROW.btn[2], ROW.btn[3]]);
  }

  _drawRow(ctx, r, i, nowMs) {
    const y = ROW.y + i * ROW.h;
    if (!this._mimg(ctx, r.locked ? 'row_locked' : `row_${r.id}`, 0, y, 540, ROW.h)) this._fill(ctx, C.bg1, 0, y, 540, ROW.h);
    if (r.locked) {
      this._text(ctx, r.name, ROW.textX, y + 24, 11, C.dim, 'left', true);
      this._img(ctx, 'icons/lock.png', ROW.textX, y + 36, 24, 24);
      this._text(ctx, r.boss, ROW.textX + 30, y + 48, 11, C.bone, 'left', true);
      this._text(ctx, t('mine.bossSub'), ROW.textX, y + 72, 11, C.dim, 'left', true);
      return;
    }
    this._mimg(ctx, `crystals_${r.id}`, ROW.slot[0], y + ROW.slot[1], ROW.slot[2], ROW.slot[2], r.stage * 24, 24);
    this._drawSparks(ctx, r.id, i, nowMs);
    this._text(ctx, r.name, ROW.textX, y + 24, 11, C.bone, 'left', true);
    const lw = this._measure(ctx, r.lv, 11);
    this._nine(ctx, 'panels/box_floor.png', ROW.textX, y + 35, lw + 20, 26);
    this._text(ctx, r.lv, ROW.textX + 10, y + 48, 11, C.goldL);
    this._text(ctx, r.maxLv, ROW.textX + lw + 22, y + 48, 11, C.dim, 'left', true);
    this._text(ctx, r.next ? `${r.rate} →` : r.rate, ROW.textX, y + 72, 11, C.bone, 'left', true);
    if (r.next) this._text(ctx, r.next, ROW.textX + this._measure(ctx, `${r.rate} → `, 11), y + 72, 11, C.grnL, 'left', true);
    const b = this._rowBtn(i);
    if (r.max) {
      this._nine(ctx, 'menu/inset.png', ...b);
      this._text(ctx, r.maxAt, b[0] + b[2] / 2, b[1] + 23, 11, C.dim, 'center');
      this._text(ctx, r.maxAt2, b[0] + b[2] / 2, b[1] + 41, 11, C.dim, 'center');
      return;
    }
    const label = this.armed === `up${i}` ? t('mine.again') : t('mine.up');
    if (r.ok) this._btn2(ctx, 'buttons/btn_gold', b, label, (cx, cy) => this._cost(ctx, 'icons/ore_small.png', 16, r.cost, cx, cy, C.bone), `up${i}`, C.outline);
    else this._btn2(ctx, 'upgrade/btn_disabled', b, label, (cx, cy) => this._cost(ctx, 'icons/ore_small.png', 16, r.cost, cx, cy, C.redL), `up${i}`, C.dim);
  }

  // 곡괭이 불꽃: 광맥마다 2~3초 간격으로 1px(네이티브) 입자 3~5개가 수정 위에서 튀었다 떨어진다.
  _drawSparks(ctx, id, i, nowMs) {
    const s = this._sparks[i];
    if (!s) return;
    if (nowMs >= s.nextAt) {
      if (s.nextAt > 0) {
        s.t0 = nowMs;
        s.n = 3 + Math.floor(this._rng() * 3);
        for (let p = 0; p < s.n; p++) {
          s.vx[p] = (this._rng() - 0.5) * 90;
          s.vy[p] = -60 - this._rng() * 70;
        }
      }
      s.nextAt = nowMs + SPARK.minMs + this._rng() * (SPARK.maxMs - SPARK.minMs);
    }
    const age = (nowMs - s.t0) / 1000;
    if (age < 0 || age * 1000 > SPARK.lifeMs) return;
    const ox = ROW.slot[0] + 36;
    const oy = ROW.y + i * ROW.h + ROW.slot[1] + 34;
    for (let p = 0; p < s.n; p++) {
      const x = ox + s.vx[p] * age;
      const y = oy + s.vy[p] * age + 320 * age * age;
      this._fill(ctx, p === 0 ? C.bone : p % 2 ? C.gold : VEIN_BRIGHT[id], Math.round(x / 3) * 3, Math.round(y / 3) * 3, 3, 3);
    }
  }

  _drawWorkshop(ctx, v, nowMs) {
    if (!this._mimg(ctx, 'workshop', ...WORK)) this._fill(ctx, C.bg1, ...WORK);
    this._text(ctx, t('mine.workshop'), 270, WORK[1] + 13, 11, C.bone, 'center', true);
    this._mimg(ctx, 'refinery', ...REFINERY);
    this._mimg(ctx, 'refinery_fire', FIRE.x, FIRE.y, FIRE.w, FIRE.h, (Math.floor(nowMs / FIRE.ms) % FIRE.frames) * 19, 19);
    this._text(ctx, t('mine.refinery'), REFINERY[0] + 124, REFINERY[1] + 157, 11, C.goldL, 'center');
    this._text(ctx, v.sign, REFINERY[0] + 124, REFINERY[1] + 169, 11, C.bone, 'center');
    // 수레: 가득이면 2초마다 잠깐 좌우로 흔들린다
    const shake = v.cartState === 2 && nowMs % 2000 < 300 ? (Math.floor(nowMs / 50) % 2 ? 3 : -3) : 0;
    const cx = CART[0] + shake;
    const pt = nowMs - this._fly.t0;
    const cy = CART[1] + (pt >= 0 && pt < HARVEST.pressMs ? HARVEST.pressPx : 0); // 수확하면 잠깐 눌린다
    this._mimg(ctx, 'cart', cx, cy, CART[2], CART[3], v.cartState * 84, 84);
    if (v.cartState === 2) {
      for (let i = 0; i < SPARKLE.at.length; i++) {
        const f = Math.floor((nowMs + i * 230) / SPARKLE.ms) % 2;
        this._mimg(ctx, 'cart_sparkle', cx + SPARKLE.at[i][0], CART[1] + SPARKLE.at[i][1], SPARKLE.size, SPARKLE.size, f * 7, 7);
      }
    }
    this._num(ctx, fmt(v.cart), cx + CART[2] / 2, cy + 66);
    this._text(ctx, v.cart > 0 ? `▲ ${t('mine.harvest')}` : t('mine.mining'), cx + CART[2] / 2, CART[1] + 99, 11, C.bone, 'center', true);
  }

  _drawBottom(ctx, v) {
    if (v.pouch == null) this._btn2(ctx, 'upgrade/btn_disabled', QUICK, t('mine.done'), null, 'quick', C.dim);
    else if (v.pouchOk) {
      const label = this.armed === 'gold' ? t('mine.again') : v.quick;
      this._btn2(ctx, 'buttons/btn_gold', QUICK, label, (cx, cy) => {
        const a = String(v.pouch);
        const wa = this._measure(ctx, a, 11);
        const w = 16 + 4 + wa + this._measure(ctx, ' → ', 11) + 16 + 4 + this._measure(ctx, v.gold, 11);
        let x = cx - w / 2;
        this._img(ctx, 'icons/ore_small.png', x, cy - 8, 16, 16);
        this._text(ctx, `${a} → `, (x += 20), cy, 11, C.outline);
        this._img(ctx, 'icons/gold.png', (x += wa + this._measure(ctx, ' → ', 11)), cy - 8, 16, 16);
        this._text(ctx, v.gold, x + 20, cy, 11, C.outline);
      }, 'quick', C.outline);
    } else this._btn2(ctx, 'upgrade/btn_disabled', QUICK, v.quick, (cx, cy) => this._text(ctx, v.pouchShort, cx, cy, 11, C.redL, 'center'), 'quick', C.dim);
    this._button(ctx, 'buttons/btn_secondary', STORE, v.storeLabel, 11, 'store');
    this._button(ctx, 'buttons/btn_secondary', BOOST, v.boostLabel, 11, 'boost');
    if (v.pouchOk) this._img(ctx, 'menu/badge.png', QUICK[0] + QUICK[2] - 12, QUICK[1] - 6, 16, 16);
  }

  // 수확 연출: 조각이 수레 더미에서 부채꼴로 튀어 올랐다 떨어지고, 수레 위에 "+받은 양"이 떠오른다.
  _drawFly(ctx, nowMs) {
    const f = this._fly;
    const el = nowMs - f.t0;
    if (el < 0 || el > HARVEST.numMs) return;
    const sx = CART[0] + CART[2] / 2 - 8;
    const sy = CART[1] + 36;
    for (let i = 0; i < f.n; i++) {
      const k = (el - ((i * 3) % f.n) * HARVEST.gapMs) / HARVEST.popMs; // 시작 순서를 섞어 한쪽부터 튀지 않게
      if (k < 0 || k > 1) continue;
      ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      this._img(ctx, 'icons/ore_small.png', sx + f.dx[i] * k, sy - f.h[i] * 4 * k * (1 - k), 16, 16);
    }
    const k = el / HARVEST.numMs;
    ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    this._num(ctx, f.gain, CART[0] + CART[2] / 2, CART[1] + 10 - HARVEST.numRise * k, 'yellow');
    ctx.globalAlpha = 1;
  }

  _drawToast(ctx) {
    const tw = TOAST[2] - 40;
    this.toast.lines ??= this._wrap(ctx, this.toast.msg, tw, 11);
    const act = this.toast.action;
    const h = 36 + this.toast.lines.length * 18 + (act ? 52 : 0);
    const ty = this.popup ? TOAST_POPUP_Y : TOAST[1]; // 팝업이 열려 있으면 팝업 내용을 가리지 않게 아래쪽에
    this._nine(ctx, 'panels/panel_iron.png', TOAST[0], ty, TOAST[2], h);
    this.toast.lines.forEach((line, i) => this._text(ctx, line, 270, ty + 27 + i * 18, 11, C.bone, 'center'));
    if (act) {
      const r = (this._pb.toastAct ??= [170, 0, 200, 44]);
      r[1] = ty + h - 62;
      this._button(ctx, 'buttons/btn_primary', r, act[0], 11, 'toastAct');
    }
  }

  // ---- 팝업 ----

  _sec(ctx, x, y, w, h) {
    this._nine(ctx, 'menu/inset.png', x, y, w, h);
  }

  _head(ctx, x, y, w, left, right) {
    this._text(ctx, left, x, y + 10, 11, C.goldL);
    this._text(ctx, right, x + w, y + 10, 11, C.bone, 'right');
  }

  // 단계 카드 n개(지난 것은 ✓, 지금 것은 선택 틀). bottom(i, cx, cy)가 아랫줄을 그린다.
  _steps(ctx, x, y, w, n, cur, top, bottom) {
    const cw = (w - (n - 1) * 6) / n;
    for (let i = 0; i < n; i++) {
      const cx = x + i * (cw + 6);
      this._nine(ctx, i === cur ? 'upgrade/card_selected.png' : 'upgrade/card.png', cx, y, cw, 54);
      const col = i < cur ? C.bg3 : i === cur ? C.bone : C.dim;
      this._text(ctx, top(i), cx + cw / 2, y + 18, 11, col, 'center');
      bottom(i, cx + cw / 2, y + 37, col);
    }
  }

  _popupFrame(ctx, pop, h, title, emblem) {
    const F = screen.full;
    const { offsetX, offsetY, k } = this._transform;
    this._dither(ctx, (F.x - offsetX) / k, (F.y - offsetY) / k, F.width / k, F.height / k);
    const top = Math.max(100, Math.round((BASIS_H - h) / 2));
    this._nine(ctx, 'menu/popup_menu.png', pop.x, top, pop.w, h);
    if (emblem) this._img(ctx, emblem, 270 - 24, top - 26, 48, 48);
    const pb = this._pb;
    pb.frame = [pop.x, top, pop.w, h];
    pb.x = [pop.x + pop.w - 62, top - 8, 64, 64];
    this._img(ctx, `upgrade/btn_close${this._pressed === 'px' ? '_pressed' : ''}.png`, pop.x + pop.w - 46, top + 14);
    this._text(ctx, title, 270, top + POP_BORDER + 14, 22, C.goldL, 'center', true);
    return top + POP_BORDER + 38;
  }

  _drawPopup(ctx, v) {
    for (const key in this._pb) this._pb[key] = null;
    if (this.popup === 'ref') this._drawRefinery(ctx, v);
    else if (this.popup === 'store') this._drawStore(ctx, v);
    else this._drawBoostPopup(ctx, v);
  }

  // 팝업 아래 보유 원석 칸.
  _foot(ctx, x, y, w, v) {
    this._sec(ctx, x, y, w, 52);
    this._img(ctx, 'icons/ore.png', x + 14, y + 16, 20, 20);
    this._num(ctx, fmt(v.ore), x + 42, y + 17, 'yellow', 'left');
  }

  _drawRefinery(ctx, v) {
    const pb = this._pb;
    const gold = this.tab === 'gold';
    const secH = gold ? 248 : 368 + (v.left.items > 0 ? 0 : 22);
    const h = 38 + 44 + 8 + secH + 8 + 52 + POP_BORDER * 2;
    let y = this._popupFrame(ctx, POP_WIDE, h, t('mine.refinery'), 'menu/emblem_refinery.png');
    const x = POP_WIDE.x + POP_BORDER;
    const w = POP_WIDE.w - POP_BORDER * 2;
    const tw = (w - 4) / 2;
    pb.tabGold = [x, y, tw, 44];
    pb.tabItem = [x + tw + 4, y, tw, 44];
    this._nine(ctx, gold ? 'upgrade/tab_on.png' : 'upgrade/tab_off.png', ...pb.tabGold);
    this._nine(ctx, gold ? 'upgrade/tab_off.png' : 'upgrade/tab_on.png', ...pb.tabItem);
    this._text(ctx, t('mine.tabGold'), x + tw / 2, y + 24, 11, gold ? C.bone : C.dim, 'center');
    this._text(ctx, t('mine.tabItem'), x + tw + 4 + tw / 2, y + 24, 11, gold ? C.dim : C.bone, 'center');
    y += 52;
    this._sec(ctx, x, y, w, secH);
    const ix = x + 12;
    const iw = w - 24;
    let cy = y + 8;
    if (gold) {
      const costs = this.env.cfg.gold.costs;
      const cur = costs.length - v.left.gold;
      this._head(ctx, ix, cy, iw, t('mine.tabGold'), v.goldLeft);
      cy += 28;
      this._steps(ctx, ix, cy, iw, costs.length, cur, (i) => (i < cur ? '✓' : String(i + 1)), (i, cx, my, col) => this._cost(ctx, 'icons/ore_small.png', 16, String(costs[i]), cx, my, col));
      cy += 62;
      this._text(ctx, t('mine.nextCost'), ix, cy + 11, 11, C.dim);
      if (v.pouch != null) {
        const s = String(v.pouch);
        this._text(ctx, s, ix + iw, cy + 11, 11, v.pouchOk ? C.bone : C.redL, 'right');
        this._img(ctx, 'icons/ore_small.png', ix + iw - this._measure(ctx, s, 11) - 20, cy + 3, 16, 16);
      } else this._text(ctx, '-', ix + iw, cy + 11, 11, C.dim, 'right');
      cy += 26;
      this._text(ctx, t('mine.gain'), ix, cy + 11, 11, C.dim);
      this._text(ctx, v.rx, ix + iw, cy + 11, 11, C.dim, 'right');
      const rw = this._measure(ctx, v.rx, 11) + 6;
      this._text(ctx, v.gold, ix + iw - rw, cy + 11, 11, C.goldL, 'right');
      this._img(ctx, 'icons/gold.png', ix + iw - rw - this._measure(ctx, v.gold, 11) - 20, cy + 3, 16, 16);
      cy += 30;
      pb.refine = [ix, cy, iw, 64];
      if (v.pouch == null) this._button(ctx, 'upgrade/btn_disabled', pb.refine, t('mine.done'), 11, 'refine', C.dim);
      else if (v.pouchOk) this._button(ctx, 'buttons/btn_gold', pb.refine, t('mine.refine'), 22, 'refine', C.outline);
      else {
        this._nine(ctx, 'upgrade/btn_disabled.png', ...pb.refine);
        this._text(ctx, t('mine.refine'), ix + iw / 2, cy + 23, 22, C.dim, 'center');
        this._text(ctx, v.pouchShort, ix + iw / 2, cy + 46, 11, C.redL, 'center');
      }
      cy += 72;
      this._text(ctx, v.dayMax, ix + iw / 2, cy + 7, 11, C.dim, 'center');
    } else {
      this._head(ctx, ix, cy, iw, t('mine.tabItem'), v.itemLeft);
      cy += 28;
      const icons = this.env.itemIcons?.();
      for (let i = 0; i < v.items.length; i++) {
        const it = v.items[i];
        this._nine(ctx, 'upgrade/card.png', ix, cy, iw, 60);
        const st = icons?.get(it.id);
        if (uiReady(st)) this._drawState(ctx, st, ix + 14, cy + 14, 32, 32);
        this._text(ctx, it.name, ix + 58, cy + 30, 11, C.bone);
        const b = [ix + iw - 132, cy + 6, 120, 48];
        pb[`item${i}`] = b;
        if (it.capped) this._button(ctx, 'upgrade/btn_disabled', b, t('mine.capItem'), 11, `item${i}`, C.dim);
        else {
          const skin = it.ok ? 'buttons/btn_gold' : 'upgrade/btn_disabled';
          this._nine(ctx, this._pressed === `item${i}` && it.ok ? `${skin}_pressed.png` : `${skin}.png`, ...b);
          this._cost(ctx, 'icons/ore_small.png', 16, it.cost, b[0] + 60, b[1] + 23, it.ok ? C.outline : it.poor ? C.redL : C.dim);
        }
        cy += 66;
      }
      if (v.left.items <= 0) this._text(ctx, t('mine.done'), ix + iw / 2, cy + 8, 11, C.dim, 'center');
    }
    y += secH + 8;
    this._foot(ctx, x, y, w, v);
    this._text(ctx, t('mine.have'), x + w - 14, y + 26, 11, C.dim, 'right');
  }

  _drawStore(ctx, v) {
    const pb = this._pb;
    const h = 38 + 166 + 8 + 104 + 8 + 52 + POP_BORDER * 2;
    let y = this._popupFrame(ctx, POP_SM, h, t('mine.storeUp'), null);
    const x = POP_SM.x + POP_BORDER;
    const w = POP_SM.w - POP_BORDER * 2;
    const ix = x + 12;
    const iw = w - 24;
    this._sec(ctx, x, y, w, 166);
    this._head(ctx, ix, y + 8, iw, t('mine.cap'), v.storeLv);
    this._steps(ctx, ix, y + 36, iw, v.storeSteps.length, v.storeCur, (i) => `Lv${i + 1}`, (i, cx, my, col) => this._text(ctx, v.storeSteps[i], cx, my, 11, col, 'center'));
    pb.store = [ix, y + 98, iw, 60];
    if (v.storeMax) this._button(ctx, 'upgrade/btn_disabled', pb.store, t('mine.max'), 11, 'pstore', C.dim);
    else {
      this._btn2(ctx, v.storeOk ? 'buttons/btn_gold' : 'upgrade/btn_disabled', pb.store, v.storeNext,
        (cx, cy) => this._cost(ctx, 'icons/ore_small.png', 16, v.storeCost, cx, cy, v.storeOk ? C.outline : C.redL), 'pstore', v.storeOk ? C.outline : C.dim);
    }
    y += 174;
    this._sec(ctx, x, y, w, 104);
    this._head(ctx, ix, y + 8, iw, t('mine.bigS'), v.bigDesc);
    pb.big = [ix, y + 36, iw, 60];
    if (v.big) this._button(ctx, 'upgrade/btn_disabled', pb.big, t('mine.owned'), 11, 'big', C.dim);
    else {
      this._nine(ctx, v.bigOk ? (this._pressed === 'big' ? 'buttons/btn_primary_pressed.png' : 'buttons/btn_primary.png') : 'upgrade/btn_disabled.png', ...pb.big);
      this._cost(ctx, 'icons/diamond.png', 16, v.bigCost, ix + iw / 2, y + 65, v.bigOk ? C.bone : C.redL);
    }
    y += 112;
    this._foot(ctx, x, y, w, v);
    this._num(ctx, fmt(v.dia), x + w - 14, y + 17, 'blue', 'right');
    this._img(ctx, 'icons/diamond.png', x + w - 14 - 22 - fmt(v.dia).length * 13, y + 18, 16, 16);
  }

  _drawBoostPopup(ctx, v) {
    const pb = this._pb;
    const h = 38 + 38 + 8 + (v.adShow ? 112 : 0) + 166 + 8 + 52 + POP_BORDER * 2;
    let y = this._popupFrame(ctx, POP_SM, h, t('mine.boostTitle'), null);
    const x = POP_SM.x + POP_BORDER;
    const w = POP_SM.w - POP_BORDER * 2;
    const ix = x + 12;
    const iw = w - 24;
    this._sec(ctx, x, y, w, 38);
    this._text(ctx, v.boostDesc, ix, y + 19, 11, C.dim);
    this._num(ctx, v.boostAmt, ix + iw, y + 10, 'white', 'right');
    this._img(ctx, 'icons/ore_small.png', ix + iw - v.boostAmt.length * 13 - 22, y + 11, 16, 16);
    y += 46;
    if (v.adShow) {
      this._sec(ctx, x, y, w, 104);
      this._head(ctx, ix, y + 8, iw, v.adFree ? t('mine.free') : t('mine.ad'), v.adLeft);
      pb.ad = [ix, y + 36, iw, 60];
      if (v.left.ads > 0) this._button(ctx, 'buttons/btn_gold', pb.ad, v.adFree ? t('mine.free') : `▶ ${t('mine.ad')}`, 11, 'ad', C.outline);
      else this._button(ctx, 'upgrade/btn_disabled', pb.ad, t('mine.done'), 11, 'ad', C.dim);
      y += 112;
    }
    this._sec(ctx, x, y, w, 166);
    const costs = this.env.cfg.diaBoost.costs;
    this._head(ctx, ix, y + 8, iw, t('mine.inst'), v.diaLeft);
    this._steps(ctx, ix, y + 36, iw, costs.length, v.diaCur, (i) => (i < v.diaCur ? '✓' : String(i + 1)), (i, cx, my, col) => this._cost(ctx, 'icons/diamond.png', 16, String(costs[i]), cx, my, col));
    pb.dia = [ix, y + 98, iw, 60];
    if (v.left.dia <= 0) this._button(ctx, 'upgrade/btn_disabled', pb.dia, t('mine.done'), 11, 'dia', C.dim);
    else {
      this._nine(ctx, v.diaOk ? (this._pressed === 'dia' ? 'buttons/btn_primary_pressed.png' : 'buttons/btn_primary.png') : 'upgrade/btn_disabled.png', ...pb.dia);
      this._cost(ctx, 'icons/diamond.png', 16, v.diaCost, ix + iw / 2, y + 127, v.diaOk ? C.bone : C.redL);
    }
    y += 174;
    this._sec(ctx, x, y, w, 52);
    this._img(ctx, 'icons/diamond.png', x + 14, y + 18, 16, 16);
    this._num(ctx, fmt(v.dia), x + 38, y + 17, 'blue', 'left');
  }

  // ---- 첫 진입 안내(3단계, 한 번만): 수레 -> 첫 광맥 강화 버튼 -> 정제소 ----

  _guideTarget() {
    if (this.guide === 0) return CART;
    if (this.guide === 2) return REFINERY;
    const i = this.env.player.mine.veins.findIndex((lv) => lv > 0);
    return this._rowBtn(Math.max(0, i));
  }

  _drawGuide(ctx, nowMs) {
    const [tx, ty, tw, th] = this._guideTarget();
    const hole = this._screenRect([tx - 6, ty - 6, tw + 12, th + 12]);
    const F = screen.full;
    // 딤 + 구멍 + 깜빡이는 강조 틀 = 튜토리얼(tutorialRenderer.js)과 같은 방식·같은 그림
    ctx.beginPath();
    ctx.rect(F.x, F.y, F.width, F.height);
    ctx.rect(hole.x, hole.y, hole.width, hole.height);
    ctx.globalAlpha = 0.72;
    ctx.fillStyle = C.outline;
    ctx.fill('evenodd');
    ctx.globalAlpha = 1;
    const g = this.env.guide;
    if (!g?._nine(ctx, Math.floor(nowMs / 400) % 2 ? 'hl_frame_b.png' : 'hl_frame.png', hole.x, hole.y, hole.width, hole.height)) {
      ctx.strokeStyle = C.goldL;
      ctx.lineWidth = 2;
      ctx.strokeRect(hole.x, hole.y, hole.width, hole.height);
    }
    if (this._guideLinesAt !== `${this.guide}|${this._transform.k}`) {
      this._guideLinesAt = `${this.guide}|${this._transform.k}`;
      this._guideLines = this._wrap(ctx, t(`mine.${GUIDE_KEYS[this.guide]}`), 420, 11);
    }
    const bh = 32 + this._guideLines.length * 18 + 10 + 48 + 8;
    const by = ty + th / 2 > BASIS_H / 2 ? ty - 18 - bh : ty + th + 18;
    this._nine(ctx, 'menu/plate.png', 30, by, 480, bh);
    this._guideLines.forEach((line, i) => this._text(ctx, line, 54, by + 28 + i * 18, 11, C.bone));
    const btnY = by + bh - 16 - 48;
    this._text(ctx, `${this.guide + 1} / ${GUIDE_KEYS.length}`, 54, btnY + 24, 11, C.dim);
    this._pb.guide = [346, btnY, 140, 48];
    this._button(ctx, 'buttons/btn_gold', this._pb.guide, t(this.guide < GUIDE_KEYS.length - 1 ? 'mine.next' : 'mine.start'), 11, 'guide', C.outline);
  }

  // ---- 입력 ----

  // 열린 팝업이 있으면 닫고 true(뒤로가기·Esc).
  closeOverlay() {
    if (!this.popup) return false;
    this.popup = null;
    return true;
  }

  _openPopup(id) {
    audio.play('ui_click');
    this.popup = id;
    this.tab = 'gold';
    this.armed = null;
    this._refresh();
  }

  handlePointerDown(x, y) {
    if (!this._transform || !this.env || !this.v) return null;
    const [bx, by] = this._toBasis(x, y);
    const nowMs = performance.now();
    if (this.toast?.action && this._pb.toastAct && inRect(bx, by, this._pb.toastAct)) {
      this._pressed = 'toastAct';
      audio.play('ui_click');
      return this.toast.action[1]; // 'shopDia' - main.js가 상점으로 넘긴다
    }
    if (this.guide >= 0 && !this.popup) {
      if (inRect(bx, by, this._pb.guide)) {
        this._pressed = 'guide';
        audio.play('ui_click');
        if (++this.guide >= GUIDE_KEYS.length) {
          this.guide = -1;
          this.env.player.mine.tutorialDone = true;
          this.env.save();
        }
      }
      return null;
    }
    if (this.popup) {
      this._popupDown(bx, by);
      return null;
    }
    if (inRect(bx, by, BACK)) {
      this._pressed = 'back';
      audio.play('ui_cancel');
      return 'exit';
    }
    const v = this.v;
    for (let i = 0; i < v.veins.length; i++) {
      const r = v.veins[i];
      if (r.locked || r.max || !inRect(bx, by, this._rowBtn(i))) continue;
      this._pressed = `up${i}`;
      if (this._upgrade(i)) this.hold = { index: i, nextMs: nowMs + HOLD.firstMs, intervalMs: HOLD.intervalMs };
      return null;
    }
    if (inRect(bx, by, CART)) this._harvest();
    else if (inRect(bx, by, REFINERY)) this._openPopup('ref');
    else if (inRect(bx, by, QUICK)) {
      this._pressed = 'quick';
      if (v.pouchOk) this._refineGold(true);
      else audio.play('ui_purchase_fail');
    } else if (inRect(bx, by, STORE)) {
      this._pressed = 'store';
      this._openPopup('store');
    } else if (inRect(bx, by, BOOST)) {
      this._pressed = 'boost';
      this._openPopup('boost');
    }
    return null;
  }

  _popupDown(bx, by) {
    const pb = this._pb;
    const { cfg, player } = this.env;
    if (inRect(bx, by, pb.x) || !inRect(bx, by, pb.frame)) {
      if (inRect(bx, by, pb.x)) this._pressed = 'px';
      audio.play('ui_cancel');
      this.popup = null; // X 또는 바깥(디더) 탭 = 닫기
      return;
    }
    if (this.popup === 'ref') {
      if (inRect(bx, by, pb.tabGold) || inRect(bx, by, pb.tabItem)) {
        const tab = inRect(bx, by, pb.tabGold) ? 'gold' : 'item';
        if (tab !== this.tab) audio.play('ui_click');
        this.tab = tab;
      } else if (inRect(bx, by, pb.refine)) {
        this._pressed = 'refine';
        if (this.v.pouchOk) this._refineGold(false); // 팝업 안의 정제는 확인 없음(15-1)
        else audio.play('ui_purchase_fail');
      } else {
        for (let i = 0; i < this.v.items.length; i++) {
          if (!inRect(bx, by, pb[`item${i}`])) continue;
          this._pressed = `item${i}`;
          if (this.v.items[i].ok) this._refineItem(this.v.items[i].id);
          else audio.play('ui_purchase_fail');
        }
      }
    } else if (this.popup === 'store') {
      if (inRect(bx, by, pb.store)) {
        this._pressed = 'pstore';
        this._result(upgradeStorage(cfg, player.mine, this._lctx()));
      } else if (inRect(bx, by, pb.big) && !this.v.big) {
        this._pressed = 'big';
        this._result(buyBigStorage(cfg, player.mine, this._lctx()));
      }
    } else if (inRect(bx, by, pb.ad)) {
      this._pressed = 'ad';
      this._boost('ad');
    } else if (inRect(bx, by, pb.dia)) {
      this._pressed = 'dia';
      if (this.v.left.dia > 0) this._boost('dia');
      else audio.play('ui_purchase_fail');
    }
  }

  handlePointerUp() {
    this._pressed = null;
    this.hold = null;
    this._flushSave();
  }

  cancelPointer() {
    this.handlePointerUp();
  }
}

// 좌표 변환·9-slice·글자·디더·줄바꿈·버튼은 상점 화면과 같은 구현을 그대로 쓴다(같은 basis, 같은 UI 팩).
for (const m of ['_toBasis', '_screenRect', '_nine', '_img', '_drawState', '_fill', '_font', '_measure', '_text', '_dither', '_wrap', '_button']) {
  MineScreen.prototype[m] = ShopScreen.prototype[m];
}
