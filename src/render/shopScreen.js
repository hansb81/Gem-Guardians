// 상점 전체 화면(mockups/shop/shop.html 시안 2 확정): 왼쪽 레일 5칸 + 1열 카드 세로 스크롤 +
// 구매 확인 팝업 + 토스트. 좌표는 모두 540x960("basis", 네이티브 180x320 x3)이고 메인 메뉴와 같이
// 분수 배율로 캔버스를 꽉 채운다. 그림은 1배 파일 x2(basis) = assets/ui 팩, imageSmoothingEnabled=false.
//
// 규칙/가격/저장은 src/core/shop/shop.js(buildRail/buyProduct)가 정하고, 여기서는 그리기·입력만 한다.
// 현금 상품은 src/shop/iap.js purchase()가 성공한 뒤에만 buyProduct를 부른다.
import { getFontString } from '../config/fonts.js';
import { drawText, drawNine, getUi, getUiMeta, uiReady, pressButton } from './uiKit.js';
import { t } from '../config/i18n.js';
import { audio } from '../audio/AudioManager.js';
import { RAILS, buildRail, buyProduct, grantPaidProduct, revokePaidProduct, hasNewPack, refreshOffers, rolloverDay, walletOf } from '../core/shop/shop.js';
import { purchase, restore } from '../shop/iap.js';
import { platform } from '../platform/index.js';
import { ITEM_CAP } from '../core/inventory/inventory.js';
import { productText, gotText, fmt } from './shopText.js';
import { rewardFromDelta } from './rewardPopup.js';
import { drawImageSnapped, screen } from './screenFit.js';

// 획득 팝업으로 알리는 상품(나머지는 토스트) - docs/inventory.md 5-2.
const REWARD_KINDS = new Set(['pack', 'passClaim', 'free']);
// 현금 상품이 있는 탭 - 마켓 결제 전에 할 일(원스토어 로그인 등)이 있으면 들어올 때 안내한다.
const CASH_RAILS = new Set(['packs', 'dia']);
const DOTS = ['.', '..', '...'];
const DOTS_MS = 400;

const NATIVE_W = 180;
const NATIVE_H = 320;
const DRAW_SCALE = 3;
const BASIS_H = 960;

// assets/gems/palette.hex에서 고른 UI 색(목업 :root와 같은 값).
const C = {
  outline: '#0d0a10', bg1: '#221c2b', bg2: '#3b3347', bg3: '#655a74', bone: '#e8dcc0',
  blueL: '#8cc4ee', blueM: '#1c3a76', red: '#b82a3c', redL: '#ec6a6a', gold: '#c28a20', goldL: '#f2d264', grnL: '#9cd872',
};
// 특수 잼 기술 슬롯 아래 5색 점(색이 효과를 정한다) - config/shop.json skills.color 순서.
const SKILL_DOT = { red: '#b82a3c', blue: '#386cbc', purple: '#7a3cae', yellow: '#f2d264', green: '#3a8a3c' };
const TAG_BG = { '': C.red, blue: C.blueM, gray: C.bg3, gold: C.gold };

// 배치(basis px). 작은 버튼은 그림 크기는 목업 그대로, 터치 영역(hit)만 64 이상으로 넓혔다(412dp 폰에서
// 540 기준 44px = 약 34dp라 Android 48dp에 못 미친다).
// 닫기 = 오른쪽 위(좌우 대칭: 그림 32 + 오른쪽 여백 28, 터치 64 + 여백 12). "+"(388~450)와 안 겹친다.
const CLOSE = { img: [480, 36], hit: [464, 20, 64, 64] };
const BAR = [154, 28, 232, 56];
const BAR_ITEMS = [
  { icon: 'icons/gold.png', iconX: 18, boxX: 50, boxW: 72, key: 'gold' },
  { icon: 'icons/diamond.png', iconX: 132, boxX: 162, boxW: 62, key: 'diamonds' },
];
const PLUS = { img: [394, 40], hit: [388, 22, 62, 66] };
const RAIL = { x: 12, y: 96, w: 100, h: 72, gap: 6 };
const PANEL = [118, 96, 410, 852];
const LIST = { x: 126, y: 104, w: 394, h: 836, padTop: 10, padBottom: 16, gap: 8 };
const CARD = { x: 127, w: 392, h: 96, bannerH: 220 };
const HDR_H = 38;
const LEGAL_H = 44;
const POP = { x: 40, w: 460, border: 32 };
const TOAST = [40, 764, 460, 76];
const TOAST_MS = 2800;
const DRAG_SLOP = 8; // css px - 이만큼 움직이면 탭이 아니라 스크롤.
const STACK_POS = { 1: [[22, 6]], 3: [[8, 12], [36, 12], [22, 0]], 5: [[0, 12], [22, 12], [44, 12], [11, 0], [33, 0]] };

function inRect(x, y, [rx, ry, rw, rh]) {
  return x >= rx && x < rx + rw && y >= ry && y < ry + rh;
}

