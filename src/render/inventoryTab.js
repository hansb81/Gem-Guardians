// 보관함 화면(docs/inventory.md 5-1·5-3, 시안 mockups/inventory.html B) - 메뉴 받침대 팝업과 탑 강화 팝업 인벤토리
// 탭이 같이 쓴다. 그리기·터치 사각형만 - 장착·예약 변경은 main.js가 playerState.inventory API로 한다.
// 위→아래: [장착 칸] [다음 층 예약] [분류 탭 + 보유(폭에 맞는 열 수, 칸 간격 6, 넘치면 세로 스크롤)] [고정 설명 패널].
// 구역 상자 = ui/menu/inset 9-slice x2, 칸 = slot_*(22x22) x2 = 44px, 설명 패널 큰 칸만 x3(66px). 전부 정수 배율.
import { drawNine, drawText, getUi, getUiMeta, drawFixedImage, uiReady } from './uiKit.js';
import { getFontString } from '../config/fonts.js';
import { t } from '../config/i18n.js';
import { HUD_CONFIG } from '../config/hud.js';
import { drawImageSnapped } from './screenFit.js';

const K = 2;
const SLOT = 22 * K; // 44
const BIG_K = 3;
const BIG = 22 * BIG_K; // 66
const P = 5; // 구역 상자 안쪽 여백
const GAP = 4; // 구역 사이
const GRID_K = 3; // 보유 목록 칸만 3배(66px) - 5열(docs/upgrade-popup.md 1·5).
const GRID_SLOT = 22 * GRID_K;
const GRID_COLS = 5;
const CELL_GAP = 6; // 보유 목록 줄 사이(가로 간격은 폭에 맞춰 나눈다)
const ROW = GRID_SLOT + CELL_GAP;
const TAB_H = 32; // 분류 탭 그림 높이(터치는 위아래로 늘려 44). tab_on/off 테두리 위 12·아래 6이라 안쪽 14에 글자.
const BTN_H = 32; // 설명 패널 버튼 그림 높이(터치 44)
const HIT = 44;
const SHAKE_MS = 300;
const TOAST_MS = 1600;
const TITLE_PX = 12;
const SMALL_PX = 11;
const FILTERS = ['all', 'board', 'battle', 'other'];
const EQ_H = P + 13 + 3 + SLOT + 1 + 11 + P;
const RS_H = EQ_H + 2 + 13;
const DT_H = P + BIG + 4 + BTN_H + P;
const C = {
  title: HUD_CONFIG.text.title,
  text: HUD_CONFIG.text.primary,
  sub: HUD_CONFIG.text.dim,
  chip: '#8cc4ee',
  chipBorder: '#655a74',
  on: '#9cd872',
  outline: '#0d0a10',
  equipTag: '#c28a20',
};

// 구역 상자 4개(장착 / 다음 층 예약 / 분류 탭+보유 / 설명 패널) - 설명 패널은 아래 고정, 보유가 남는 높이를 먹는다.
export function vaultSections(rect) {
  const { x, width: w } = rect;
  const equip = { x, y: rect.y, width: w, height: EQ_H };
  const reserve = { x, y: equip.y + EQ_H + GAP, width: w, height: RS_H };
  const detail = { x, y: Math.round(rect.y + rect.height - DT_H), width: w, height: DT_H };
  const ownY = reserve.y + RS_H + GAP;
  const own = { x, y: ownY, width: w, height: detail.y - GAP - ownY };
  return { equip, reserve, own, detail };
}

// 보유 아이템 그룹: hotbar는 config kind(board/battle), preFloor는 예약 구역에 따로, 그 밖(onFail 부활)은 기타.
export function inventoryGroups(itemsConfig, visibleIds) {
  const out = { board: [], battle: [], other: [] };
  for (const id of visibleIds) {
    const cfg = itemsConfig.items[id];
    if (cfg.group === 'preFloor') continue;
    if (cfg.group === 'hotbar') (cfg.kind === 'battle' ? out.battle : out.board).push(id);
    else out.other.push(id);
  }
  return out;
}

// 분류 탭 필터 - 'all'은 예약 아이템을 뺀 전부(config 순서).
export function filterItems(itemsConfig, visibleIds, filter) {
  if (filter !== 'all') return inventoryGroups(itemsConfig, visibleIds)[filter] ?? [];
  return visibleIds.filter((id) => itemsConfig.items[id].group !== 'preFloor');
}

