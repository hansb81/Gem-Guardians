// 정비 팝업의 정령 탭(docs/spirits.md 7장). 그리기 + 터치 사각형만 - 장착·레벨업은 main.js가 inventory를 부른다.
// 좌표는 prepPopup과 같은 540 폭 기준(basis). 위 = 정령석 + 수호자 5줄(정령 칸·공명·효과 한 줄),
// 아래 = 보유 정령 목록(5열, 속성·등급 필터) 또는 고른 정령의 상세(수치·레벨업·장착/해제).
//   sel(state.spirit)  = { slot, element, grade, detail }  - 고른 수호자 칸 / 필터 / 상세로 연 정령 id
//   view(view.spirit)  = { cfg, owned, slots, pending, stones, gold, floorReward }
import { t } from '../../config/i18n.js';
import { getFontString } from '../../config/fonts.js';
import { HUD_CONFIG } from '../../config/hud.js';
import { fmt as fmtGold, spiritEffectText } from '../shopText.js';
import { levelUpCost } from '../../core/spirits/spirits.js';
import { drawSpirit, drawSpiritPortrait, drawSpiritStone, SPIRIT_GRADE_COLOR, SPIRIT_ELEMENT_COLOR, SPIRIT_SIZE } from '../spiritSprite.js';
import { drawFixedImage } from '../uiKit.js';
import { nine, label } from './prepPopup.js';

const ELEMENTS = ['red', 'blue', 'yellow', 'green', 'purple'];
const GRADES = ['common', 'rare', 'epic', 'legend'];
const TOP_H = 28;
const ROW_H = 44;
const ROW_GAP = 4;
const FILTER_H = 30;
const COLS = 5;
const C = { title: HUD_CONFIG.text.title, text: HUD_CONFIG.text.primary, sub: HUD_CONFIG.text.dim, outline: '#0d0a10', green: HUD_CONFIG.popup.upgradeColor, chip: '#8cc4ee', white: '#ffffff', star: '#f2d264', starOff: '#3b3347' };

const rect = (x, y, width, height) => ({ x, y, width, height });

export function newSpiritSel() {
  return { slot: 0, element: null, grade: null, detail: null };
}

// 목록에 보일 보유 정령 id(config 순서 = 속성·등급 순), 필터 적용.
export function spiritList(cfg, owned, sel) {
  return Object.keys(cfg.spirits).filter((id) => owned[id] && (!sel.element || cfg.spirits[id].element === sel.element) && (!sel.grade || cfg.spirits[id].grade === sel.grade));
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
export function drawSpiritTab(ctx, assets, c, view, sel, towers, drawStatue, nowMs) {
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
  if (sel.detail && owned[sel.detail]) drawDetail(ctx, assets, area, view, sel, towers, hits, nowMs);
  else drawList(ctx, assets, area, view, sel, hits, nowMs);
  return hits;
}

function drawList(ctx, assets, a, view, sel, hits, nowMs) {
  const { cfg, owned, slots } = view;
  // 필터 한 줄: 전체 + 속성 5(색 칩) | 등급 4(테두리 색 글자).
  const ew = 30;
  const chips = [{ key: null, kind: 'element' }, ...ELEMENTS.map((key) => ({ key, kind: 'element' })), ...GRADES.map((key) => ({ key, kind: 'grade' }))];
  const gw = Math.floor((a.width - 6 * (ew + 4) - 8 - 3 * 4) / 4);
  let x = a.x;
  chips.forEach((ch, i) => {
    const w = ch.kind === 'element' ? ew : gw;
    if (i === 6) x += 8;
    const r = rect(x, a.y, w, FILTER_H - 4);
    const on = ch.kind === 'element' ? sel.element === ch.key : sel.grade === ch.key;
    nine(ctx, assets, on ? 'upgrade/tab_on.png' : 'menu/inset.png', r, on ? HUD_CONFIG.popup.ghost : C.outline);
    if (ch.kind === 'grade') label(ctx, t(`spirit.grade.${ch.key}`), r, on ? C.text : SPIRIT_GRADE_COLOR[ch.key], 11, true, 'center');
    else if (ch.key == null) label(ctx, t('inv.filter.all'), r, on ? C.text : C.sub, 11, true, 'center');
    else {
      ctx.fillStyle = C.outline;
      ctx.fillRect(r.x + w / 2 - 7, r.y + r.height / 2 - 7, 14, 14);
      ctx.fillStyle = SPIRIT_ELEMENT_COLOR[ch.key][on ? 2 : 1];
      ctx.fillRect(r.x + w / 2 - 5, r.y + r.height / 2 - 5, 10, 10);
    }
    hits.push({ r, hit: { type: 'spiritFilter', kind: ch.kind, key: ch.key } });
    x += w + 4;
  });

  const ids = spiritList(cfg, owned, sel);
  const top = a.y + FILTER_H + 2;
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
    hits.push({ r, hit: { type: 'spiritItem', id } });
  });
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
  const tw = a.x + a.width - P - tx;
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

  // 아래 버튼: 레벨업(골드 + 정령석) / 장착·해제 / 목록
  const bh = 40;
  const by = a.y + a.height - P - bh;
  const bw = a.width - P * 2;
  const backW = 64;
  const eqW = 84;
  const up = rect(a.x + P, by, bw - backW - eqW - 12, bh);
  const eq = rect(up.x + up.width + 6, by, eqW, bh);
  const back = rect(eq.x + eqW + 6, by, backW, bh);
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
  }
  const equipped = slots[sel.slot] === id;
  const em = nine(ctx, assets, 'buttons/btn_primary.png', eq, HUD_CONFIG.popup.primary);
  label(ctx, t(equipped ? 'spirit.unequip' : 'spirit.equip'), eq, em?.textColor ?? C.text, 13, true, 'center');
  hits.push({ r: eq, hit: { type: 'spiritEquip', id: equipped ? null : id } });
  const bm = nine(ctx, assets, 'buttons/btn_secondary.png', back, HUD_CONFIG.popup.ghost);
  label(ctx, t('spirit.back'), back, bm?.textColor ?? C.text, 13, true, 'center');
  hits.push({ r: back, hit: { type: 'spiritBack' } });
}

export function hitSpiritTab(hits, bx, by) {
  // 뒤에 그린 것(목록·버튼)이 위 - 뒤에서부터.
  for (let i = hits.length - 1; i >= 0; i--) {
    const { r } = hits[i];
    if (bx >= r.x && bx < r.x + r.width && by >= r.y && by < r.y + r.height) return hits[i].hit;
  }
  return null;
}
