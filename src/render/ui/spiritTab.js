// 정비 팝업의 정령 탭(docs/spirits.md 7장). 그리기 + 터치 사각형만 - 장착·레벨업은 main.js가 inventory를 부른다.
// 좌표는 prepPopup과 같은 540 폭 기준(basis). 위 = 정령석 + 수호자 무대 5칸(가로 한 줄) + 고른 수호자 정보 카드(이름·효과·해제),
// 아래 = "보유 n / 30" + 필터 버튼 3개(속성·등급·보유 - 누를 때마다 다음 값, 길게 누르면 전체) + 정령 목록 하나(5열, 칸 86x92 고정, 세로 스크롤).
// 보유 "전체"면 안 가진 정령이 실루엣으로 섞인다. 누르면 가진 정령 = 상세(레벨업·장착), 안 가진 정령 = 도감 설명(spiritDex.js).
//   sel(state.spirit)  = { slot, element, grade, ownedOnly, detail, scroll, maxScroll } - 고른 수호자 칸 / 필터 / 상세·설명을 연 정령 id / 목록 스크롤
//   view(view.spirit)  = { cfg, owned, slots, pending, stones, gold, floorReward }
import { t } from '../../config/i18n.js';
import { getFontString } from '../../config/fonts.js';
import { HUD_CONFIG } from '../../config/hud.js';
import { fmt as fmtGold, spiritEffectText } from '../shopText.js';
import { levelUpCost, dexEntries } from '../../core/spirits/spirits.js';
import { drawSpirit, drawSpiritPortrait, drawSpiritStone, portraitBBox, SPIRIT_GRADE_COLOR, SPIRIT_ELEMENT_COLOR, PORTRAIT_SIZE } from '../spiritSprite.js';
import { drawFixedImage, drawNine, getUi, uiReady } from '../uiKit.js';
import { drawImageSnapped } from '../screenFit.js';
import { nine, label } from './prepPopup.js';
import { drawDexInfo } from './spiritDex.js';

// 필터 순환 순서(docs/spirits.md 7장)와 "전체" 값. 보유 필터는 true = 보유만(기본), false = 전체.
export const FILTER_CYCLE = { element: [null, 'red', 'blue', 'green', 'purple', 'yellow'], grade: [null, 'common', 'rare', 'epic', 'legend'], ownedOnly: [true, false] };
export const FILTER_ALL = { element: null, grade: null, ownedOnly: false };
const TOP_H = 28;
const STAGE_K = 3; // 무대 그림(upgrade/stage/spirit_stage_*, 30x34)은 x3
const STAGE_W = 30 * STAGE_K;
const STAGE_H = 34 * STAGE_K;
const GLOW_MS = 300;
const GLOW_FRAMES = 8;
const INFO_H = 58; // 고른 수호자 정보 카드
// 목록 칸(assets/ui/spirit_cell, 43x46 x2) - 필터로 칸 수가 줄어도 크기는 그대로, 넘치면 세로 스크롤.
const CELL_K = 2;
export const CELL_W = 43 * CELL_K;
export const CELL_H = 46 * CELL_K;
const CELL_GAP_X = 5;
const CELL_GAP_Y = 6;
const CELL_MS = 150;
const CELL_FRAMES = 24;
const BAR_W = 4;
export const DRAG_PX = 8; // 이만큼 끌면 스크롤 - 손을 떼도 칸 터치가 아니다
const STAGE_ANIM = { row: 0, atk: -Infinity, flash: -Infinity, tier: 0 }; // drawStageGuardian에 넘기는 값(idle만, 매 프레임 재사용)
const FILTER_H = 40;
const FILTER_FONT = Math.round(22 * 0.8); // 필터 버튼 글자(basis) - 본문 22의 80%
const HEAD_H = 16; // "보유 n / 30" 줄
const SLOT_SLICE = [5, 5, 5, 5]; // items/slot_selected(22x22, 틀 두께 4 + 그림자 1)을 9-slice로
const COLS = 5;
const C = { title: HUD_CONFIG.text.title, text: HUD_CONFIG.text.primary, sub: HUD_CONFIG.text.dim, outline: '#0d0a10', green: HUD_CONFIG.popup.upgradeColor, chip: '#8cc4ee', white: '#ffffff', star: '#f2d264', starOff: '#3b3347' };