// 설명 패널 버튼(최대 2개, 같은 곳으로 가는 버튼 두 개 금지 - 상점은 '상점에서 사기' 또는 '상점 가기' 하나만).
//   보유+미장착 = 장착(첫 빈 칸, 없으면 안내 swapHint) / 상점 가기   보유+장착 = 해제 / 상점 가기
//   0개+미장착 = 상점에서 사기                                      0개+장착 = 상점에서 사기 / 해제
//   예약·부활 = 상점 가기(0개면 상점에서 사기)                       고른 것 없음 = 상점 가기
// 층 진행 중이면 pending 장착 기준. hasShop이 false면 상점 버튼은 빠진다.
export function itemButtons(inv, id, hasShop = true) {
  const c = id != null ? inv.config?.items[id] : null;
  const out = [];
  const shop = (kind) => hasShop && out.push({ kind });
  if (!c) {
    shop('shop');
    return out;
  }
  const owned = inv.count(id) > 0;
  const bar = inv.pendingHotbar() ?? inv.hotbar();
  const at = c.group === 'hotbar' ? bar.indexOf(id) : -1;
  if (!owned) {
    shop('buy');
    if (at >= 0) out.push({ kind: 'unequip', slot: at });
    return out;
  }
  if (at >= 0) out.push({ kind: 'unequip', slot: at });
  else if (c.group === 'hotbar') {
    const empty = bar.indexOf(null);
    out.push(empty >= 0 ? { kind: 'equip', slot: empty } : { kind: 'swapHint' });
  }
  shop('shop');
  return out;
}

export class InventoryTab {
  constructor() {
    this._shake = { slot: -1, until: 0 };
    this._toast = null; // { text, until }
    this.filter = 'all';
    this._scroll = 0;
    this._scrollMax = 0;
  }

  // 보관함을 열 때마다 "전체", 맨 위부터.
  reset() {
    this.filter = 'all';
    this._scroll = 0;
  }

  setFilter(f) {
    this.filter = f;
    this._scroll = 0;
  }

  get scroll() {
    return this._scroll;
  }

  setScroll(v) {
    this._scroll = Math.max(0, Math.min(this._scrollMax, v));
  }

  shakeSlot(slot, nowMs) {
    this._shake = { slot, until: nowMs + SHAKE_MS };
  }

  toast(text, nowMs) {
    this._toast = { text, until: nowMs + TOAST_MS };
  }

  _shakeX(slot, nowMs) {
    const left = this._shake.slot === slot ? this._shake.until - nowMs : 0;
    return left > 0 ? Math.round(Math.sin(nowMs / 25) * 3 * (left / SHAKE_MS)) : 0;
  }

