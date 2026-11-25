// 정비 팝업의 정령 탭(docs/spirits.md 7장). 그리기 + 터치 사각형만 - 장착·레벨업은 main.js가 inventory를 부른다.
// 좌표는 prepPopup과 같은 540 폭 기준(basis). 위 = 정령석 + 수호자 5줄(정령 칸·공명·효과 한 줄),
// 아래 = "보유 n / 30" + 필터 버튼 3개(속성·등급·보유 - 누를 때마다 다음 값, 길게 누르면 전체) + 정령 목록 하나(5열).
// 보유 "전체"면 안 가진 정령이 실루엣으로 섞인다. 누르면 가진 정령 = 상세(레벨업·장착), 안 가진 정령 = 도감 설명(spiritDex.js).
//   sel(state.spirit)  = { slot, element, grade, ownedOnly, detail } - 고른 수호자 칸 / 필터 / 상세·설명을 연 정령 id
//   view(view.spirit)  = { cfg, owned, slots, pending, stones, gold, floorReward }
import { t } from '../../config/i18n.js';
import { getFontString } from '../../config/fonts.js';
import { HUD_CONFIG } from '../../config/hud.js';
import { fmt as fmtGold, spiritEffectText } from '../shopText.js';
import { levelUpCost, dexEntries } from '../../core/spirits/spirits.js';
import { drawSpirit, drawSpiritPortrait, drawSpiritStone, SPIRIT_GRADE_COLOR, SPIRIT_ELEMENT_COLOR, SPIRIT_SIZE } from '../spiritSprite.js';
import { drawFixedImage, drawNine, getUi, uiReady } from '../uiKit.js';
import { drawImageSnapped } from '../screenFit.js';
import { nine, label } from './prepPopup.js';
import { drawDexCell, drawDexInfo } from './spiritDex.js';

// 필터 순환 순서(docs/spirits.md 7장)와 "전체" 값. 보유 필터는 true = 보유만(기본), false = 전체.
export const FILTER_CYCLE = { element: [null, 'red', 'blue', 'green', 'purple', 'yellow'], grade: [null, 'common', 'rare', 'epic', 'legend'], ownedOnly: [true, false] };
export const FILTER_ALL = { element: null, grade: null, ownedOnly: false };
const TOP_H = 28;
const ROW_H = 44;
const ROW_GAP = 4;
const FILTER_H = 40;
const FILTER_FONT = Math.round(22 * 0.8); // 필터 버튼 글자(basis) - 본문 22의 80%
const HEAD_H = 16; // "보유 n / 30" 줄
const SLOT_SLICE = [5, 5, 5, 5]; // items/slot_selected(22x22, 틀 두께 4 + 그림자 1)을 9-slice로
const COLS = 5;
const C = { title: HUD_CONFIG.text.title, text: HUD_CONFIG.text.primary, sub: HUD_CONFIG.text.dim, outline: '#0d0a10', green: HUD_CONFIG.popup.upgradeColor, chip: '#8cc4ee', white: '#ffffff', star: '#f2d264', starOff: '#3b3347' };

const rect = (x, y, width, height) => ({ x, y, width, height });

export function newSpiritSel() {
  return { slot: 0, element: null, grade: null, ownedOnly: true, detail: null };
}

// 필터 버튼 탭 = 다음 값, 길게 누르기 = 전체로. 열어 둔 상세·설명은 닫는다.
export function cycleFilter(sel, kind) {
  const list = FILTER_CYCLE[kind];
  sel[kind] = list[(list.indexOf(sel[kind]) + 1) % list.length];
  sel.detail = null;
}