const OUTLINED = { outlineColor: C.outline, outlineWidth: 3 };

const rect = (x, y, width, height) => ({ x, y, width, height });

// scroll = 목록 스크롤(basis px), maxScroll = 그릴 때 정해지는 범위 끝(내용 높이 - 보이는 높이).
export function newSpiritSel() {
  return { slot: 0, element: null, grade: null, ownedOnly: true, detail: null, scroll: 0, maxScroll: 0 };
}

// 필터 버튼 탭 = 다음 값, 길게 누르기 = 전체로. 열어 둔 상세·설명은 닫고 스크롤은 맨 위로.
export function cycleFilter(sel, kind) {
  const list = FILTER_CYCLE[kind];
  sel[kind] = list[(list.indexOf(sel[kind]) + 1) % list.length];
  sel.detail = null;
  sel.scroll = 0;
}

export function resetFilter(sel, kind) {
  sel[kind] = FILTER_ALL[kind];
  sel.detail = null;
  sel.scroll = 0;
}

// 스크롤 범위 = 0 ~ (내용 높이 - 보이는 높이). count = 칸 수, viewH = 목록이 보이는 높이.
export function listMaxScroll(count, viewH) {
  const rows = Math.ceil(count / COLS);
  return Math.max(0, rows * CELL_H + (rows - 1) * CELL_GAP_Y - viewH);
}

export function scrollList(sel, v) {
  sel.scroll = Math.max(0, Math.min(sel.maxScroll, v));
}

// 목록 끌기. drag = { y(누른 곳, basis), startScroll, moved } - DRAG_PX 이상 움직이면 moved(뗄 때 칸 터치 취소).
export function dragList(sel, drag, by) {
  const dy = by - drag.y;
  if (Math.abs(dy) >= DRAG_PX) drag.moved = true;
  if (drag.moved) scrollList(sel, drag.startScroll - dy);
}

// 무대 빛 시트 이름 - 정령 속성 = 수호자 색(공명)이면 _res.
export function stageGlowName(color, spiritElement) {
  return `spirit_stage_glow_${color}${spiritElement === color ? '_res' : ''}`;
}

// 초상(24x24 칸, x k)을 목록 칸에 놓을 왼쪽 위(칸 기준) - 칸이 아니라 그려진 픽셀의 경계 상자 box가 한가운데 오게.
export function portraitOffset(box, k = CELL_K, cellW = CELL_W, cellH = CELL_H) {
  return { x: Math.round((cellW - box.w * k) / 2) - box.x * k, y: Math.round((cellH - box.h * k) / 2) - box.y * k };
}

// 시트 한 프레임을 정수배로. fx = 시트 안 프레임 x.
function sheetImg(ctx, assets, path, fx, w, h, x, y, k) {
  const st = getUi(assets, path);
  if (uiReady(st)) ctx.drawImage(st.img, fx, 0, w, h, x, y, w * k, h * k);
}
const stageImg = (ctx, assets, name, fx, w, h, x, y) => sheetImg(ctx, assets, `upgrade/stage/${name}.png`, fx, w, h, x, y, STAGE_K);

// 목록에 보일 정령 id(config 순서 그대로 - 정렬하지 않는다), 속성·등급 필터 + 보유만(ownedOnly)이면 가진 것만.
export function spiritList(cfg, owned, sel) {
  return dexEntries(cfg, owned, sel).ids.filter((e) => e.owned || sel.ownedOnly === false).map((e) => e.id);
}

function gradeFrame(ctx, r, grade, width = 2) {
  ctx.fillStyle = grade ? SPIRIT_GRADE_COLOR[grade] ?? C.outline : C.white; // grade null = 장착 중 흰 테
  ctx.fillRect(r.x, r.y, r.width, width);
  ctx.fillRect(r.x, r.y + r.height - width, r.width, width);
  ctx.fillRect(r.x, r.y, width, r.height);
  ctx.fillRect(r.x + r.width - width, r.y, width, r.height);
}