  // ui = itemUi(main.js buildItemUi) - inventory, config, bestFloor, invSel, failed, hasShop.
  // drawSlot(x, y, id, opts, k) = ItemBarRenderer.drawSlot.
  // 반환 = { equip: [rect], items: { [id]: rect }(보이는 것만), grid, preFloor: { [id]: rect }, tabs: { [filter]: rect },
  //          actions: [{ kind: 'equip'|'unequip'|'buy'|'shop', slot?, rect }], slotCount }.
  draw(ctx, rect, assets, ui, { drawSlot }, nowMs) {
    const inv = ui.inventory;
    const cfg = ui.config;
    const out = { equip: [], items: {}, grid: null, preFloor: {}, tabs: {}, actions: [], slotCount: inv.slotCount() };
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.textBaseline = 'middle';
    const { x, width: w } = rect;
    const now = inv.hotbar();
    const pending = inv.pendingHotbar();
    const shown = pending ?? now;
    const cellW = (w - P * 2) / 4;
    const cellX = (i) => Math.round(x + P + cellW * i + (cellW - SLOT) / 2);
    const sec = vaultSections(rect);
    let y = sec.equip.y;

    // ---- 장착 칸: 4칸(잠긴 칸 포함) + 이름 ----
    const eqH = EQ_H;
    this._box(ctx, assets, x, y, w, eqH);
    const filled = shown.filter((id) => id != null).length;
    // 층 진행 중(패배 후 등)이면 파란 "다음 층부터 적용", 층 밖(층 클리어 후·마을)이면 즉시 장착.
    const eqInfo = inv.inFloor ? t('inv.pending') : `${filled}/${out.slotCount} · ${t('inv.holdHint')}`;
    this._header(ctx, t('inv.equipTitle'), eqInfo, x, y, w, inv.inFloor ? C.chip : C.sub);
    const sy = y + P + 16;
    for (let i = 0; i < 4; i++) {
      const sx = cellX(i) + this._shakeX(i, nowMs);
      out.equip.push({ x: sx, y: sy, width: SLOT, height: SLOT });
      let name;
      if (i >= out.slotCount) {
        this._drawLocked(ctx, assets, sx, sy);
        name = t('inv.lockedSlot');
      } else {
        const id = shown[i] ?? null;
        const count = id != null ? inv.count(id) : null;
        drawSlot(sx, sy, id, this._slotOpts(pending != null && pending[i] !== now[i], count));
        name = id != null ? t(`item.name.${id}`) : t('inv.emptySlot');
        if (id == null) this._plus(ctx, sx, sy);
      }
      this._name(ctx, name, cellX(i) + SLOT / 2, sy + SLOT + 7, cellW - 2, i >= out.slotCount || shown[i] == null);
    }
    y = sec.reserve.y;

    // ---- 다음 층 예약: 칸 + 이름 + 예약됨/끔 ----
    const preIds = inv.visibleItems(ui.bestFloor).filter((id) => cfg.items[id].group === 'preFloor');
    const rsH = RS_H;
    this._box(ctx, assets, x, y, w, rsH);
    this._header(ctx, t('inv.reserveTitle'), t('inv.reserveInfo'), x, y, w);
    const reserve = inv.data.loadout.preFloor;
    preIds.forEach((id, i) => {
      const on = !!reserve[id];
      const sx = cellX(i);
      const count = inv.count(id);
      const ry = y + P + 16;
      drawSlot(sx, ry, id, this._slotOpts(on, count));
      this._name(ctx, t(`item.name.${id}`), sx + SLOT / 2, ry + SLOT + 7, cellW - 2, false);
      this._status(ctx, on, sx + SLOT / 2, ry + SLOT + 21);
      out.preFloor[id] = { x: Math.round(x + P + cellW * i), y: ry, width: Math.round(cellW), height: SLOT + 28 };
    });
    y = sec.own.y;

    // ---- 설명 패널(아래 고정) 자리를 먼저 빼고 남는 높이가 보유 목록 ----
    const dtH = DT_H;
    const dtY = sec.detail.y;
    const ownH = sec.own.height;

    // ---- 분류 탭 + 보유 목록 ----
    this._box(ctx, assets, x, y, w, ownH);
    const tabW = (w - P * 2 - 3 * 4) / 4;
    FILTERS.forEach((f, i) => {
      const r = { x: Math.round(x + P + i * (tabW + 4)), y: y + P, width: Math.round(tabW), height: TAB_H };
      this._tab(ctx, assets, t(`inv.filter.${f}`), r, this.filter === f);
      out.tabs[f] = { x: r.x, y: r.y + TAB_H / 2 - HIT / 2, width: r.width, height: HIT };
    });
    const grid = { x: x + P, y: y + P + TAB_H + 4, width: w - P * 2, height: Math.max(0, ownH - P * 2 - TAB_H - 4) };
    out.grid = grid;
    const ids = filterItems(cfg, inv.visibleItems(ui.bestFloor), this.filter);
    // 5열, 가로 간격은 폭에 맞춰 나눈다(스크롤 막대 자리 4 빼고). 보이는 자리는 빈 칸 틀로 채워 칸 구분이 보이게
    // (빈 칸은 누를 수 없음). 칸이 넘치면 마지막 줄이 잘려 보여 스크롤이 있다는 걸 알 수 있다.
    const cols = GRID_COLS;
    const pitchX = Math.floor((grid.width - 4 - GRID_SLOT) / (cols - 1));
    const ox = grid.x + Math.floor((grid.width - 4 - (pitchX * (cols - 1) + GRID_SLOT)) / 2);
    const rows = Math.ceil(ids.length / cols);
    this._scrollMax = Math.max(0, rows * ROW - CELL_GAP + 4 - grid.height);
    this._scroll = Math.min(this._scroll, this._scrollMax);
    const cells = Math.max(rows, Math.ceil((grid.height - 2 + CELL_GAP) / ROW)) * cols; // 빈 칸도 잘리는 줄까지 - 반 줄이 보여 스크롤이 있다는 걸 알 수 있다
    ctx.save();
    ctx.beginPath();
    ctx.rect(grid.x, grid.y, grid.width, grid.height);
    ctx.clip();
    for (let i = 0; i < cells; i++) {
      const gx = ox + (i % cols) * pitchX;
      const gy = Math.round(grid.y + 2 + Math.floor(i / cols) * ROW - this._scroll);
      if (gy + GRID_SLOT < grid.y || gy > grid.y + grid.height) continue;
      const id = ids[i];
      if (id == null) {
        drawSlot(gx, gy, null, {}, GRID_K);
        continue;
      }
      // 칸은 3배지만 개수 숫자는 장착 칸과 같은 2배 - 세 자리(최대 999)도 아이콘을 덜 가린다.
      out.items[id] = drawSlot(gx, gy, id, { ...this._slotOpts(ui.invSel === id, inv.count(id)), countK: K }, GRID_K);
      if (shown.includes(id)) this._equipTag(ctx, gx, gy);
    }
    ctx.restore();
    if (this._scrollMax > 0) this._scrollBar(ctx, grid);

    // ---- 설명 패널 ----
    this._box(ctx, assets, x, dtY, w, dtH);
    const id = ui.invSel && cfg.items[ui.invSel] ? ui.invSel : null;
    const tx = x + P + BIG + 8;
    const tw = x + w - P - tx;
    const toast = this._toast && this._toast.until > nowMs ? this._toast.text : null;
    if (id) {
      const count = inv.count(id);
      drawSlot(x + P, dtY + P, id, { silhouette: count <= 0 }, BIG_K);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.title;
      ctx.font = getFontString(TITLE_PX, true);
      this._fit(ctx, t(`item.name.${id}`), tx, dtY + P + 7, tw);
      ctx.fillStyle = C.text;
      ctx.font = getFontString(SMALL_PX);
      this._wrap(ctx, t(`item.desc.${id}`), tx, dtY + P + 22, tw, 15, 2);
      this._chips(ctx, [...this._stats(cfg.items[id]), t('inv.owned', { n: count })], tx, dtY + P + BIG - 14, tw);
    } else {
      drawSlot(x + P, dtY + P, null, {}, BIG_K);
      ctx.textAlign = 'left';
      ctx.fillStyle = C.sub;
      ctx.font = getFontString(SMALL_PX);
      this._wrap(ctx, t('inv.pickHint'), tx, dtY + P + 22, tw, 15, 2);
    }

    // 버튼 줄(itemButtons): 1개면 전체 폭, 2개면 반씩. 첫 버튼만 강조(primary). 안내(swapHint)·토스트는 글자로.
    const by = dtY + P + BIG + 4;
    const btns = itemButtons(inv, id, ui.hasShop);
    const n = btns.length;
    const bw = n > 1 ? (w - P * 2 - 6) / 2 : w - P * 2;
    btns.forEach((b, i) => {
      const r = { x: Math.round(x + P + i * (bw + 6)), y: by, width: Math.round(bw), height: BTN_H };
      if (i === 0 && toast) this._hint(ctx, toast, r, '#ffe7a8');
      else if (b.kind === 'swapHint') this._hint(ctx, t('inv.swapHint'), r, C.sub);
      else {
        this._button(ctx, assets, t(b.kind === 'shop' ? 'inv.toShop' : `inv.${b.kind}`), r, i === 0 && b.kind !== 'shop');
        out.actions.push({ ...b, rect: this._hitRect(r) });
      }
    });
    ctx.restore();
    return out;
  }