function localDay(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hms(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map((v) => String(v).padStart(2, '0')).join(':');
}

export class ShopScreen {
  constructor() {
    this.env = null; // { cfg, itemsConfig, data, player, save(), itemIcons() } - main.js가 데이터 로드 후 setEnv.
    this.rail = 'items';
    this.rails = RAILS; // open()이 마켓에 맞게 줄인다.
    this.scroll = 0;
    this.entries = []; // [{ e, y, h, tx, lines?, linesK? }]
    this.contentH = 0;
    this.newPack = false;
    this.sel = null; // 마지막으로 누른 카드 id(card_selected)
    this.popup = null; // { p, tx, qty, step: 'confirm'|'paying'|'done', got, layout, layoutK }
    this.toast = null; // { msg, action: [label, to] | null, until }
    this._pressed = null;
    this._drag = null;
    this._transform = null;
    this._assets = null;
    this._nextExpiry = Infinity;
    this.changed = false; // 이번 방문에 산 게 있으면 true - main.js가 나갈 때 전투를 다시 만든다(젬 스킬 레벨).
  }

  // env.showReward(reward) = 공통 획득 팝업(main.js). 보유 수가 바뀌면(onChange) 다음 그리기 때 카드를 다시 만든다.
  setEnv(env) {
    this.env = env;
    env.player.inventory?.onChange(() => {
      this._dirty = true;
    });
  }

  // 상점에 들어올 때(메뉴 상점 아이콘). 날짜 갱신·기간 한정 팩 열기 후 목록을 만든다.
  // hdr: 열면서 그 머리글로 스크롤(예: 'goldex' = 다이아 탭의 골드 교환).
  open(rail = 'items', hdr = null) {
    this.rail = rail;
    this.scroll = 0;
    this.popup = null;
    this.toast = null;
    this.sel = null;
    this.changed = false;
    if (!this.env) return;
    const ctx = this._ctx();
    // 현금 상품을 못 파는 마켓(웹)은 패키지 탭을 숨긴다 - 이미 산 패스 받기가 있으면 남는다.
    this.rails = RAILS.filter((id) => id !== 'packs' || buildRail(ctx, 'packs').some((e) => e.id));
    if (!this.rails.includes(rail)) this.rail = 'items';
    if (CASH_RAILS.has(this.rail)) this._storeNotice();
    const a = rolloverDay(this.env.player.shop, ctx.today);
    const b = refreshOffers(ctx);
    if (a || b) this.env.save();
    this._rebuild();
    if (hdr) this._scrollToHdr(hdr);
  }

  _ctx() {
    const now = Date.now();
    const { cfg, itemsConfig, data, player } = this.env;
    // 현금 상품: 결제가 되는 마켓이고 그 마켓 상품 id가 등록된 것만. dev 가짜 결제 중엔 전부.
    const canSell = (key) => platform.caps.iap && (platform.dev || !!cfg.products[key]?.ids?.[platform.id]);
    return { cfg, itemsConfig, data, player, now, today: localDay(now), canSell };
  }

  _rebuild() {
    if (!this.env) return;
    const ctx = this._ctx();
    const list = buildRail(ctx, this.rail);
    this.newPack = this.rail === 'packs' ? list.some((e) => e.banner) : hasNewPack(ctx);
    this._nextExpiry = Infinity;
    let y = LIST.padTop;
    this.entries = list.map((e) => {
      const h = e.hdr ? HDR_H : e.legal ? LEGAL_H : e.banner ? CARD.bannerH : CARD.h;
      const tx = e.id ? productText(e, this.env) : null;
      if (e.expiresAt) this._nextExpiry = Math.min(this._nextExpiry, e.expiresAt);
      const row = { e, y, h, tx, lines: null, linesK: 0 };
      y += h + LIST.gap;
      return row;
    });
    this.contentH = y - LIST.gap + LIST.padBottom;
    this._clampScroll();
  }

  _clampScroll() {
    this.scroll = Math.max(0, Math.min(this.scroll, Math.max(0, this.contentH - LIST.h)));
  }

  // ---- 좌표 ----

  _toBasis(x, y) {
    const { offsetX, offsetY, k } = this._transform;
    return [(x - offsetX) / k, (y - offsetY) / k];
  }

  _screenRect([x, y, w, h]) {
    const { offsetX, offsetY, k } = this._transform;
    return { x: offsetX + x * k, y: offsetY + y * k, width: w * k, height: h * k };
  }

  // ---- 그리기 헬퍼(basis 좌표) ----

  _nine(ctx, path, x, y, w, h) {
    const state = getUi(this._assets, path);
    const slice = getUiMeta(this._assets, path)?.slice;
    const { offsetX, offsetY, k } = this._transform;
    if (!uiReady(state) || !slice) {
      ctx.fillStyle = C.bg2;
      ctx.fillRect(offsetX + x * k, offsetY + y * k, w * k, h * k);
      return;
    }
    drawNine(ctx, state.img, slice, offsetX + x * k, offsetY + y * k, w * k, h * k, 2 * k);
  }

  // 고정 그림. w/h를 안 주면 원본 x2(basis).
  _img(ctx, path, x, y, w, h) {
    const state = getUi(this._assets, path);
    if (!uiReady(state)) return false;
    this._drawState(ctx, state, x, y, w ?? state.img.width * 2, h ?? state.img.height * 2);
    return true;
  }

  _drawState(ctx, state, x, y, w, h) {
    const { offsetX, offsetY, k } = this._transform;
    drawImageSnapped(ctx, state.img, offsetX + x * k, offsetY + y * k, w * k, h * k);
  }

  _fill(ctx, color, x, y, w, h) {
    const { offsetX, offsetY, k } = this._transform;
    ctx.fillStyle = color;
    ctx.fillRect(offsetX + x * k, offsetY + y * k, w * k, h * k);
  }

  _font(ctx, size) {
    ctx.font = getFontString(size * this._transform.k);
  }

  _measure(ctx, text, size) {
    this._font(ctx, size);
    return ctx.measureText(text).width / this._transform.k;
  }

  // y = 글자 가운데.
  _text(ctx, text, x, y, size = 11, color = C.bone, align = 'left', outline = false) {
    const { offsetX, offsetY, k } = this._transform;
    this._font(ctx, size);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    drawText(ctx, text, offsetX + x * k, offsetY + y * k, { outline, outlineColor: C.outline, outlineWidth: Math.max(1, 1.5 * k) });
  }

  // 2px 체크무늬 디더(목업 --dither) - 반투명 대신 단색 + 투명.
  _dither(ctx, x, y, w, h) {
    const cell = Math.max(1, Math.round(2 * this._transform.k));
    if (this._ditherCell !== cell) {
      const c = document.createElement('canvas');
      c.width = c.height = cell * 2;
      const g = c.getContext('2d');
      g.fillStyle = C.outline;
      g.fillRect(cell, 0, cell, cell);
      g.fillRect(0, cell, cell, cell);
      this._ditherPat = ctx.createPattern(c, 'repeat');
      this._ditherCell = cell;
    }
    const { offsetX, offsetY, k } = this._transform;
    ctx.fillStyle = this._ditherPat;
    ctx.fillRect(offsetX + x * k, offsetY + y * k, w * k, h * k);
  }

  // 단어 단위 줄바꿈(basis 폭). 한 단어가 폭보다 길면 그대로 둔다.
  _wrap(ctx, text, maxW, size) {
    const out = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && this._measure(ctx, next, size) > maxW) {
          out.push(line);
          line = word;
        } else line = next;
      }
      out.push(line);
    }
    return out;
  }

  // ---- 그리기 ----

  draw(ctx, width, height, nowMs, assets) {
    ctx.fillStyle = C.outline;
    ctx.fillRect(0, 0, width, height);
    if (width <= 0 || height <= 0) return;
    if (this._dirty && this.env) {
      this._dirty = false;
      this._rebuild();
    }
    this._assets = assets;
    const scale = Math.min(width / NATIVE_W, height / NATIVE_H);
    const offsetX = (width - NATIVE_W * scale) / 2;
    const offsetY = (height - NATIVE_H * scale) / 2;
    this._transform = { offsetX, offsetY, k: scale / DRAW_SCALE };
    const now = Date.now();
    if (now >= this._nextExpiry) this._rebuild(); // 기간 한정 팩 시간이 끝나면 목록에서 뺀다.

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this._fill(ctx, C.bg1, 0, 0, NATIVE_W * DRAW_SCALE, BASIS_H);
    this._drawTop(ctx);
    this._drawRail(ctx);
    this._nine(ctx, 'upgrade/tab_body.png', ...PANEL);
    this._drawList(ctx, now);
    if (this.popup) this._drawPopup(ctx, nowMs);
    if (this.toast) {
      if (now > this.toast.until) this.toast = null;
      else this._drawToast(ctx);
    }
    ctx.restore();
  }

  _drawTop(ctx) {
    this._img(ctx, `upgrade/btn_close${this._pressed === 'close' ? '_pressed' : ''}.png`, CLOSE.img[0], CLOSE.img[1]);
    const [bx, by, , bh] = BAR;
    this._nine(ctx, 'menu/plate.png', ...BAR);
    const midY = by + bh / 2;
    const player = this.env?.player;
    for (const item of BAR_ITEMS) {
      this._img(ctx, item.icon, bx + item.iconX, midY - 16);
      this._nine(ctx, 'menu/inset.png', bx + item.boxX, by + 14, item.boxW, 28);
      this._text(ctx, fmt(player?.[item.key] ?? 0), bx + item.boxX + item.boxW - 5, midY, 11, C.bone, 'right', true);
    }
    this._img(ctx, `buttons/btn_plus${this._pressed === 'plus' ? '_pressed' : ''}.png`, PLUS.img[0], PLUS.img[1]);
  }

  _railRect(i) {
    return [RAIL.x, RAIL.y + i * (RAIL.h + RAIL.gap), RAIL.w, RAIL.h];
  }

  _drawRail(ctx) {
    this.rails.forEach((id, i) => {
      const [x, y, w, h] = this._railRect(i);
      const on = id === this.rail;
      this._nine(ctx, on ? 'upgrade/card_selected.png' : 'upgrade/card.png', x, y, w, h);
      this._img(ctx, `shop/rail_${id}.png`, x + w / 2 - 12, y + 11, 24, 24);
      this._text(ctx, t(`shop.rail.${id}`), x + w / 2, y + 50, 22, on ? C.goldL : C.bg3, 'center');
      if (id === 'packs' && this.newPack) this._img(ctx, 'menu/badge.png', x + 82, y + 2);
    });
  }

  _drawList(ctx, now) {
    const { offsetX, offsetY, k } = this._transform;
    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX + LIST.x * k, offsetY + LIST.y * k, LIST.w * k, LIST.h * k);
    ctx.clip();
    const top = this.scroll;
    for (const row of this.entries) {
      if (row.y + row.h + 16 < top || row.y - 16 > top + LIST.h) continue;
      const y = LIST.y + row.y - top;
      if (row.e.hdr) this._drawHeader(ctx, row, y);
      else if (row.e.legal) this._drawLegal(ctx, y);
      else if (row.e.banner) this._drawBanner(ctx, row, y, now);
      else this._drawCard(ctx, row, y);
    }
    ctx.restore();
  }

  _drawHeader(ctx, row, y) {
    const key = `shop.hdr.${row.e.hdr}`;
    const x = CARD.x;
    this._text(ctx, t(`${key}.title`), x + 2, y + 21, 22, C.goldL);
    const note = t(`${key}.note`, row.e.params ?? undefined);
    if (note) this._text(ctx, note, x + CARD.w - 2, y + 27, 11, C.bg3, 'right');
    this._fill(ctx, C.bg2, x, y + HDR_H - 2, CARD.w, 2);
  }

  // 구매 내역 복원은 복원이 있는 마켓(iOS)에서만.
  _legalParts() {
    return platform.caps.restore ? ['restore', 'terms', 'refund'] : ['terms', 'refund'];
  }

  // 결제가 끝난 주문 지급(시작 시 미지급 복구·구매 복원) - 성공이면 true(어댑터가 스토어에 지급 완료를 알린다).
  grantPaid(productKey, orderId) {
    if (!this.env) return false;
    const res = grantPaidProduct(this._ctx(), productKey, `iap:${productKey}:${orderId}`);
    if (res.ok && !res.duplicate) {
      this.env.save();
      this.changed = true;
      this._dirty = true;
    }
    return res.ok && { delta: res.delta ?? null }; // 이미 받은 주문(duplicate)은 delta null
  }

  // 환불된 비소모성 주문 - 결제로만 얻는 플래그(광고 제거) 회수.
  revokePaid(productKey, orderId) {
    if (!this.env) return;
    const res = revokePaidProduct(this._ctx(), productKey, orderId);
    if (res.ok && res.removed?.length) {
      this.env.save();
      this._dirty = true;
    }
  }

  async _restore() {
    const results = await restore(
      (key, orderId) => this.grantPaid(key, orderId),
      (key, orderId) => this.revokePaid(key, orderId)
    );
    const n = results.filter((r) => r.ok).length;
    this._showToast(n > 0 ? t('shop.toast.restored', { n }) : t('shop.toast.restoreNone'));
  }

  _drawLegal(ctx, y) {
    const parts = this._legalParts();
    const w = CARD.w / parts.length;
    parts.forEach((p, i) => {
      const label = t(`shop.legal.${p}`);
      const cx = CARD.x + w * i + w / 2;
      this._text(ctx, label, cx, y + LEGAL_H / 2, 11, C.bg3, 'center');
      const lw = this._measure(ctx, label, 11);
      this._fill(ctx, C.bg3, cx - lw / 2, y + LEGAL_H / 2 + 7, lw, 1);
    });
  }

  // 슬롯 아이콘(44x44): items/slot 틀 + 그림 28x28. wide(묶음) = 겹친 화폐 아이콘.
  _drawIcon(ctx, p, tx, x, y) {
    if (p.kind === 'diaBundle' || p.kind === 'goldEx') {
      const icon = p.kind === 'goldEx' ? 'icons/gold.png' : 'icons/diamond.png';
      for (const [dx, dy] of STACK_POS[p.stack] ?? STACK_POS[1]) this._img(ctx, icon, x + dx, y + dy, 32, 32);
      return;
    }
    this._img(ctx, p.kind === 'slot4' ? 'items/slot_locked.png' : 'items/slot_normal.png', x, y, 44, 44);
    if (p.item) {
      const state = this.env?.itemIcons?.()?.get(p.item);
      if (uiReady(state)) this._drawState(ctx, state, x + 8, y + 8, 28, 28);
      if (p.kind === 'itemBundle') this._text(ctx, `×${p.count}`, x + 42, y + 36, 11, C.bone, 'right', true);
      return;
    }
    let path = null;
    if (p.kind === 'skill' || p.kind === 'skillUnlock') path = `shop/skill_${p.skill}.png`;
    else if (p.kind === 'totem') path = 'shop/totem_unknown.png';
    else if (p.kind === 'pack' || p.kind === 'passClaim') path = `shop/${this.env.cfg.packs[p.pack].icon}.png`;
    if (path) this._img(ctx, path, x + 8, y + 8, 28, 28);
    if (p.special) {
      Object.keys(this.env.cfg.skills.color).forEach((c, i) => this._fill(ctx, SKILL_DOT[c], x + 12 + i * 6, y + 38, 4, 4));
    }
  }

  // 카드 설명 줄(폭에 맞춰 줄바꿈, 배율이 바뀔 때만 다시 잰다).
  _lines(ctx, row, maxW, maxLines) {
    const k = this._transform.k;
    if (row.linesK !== k) {
      const desc = row.tx.desc ?? [];
      // 팩 구성품은 " · "로 이어 붙여 줄바꿈.
      const src = row.e.kind === 'pack' && row.tx.parts ? [row.tx.parts.join(' · ')] : desc;
      // em = 금색 강조(젬 스킬의 수치 줄 emSecond, 다이아 첫 구매 descEm) - 줄바꿈으로 이어진 줄은 원래 줄 색을 따른다.
      row.lines = src.flatMap((s, i) => this._wrap(ctx, s, maxW, 11).map((text) => ({ text, em: (i > 0 && !!row.tx.emSecond) || !!row.tx.descEm }))).slice(0, maxLines);
      row.linesK = k;
    }
    return row.lines;
  }

  _drawTag(ctx, [key, tone, n], rightX, topY) {
    const label = t(key, { n });
    const w = this._measure(ctx, label, 11) + 12;
    this._fill(ctx, C.outline, rightX - w, topY, w, 22);
    this._fill(ctx, TAG_BG[tone] ?? C.red, rightX - w + 2, topY + 2, w - 4, 18);
    this._text(ctx, label, rightX - w / 2, topY + 11, 11, tone === 'gold' ? C.outline : C.bone, 'center');
    return w;
  }

  _drawCard(ctx, row, y) {
    const { e: p, tx } = row;
    const x = CARD.x;
    const w = CARD.w;
    const h = CARD.h;
    this._nine(ctx, this.sel === p.id ? 'upgrade/card_selected.png' : 'upgrade/card.png', x, y, w, h);
    const ix = x + 8;
    const iy = y + 8;
    const iw = w - 16;
    const left = ix + (tx.wide ? 88 : 56);
    this._drawIcon(ctx, p, tx, ix + 4, iy + 4);
    this._text(ctx, tx.name, left, iy + 15, 22, C.bone, 'left', true);
    const lines = this._lines(ctx, row, ix + iw - 140 - left, 2);
    lines.forEach((line, i) => this._text(ctx, line.text, left, iy + 35 + i * 14, 11, line.em ? C.goldL : C.bone));
    if (tx.sub) this._text(ctx, tx.sub, left, iy + 69, 11, C.blueL);
    if (p.state === 'sold') this._dither(ctx, x, y, w, h);
    this._drawPrice(ctx, p, tx, ix + iw - 132, iy + 16, 132, 48);
    if (tx.tag) this._drawTag(ctx, tx.tag, x + w - 4, y - 8);
  }

  _drawBanner(ctx, row, y, now) {
    const { e: p, tx } = row;
    const x = CARD.x;
    const w = CARD.w;
    const h = CARD.bannerH;
    this._nine(ctx, 'upgrade/card.png', x, y, w, h);
    const ix = x + 8;
    const iy = y + 8;
    const iw = w - 16;
    const ih = h - 16;
    this._img(ctx, `shop/${this.env.cfg.packs[p.pack].banner}.png`, ix + 4, iy + 4, 120, 120);
    this._text(ctx, tx.name, ix + 136, iy + 11, 22, C.goldL, 'left', true);
    this._text(ctx, t('shop.pack.contents'), ix + 136, iy + 37, 11, C.blueL);
    this._lines(ctx, row, iw - 136 - 4, 5).forEach((line, i) => this._text(ctx, line.text, ix + 136, iy + 57 + i * 14, 11));
    let tagX = ix + 4;
    for (const tag of tx.bannerTags) {
      const tw = this._measure(ctx, t(tag[0], { n: tag[2] }), 11) + 12;
      this._drawTag(ctx, tag, tagX + tw, iy + 130);
      tagX += tw + 6;
    }
    const tyTop = iy + ih - 4 - 44;
    this._nine(ctx, 'panels/panel_inset.png', ix + 4, tyTop, 168, 44);
    const label = t('shop.pack.timer');
    const timeText = hms(p.expiresAt - now);
    const lw = this._measure(ctx, label, 11);
    const tw = this._measure(ctx, timeText, 22);
    const startX = ix + 4 + (168 - (lw + 6 + tw)) / 2;
    this._text(ctx, label, startX, tyTop + 22, 11);
    this._text(ctx, timeText, startX + lw + 6, tyTop + 22, 22, C.redL);
    this._drawPrice(ctx, p, tx, ix + iw - 180, iy + ih - 48, 180, 48);
  }

  // 가격 버튼(9-slice). 해금 버튼은 '해금'을 버튼 위 작은 라벨로(132px 안에 다 안 들어감).
  _drawPrice(ctx, p, tx, x, y, w, h, pressed = false) {
    const cy = y + h / 2 - 1 + (pressed ? 2 : 0);
    const cx = x + w / 2;
    const content = (iconPath, iconSize, label, size, color) => {
      const lw = this._measure(ctx, label, size);
      const total = (iconPath ? iconSize + 6 : 0) + lw;
      let sx = cx - total / 2;
      if (iconPath) {
        this._img(ctx, iconPath, sx, cy - iconSize / 2, iconSize, iconSize);
        sx += iconSize + 6;
      }
      this._text(ctx, label, sx, cy, size, color);
    };
    const btn = (name) => this._nine(ctx, `${name}${pressed && name.startsWith('buttons/') ? '_pressed' : ''}.png`, x, y, w, h);
    if (p.state === 'locked') {
      btn('upgrade/btn_disabled');
      content('icons/lock.png', 24, tx.lockText ?? '', 11, C.bg3);
      return;
    }
    if (p.state === 'sold') {
      btn('upgrade/btn_disabled');
      content(null, 0, tx.soldText ?? t('shop.sold.bought'), 11, C.bg3);
      return;
    }
    if (p.cur === 'free') {
      btn('buttons/btn_primary');
      content(null, 0, tx.label, 11, C.bone);
      return;
    }
    if (p.cur === 'claim') {
      btn('buttons/btn_primary');
      content('icons/diamond.png', 32, tx.label, 11, C.bone);
      return;
    }
    if (p.cur === 'krw') {
      btn('buttons/btn_gold');
      content(null, 0, `₩${fmt(p.price)}`, 22, C.outline);
      return;
    }
    const poor = walletOf(this.env.player, p.cur) < p.price;
    btn(poor ? 'upgrade/btn_disabled' : p.cur === 'gold' ? 'buttons/btn_gold' : 'buttons/btn_primary');
    content(p.cur === 'gold' ? 'icons/gold.png' : 'icons/diamond.png', 32, fmt(p.price), 22, poor ? C.redL : p.cur === 'gold' ? C.outline : C.bone);
    if (tx.prefix) this._text(ctx, tx.prefix, cx, y - 12, 11, C.goldL, 'center');
  }

  // ---- 팝업 ----

  // 팝업 세로 배치(basis). 글자 줄바꿈이 필요해서 그리는 시점(배율을 알 때)에 한 번 계산한다.
  _popupLayout(ctx) {
    const pop = this.popup;
    const k = this._transform.k;
    if (pop.layout && pop.layoutK === k) return pop.layout;
    const { p, tx, step } = pop;
    const innerW = POP.w - POP.border * 2;
    const rows = [];
    let y = 0;
    const add = (type, h, margin, extra) => {
      y += margin;
      rows.push({ type, y, h, ...extra });
      y += h;
    };
    add('head', 52, 0);
    const para = this._wrap(ctx, tx.long ?? (tx.desc ?? []).join(' '), innerW, 11);
    add('para', para.length * 18, 8, { lines: para });
    if (tx.info?.length) add('info', tx.info.length * 16 + 22, 8);
    const krw = p.cur === 'krw';
    if (krw && step !== 'done') add('note', 52, 8, { lines: [t('shop.popup.store'), t('shop.popup.store2')] });
    if (p.kind === 'free' && tx.note) add('note', 38, 8, { lines: tx.note });
    if (krw && step === 'done') add('done', 64, 8);
    if (p.qty && step === 'confirm') add('qty', 52, 10);
    if (p.cur === 'gold' || p.cur === 'dia' || (krw && step !== 'done')) add('total', 48, 10);
    add('acts', 52, 12);
    const h = y + POP.border * 2;
    const top = Math.max(100, Math.round((BASIS_H - h) / 2));
    pop.layout = { rows, h, top, innerX: POP.x + POP.border, innerY: top + POP.border, innerW };
    pop.layoutK = k;
    return pop.layout;
  }

  // 팝업 버튼들의 basis 사각형(그리기와 터치 판정이 같은 값을 쓴다).
  _popupButtons(layout) {
    const { p, step } = this.popup;
    const { innerX, innerY, innerW, rows, top } = layout;
    const out = { x: { img: [POP.x + POP.w - 52 + 6, top + 8 + 6], hit: [POP.x + POP.w - 52 - 10, top - 8, 64, 64] } };
    for (const r of rows) {
      const ry = innerY + r.y;
      if (r.type === 'qty') {
        out.minus = [innerX, ry, 52, 52];
        out.plus = [innerX + 128, ry, 52, 52];
        out.qtyBox = [innerX + 58, ry, 64, 52];
        this.env.cfg.qtyQuick.forEach((n, i, arr) => {
          out[`q${n}`] = [innerX + innerW - (arr.length - i) * 66 + 6, ry, 60, 52];
        });
      }
      if (r.type === 'acts') {
        if (step === 'done') out.ok = [innerX, ry, innerW, 52];
        else if (step === 'confirm') {
          const bw = (innerW - 10) / 2;
          out.cancel = [innerX, ry, bw, 52];
          out.buy = [innerX + bw + 10, ry, bw, 52];
        }
      }
    }
    if (p.cur === 'krw' && step === 'paying') out.cancel = null;
    return out;
  }

  _popupTotal() {
    const { p, qty } = this.popup;
    return (p.price ?? 0) * (p.qty ? qty : 1);
  }

  _drawPopup(ctx, nowMs = 0) {
    const F = screen.full; // 블리드까지(basis 좌표로)
    const { offsetX, offsetY, k } = this._transform;
    this._dither(ctx, (F.x - offsetX) / k, (F.y - offsetY) / k, F.width / k, F.height / k);
    const layout = this._popupLayout(ctx);
    const { p, tx, step } = this.popup;
    const { innerX, innerY, innerW, h, top } = layout;
    this._nine(ctx, 'menu/popup_menu.png', POP.x, top, POP.w, h);
    const btns = this._popupButtons(layout);
    this._img(ctx, `upgrade/btn_close${this._pressed === 'px' ? '_pressed' : ''}.png`, btns.x.img[0], btns.x.img[1]);
    const total = this._popupTotal();
    const poor = (p.cur === 'gold' || p.cur === 'dia') && walletOf(this.env.player, p.cur) < total;

    for (const r of layout.rows) {
      const ry = innerY + r.y;
      if (r.type === 'head') {
        this._drawIcon(ctx, p, tx, innerX, ry);
        const nx = innerX + (tx.wide ? 88 : 56);
        this._text(ctx, tx.name, nx, ry + 11, 22, C.goldL, 'left', true);
        if (tx.sub) this._text(ctx, tx.sub, nx, ry + 37, 11, C.blueL);
      } else if (r.type === 'para') {
        r.lines.forEach((line, i) => this._text(ctx, line, innerX, ry + 9 + i * 18, 11));
      } else if (r.type === 'info') {
        this._nine(ctx, 'panels/panel_inset.png', innerX, ry, innerW, r.h);
        const labelW = Math.max(...tx.info.map(([a]) => this._measure(ctx, a, 11)));
        tx.info.forEach(([a, b], i) => {
          this._text(ctx, a, innerX + 14, ry + 19 + i * 16, 11, C.bg3);
          this._text(ctx, b, innerX + 14 + labelW + 12, ry + 19 + i * 16, 11);
        });
      } else if (r.type === 'note') {
        this._nine(ctx, 'panels/panel_inset.png', innerX, ry, innerW, r.h);
        r.lines.forEach((line, i) => this._text(ctx, line, innerX + innerW / 2, ry + 19 + i * 14, 11, C.bone, 'center'));
      } else if (r.type === 'done') {
        this._nine(ctx, 'panels/panel_inset.png', innerX, ry, innerW, r.h);
        this._text(ctx, t('shop.popup.done'), innerX + innerW / 2, ry + 21, 22, C.grnL, 'center');
        this._text(ctx, this.popup.gotText ?? '', innerX + innerW / 2, ry + 45, 11, C.grnL, 'center');
      } else if (r.type === 'qty') {
        this._button(ctx, 'buttons/btn_secondary', btns.minus, '−', 22, 'minus');
        this._nine(ctx, 'menu/inset.png', ...btns.qtyBox);
        this._text(ctx, String(this.popup.qty), btns.qtyBox[0] + 32, ry + 26, 22, C.bone, 'center');
        this._button(ctx, 'buttons/btn_secondary', btns.plus, '+', 22, 'plusq');
        for (const n of this.env.cfg.qtyQuick) {
          this._button(ctx, this.popup.qty === n ? 'buttons/btn_primary' : 'buttons/btn_secondary', btns[`q${n}`], t('shop.popup.qtyN', { n }), 11, `q${n}`);
        }
      } else if (r.type === 'total') {
        this._nine(ctx, 'panels/panel_inset.png', innerX, ry, innerW, 48);
        this._text(ctx, t(p.cur === 'krw' ? 'shop.popup.price' : 'shop.popup.total'), innerX + 16, ry + 24, 11);
        if (p.cur === 'krw') this._text(ctx, `₩${fmt(p.price)}`, innerX + innerW - 16, ry + 24, 22, C.bone, 'right');
        else {
          const s = fmt(total);
          const sw = this._measure(ctx, s, 22);
          this._img(ctx, p.cur === 'gold' ? 'icons/gold.png' : 'icons/diamond.png', innerX + innerW - 16 - sw - 38, ry + 8, 32, 32);
          this._text(ctx, s, innerX + innerW - 16, ry + 24, 22, poor ? C.redL : C.bone, 'right');
        }
      } else if (r.type === 'acts') {
        if (btns.ok) this._button(ctx, 'buttons/btn_primary', btns.ok, t('shop.popup.ok'), 22, 'ok');
        if (btns.cancel) this._button(ctx, 'buttons/btn_secondary', btns.cancel, t('shop.popup.cancel'), 22, 'cancel');
        if (btns.buy) {
          const label = p.cur === 'krw' ? t('shop.popup.pay') : p.kind === 'free' ? t('shop.popup.claim') : tx.prefix ?? t('shop.popup.buy');
          const skin = poor ? 'upgrade/btn_disabled' : p.cur === 'gold' || p.cur === 'krw' ? 'buttons/btn_gold' : 'buttons/btn_primary';
          this._button(ctx, skin, btns.buy, label, 22, 'buy', poor ? C.bg3 : skin === 'buttons/btn_gold' ? C.outline : C.bone);
        }
        if (step === 'paying') {
          // 결제 중 표시: . .. ... 를 400ms마다 돌린다. 왼쪽 기준을 '...' 폭으로 고정해 점이 늘어도 자리가 안 흔들린다.
          const dots = DOTS[Math.floor(nowMs / DOTS_MS) % DOTS.length];
          this._text(ctx, dots, innerX + innerW / 2 - this._measure(ctx, '...', 22) / 2, ry + 26, 22, C.bone, 'left');
        }
      }
    }
  }

  _button(ctx, skin, rect, label, size, id, color = C.bone) {
    const down = this._pressed === id;
    const path = skin.startsWith('buttons/') && down ? `${skin}_pressed.png` : `${skin}.png`;
    this._nine(ctx, path, ...rect);
    this._text(ctx, label, rect[0] + rect[2] / 2, rect[1] + rect[3] / 2 - 1 + (down ? 2 : 0), size, color, 'center');
  }

  _drawToast(ctx) {
    const [x, y, w, h] = TOAST;
    this._nine(ctx, 'panels/panel_iron.png', x, y, w, h);
    this._text(ctx, this.toast.msg, x + 20, y + h / 2, 11);
    if (this.toast.action && this.toast._w == null) this.toast._w = this._measure(ctx, this.toast.action[0], 11);
    const r = this._toastAction();
    if (r) this._button(ctx, 'buttons/btn_primary', r, this.toast.action[0], 11, 'toastAct');
  }

  // 토스트 이동 버튼(basis). 글자 폭은 _drawToast가 처음 그릴 때 잰다.
  _toastAction() {
    if (!this.toast?.action || this.toast._w == null) return null;
    const [x, y, w, h] = TOAST;
    const bw = Math.ceil(this.toast._w) + 36;
    return [x + w - 20 - bw, y + (h - 44) / 2, bw, 44];
  }

  // ---- 상태 바꾸기 ----

  _showToast(msg, action = null) {
    this.toast = { msg, action, until: Date.now() + TOAST_MS, _w: null };
  }

  // 마켓 결제 전에 사용자가 할 일(원스토어 서비스 앱 로그인/설치)이 있으면 안내 + 버튼 토스트. 띄운 상태 값 또는 null.
  _storeNotice() {
    const st = platform.iap.getStoreStatus?.() ?? null; // 원스토어 provider만 구현(어댑터 iap는 통째로 바뀐다).
    if (st) this._showToast(t(`shop.toast.store_${st}`), [t(`shop.toast.storeBtn_${st}`), 'storeFix']);
    return st;
  }

  // 구매 버튼: 로그인 전이면 안내만 하지 않고 원스토어 로그인 창까지 연다. 처리했으면 true.
  _storeGate() {
    const st = this._storeNotice();
    if (st === 'needLogin') this._fixStore();
    return !!st;
  }

  _fixStore() {
    this.toast = null;
    platform.iap.fixStoreStatus().then((ok) => (ok ? this._showToast(t('shop.toast.storeOk')) : this._storeNotice()));
  }

  _poorToast(cur) {
    audio.play('ui_purchase_fail');
    if (cur === 'gold') this._showToast(t('shop.toast.poorGold'), [t('shop.toast.toGoldex'), 'goldex']);
    else this._showToast(t('shop.toast.poorDia'), [t('shop.toast.toDia'), 'dia']);
  }

  // 레일 이동(+ 머리글로 스크롤). where = 'dia' | 'goldex'
  goTo(where) {
    this.toast = null;
    this.popup = null;
    this.rail = 'dia';
    this.scroll = 0;
    this._rebuild();
    if (where === 'goldex') this._scrollToHdr('goldex');
  }

  _scrollToHdr(hdr) {
    const row = this.entries.find((r) => r.e.hdr === hdr);
    if (row) this.scroll = row.y;
    this._clampScroll();
  }

  setRail(rail) {
    if (rail === this.rail) return;
    this.rail = rail;
    this.scroll = 0;
    this.sel = null;
    this._rebuild();
    if (CASH_RAILS.has(rail)) this._storeNotice();
  }

  // 뒤로 가기: 팝업 -> 토스트 순으로 닫는다. 닫은 게 있으면 true(상점은 그대로).
  closeOverlay() {
    if (this.popup && this.popup.step !== 'paying') {
      this.popup = null;
      return true;
    }
    return false;
  }

  // 수량 선택 상한 = min(qtyMax, 999 - 보유 수).
  _qtyMax(p) {
    return Math.min(this.env.cfg.qtyMax, ITEM_CAP - this.env.player.inventory.count(p.item));
  }

  _openPopup(p, tx) {
    this.popup = { p, tx, qty: 1, step: 'confirm', layout: null, layoutK: 0 };
  }

  _tapCard(row) {
    const { e: p, tx } = row;
    this.sel = p.id;
    if (p.state === 'locked') return this._showToast(tx.lockMsg ?? tx.lockText ?? '');
    if (p.state === 'sold') {
      const key = p.kind === 'skill' ? 'shop.toast.maxLevel' : p.kind === 'free' || p.kind === 'passClaim' ? 'shop.toast.tomorrow' : 'shop.toast.already';
      return this._showToast(t(key));
    }
    if (p.kind === 'passClaim') return this._buy(p, tx, 1);
    if (p.cur === 'krw' && this._storeGate()) return;
    if ((p.cur === 'gold' || p.cur === 'dia') && walletOf(this.env.player, p.cur) < p.price) return this._poorToast(p.cur);
    if (p.qty && this._qtyMax(p) < 1) {
      audio.play('ui_purchase_fail');
      return this._showToast(t('shop.toast.cap'));
    }
    audio.play('ui_click');
    this._openPopup(p, tx);
  }

  // buyProduct + 저장 + 목록 갱신 + 토스트. krw는 결제가 끝난 뒤에만 부른다.
  _buy(p, tx, qty, txId = null) {
    const ctx = this._ctx();
    const res = buyProduct(ctx, p.id, qty, txId);
    if (!res.ok) {
      if (res.reason === 'poor') this._poorToast(p.cur); // 실패음은 _poorToast가 낸다.
      else {
        audio.play('ui_purchase_fail');
        if (res.reason === 'cap') this._showToast(t('shop.toast.cap'));
        else this._showToast(t(res.reason === 'sold' ? 'shop.toast.already' : 'shop.toast.gone'));
      }
      return res;
    }
    audio.play('ui_purchase');
    this.env.save();
    this.changed = true;
    this._rebuild();
    if (p.kind === 'skill') this._showToast(t('shop.toast.levelUp', { name: tx.name, lv: res.got.skillLv }));
    else if (p.kind === 'skillUnlock') this._showToast(t('shop.toast.unlocked', { name: tx.name }));
    else if (p.kind === 'item') this._showToast(t('shop.toast.bought', { name: tx.name, n: res.qty }));
    else if (REWARD_KINDS.has(p.kind) && this.env.showReward) this.env.showReward(rewardFromDelta(res.delta));
    else this._showToast(t('shop.toast.got', { what: gotText(res.got) }));
    return res;
  }

  _confirmBuy() {
    const { p, tx, qty } = this.popup;
    if (p.cur === 'krw') {
      this.popup.step = 'paying';
      this.popup.layout = null;
      const pop = this.popup;
      audio.pauseFor('purchase'); // 결제 창 동안 BGM 정지(토스 심사).
      // 지급은 결제 도중 어댑터가 grant를 부를 때 - 주문 id로 txId를 만들어 같은 결제가 두 번 지급되지 않게
      // (docs/inventory.md 4장). 지급이 성공해야 어댑터가 스토어에 완료를 알린다. 팝업을 닫아도 지급은 된다.
      let res = null;
      const onGrant = (productKey, orderId) => {
        res = this._buy(p, tx, 1, `iap:${productKey}:${orderId}`);
        return res.ok && { delta: res.delta ?? null }; // 참 = 지급 성공, delta는 서버 기록용(src/shop/iap.js)
      };
      purchase(p.id, onGrant).then((r) => {
        audio.resumeFor('purchase');
        if (!r?.ok || !res?.ok) {
          if (this.popup === pop) this.popup = null;
          // 결제 중에 로그인이 필요하다고 나오면(원스토어) 로그인 창으로. 지급 실패 토스트는 _buy가 이미 띄웠다.
          if (r?.reason === 'verifying') this._showToast(t('shop.toast.verifying')); // iapStrict: 서버 확인 뒤 지급
          else if (!res && !(r?.reason === 'needLogin' && this._storeGate())) {
            audio.play('ui_purchase_fail');
            this._showToast(t('shop.toast.payFail'));
          }
          return;
        }
        if (this.popup !== pop) return;
        if (REWARD_KINDS.has(p.kind) && this.env.showReward) {
          this.popup = null; // 패키지는 획득 팝업이 알려 준다.
          return;
        }
        this.toast = null; // 완료 화면이 대신 알려 준다.
        pop.step = 'done';
        pop.gotText = gotText(res.got);
        pop.layout = null;
      });
      return;
    }
    if ((p.cur === 'gold' || p.cur === 'dia') && walletOf(this.env.player, p.cur) < this._popupTotal()) return this._poorToast(p.cur);
    this.popup = null;
    this._buy(p, tx, qty);
  }

  // ---- 입력(css px, 캔버스 기준) ----

  // 'exit'를 돌려주면 main.js가 메뉴로 돌아간다.
  handlePointerDown(x, y) {
    if (!this._transform || !this.env) return null;
    const [bx, by] = this._toBasis(x, y);
    if (this.popup) {
      this._popupPointerDown(bx, by);
      return null;
    }
    const act = this._toastAction();
    if (act && inRect(bx, by, [act[0], TOAST[1], act[2], TOAST[3]])) {
      this._pressed = 'toastAct';
      audio.play('ui_click');
      if (this.toast.action[1] === 'storeFix') this._fixStore();
      else this.goTo(this.toast.action[1]);
      return null;
    }
    if (inRect(bx, by, CLOSE.hit)) {
      this._pressed = 'close';
      pressButton(x, y, this._screenRect(CLOSE.hit), 'cancel');
      return 'exit';
    }
    if (inRect(bx, by, PLUS.hit)) {
      this._pressed = 'plus';
      audio.play('ui_click');
      this.goTo('dia');
      return null;
    }
    for (let i = 0; i < this.rails.length; i++) {
      if (!inRect(bx, by, this._railRect(i))) continue;
      if (this.rails[i] !== this.rail) audio.play('ui_click');
      this.setRail(this.rails[i]);
      return null;
    }
    if (inRect(bx, by, [LIST.x, LIST.y, LIST.w, LIST.h])) this._drag = { y0: y, scroll0: this.scroll, moved: false, bx, by };
    return null;
  }

  _popupPointerDown(bx, by) {
    const layout = this.popup.layout;
    if (!layout) return;
    const b = this._popupButtons(layout);
    const hit = (r) => r && inRect(bx, by, r);
    if (this.popup.step === 'paying') return; // 결제 중엔 닫지 않는다.
    if (hit(b.x.hit) || hit(b.cancel) || hit(b.ok)) {
      this._pressed = hit(b.x.hit) ? 'px' : hit(b.ok) ? 'ok' : 'cancel';
      audio.play('ui_cancel');
      this.popup = null;
      return;
    }
    if (hit(b.buy)) {
      this._pressed = 'buy'; // 버튼음 없음: 결과음(ui_purchase / ui_purchase_fail)이 대신한다.
      this._confirmBuy();
      return;
    }
    const max = this._qtyMax(this.popup.p);
    if (hit(b.minus) || hit(b.plus)) {
      this._pressed = hit(b.minus) ? 'minus' : 'plusq';
      this.popup.qty = Math.max(1, Math.min(max, this.popup.qty + (hit(b.minus) ? -1 : 1)));
      audio.play('ui_click');
      return;
    }
    for (const n of this.env.cfg.qtyQuick) {
      if (!hit(b[`q${n}`])) continue;
      this._pressed = `q${n}`;
      this.popup.qty = Math.max(1, Math.min(max, n));
      audio.play('ui_click');
      return;
    }
    const { top, h } = layout;
    if (!inRect(bx, by, [POP.x, top, POP.w, h])) {
      audio.play('ui_cancel');
      this.popup = null; // 바깥(디더) 탭 = 닫기.
    }
  }

  handlePointerMove(x, y) {
    if (!this._drag || !this._transform) return;
    const dy = y - this._drag.y0;
    if (Math.abs(dy) > DRAG_SLOP) this._drag.moved = true;
    if (!this._drag.moved) return;
    this.scroll = this._drag.scroll0 - dy / this._transform.k;
    this._clampScroll();
  }

  handlePointerUp() {
    const drag = this._drag;
    this._drag = null;
    this._pressed = null;
    if (!drag || drag.moved) return;
    const ly = drag.by - LIST.y + this.scroll;
    const row = this.entries.find((r) => ly >= r.y && ly < r.y + r.h);
    if (!row || row.e.hdr) return;
    if (row.e.legal) {
      const parts = this._legalParts();
      const i = Math.max(0, Math.min(parts.length - 1, Math.floor(((drag.bx - CARD.x) / CARD.w) * parts.length)));
      audio.play('ui_click');
      if (parts[i] === 'restore') this._restore();
      else this._showToast(t('shop.legal.page', { name: t(`shop.legal.${parts[i]}`) }));
      return;
    }
    if (drag.bx < CARD.x || drag.bx >= CARD.x + CARD.w) return;
    this._tapCard(row);
  }

  // 브라우저가 제스처를 가져간 경우(pointercancel) - 탭으로 처리하지 않는다.
  cancelPointer() {
    this._drag = null;
    this._pressed = null;
  }

  handleWheel(deltaY) {
    if (!this._transform || this.popup) return;
    this.scroll += deltaY / this._transform.k;
    this._clampScroll();
  }
}