function stars(ctx, x, y, n, max, size = 4) {
  for (let i = 0; i < max; i++) {
    ctx.fillStyle = i < n ? C.star : C.starOff;
    ctx.fillRect(x + i * (size + 2), y, size, size);
  }
}

// c = 본문 사각형. 반환 = 터치 목록 [{ r, hit }] (hitSpiritTab이 읽는다).
// uiScale = 화면 px / basis px(prepPopup layout.scale) - 필터 글자를 화면 11px 아래로 안 줄이는 데 쓴다.
export function drawSpiritTab(ctx, assets, c, view, sel, towers, drawGuardian, nowMs, uiScale = 1) {
  const hits = [];
  const { cfg, owned, slots } = view;

  // ---- 위: 안내(층 중이면 "다음 층부터 적용") + 정령석 ----
  label(ctx, view.pending ? t('inv.pending') : t('spirit.slotHint'), rect(c.x, c.y, c.width - 110, TOP_H), view.pending ? C.chip : C.sub, 12, false, 'left');
  const chip = rect(c.x + c.width - 100, c.y, 100, TOP_H);
  nine(ctx, assets, 'menu/inset.png', chip, C.outline);
  drawSpiritStone(ctx, assets, chip.x + 16, chip.y + TOP_H / 2, 1);
  label(ctx, fmtGold(view.stones), rect(chip.x + 28, chip.y, chip.width - 36, TOP_H), C.text, 14, true, 'right');

  // ---- 수호자 무대 5칸(30x34 x3, 간격 0, 가운데 정렬 - 본문이 450보다 좁으면 양옆으로 넘친다) ----
  const sc = ctx.getTransform?.().a || 1; // 무대는 기기 px에 맞춰 그린다(x3 픽셀 굵기 균일)
  const sy = Math.round((c.y + TOP_H + 6) * sc) / sc;
  const sx0 = c.x + (c.width - STAGE_W * 5) / 2;
  const slotSpirit = (i) => (towers[i] && owned[slots[i]] ? cfg.spirits[slots[i]] : null) ?? null;
  for (let i = 0; i < 5; i++) {
    const tower = towers[i];
    const sp = slotSpirit(i);
    const sx = Math.round((sx0 + i * STAGE_W) * sc) / sc;
    stageImg(ctx, assets, 'spirit_stage_back', 0, 30, 34, sx, sy);
    if (tower) {
      stageImg(ctx, assets, stageGlowName(tower.color, sp?.element), ((Math.floor(nowMs / GLOW_MS) + i) % GLOW_FRAMES) * 30, 30, 34, sx, sy);
      stageImg(ctx, assets, 'spirit_stage_disc', 0, 19, 3, sx + 8 * STAGE_K, sy + 31 * STAGE_K);
      STAGE_ANIM.row = i;
      // drawStageGuardian은 프레임을 무대 (3, 3)에 놓는다 -> (8, 6)이 되게 (5, 3) 민다.
      drawGuardian?.(ctx, tower.color, tower.look, sx + 5 * STAGE_K, sy + 3 * STAGE_K, nowMs, STAGE_ANIM);
    }
    if (sp) {
      const bob = Math.round(1.5 * Math.sin((2 * Math.PI * ((nowMs + i * 300) % 1600)) / 1600));
      drawSpirit(ctx, assets, slots[i], sp.element, sx + STAGE_K, sy + (4 + bob) * STAGE_K, STAGE_K, nowMs);
    } else {
      // 빈 칸 = 정령 자리에 점 9개 원(반지름 4)이 천천히 돈다 - "여기에 장착".
      ctx.fillStyle = '#655a74';
      const turn = Math.floor(nowMs / 100) * 10;
      for (let k = 0; k < 9; k++) {
        const a = ((k * 40 + turn) * Math.PI) / 180;
        ctx.fillRect(sx + Math.round(5.5 + 4 * Math.cos(a)) * STAGE_K, sy + Math.round(8.5 + 4 * Math.sin(a)) * STAGE_K, STAGE_K, STAGE_K);
      }
    }
    const r = rect(sx, sy, STAGE_W, STAGE_H);
    ctx.fillStyle = sel.slot === i ? '#c28a20' : '#3b3347';
    ctx.fillRect(r.x, r.y, r.width, STAGE_K);
    ctx.fillRect(r.x, r.y + r.height - STAGE_K, r.width, STAGE_K);
    ctx.fillRect(r.x, r.y, STAGE_K, r.height);
    ctx.fillRect(r.x + r.width - STAGE_K, r.y, STAGE_K, r.height);
    if (sp && sp.element === tower.color) label(ctx, t('spirit.resonance'), rect(sx + 6, sy + 5, STAGE_W - 12, 14), C.star, 11, true, 'right', OUTLINED);
    hits.push({ r, hit: { type: 'spiritSlot', index: i } });
  }

  // ---- 고른 수호자 정보 카드 ----
  const card = rect(c.x, sy + STAGE_H + 6, c.width, INFO_H);
  nine(ctx, assets, 'upgrade/card_selected.png', card, '#1f1b2b');
  const tower = towers[sel.slot];
  if (tower) {
    const sp = slotSpirit(sel.slot);
    const id = slots[sel.slot];
    const res = sp && sp.element === tower.color;
    const tx = card.x + 12;
    const tw = card.width - 24;
    const resText = res ? `${t('spirit.resonance')} ×${cfg.resonanceMul}` : '';
    ctx.font = getFontString(13, true);
    const rw = res ? Math.ceil(ctx.measureText(resText).width) + 8 : 0;
    ctx.font = getFontString(22, true);
    const nw = Math.min(tw - rw, Math.ceil(ctx.measureText(tower.name).width));
    label(ctx, tower.name, rect(tx, card.y + 5, nw, 28), C.text, 22, true, 'left');
    if (sp) label(ctx, `+ ${t(`spirit.name.${id}`)}`, rect(tx + nw + 8, card.y + 5, tw - rw - nw - 8, 28), C.star, 22, true, 'left');
    if (res) label(ctx, resText, rect(tx + tw - rw, card.y + 5, rw, 28), C.star, 13, true, 'right');
    const BTN_W = 60;
    label(ctx, sp ? spiritEffectText(cfg, id, owned[id], tower.color) : t('spirit.emptyHint'), rect(tx, card.y + 32, tw - (sp ? BTN_W + 8 : 0), 20), C.sub, 12, false, 'left');
    if (sp) {
      const btn = rect(tx + tw - BTN_W, card.y + 30, BTN_W, 22);
      nine(ctx, assets, 'upgrade/card.png', btn, HUD_CONFIG.popup.ghost);
      label(ctx, t('spirit.unequip'), btn, C.text, 12, true, 'center');
      // 그림은 작아도 터치는 44 높이(카드 안에서 위로 넓힌다).
      hits.push({ r: rect(btn.x - 8, card.y + INFO_H - 46, BTN_W + 16, 44), hit: { type: 'spiritEquip', id: null } });
    }
  }

  const y = card.y + INFO_H;
  const area = rect(c.x, y + 4, c.width, c.y + c.height - y - 4);
  if (area.height < 80) return hits;
  // 목록 위: 오른쪽 "보유 n / 30"(항상) + 필터 버튼 3개(속성·등급·보유, 누를 때마다 다음 값, 길게 누르면 전체).
  const dex = dexEntries(cfg, owned);
  label(ctx, t('spirit.dexCount', { n: dex.ownedCount, max: dex.total }), rect(area.x, area.y, area.width, HEAD_H), C.title, 12, true, 'right');
  const fy = area.y + HEAD_H + 2;
  drawFilters(ctx, assets, rect(area.x, fy, area.width, FILTER_H), sel, hits, uiScale);
  const rest = rect(area.x, fy + FILTER_H + 6, area.width, area.y + area.height - fy - FILTER_H - 6);
  if (sel.detail && cfg.spirits[sel.detail]) {
    if (owned[sel.detail]) drawDetail(ctx, assets, rest, view, sel, towers, hits, nowMs);
    else drawInfo(ctx, assets, rest, view, sel, hits, nowMs);
  } else drawList(ctx, assets, rest, view, sel, hits, nowMs);
  return hits;
}