  // 0개 = 단색 실루엣 + 빨간 0, 개수 숫자 뒤엔 #0d0a10 바탕.
  _slotOpts(selected, count) {
    if (count == null) return { selected };
    return { selected, count, silhouette: count <= 0, countBg: true, countVariant: count <= 0 ? 'red' : 'white' };
  }

  _hitRect(r) {
    return { x: r.x, y: r.y + r.height / 2 - HIT / 2, width: r.width, height: HIT };
  }

  _stats(c) {
    const parts = [];
    if (c.group === 'preFloor') parts.push(t('inv.statPreFloor'));
    else if (c.group !== 'hotbar') parts.push(t('inv.statOnFail'));
    if (c.cooldownMoves) parts.push(t('inv.cooldown', { n: c.cooldownMoves }));
    if (c.group === 'hotbar') parts.push(c.perFloor == null ? t('inv.perFloorNone') : t('inv.perFloor', { n: c.perFloor }));
    else if (c.perFloor != null) parts.push(t('inv.perFloor', { n: c.perFloor }));
    return parts;
  }

  _box(ctx, assets, x, y, w, h) {
    if (h <= 0) return;
    const st = getUi(assets, 'menu/inset.png');
    const meta = getUiMeta(assets, 'menu/inset.png');
    if (uiReady(st) && meta?.slice) drawNine(ctx, st.img, meta.slice, Math.round(x), Math.round(y), Math.round(w), Math.round(h), K);
    else {
      ctx.fillStyle = C.outline;
      ctx.fillRect(x, y, w, h);
    }
  }

