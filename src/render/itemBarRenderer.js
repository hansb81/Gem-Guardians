// 하단 장착 아이템 바 + 조준 오버레이(docs/items.md 0·2장). 표시만 한다 - 사용 판정·소모는
// src/game/itemController.js, 조준 상태(ui.aim)는 main.js가 들고 있다.
import { drawDamage, drawNine, drawText, getUi, getUiFont, getUiMeta, snap, uiReady } from './uiKit.js';
import { getFontString } from '../config/fonts.js';
import { t } from '../config/i18n.js';

const SLOT_K = 2; // slot_*.png(22x22) 2배
const DIM_DARK = '#0d0a10';
const AIM_DIM = 'rgba(13, 10, 16, 0.6)'; // 조준 중 보드 어둡게(고정 오버레이 색).
const HILITE = '#f2d264';
const SHAKE_MS = 300;
const TOAST_MS = 1400;

// "row,col" 목록 - 조준 대상 칸.
export function itemTargetCells(cfgTarget, target, rows, cols) {
  if (!target) return [];
  if (cfgTarget === 'row') return Array.from({ length: cols }, (_, c) => ({ row: target.row, col: c }));
  if (cfgTarget === 'col') return Array.from({ length: rows }, (_, r) => ({ row: r, col: target.col }));
  if (cfgTarget === 'pair') return [target.a, target.b].filter(Boolean);
  return [target];
}

const _patterns = new Map();
// 2배 픽셀 체커 디더(불투명 픽셀만, 반투명 알파 없음).
export function ditherPattern(ctx, color) {
  let pattern = _patterns.get(color);
  if (pattern) return pattern;
  const tile = document.createElement('canvas');
  tile.width = 4;
  tile.height = 4;
  const tctx = tile.getContext('2d');
  tctx.fillStyle = color;
  tctx.fillRect(0, 0, 2, 2);
  tctx.fillRect(2, 2, 2, 2);
  pattern = ctx.createPattern(tile, 'repeat');
  _patterns.set(color, pattern);
  return pattern;
}

// 아이콘 -> 단색 실루엣(외곽선 #0d0a10은 그대로, 나머지 불투명 픽셀은 #3b3347). 아이콘마다 한 번만 만든다.
const SILHOUETTE = [0x3b, 0x33, 0x47];
const silhouettes = new WeakMap();
function silhouetteOf(img) {
  let c = silhouettes.get(img);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i + 3] === 0 || (p[i] === 0x0d && p[i + 1] === 0x0a && p[i + 2] === 0x10)) continue;
    p[i] = SILHOUETTE[0];
    p[i + 1] = SILHOUETTE[1];
    p[i + 2] = SILHOUETTE[2];
  }
  g.putImageData(d, 0, 0);
  silhouettes.set(img, c);
  return c;
}

export class ItemBarRenderer {
  constructor() {
    this._slotShakeUntil = []; // slot -> ms
    this._cellShake = null; // { cells, untilMs }
    this._toast = null; // { text, untilMs }
    this._tip = null; // { slot, untilMs } - 즉시 사용(전투) 아이템 탭 후 잠깐 보이는 설명
  }

  showTip(slot, nowMs) {
    this._tip = { slot, untilMs: nowMs + TOAST_MS };
  }

  shakeSlot(slot, nowMs) {
    this._slotShakeUntil[slot] = nowMs + SHAKE_MS;
  }

  shakeCells(cells, nowMs) {
    this._cellShake = { cells, untilMs: nowMs + SHAKE_MS };
  }

  toast(text, nowMs) {
    this._toast = { text, untilMs: nowMs + TOAST_MS };
  }

  // 셀 흔들림 오프셋(px) - 조준 하이라이트 테두리에 적용.
  _shakeOffset(untilMs, nowMs) {
    const left = untilMs - nowMs;
    return left > 0 ? Math.round(Math.sin(nowMs / 25) * 3 * (left / SHAKE_MS)) : 0;
  }