// 필터 버튼 한 칸의 글자(+ 속성 잼 아이콘 색).
function filterText(kind, sel) {
  if (kind === 'element') return sel.element ? t(`spirit.element.${sel.element}`) : t('spirit.filter.elementAll');
  if (kind === 'grade') return sel.grade ? t(`spirit.grade.${sel.grade}`) : t('spirit.filter.gradeAll');
  return sel.ownedOnly ? t('spirit.filter.ownedOnly') : t('spirit.filter.all');
}

// 같은 폭 버튼 3개(간격 4). 전체가 아닌 값이면 slot_selected 틀. 글자 = FILTER_FONT(본문 22의 80%), 안 들어가면 줄이되 화면 11px 아래로는 안 내린다.
function drawFilters(ctx, assets, a, sel, hits, uiScale) {
  const w = (a.width - 8) / 3;
  const minSize = Math.ceil(11 / uiScale);
  const PAD = 14; // slot_selected 틀 두께(5 x 2) + 여유 - 글자가 틀에 닿지 않게
  ['element', 'grade', 'ownedOnly'].forEach((kind, i) => {
    const r = rect(Math.round(a.x + i * (w + 4)), a.y, Math.round(w), a.height);
    const active = sel[kind] !== FILTER_ALL[kind];
    const st = active ? getUi(assets, 'items/slot_selected.png') : null;
    if (st && uiReady(st)) drawNine(ctx, st.img, SLOT_SLICE, r.x, r.y, r.width, r.height, 2);
    else nine(ctx, assets, active ? 'upgrade/card_selected.png' : 'menu/inset.png', r, active ? HUD_CONFIG.popup.ghost : C.outline);
    const text = filterText(kind, sel);
    const icon = kind === 'element' && sel.element ? 24 : 0; // 그 속성 잼(몸통 32 -> 24)
    let size = FILTER_FONT;
    ctx.font = getFontString(size, true);
    while (size > minSize && ctx.measureText(text).width + icon + (icon ? 6 : 0) > r.width - PAD * 2) ctx.font = getFontString(--size, true);
    const tw = Math.min(r.width - PAD * 2 - icon - (icon ? 6 : 0), ctx.measureText(text).width);
    const x0 = Math.round(r.x + (r.width - tw - icon - (icon ? 6 : 0)) / 2);
    if (icon) drawGem(ctx, assets, sel.element, x0, r.y + (r.height - icon) / 2, icon);
    const color = kind === 'grade' && sel.grade ? SPIRIT_GRADE_COLOR[sel.grade] : active ? C.text : C.sub;
    label(ctx, text, rect(x0 + icon + (icon ? 6 : 0), r.y, tw + 1, r.height), sel.grade === 'common' && kind === 'grade' ? C.sub : color, size, true, 'left');
    hits.push({ r, hit: { type: 'spiritFilter', kind } });
  });
}