  // 구역 제목(금색, 왼쪽) + 보조 정보(오른쪽).
  _header(ctx, title, info, x, y, w, infoColor = C.sub) {
    const cy = y + P + 6;
    ctx.textAlign = 'left';
    ctx.fillStyle = C.title;
    ctx.font = getFontString(TITLE_PX, true);
    drawText(ctx, title, x + P + 2, cy);
    const titleW = ctx.measureText(title).width;
    ctx.textAlign = 'right';
    ctx.fillStyle = infoColor;
    ctx.font = getFontString(SMALL_PX);
    this._fit(ctx, info, x + w - P - 2, cy, w - P * 2 - titleW - 14);
  }

  _name(ctx, text, cx, cy, maxW, dim) {
    ctx.textAlign = 'center';
    ctx.fillStyle = dim ? C.sub : C.text;
    ctx.font = getFontString(SMALL_PX);
    this._fit(ctx, text, cx, cy, maxW);
  }

  // 예약됨(녹색 글자·테두리) / 끔 - 색만으로 구분하지 않게 글자도 다르다.
  _status(ctx, on, cx, cy) {
    const text = t(on ? 'inv.reserveOn' : 'inv.reserveOff');
    ctx.font = getFontString(SMALL_PX);
    const tw = Math.ceil(ctx.measureText(text).width) + 6;
    const rx = Math.round(cx - tw / 2);
    ctx.strokeStyle = on ? C.on : C.chipBorder;
    ctx.lineWidth = 1;
    ctx.strokeRect(rx + 0.5, Math.round(cy - 6) + 0.5, tw - 1, 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = on ? C.on : C.sub;
    drawText(ctx, text, cx, cy);
  }

  _plus(ctx, sx, sy) {
    ctx.textAlign = 'center';
    ctx.fillStyle = C.chipBorder;
    ctx.font = getFontString(22);
    drawText(ctx, '+', sx + SLOT / 2, sy + SLOT / 2, { outline: false });
  }

  // 장착된 아이템 표: 칸 왼쪽 위 안쪽 금색 "E"(#0d0a10 1px 그림자).
  _equipTag(ctx, gx, gy) {
    ctx.font = getFontString(SMALL_PX, true);
    const tw = Math.ceil(ctx.measureText('E').width) + 4;
    ctx.fillStyle = C.outline;
    ctx.fillRect(gx + 3, gy + 3, tw, 12);
    ctx.fillStyle = C.equipTag;
    ctx.fillRect(gx + 2, gy + 2, tw, 12);
    ctx.textAlign = 'center';
    ctx.fillStyle = C.outline;
    drawText(ctx, 'E', gx + 2 + tw / 2, gy + 8, { outline: false });
  }

  _tab(ctx, assets, label, r, on) {
    const path = on ? 'upgrade/tab_on.png' : 'upgrade/tab_off.png';
    const st = getUi(assets, path);
    const meta = getUiMeta(assets, path);
    if (uiReady(st) && meta?.slice) drawNine(ctx, st.img, meta.slice, r.x, r.y, r.width, r.height, K);
    else {
      ctx.fillStyle = on ? HUD_CONFIG.popup.ghost : C.outline;
      ctx.fillRect(r.x, r.y, r.width, r.height);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = on ? C.text : C.sub;
    ctx.font = getFontString(SMALL_PX, true);
    drawText(ctx, label, r.x + r.width / 2, r.y + 12 + (r.height - 18) / 2); // 테두리(위 12·아래 6) 안쪽 가운데
  }

  _button(ctx, assets, label, r, primary) {
    const path = primary ? 'buttons/btn_primary.png' : 'buttons/btn_secondary.png';
    const st = getUi(assets, path);
    const meta = getUiMeta(assets, path);
    if (uiReady(st) && meta?.slice) drawNine(ctx, st.img, meta.slice, r.x, r.y, r.width, r.height, K);
    else {
      ctx.fillStyle = HUD_CONFIG.popup.ghost;
      ctx.fillRect(r.x, r.y, r.width, r.height);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = meta?.textColor ?? C.text;
    ctx.font = getFontString(TITLE_PX, true);
    this._fit(ctx, label, r.x + r.width / 2, r.y + r.height / 2 - 1, r.width - 12);
  }

  _hint(ctx, text, r, color) {
    ctx.textAlign = 'left';
    ctx.fillStyle = color;
    ctx.font = getFontString(SMALL_PX);
    this._fit(ctx, text, r.x + 2, r.y + r.height / 2, r.width - 4);
  }

  // 수치 칩(파란 글자 + 1px 테두리) 한 줄 - 안 들어가는 칩은 생략.
  _chips(ctx, parts, x, cy, maxW) {
    ctx.font = getFontString(SMALL_PX);
    ctx.textAlign = 'left';
    ctx.lineWidth = 1;
    let cx = x;
    for (const p of parts) {
      const tw = Math.ceil(ctx.measureText(p).width) + 8;
      if (cx + tw > x + maxW) break;
      ctx.strokeStyle = C.chipBorder;
      ctx.strokeRect(Math.round(cx) + 0.5, Math.round(cy - 7) + 0.5, tw - 1, 14);
      ctx.fillStyle = C.chip;
      drawText(ctx, p, cx + 4, cy);
      cx += tw + 4;
    }
  }

  _scrollBar(ctx, g) {
    const trackH = g.height - 4;
    const total = trackH + this._scrollMax;
    const h = Math.max(12, Math.round((trackH * trackH) / total));
    const y = g.y + 2 + Math.round(((trackH - h) * this._scroll) / this._scrollMax);
    ctx.fillStyle = C.equipTag;
    ctx.fillRect(g.x + g.width - 2, y, 2, h);
  }

  _drawLocked(ctx, assets, x, y) {
    const st = getUi(assets, 'items/slot_locked.png');
    if (uiReady(st)) drawImageSnapped(ctx, st.img, x, y, SLOT, SLOT);
    else {
      ctx.fillStyle = '#1b1f2a';
      ctx.fillRect(x, y, SLOT, SLOT);
    }
    drawFixedImage(ctx, assets, 'icons/lock.png', x + SLOT / 2, y + SLOT / 2, K);
  }

  // 폭을 넘으면 끝을 …로 자른다(한 줄 유지).
  _fit(ctx, text, x, cy, maxW) {
    let s = text;
    if (ctx.measureText(s).width > maxW) {
      while (s.length > 1 && ctx.measureText(`${s}…`).width > maxW) s = s.slice(0, -1);
      s = `${s}…`;
    }
    drawText(ctx, s, x, cy);
  }

  // 글자 단위 줄바꿈(공백이 있으면 공백에서) - 최대 lines줄, 넘치면 마지막 줄 끝 ….
  _wrap(ctx, text, x, cy, maxW, lineH, lines) {
    let rest = text;
    for (let i = 0; i < lines && rest; i++) {
      if (i === lines - 1 || ctx.measureText(rest).width <= maxW) {
        this._fit(ctx, rest, x, cy + i * lineH, maxW);
        return;
      }
      let n = 1;
      while (n < rest.length && ctx.measureText(rest.slice(0, n + 1)).width <= maxW) n++;
      const sp = rest.lastIndexOf(' ', n);
      const cut = sp > 0 ? sp : n;
      drawText(ctx, rest.slice(0, cut), x, cy + i * lineH);
      rest = rest.slice(cut).trimStart();
    }
  }
}