  // 슬롯 사각형 목록을 돌려준다(main.js 탭 판정용).
  drawBar(ctx, rect, assets, icons, ui, nowMs) {
    const slots = [];
    const equipped = ui.equipped ?? [];
    const slotPx = 22 * SLOT_K;
    // 바 높이가 2배 슬롯보다 낮으면 1배로(보고 사항 - 지금 9:16에선 2배가 들어간다).
    const k = rect.height >= slotPx + 4 ? SLOT_K : 1;
    const size = 22 * k;
    const gap = Math.round(size * 0.35);
    const total = equipped.length * size + (equipped.length - 1) * gap;
    const startX = Math.round(rect.x + (rect.width - total) / 2);
    const y = Math.round(rect.y + (rect.height - size) / 2);
    const items = ui.items;
    const pendingId = items?.pending?.id ?? null;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < equipped.length; i++) {
      const id = equipped[i];
      const x = startX + i * (size + gap) + this._shakeOffset(this._slotShakeUntil[i] ?? 0, nowMs);
      const slotRect = { x, y, width: size, height: size };
      slots.push(slotRect);

      const selected = id != null && (ui.aim?.slot === i || pendingId === id);
      if (id == null || !items) {
        this.drawSlot(ctx, assets, icons, null, x, y, k, { selected });
        continue;
      }
      // 개수·장착(ui.counts/equipped)은 inventory.onChange 때만 갱신, 쿨다운·층당 남은 횟수는 ItemController에서
      // 매 프레임 읽는다(스왑마다 바뀌는데 inventory onChange는 안 온다 - docs/inventory.md 9장).
      const count = ui.counts?.[id] ?? 0;
      const cooldown = items.cooldownLeft(id);
      const perFloorLeft = items.perFloorLeft(id);
      const buffed = items.buff?.id === id; // 분노의 북 - 남은 스왑 수를 가운데에(어둡게 안 함).
      let center = null;
      if (buffed) center = String(items.buffSwapsLeft);
      else if (count <= 0) center = '';
      else if (perFloorLeft === 0) center = '0';
      else if (cooldown > 0) center = String(cooldown);
      this.drawSlot(ctx, assets, icons, id, x, y, k, { selected, count, center, centerVariant: buffed ? 'yellow' : 'white', dim: center != null && !buffed });
    }

    // 설명 툴팁: 조준 중인 슬롯, 또는 방금 쓴 전투 아이템 슬롯 위.
    const tipSlot = ui.aim ? ui.aim.slot : this._tip && this._tip.untilMs > nowMs ? this._tip.slot : -1;
    let toastBottom = y - 2;
    if (equipped[tipSlot] != null && slots[tipSlot]) {
      toastBottom = this._drawTip(ctx, rect, assets, equipped[tipSlot], slots[tipSlot]) - 2;
    }
    if (this._toast && this._toast.untilMs > nowMs) {
      ctx.font = getFontString(Math.max(11, Math.round(rect.height * 0.22)), true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillStyle = '#ffe7a8';
      drawText(ctx, this._toast.text, rect.x + rect.width / 2, toastBottom);
    }
    ctx.restore();
    return slots;
  }