// 잼 미니 아이콘(assets/gems normal, 몸통만). 그림이 없으면 속성 색 네모.
function drawGem(ctx, assets, color, x, y, size) {
  const st = assets?.gemImages?.get(`${color}_normal`);
  if (uiReady(st)) {
    const body = assets.gemBodySize ?? 32;
    const pad = ((assets.gemTileSize ?? 48) - body) / 2;
    drawImageSnapped(ctx, st.img, pad, pad, body, body, Math.round(x), Math.round(y), size, size);
    return;
  }
  ctx.fillStyle = SPIRIT_ELEMENT_COLOR[color][1];
  ctx.fillRect(Math.round(x + 4), Math.round(y + 4), size - 8, size - 8);
}

// 하나로 합친 목록: config 순서, 필터 적용. 가진 정령 = 속성 배경 + 등급 테두리 + Lv·별(·장착 띠), 안 가진 정령 = #221c2b 실루엣.
function drawList(ctx, assets, a, view, sel, hits, nowMs) {
  const { cfg, owned, slots } = view;
  const ids = spiritList(cfg, owned, sel);
  sel.maxScroll = listMaxScroll(ids.length, a.height);
  scrollList(sel, sel.scroll);
  if (ids.length === 0) {
    label(ctx, t('spirit.none'), rect(a.x, a.y, a.width, 40), C.sub, 12, false, 'center');
    return;
  }
  const sc = ctx.getTransform?.().a || 1;
  const gridW = COLS * CELL_W + (COLS - 1) * CELL_GAP_X;
  const gx = Math.round((a.x + (a.width - gridW) / 2) * sc) / sc; // 본문이 좁으면 양옆으로 넘친다(칸 크기 고정)
  hits.push({ r: a, hit: { type: 'spiritList' } }); // 칸 사이 틈에서도 끌 수 있게(칸이 위)
  ctx.save();
  ctx.beginPath();
  ctx.rect(gx, a.y, gridW, a.height);
  ctx.clip();
  ids.forEach((id, i) => {
    const x = gx + (i % COLS) * (CELL_W + CELL_GAP_X);
    const y = Math.round((a.y - sel.scroll + Math.floor(i / COLS) * (CELL_H + CELL_GAP_Y)) * sc) / sc;
    const top = Math.max(y, a.y);
    const bottom = Math.min(y + CELL_H, a.y + a.height);
    if (bottom <= top) return; // 목록 영역 밖
    hits.push({ r: rect(x, top, CELL_W, bottom - top), hit: { type: 'spiritItem', id } });
    const sp = cfg.spirits[id];
    const own = owned[id];
    const off = portraitOffset(portraitBBox(assets, id));
    if (!own) {
      // 안 가진 정령: 배경·빛 없이 어두운 바탕 + 실루엣.
      ctx.fillStyle = '#0d0a10';
      ctx.fillRect(x, y, CELL_W, CELL_H);
      ctx.fillStyle = '#221c2b';
      ctx.fillRect(x, y, CELL_W, 2);
      ctx.fillRect(x, y + CELL_H - 2, CELL_W, 2);
      ctx.fillRect(x, y, 2, CELL_H);
      ctx.fillRect(x + CELL_W - 2, y, 2, CELL_H);
      drawSpiritPortrait(ctx, assets, id, sp.element, x + off.x, y + off.y, PORTRAIT_SIZE * CELL_K, nowMs, 'silhouette');
      return;
    }
    // 속성 배경 -> 빛(영웅·전설) -> 초상 -> 등급 테두리 -> Lv·별·장착 띠. 애니는 칸마다 2프레임씩 엇갈린다.
    const fx = ((Math.floor(nowMs / CELL_MS) + i * 2) % CELL_FRAMES) * 43;
    sheetImg(ctx, assets, `spirit_cell/cell_bg_${sp.element}.png`, fx, 43, 46, x, y, CELL_K);
    if (sp.grade === 'epic') sheetImg(ctx, assets, 'spirit_cell/cell_glow_epic.png', 0, 43, 46, x, y, CELL_K);
    else if (sp.grade === 'legend') sheetImg(ctx, assets, 'spirit_cell/cell_glow_legend.png', fx, 43, 46, x, y, CELL_K);
    drawSpiritPortrait(ctx, assets, id, sp.element, x + off.x, y + off.y, PORTRAIT_SIZE * CELL_K, nowMs);
    sheetImg(ctx, assets, `spirit_cell/cell_frame_${sp.grade}.png`, 0, 43, 46, x, y, CELL_K);
    label(ctx, `Lv.${own.lv}`, rect(x + 7, y + CELL_H - 21, 40, 14), C.text, 11, true, 'left', OUTLINED);
    stars(ctx, x + CELL_W - 7 - (cfg.starMax * 5 - 2), y + CELL_H - 15, own.star, cfg.starMax, 3);
    if (slots.includes(id)) {
      const mark = t('spirit.equippedMark');
      ctx.font = getFontString(10, true);
      const mw = Math.min(CELL_W - 12, Math.ceil(ctx.measureText(mark).width) + 8);
      ctx.fillStyle = C.outline;
      ctx.fillRect(x + 6, y + 6, mw, 14);
      label(ctx, mark, rect(x + 10, y + 6, mw - 8, 14), C.green, 10, true, 'left');
    }
  });
  ctx.restore();
  if (sel.maxScroll > 0) {
    // 스크롤 막대(4px) - 격자 오른쪽 바로 옆.
    const bh = Math.max(16, Math.round((a.height * a.height) / (a.height + sel.maxScroll)));
    ctx.fillStyle = '#221c2b';
    ctx.fillRect(gx + gridW + 1, a.y, BAR_W, a.height);
    ctx.fillStyle = '#655a74';
    ctx.fillRect(gx + gridW + 1, Math.round(a.y + ((a.height - bh) * sel.scroll) / sel.maxScroll), BAR_W, bh);
  }
}