export function resetFilter(sel, kind) {
  sel[kind] = FILTER_ALL[kind];
  sel.detail = null;
}

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
export function drawSpiritTab(ctx, assets, c, view, sel, towers, drawStatue, nowMs, uiScale = 1) {
  const hits = [];
  const { cfg, owned, slots } = view;

  // ---- 위: 안내(층 중이면 "다음 층부터 적용") + 정령석 ----
  label(ctx, view.pending ? t('inv.pending') : t('spirit.slotHint'), rect(c.x, c.y, c.width - 110, TOP_H), view.pending ? C.chip : C.sub, 12, false, 'left');
  const chip = rect(c.x + c.width - 100, c.y, 100, TOP_H);
  nine(ctx, assets, 'menu/inset.png', chip, C.outline);
  drawSpiritStone(ctx, assets, chip.x + 16, chip.y + TOP_H / 2, 1);
  label(ctx, fmtGold(view.stones), rect(chip.x + 28, chip.y, chip.width - 36, TOP_H), C.text, 14, true, 'right');

  // ---- 수호자 5줄 ----
  let y = c.y + TOP_H + 6;
  for (let i = 0; i < 5; i++) {
    const tower = towers[i];
    const card = rect(c.x, y, c.width, ROW_H);
    nine(ctx, assets, sel.slot === i ? 'upgrade/card_selected.png' : 'upgrade/card.png', card, '#1f1b2b');
    if (tower) drawStatue?.(ctx, tower.color, card.x + 26, card.y + ROW_H / 2, 34, tower.look);
    const box = rect(card.x + 50, card.y + 4, 36, 36);
    nine(ctx, assets, 'menu/inset.png', box, C.outline);
    const id = slots[i];
    const sp = id && cfg.spirits[id];
    const tx = box.x + box.width + 10;
    const tw = card.x + card.width - 8 - tx;
    if (sp && owned[id] && tower) {
      gradeFrame(ctx, box, sp.grade);
      drawSpirit(ctx, assets, id, sp.element, box.x + 3, box.y + 3, 3, nowMs);
      const res = sp.element === tower.color;
      const RES_W = 84; // "Resonance"까지 들어가는 폭
      label(ctx, t(`spirit.name.${id}`), rect(tx, card.y + 4, tw - (res ? RES_W + 4 : 0), 18), C.text, 13, true, 'left');
      if (res) label(ctx, t('spirit.resonance'), rect(card.x + card.width - 8 - RES_W, card.y + 4, RES_W, 18), C.title, 12, true, 'right');
      label(ctx, spiritEffectText(cfg, id, owned[id], tower.color), rect(tx, card.y + 22, tw, 18), C.sub, 12, false, 'left');
    } else label(ctx, t('spirit.empty'), rect(tx, card.y, tw, ROW_H), C.sub, 12, false, 'left');
    hits.push({ r: card, hit: { type: 'spiritSlot', index: i } });
    y += ROW_H + ROW_GAP;
  }

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

// 하나로 합친 목록: config 순서, 필터 적용. 가진 정령 = 등급 테두리 + Lv·별(·장착 중), 안 가진 정령 = #221c2b 실루엣.
function drawList(ctx, assets, a, view, sel, hits, nowMs) {
  const { cfg, owned, slots } = view;
  const ids = spiritList(cfg, owned, sel);
  const top = a.y;
  if (ids.length === 0) {
    label(ctx, t('spirit.none'), rect(a.x, top, a.width, 40), C.sub, 12, false, 'center');
    return;
  }
  const rows = Math.ceil(Object.keys(cfg.spirits).length / COLS); // 30종 전부 가져도 스크롤 없이
  const cellH = Math.max(30, Math.min(64, Math.floor((a.y + a.height - top - (rows - 1) * 4) / rows)));
  const cellW = Math.floor((a.width - (COLS - 1) * 4) / COLS);
  const k = cellH >= 56 ? 4 : cellH >= 42 ? 3 : 2;
  ids.forEach((id, i) => {
    const sp = cfg.spirits[id];
    const own = owned[id];
    const r = rect(a.x + (i % COLS) * (cellW + 4), top + Math.floor(i / COLS) * (cellH + 4), cellW, cellH);
    hits.push({ r, hit: { type: 'spiritItem', id } });
    if (!own) {
      drawDexCell(ctx, assets, r, cfg, id, false, false, nowMs);
      return;
    }
    nine(ctx, assets, 'menu/inset.png', r, C.outline);
    gradeFrame(ctx, r, sp.grade);
    drawSpirit(ctx, assets, id, sp.element, Math.round(r.x + 8), Math.round(r.y + (cellH - SPIRIT_SIZE * k) / 2), k, nowMs + i * 90);
    const tx = r.x + 12 + SPIRIT_SIZE * k;
    label(ctx, `Lv.${own.lv}`, rect(tx, r.y + 4, r.x + r.width - 6 - tx, 14), C.text, 11, true, 'left');
    stars(ctx, tx, r.y + cellH - 10, own.star, cfg.starMax, 3);
    if (slots.includes(id)) {
      // 장착 중: 글자가 칸에 안 들어가면(영어·좁은 칸) 글자 대신 칸 안쪽 흰 테두리.
      const mark = t('spirit.equippedMark');
      const mw = r.x + r.width - 6 - tx;
      ctx.font = getFontString(10, true);
      if (ctx.measureText(mark).width <= mw && cellH >= 38) label(ctx, mark, rect(tx, r.y + cellH / 2 - 7, mw, 14), C.green, 10, true, 'left');
      else gradeFrame(ctx, rect(r.x + 2, r.y + 2, r.width - 4, r.height - 4), null, 2);
    }
  });
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