  // 아이템 칸 1개(slot_normal/selected 22x22 x k + 안쪽 (4,4) 14x14 아이콘). 하단 바·인벤토리 탭·
  // 패배 팝업이 같이 쓴다. count = 오른쪽 아래 보유 수(null이면 생략), center = 가운데 숫자(쿨다운/
  // 남은 스왑), dim = 아이콘을 #0d0a10 체커 디더로 어둡게(반투명 알파 금지). 보관함용: silhouette = 아이콘을
  // #3b3347 단색 실루엣(#0d0a10 외곽선 유지), countBg = 개수 뒤 #0d0a10 바탕(1 원본px 여백), countVariant = 숫자 색, countK = 숫자 배율(기본 칸과 같음).
  drawSlot(ctx, assets, icons, id, x, y, k, { selected = false, count = null, center = null, centerVariant = 'white', dim = false, silhouette = false, countBg = false, countVariant = 'white', countK = k } = {}) {
    const size = 22 * k;
    const slotPath = selected ? 'items/slot_selected.png' : 'items/slot_normal.png';
    const slotState = getUi(assets, slotPath);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (uiReady(slotState)) {
      ctx.drawImage(slotState.img, x, y, size, size);
    } else {
      ctx.fillStyle = '#272c3a';
      ctx.fillRect(x, y, size, size);
      ctx.strokeStyle = selected ? HILITE : '#4a5265';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, size - 2, size - 2);
    }
    if (id != null) {
      const meta = getUiMeta(assets, slotPath)?.item ?? { x: 4, y: 4, w: 14, h: 14 };
      const ix = x + meta.x * k;
      const iy = y + meta.y * k;
      const iw = meta.w * k;
      const icon = icons?.get(id);
      if (uiReady(icon)) ctx.drawImage(silhouette ? silhouetteOf(icon.img) : icon.img, ix, iy, iw, iw);
      else drawItemIconFallback(ctx, id, ix, iy, iw);
      if (dim) {
        // 패턴은 캔버스 원점 기준이라, 아이콘 좌상단으로 옮겨 그려 체커가 아이콘 픽셀과 맞게 한다.
        ctx.translate(ix, iy);
        ctx.fillStyle = ditherPattern(ctx, DIM_DARK);
        ctx.fillRect(0, 0, iw, iw);
        ctx.translate(-ix, -iy);
      }
      if (center) this._drawNumber(ctx, assets, center, x + size / 2, y + size / 2, k, 'center', centerVariant);
      if (count != null) this._drawNumber(ctx, assets, String(count), x + size, y + size, countK, 'bottomRight', countVariant, countBg);
    }
    ctx.restore();
    return { x, y, width: size, height: size };
  }

  // 염료 색 고르기(docs/items.md A6): 고른 칸 옆에 panel_inset 위 5색 잼 미니 아이콘 줄. drawGem(value, x, y,
  // size)는 CanvasRenderer._drawGem을 감싼 콜백. 반환 = 스와치 사각형 목록 [{ color, rect }](main.js 탭 판정).
  drawDyePalette(ctx, assets, board, cell, typeCount, drawGem) {
    const cs = board.cellSize;
    const s = snap(Math.round(cs * 0.62));
    const gap = 2;
    const pad = 6;
    const w = snap(typeCount * s + (typeCount - 1) * gap + pad * 2);
    const h = snap(s + pad * 2);
    const cellX = board.x + cell.col * cs;
    const cellY = board.y + cell.row * cs;
    // 칸 오른쪽에, 안 들어가면 왼쪽에. 세로는 칸 중심, 보드 안으로 클램프.
    let x = Math.round(cellX + cs + 4);
    if (x + w > board.x + board.width) x = Math.round(cellX - 4 - w);
    const y = Math.round(Math.min(Math.max(cellY + cs / 2 - h / 2, board.y), board.y + board.height - h));

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const path = 'panels/panel_inset.png';
    const state = getUi(assets, path);
    const meta = getUiMeta(assets, path);
    if (uiReady(state) && meta?.slice) {
      drawNine(ctx, state.img, meta.slice, x, y, w, h);
    } else {
      ctx.fillStyle = DIM_DARK;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#4a5265';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
    const swatches = [];
    for (let i = 0; i < typeCount; i++) {
      const sx = x + pad + i * (s + gap);
      const sy = y + pad;
      drawGem(i, sx, sy, s);
      swatches.push({ color: i, rect: { x: sx - gap / 2, y: sy - pad, width: s + gap, height: h } });
    }
    ctx.restore();
    return swatches;
  }

  // 슬롯 위 이름 + 한 줄 설명 상자(panel_inset 9-slice). 상자 윗변 y를 돌려준다.
  _drawTip(ctx, rect, assets, id, slotRect) {
    const fontPx = Math.max(11, Math.round(rect.height * 0.22));
    const name = t(`item.name.${id}`);
    const desc = t(`item.desc.${id}`);
    ctx.font = getFontString(fontPx, true);
    const textW = Math.max(ctx.measureText(name).width, ctx.measureText(desc).width);
    const lineH = Math.round(fontPx * 1.3);
    const w = Math.min(snap(textW + 20), snap(rect.width - 8));
    const h = snap(lineH * 2 + 12);
    const x = Math.round(Math.min(Math.max(slotRect.x + slotRect.width / 2 - w / 2, rect.x + 4), rect.x + rect.width - w - 4));
    const y = Math.round(slotRect.y - h - 6);

    const path = 'panels/panel_inset.png';
    const state = getUi(assets, path);
    const meta = getUiMeta(assets, path);
    if (uiReady(state) && meta?.slice) {
      drawNine(ctx, state.img, meta.slice, x, y, w, h);
    } else {
      ctx.fillStyle = DIM_DARK;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = '#4a5265';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = x + w / 2;
    const midY = y + h / 2;
    ctx.fillStyle = HILITE;
    drawText(ctx, name, cx, midY - lineH / 2);
    ctx.font = getFontString(Math.max(10, fontPx - 2), true);
    ctx.fillStyle = '#ffffff';
    drawText(ctx, desc, cx, midY + lineH / 2);
    return y;
  }

  // 데미지 숫자 폰트(ui/font, white). anchor 'center' = (ax, ay) 중심, 'bottomRight' = 오른쪽 아래 모서리.
  // 폰트 이미지가 없으면 시스템 폰트 텍스트로 대체.
  _drawNumber(ctx, assets, text, ax, ay, k, anchor, variant = 'white', bg = false) {
    const font = assets?.uiFont;
    const img = getUiFont(assets, variant);
    if (font?.chars && uiReady(img)) {
      let w = 1;
      for (const c of text) w += font.widths[c] - 1;
      const h = font.cellH * k;
      const cx = anchor === 'center' ? ax : ax - (w * k) / 2;
      const top = anchor === 'center' ? Math.round(ay - h / 2) : ay - h;
      if (bg) {
        ctx.fillStyle = '#0d0a10';
        ctx.fillRect(Math.round(cx - (w * k) / 2) - k, top - k, w * k + 2 * k, h + 2 * k);
      }
      drawDamage(ctx, img.img, font, text, cx, top, k);
      return;
    }
    ctx.font = getFontString(Math.round(11 * k), true);
    ctx.textAlign = anchor === 'center' ? 'center' : 'right';
    ctx.textBaseline = anchor === 'center' ? 'middle' : 'bottom';
    ctx.fillStyle = '#ffffff';
    drawText(ctx, text, ax, ay);
  }

  // 조준 중: 보드를 어둡게 + 미리보기 칸만 밝게 + 안내. 대기(pending) 중: 대상 칸 깜빡임.
  drawBoardOverlay(ctx, board, guideRect, ui, cfgItems, nowMs) {
    const { aim, items } = ui;
    const pending = items?.pending;
    if (!aim && !pending) return;
    const cs = board.cellSize;
    const cellRect = (c) => [board.x + c.col * cs, board.y + c.row * cs, cs, cs];

    ctx.save();
    if (aim) {
      const cfg = cfgItems[aim.id];
      let lit = [];
      let outline = [];
      if (cfg.target === 'pair') {
        if (aim.first) {
          lit = [aim.first, ...neighbors(aim.first, board.rows, board.cols)];
          outline = [aim.first];
          if (aim.hover && isNeighbor(aim.first, aim.hover)) outline.push(aim.hover);
        } else if (aim.hover) {
          lit = outline = [aim.hover];
        }
      } else if (cfg.action === 'recolor' && aim.first) {
        // 염료: 고른 칸만 밝게 + 테두리, 색은 옆 팔레트(drawDyePalette)에서 고른다.
        lit = outline = [aim.first];
      } else if (aim.hover) {
        lit = outline = itemTargetCells(cfg.target, aim.hover, board.rows, board.cols);
      }

      // 밝게 둘 칸만 빼고 어둡게(evenodd 구멍).
      ctx.beginPath();
      ctx.rect(board.x, board.y, board.width, board.height);
      for (const c of lit) ctx.rect(...cellRect(c));
      ctx.fillStyle = AIM_DIM;
      ctx.fill('evenodd');

      const shake = this._cellShake ? this._shakeOffset(this._cellShake.untilMs, nowMs) : 0;
      ctx.strokeStyle = HILITE;
      ctx.lineWidth = 2;
      for (const c of outline) {
        const [x, y, w, h] = cellRect(c);
        ctx.strokeRect(Math.round(x + 1 + shake), Math.round(y + 1), w - 2, h - 2);
      }

      const key = aim.confirm ? 'confirm' : cfg.target === 'pair' ? (aim.first ? 'pair2' : 'pair') : cfg.action === 'recolor' ? (aim.first ? 'dye2' : 'dye') : cfg.target;
      ctx.font = getFontString(Math.max(12, Math.round(guideRect.height * 0.42)), true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = DIM_DARK;
      ctx.fillRect(guideRect.x, guideRect.y, guideRect.width, guideRect.height);
      ctx.fillStyle = '#ffffff';
      drawText(ctx, t(`item.aim.${key}`), guideRect.x + guideRect.width / 2, guideRect.y + guideRect.height / 2);
    }

    if (pending && Math.floor(nowMs / 150) % 2 === 0) {
      const cells = itemTargetCells(cfgItems[pending.id].target, pending.target, board.rows, board.cols);
      ctx.strokeStyle = HILITE;
      ctx.lineWidth = 2;
      for (const c of cells) {
        const [x, y, w, h] = cellRect(c);
        ctx.strokeRect(Math.round(x + 1), Math.round(y + 1), w - 2, h - 2);
      }
    }
    ctx.restore();
  }
}

export function isNeighbor(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
}

function neighbors(c, rows, cols) {
  return [
    { row: c.row - 1, col: c.col },
    { row: c.row + 1, col: c.col },
    { row: c.row, col: c.col - 1 },
    { row: c.row, col: c.col + 1 },
  ].filter((n) => n.row >= 0 && n.row < rows && n.col >= 0 && n.col < cols);
}

// 아이콘 로드 실패 시 코드 도형(assets/items/*.png가 없을 때만).
export function drawItemIconFallback(ctx, id, x, y, s) {
  const u = s / 14;
  const r = (cx, cy, w, h, color) => {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x + cx * u), Math.round(y + cy * u), Math.round(w * u), Math.round(h * u));
  };
  switch (id) {
    case 'hammer':
      r(2, 2, 10, 4, '#b8b8c8');
      r(6, 6, 2, 7, '#8a5a32');
      break;
    case 'scythe_h':
      r(1, 6, 12, 2, '#e8e8f0');
      r(10, 4, 3, 2, '#e8e8f0');
      break;
    case 'scythe_v':
      r(6, 1, 2, 12, '#e8e8f0');
      r(8, 1, 2, 3, '#e8e8f0');
      break;
    case 'rainbow':
      r(5, 2, 4, 2, '#ff5a5a');
      r(4, 4, 6, 2, '#ffd75a');
      r(3, 6, 8, 2, '#5aff7a');
      r(4, 8, 6, 2, '#5ab4ff');
      r(5, 10, 4, 2, '#b45aff');
      break;
    case 'glove':
      r(3, 4, 8, 7, '#f0c890');
      r(1, 6, 2, 3, '#f0c890');
      break;
    case 'repair':
      r(5, 2, 4, 10, '#5aff7a');
      r(2, 5, 10, 4, '#5aff7a');
      break;
    case 'hourglass':
      r(3, 1, 8, 2, '#c8a060');
      r(3, 11, 8, 2, '#c8a060');
      r(4, 3, 6, 3, '#f2d264');
      r(6, 6, 2, 2, '#f2d264');
      r(4, 8, 6, 3, '#f2d264');
      break;
    default:
      r(3, 3, 8, 8, '#a0a0b0');
  }
}