// 상세·설명 칸 오른쪽 위 닫기 X(그림 16x16 x2, 터치 44x44) - 누르면 목록으로.
function drawClose(ctx, assets, a, hits) {
  const r = rect(a.x + a.width - 46, a.y + 2, 44, 44);
  drawFixedImage(ctx, assets, 'upgrade/btn_close.png', r.x + 22, r.y + 22, 2);
  hits.push({ r, hit: { type: 'spiritBack' } });
}

// 안 가진 정령: 도감 설명(이름·등급·속성·역할·1레벨 기준 효과). 레벨업·장착 없음, 오른쪽 위 X로 닫기만.
function drawInfo(ctx, assets, a, view, sel, hits, nowMs) {
  nine(ctx, assets, 'menu/inset.png', a, C.outline);
  drawDexInfo(ctx, assets, a, view.cfg, sel.detail, null, nowMs);
  drawClose(ctx, assets, a, hits);
}

function drawDetail(ctx, assets, a, view, sel, towers, hits, nowMs) {
  const { cfg, owned, slots } = view;
  const id = sel.detail;
  const sp = cfg.spirits[id];
  const own = owned[id];
  const color = towers[sel.slot]?.color ?? null;
  nine(ctx, assets, 'menu/inset.png', a, C.outline);
  const P = 10;
  const box = rect(a.x + P, a.y + P, 80, 80);
  ctx.fillStyle = '#15121c';
  ctx.fillRect(box.x, box.y, box.width, box.height);
  gradeFrame(ctx, box, sp.grade, 2);
  drawSpiritPortrait(ctx, assets, id, sp.element, box.x + 4, box.y + 4, 72, nowMs);

  const tx = box.x + box.width + 12;
  const tw = a.x + a.width - P - tx - 40; // 오른쪽 위 X 자리
  label(ctx, t(`spirit.name.${id}`), rect(tx, a.y + P, tw, 22), C.title, 16, true, 'left');
  label(ctx, `${t(`spirit.grade.${sp.grade}`)} · ${t(`spirit.element.${sp.element}`)} · ${t(`spirit.role.${sp.role}`)}`, rect(tx, a.y + P + 24, tw, 18), SPIRIT_GRADE_COLOR[sp.grade] === '#655a74' ? C.sub : SPIRIT_GRADE_COLOR[sp.grade], 12, true, 'left');
  label(ctx, `Lv.${own.lv} / ${cfg.levelMax}`, rect(tx, a.y + P + 44, 90, 18), C.text, 13, true, 'left');
  stars(ctx, tx + 96, a.y + P + 49, own.star, cfg.starMax, 8);
  if (color && sp.element === color) label(ctx, t('spirit.resonanceOn', { mul: cfg.resonanceMul }), rect(tx, a.y + P + 64, tw, 18), C.title, 12, false, 'left');

  // 지금 수치 / 다음 레벨 수치(고른 수호자 칸 기준 - 공명 포함).
  let y = box.y + box.height + 10;
  const line = (head, text, col) => {
    label(ctx, head, rect(a.x + P, y, 70, 18), C.sub, 12, false, 'left');
    label(ctx, text, rect(a.x + P + 74, y, a.width - P * 2 - 74, 18), col, 12, true, 'left');
    y += 20;
  };
  const maxed = own.lv >= cfg.levelMax;
  line(t('spirit.now'), spiritEffectText(cfg, id, own, color), C.text);
  if (!maxed) line(t('spirit.next'), spiritEffectText(cfg, id, { ...own, lv: own.lv + 1 }, color), C.green);

  // 아래 버튼: 레벨업(골드 + 정령석) / 장착·해제. 닫기는 오른쪽 위 X.
  const bh = 40;
  const by = a.y + a.height - P - bh;
  const bw = a.width - P * 2;
  const eqW = 84;
  const up = rect(a.x + P, by, bw - eqW - 6, bh);
  const eq = rect(up.x + up.width + 6, by, eqW, bh);
  if (maxed) {
    nine(ctx, assets, 'upgrade/btn_disabled.png', up, HUD_CONFIG.popup.disabled);
    label(ctx, t('popup.prep.max'), up, C.sub, 14, true, 'center');
  } else {
    const cost = levelUpCost(cfg, own.lv, view.floorReward);
    const ok = view.gold >= cost.gold && view.stones >= cost.stones;
    const meta = nine(ctx, assets, ok ? 'buttons/btn_gold.png' : 'upgrade/btn_disabled.png', up, HUD_CONFIG.popup.disabled);
    const col = ok ? meta?.textColor ?? C.outline : C.sub;
    const opts = ok ? { outline: false } : undefined;
    const goldText = fmtGold(cost.gold);
    const stoneText = String(cost.stones);
    const upText = t('spirit.levelUp');
    ctx.font = getFontString(13, true);
    const lw = Math.ceil(ctx.measureText(upText).width) + 2; // 언어마다 글자 폭이 달라 잰다("Level up")
    label(ctx, upText, rect(up.x + 10, up.y, lw, bh), col, 13, true, 'left', opts);
    // 골드 아이콘 + 값, 정령석 아이콘 + 값 - 모자란 쪽은 빨강.
    const short = (lack) => (ok ? col : lack ? HUD_CONFIG.popup.loseColor : C.sub);
    const half = Math.floor((up.width - lw - 20) / 2);
    const gx = up.x + 16 + lw;
    drawFixedImage(ctx, assets, 'upgrade/coin_small.png', gx + 8, up.y + bh / 2, 2);
    label(ctx, goldText, rect(gx + 20, up.y, half - 22, bh), short(view.gold < cost.gold), 13, true, 'left', opts);
    drawSpiritStone(ctx, assets, gx + half + 8, up.y + bh / 2, 1);
    label(ctx, stoneText, rect(gx + half + 20, up.y, half - 22, bh), short(view.stones < cost.stones), 13, true, 'left', opts);
    hits.push({ r: up, hit: { type: 'spiritLevelUp', id } });
    // 정령석이 모자라면 버튼 위에 얻는 곳 두 줄(글만, docs/spirit-stones.md).
    if (view.stones < cost.stones) t('spirit.stoneWhere').forEach((s, i) => label(ctx, `· ${s}`, rect(a.x + P, by - 40 + i * 18, bw, 18), C.sub, 12, false, 'left'));
  }
  const equipped = slots[sel.slot] === id;
  const em = nine(ctx, assets, 'buttons/btn_primary.png', eq, HUD_CONFIG.popup.primary);
  label(ctx, t(equipped ? 'spirit.unequip' : 'spirit.equip'), eq, em?.textColor ?? C.text, 13, true, 'center');
  hits.push({ r: eq, hit: { type: 'spiritEquip', id: equipped ? null : id } });
  drawClose(ctx, assets, a, hits);
}

export function hitSpiritTab(hits, bx, by) {
  // 뒤에 그린 것(목록·버튼)이 위 - 뒤에서부터.
  for (let i = hits.length - 1; i >= 0; i--) {
    const { r } = hits[i];
    if (bx >= r.x && bx < r.x + r.width && by >= r.y && by < r.y + r.height) return hits[i].hit;
  }
  return null;
}
