// 정비 팝업(docs/upgrade-popup.md) - 석상 강화 / 토템(잠김) / 보관함 3탭. 층 클리어·패배·마을(받침대)·전투 중 석상 탭이
// 모두 이 팝업 하나를 쓰고 상황(context)에 따라 제목·상황 줄·아래 버튼·X·처음 탭만 바뀐다.
// 좌표는 전부 540 폭 기준(basis, 기획서의 "화면 px")이고 실제 캔버스엔 scale(= 화면 폭 / 540)을 곱해 그린다
// (메인 메뉴와 같은 방식). 그림은 basis에서 원본 x2(보유 칸만 x3) 정수 배율, imageSmoothingEnabled=false.
//   layoutPrepPopup = 사각형만 계산하는 순수 함수(tests/prepPopup.test.js)
//   drawPrepPopup   = 그리기만(보관함 본문 터치 사각형은 layout.vaultHits에 담아 둔다)
//   hitPrepPopup    = 화면 좌표 -> { type, ... }
import { drawNine, drawText, drawDamage, drawFixedImage, getUi, getUiMeta, getUiFont, uiReady } from '../uiKit.js';
import { getFontString } from '../../config/fonts.js';
import { t } from '../../config/i18n.js';
import { HUD_CONFIG } from '../../config/hud.js';
import { towerLevelCost, maxTowerLevelUps, evenTowerLevelUps } from '../../core/economy/economy.js';
import { vaultSections } from '../inventoryTab.js';
import { fmt as fmtGold } from '../shopText.js'; // 골드 1,000 형식(메뉴 재화 바·상점과 같음)

export const PREP_TABS = ['statue', 'totem', 'vault'];
const BASIS_W = 540;
const K = 2;
const SIDE = 26; // popup_menu 테두리 안쪽
const BOTTOM = 26;
const TAB_HIT_H = 38; // 탭 터치 높이(그림은 본문과 6 겹쳐 44)
const TAB_OVERLAP = 6; // 켜진 탭이 tab_body 윗변 3px(원본)을 덮는다
const ACTION_H = 48;
const ROW_GAP = 6;
const ROW_MAX_H = 112;
const FOOTER_H = 24;
const ALL_H = 40; // 일괄 강화 버튼
const UPGRADE_W = 116;
const UPGRADE_H = 44; // 주 버튼
const MAX_H = 36;
const TOTEM_ROW_H = 56;
const FX_PLUS_MS = 600;
const C = {
  title: HUD_CONFIG.text.title,
  text: HUD_CONFIG.text.primary,
  sub: HUD_CONFIG.text.dim,
  silhouette: '#3b3347',
  outline: '#0d0a10',
  red: HUD_CONFIG.popup.loseColor,
  white: '#ffffff',
};

const rect = (x, y, width, height) => ({ x, y, width, height });
// 석상 이름 = 메뉴·상점 글자와 같은 단색 외곽선(#0d0a10, 기준 1.5px가 바깥에 보이게 선 3).
const NAME_OUTLINE = { outlineColor: C.outline, outlineWidth: 3 };
// 처음 열 때 상태. 층 클리어/패배는 같은 판에서 마지막에 본 탭(remembered), 마을은 항상 보관함.
export function openPrepState(context, remembered = null, selectedTower = null) {
  const tab = context === 'village' ? 'vault' : context === 'towerTap' ? 'statue' : remembered ?? 'statue';
  return { context, tab, selectedTower, flash: null };
}

// 잠긴 토템 탭은 본문 안내만 보여 주고 "마지막 탭" 기억에는 남기지 않는다.
export function rememberTab(prev, tab, totemLocked = HUD_CONFIG.totemTab.locked) {
  return tab === 'totem' && totemLocked ? prev : tab;
}

// 석상 한 줄의 버튼 상태 - 최대 레벨 / 골드 부족 / MAX +N(지금 골드로 오를 레벨 수).
export function statueRowInfo(balance, level, gold) {
  const maxed = level >= balance.tower.maxLevel;
  const cost = maxed ? 0 : towerLevelCost(balance, level);
  const maxUps = maxed ? 0 : maxTowerLevelUps(balance, level, gold).levels;
  return { maxed, cost, affordable: !maxed && gold >= cost, maxUps };
}

// 일괄 강화 버튼 - 골고루 올릴 레벨 수(+N)와 총 비용.
export function statueAllInfo(balance, levels, gold) {
  const { count, cost } = evenTowerLevelUps(balance, levels, gold);
  return { count, cost };
}

export function layoutPrepPopup(screenW, screenH, context, tab) {
  const scale = screenW / BASIS_W;
  const H = Math.round(screenH / scale);
  const m = HUD_CONFIG.popup.sheet;
  const sheet = rect(m.marginX, m.top, BASIS_W - m.marginX * 2, H - m.top - m.bottom);
  const ix = sheet.x + SIDE;
  const iw = sheet.width - SIDE * 2;
  const hasClose = context === 'village' || context === 'towerTap';
  const hasAction = context === 'floorClear' || context === 'defeat';

  const out = { scale, basisH: H, context, tab, sheet, emblem: { cx: sheet.x + sheet.width / 2, cy: sheet.y } };
  // 닫기 그림 16x16(화면 32), 터치 44x44.
  out.close = hasClose ? rect(sheet.x + sheet.width - 52, sheet.y + 8, 44, 44) : null;
  out.title = rect(ix + 48, sheet.y + 36, iw - 96, 32);
  out.status = rect(ix, sheet.y + 72, iw - 132, 32);
  out.goldChip = rect(ix + iw - 124, sheet.y + 72, 124, 32);

  const tabY = sheet.y + 108;
  const tw = Math.floor((iw - 12) / 3);
  out.tabs = {};
  PREP_TABS.forEach((key, i) => (out.tabs[key] = rect(ix + i * (tw + 6), tabY, tw, TAB_HIT_H)));

  const bodyY = tabY + TAB_HIT_H;
  const actionY = sheet.y + sheet.height - BOTTOM - ACTION_H;
  const bodyBottom = hasAction ? actionY - 8 : sheet.y + sheet.height - BOTTOM;
  out.body = rect(ix, bodyY, iw, bodyBottom - bodyY);
  out.content = rect(ix + 10, bodyY + 10, iw - 20, out.body.height - 20);

  out.actions = [];
  if (context === 'floorClear') out.actions.push({ kind: 'next', rect: rect(ix, actionY, iw, ACTION_H) });
  else if (context === 'defeat') {
    const hw = (iw - 8) / 2;
    out.actions.push({ kind: 'village', rect: rect(ix, actionY, hw, ACTION_H) });
    out.actions.push({ kind: 'retry', rect: rect(ix + hw + 8, actionY, hw, ACTION_H) });
  }

  const c = out.content;
  if (tab === 'statue') out.statue = layoutStatueTab(c);
  else if (tab === 'totem') out.totem = layoutTotemTab(c);
  else out.vault = vaultSections(c);
  return out;
}

function layoutStatueTab(c) {
  const rowH = Math.min(ROW_MAX_H, Math.floor((c.height - FOOTER_H - ALL_H - ROW_GAP * 2 - ROW_GAP * 4) / 5));
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const card = rect(c.x, c.y + i * (rowH + ROW_GAP), c.width, rowH);
    const mid = card.y + rowH / 2;
    const upgrade = rect(card.x + card.width - 8 - UPGRADE_W, Math.round(mid - (UPGRADE_H + 4 + MAX_H) / 2), UPGRADE_W, UPGRADE_H);
    const max = rect(upgrade.x, upgrade.y + UPGRADE_H + 4, UPGRADE_W, MAX_H);
    const tx = card.x + 66;
    const textW = upgrade.x - 8 - tx;
    rows.push({
      card,
      statueBox: rect(card.x + 8, Math.round(mid - 28), 48, 56), // 석상 32x40 + 안쪽 8
      name: rect(tx, Math.round(mid - 42), textW, 22),
      // box_floor 테두리가 원본 5(화면 10)씩이라 32 높이여야 안쪽 12에 글자가 테를 안 덮는다("Lv.200"까지 폭 44).
      badge: rect(tx, Math.round(mid - 17), 64, 32),
      plus: rect(tx + 70, Math.round(mid - 17), 40, 32),
      attack: rect(tx, Math.round(mid + 19), textW, 22),
      upgrade,
      max,
    });
  }
  const fy = rows[4].card.y + rowH + ROW_GAP;
  const half = Math.floor(c.width / 2);
  return { rows, hint: rect(c.x, fy, half, FOOTER_H), total: rect(c.x + half, fy, c.width - half, FOOTER_H), all: rect(c.x, fy + FOOTER_H + ROW_GAP, c.width, ALL_H) };
}

function layoutTotemTab(c) {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const card = rect(c.x, c.y + i * (TOTEM_ROW_H + ROW_GAP), c.width, TOTEM_ROW_H);
    const s1 = rect(card.x + card.width - 8 - 44, card.y + 6, 44, 44);
    const s0 = rect(s1.x - 8 - 44, s1.y, 44, 44);
    rows.push({ card, statue: rect(card.x + 12, card.y + 8, 32, 40), name: rect(card.x + 56, card.y + 17, s0.x - 8 - card.x - 56, 22), slots: [s0, s1] });
  }
  const ny = rows[4].card.y + TOTEM_ROW_H + 10;
  return { rows, notice: rect(c.x, ny, c.width, Math.max(0, c.y + c.height - ny)) };
}

const inside = (x, y, r) => r && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

// x, y = 캔버스 화면 좌표. 보관함 본문은 drawPrepPopup이 채운 layout.vaultHits(basis)로 판정한다.
export function hitPrepPopup(layout, x, y) {
  const bx = x / layout.scale;
  const by = y / layout.scale;
  if (inside(bx, by, layout.close)) return { type: 'close' };
  for (const key of PREP_TABS) if (inside(bx, by, layout.tabs[key])) return { type: 'tab', tab: key };
  for (const a of layout.actions) if (inside(bx, by, a.rect)) return { type: 'action', action: a.kind };
  if (layout.statue) {
    for (let i = 0; i < 5; i++) {
      const row = layout.statue.rows[i];
      if (inside(bx, by, row.upgrade)) return { type: 'upgrade', index: i };
      if (inside(bx, by, row.max)) return { type: 'max', index: i };
    }
    if (inside(bx, by, layout.statue.all)) return { type: 'all' };
  }
  const v = layout.vaultHits;
  if (v) {
    for (const [filter, r] of Object.entries(v.tabs)) if (inside(bx, by, r)) return { type: 'filter', filter };
    for (let i = 0; i < v.equip.length; i++) if (inside(bx, by, v.equip[i])) return { type: 'slot', index: i };
    for (const [id, r] of Object.entries(v.preFloor)) if (inside(bx, by, r)) return { type: 'reserve', id };
    for (const a of v.actions) if (inside(bx, by, a.rect)) return { type: 'detailAction', action: a };
    if (inside(bx, by, v.grid)) {
      const hit = Object.entries(v.items).find(([, r]) => inside(bx, by, r));
      return { type: 'item', id: hit ? hit[0] : null, by };
    }
  }
  // 카드 바깥 탭 = 닫기(X가 있는 상황만). 층 클리어/패배는 아래 버튼만 나가는 길.
  if (layout.close && !inside(bx, by, layout.sheet)) return { type: 'close' };
  return null;
}

// state = openPrepState + flash { index, atMs, white } + view(그릴 값):
// view = { floor, best, gold, totalAttack, towers: [{ color, name, level, atk, nextAtk, info: statueRowInfo }],
//          nowMs, drawStatue(ctx, color, cx, cy, size), drawVault(rect) -> 터치 사각형 }
export function drawPrepPopup(ctx, assets, state, layout) {
  const { sheet, view } = { sheet: layout.sheet, view: state.view };
  ctx.save();
  ctx.scale(layout.scale, layout.scale);
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = HUD_CONFIG.popup.overlayColor;
  ctx.fillRect(0, 0, BASIS_W, layout.basisH);

  nine(ctx, assets, 'menu/popup_menu.png', sheet, '#221c2b');
  drawFixedImage(ctx, assets, 'upgrade/emblem_upgrade.png', layout.emblem.cx, layout.emblem.cy, K);
  if (layout.close) drawFixedImage(ctx, assets, 'menu/btn_close.png', layout.close.x + 22, layout.close.y + 22, K);

  const n = view.floor;
  const titleKey = state.context === 'towerTap' ? 'village' : state.context;
  label(ctx, t(`popup.prep.title.${titleKey}`, { n }), layout.title, C.title, 22, true, 'center');
  const statusText = state.context === 'towerTap' ? t('popup.pause.title') : t(`popup.prep.status.${state.context}`, { best: view.best });
  label(ctx, statusText, layout.status, C.sub, 13, false, 'left');
  drawGoldChip(ctx, assets, layout.goldChip, view.gold);

  // 탭: 꺼진 탭 → 본문 → 켜진 탭(본문 윗변을 덮게).
  const body = layout.body;
  for (const key of PREP_TABS) if (key !== state.tab) drawTab(ctx, assets, layout.tabs[key], key, false);
  nine(ctx, assets, 'upgrade/tab_body.png', body, '#15121c');
  drawTab(ctx, assets, layout.tabs[state.tab], state.tab, true);

  if (layout.statue) drawStatueTab(ctx, assets, state, layout.statue, view);
  else if (layout.totem) drawTotemTab(ctx, assets, layout.totem, view);
  else layout.vaultHits = view.drawVault ? view.drawVault(layout.content) : null;

  for (const a of layout.actions) {
    const path = a.kind === 'next' ? 'buttons/btn_gold.png' : a.kind === 'retry' ? 'buttons/btn_primary.png' : 'buttons/btn_secondary.png';
    const meta = nine(ctx, assets, path, a.rect, HUD_CONFIG.popup.ghost);
    const text = a.kind === 'next' ? t('popup.prep.next', { n: n + 1 }) : a.kind === 'retry' ? t('popup.prep.retry', { n }) : t('popup.prep.village');
    label(ctx, text, a.rect, meta?.textColor ?? C.text, 16, true, 'center', a.kind === 'next' ? { outline: false } : undefined);
  }
  ctx.restore();
}

function drawStatueTab(ctx, assets, state, tab, view) {
  const flash = state.flash;
  tab.rows.forEach((row, i) => {
    const tower = view.towers[i];
    if (!tower) return;
    const { info } = tower;
    const selected = state.selectedTower === i;
    nine(ctx, assets, selected ? 'upgrade/card_selected.png' : 'upgrade/card.png', row.card, '#1f1b2b');
    const box = row.statueBox;
    nine(ctx, assets, 'menu/inset.png', box, C.outline);
    view.drawStatue?.(ctx, tower.color, box.x + box.width / 2, box.y + box.height / 2, 40);
    // 방금 강화: 받침 상자에 1프레임 흰 테 + Lv 옆 초록 "+1" 0.6초.
    const justUp = flash && flash.index === i;
    if (justUp && flash.white) {
      ctx.strokeStyle = C.white;
      ctx.lineWidth = 2;
      ctx.strokeRect(box.x + 1, box.y + 1, box.width - 2, box.height - 2);
    }

    label(ctx, tower.name, row.name, selected ? C.title : C.text, 15, true, 'left', NAME_OUTLINE);
    nine(ctx, assets, 'panels/box_floor.png', row.badge, HUD_CONFIG.panel.raised);
    label(ctx, `Lv.${tower.level}`, row.badge, C.text, 12, true, 'center');
    const age = justUp ? view.nowMs - flash.atMs : Infinity;
    if (age < FX_PLUS_MS) number(ctx, assets, '+1', row.plus.x + 18, row.plus.y + 16 - Math.round((age / FX_PLUS_MS) * 6), 'green');

    // 공격 412 › 498 - 글자는 회색, 숫자는 데미지 폰트(현재 흰, 다음 초록).
    const ay = row.attack.y + row.attack.height / 2;
    ctx.font = getFontString(13);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.sub;
    const word = t('popup.prep.attack');
    drawText(ctx, word, row.attack.x, ay);
    let ax = row.attack.x + Math.ceil(ctx.measureText(word).width) + 8;
    const cur = String(Math.round(tower.atk));
    ax += number(ctx, assets, cur, ax, ay, 'white', 'left');
    if (!info.maxed) {
      ctx.fillStyle = C.sub;
      ctx.font = getFontString(14, true);
      drawText(ctx, '›', ax + 5, ay);
      number(ctx, assets, String(Math.round(tower.nextAtk)), ax + 16, ay, 'green', 'left');
    }

    // 강화(btn_gold, 코인 + 비용) / MAX +N(btn_primary). 골드 부족·최대 레벨 = btn_disabled.
    const up = row.upgrade;
    const upMeta = nine(ctx, assets, info.affordable ? 'buttons/btn_gold.png' : 'upgrade/btn_disabled.png', up, HUD_CONFIG.popup.disabled);
    if (info.maxed) label(ctx, t('popup.prep.max'), up, C.sub, 15, true, 'center');
    else {
      ctx.font = getFontString(15, true);
      const costText = fmtGold(info.cost);
      const tw = numberWidth(assets, costText) ?? ctx.measureText(costText).width;
      const left = Math.round(up.x + up.width / 2 - (16 + 6 + tw) / 2);
      drawFixedImage(ctx, assets, 'upgrade/coin_small.png', left + 8, up.y + up.height / 2, K);
      if (info.affordable) label(ctx, costText, rect(left + 22, up.y, tw, up.height), upMeta?.textColor ?? C.outline, 15, true, 'left', { outline: false });
      else number(ctx, assets, costText, left + 22, up.y + up.height / 2, 'red', 'left', true);
    }
    const canMax = info.maxUps > 0;
    const mxMeta = nine(ctx, assets, canMax ? 'buttons/btn_primary.png' : 'upgrade/btn_disabled.png', row.max, HUD_CONFIG.popup.disabled);
    label(ctx, canMax ? t('popup.prep.maxN', { n: info.maxUps }) : t('popup.prep.max'), row.max, canMax ? mxMeta?.textColor ?? C.text : C.sub, 13, true, 'center');
  });
  label(ctx, t('popup.prep.holdHint'), tab.hint, C.sub, 12, false, 'left');
  label(ctx, t('popup.prep.totalAttack', { n: Math.round(view.totalAttack) }), tab.total, C.text, 13, true, 'right');
  const all = view.all ?? { count: 0, cost: 0 };
  const can = all.count > 0;
  const allMeta = nine(ctx, assets, can ? 'buttons/btn_primary.png' : 'upgrade/btn_disabled.png', tab.all, HUD_CONFIG.popup.disabled);
  const allText = can ? t('popup.prep.allN', { n: all.count, cost: fmtGold(all.cost) }) : t('popup.prep.all');
  label(ctx, allText, tab.all, can ? allMeta?.textColor ?? C.text : C.sub, 14, true, 'center');
}

function drawTotemTab(ctx, assets, tab, view) {
  tab.rows.forEach((row, i) => {
    const tower = view.towers[i];
    nine(ctx, assets, 'upgrade/card.png', row.card, '#1f1b2b');
    if (tower) drawSilhouette(ctx, assets, tower.color, row.statue);
    label(ctx, tower?.name ?? '', row.name, C.sub, 14, false, 'left', NAME_OUTLINE);
    for (const s of row.slots) {
      const st = getUi(assets, 'items/slot_locked.png');
      if (uiReady(st)) ctx.drawImage(st.img, s.x, s.y, s.width, s.height);
      else {
        ctx.fillStyle = C.silhouette;
        ctx.fillRect(s.x, s.y, s.width, s.height);
      }
      drawFixedImage(ctx, assets, 'icons/lock.png', s.x + s.width / 2, s.y + s.height / 2, K);
    }
  });
  const nb = tab.notice;
  if (nb.height < 120) return;
  nine(ctx, assets, 'menu/inset.png', nb, C.outline);
  const cx = nb.x + nb.width / 2;
  let y = nb.y + Math.max(24, Math.round((nb.height - 132) / 2) + 12);
  drawFixedImage(ctx, assets, 'icons/lock.png', cx, y, K * 2);
  y += 30;
  const line = (key, color, size, bold, dy) => {
    label(ctx, t(key), rect(nb.x, y, nb.width, 20), color, size, bold, 'center');
    y += dy;
  };
  line('popup.prep.totem.title', C.title, 16, true, 26);
  line('popup.prep.totem.desc1', C.text, 13, false, 20);
  line('popup.prep.totem.desc2', C.text, 13, false, 28);
  line('popup.prep.totem.cond', C.sub, 12, false, 0);
}

// 석상 idle 0프레임을 단색(#3b3347)으로 - 색별 1번만 만들어 둔다(32x40 = 원본 x2).
const silhouettes = new Map();
function drawSilhouette(ctx, assets, color, r) {
  const anim = assets?.towerAnims?.get(`tower_idle_${color}`);
  if (!anim || !uiReady(anim.state)) {
    ctx.fillStyle = C.silhouette;
    ctx.fillRect(r.x + 6, r.y + 4, r.width - 12, r.height - 4);
    return;
  }
  let c = silhouettes.get(color);
  if (!c) {
    c = document.createElement('canvas');
    c.width = anim.frameW;
    c.height = anim.frameH;
    const g = c.getContext('2d');
    g.drawImage(anim.state.img, 0, 0, anim.frameW, anim.frameH, 0, 0, anim.frameW, anim.frameH);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = C.silhouette;
    g.fillRect(0, 0, c.width, c.height);
    silhouettes.set(color, c);
  }
  // 석상 원본은 왼쪽을 본다 - 강화 줄과 같이 오른쪽 보기.
  const w = anim.frameW * K;
  const h = anim.frameH * K;
  ctx.save();
  ctx.translate(Math.round(r.x + r.width / 2), 0);
  ctx.scale(-1, 1);
  ctx.drawImage(c, -w / 2, Math.round(r.y + r.height / 2 - h / 2), w, h);
  ctx.restore();
}

function drawTab(ctx, assets, r, key, on) {
  const locked = key === 'totem' && HUD_CONFIG.totemTab.locked;
  const draw = rect(r.x, r.y, r.width, r.height + TAB_OVERLAP);
  nine(ctx, assets, on ? 'upgrade/tab_on.png' : 'upgrade/tab_off.png', draw, on ? HUD_CONFIG.popup.ghost : C.outline);
  ctx.font = getFontString(15, true);
  const text = t(`popup.prep.tab.${key}`);
  // 탭 그림 윗테(원본 6 = 12)를 빼고 보이는 안쪽(12~38)의 가운데에 가깝게.
  const cy = r.y + r.height / 2 + 5;
  let cx = r.x + r.width / 2;
  if (locked) {
    const w = 24 + 4 + ctx.measureText(text).width;
    drawFixedImage(ctx, assets, 'icons/lock.png', cx - w / 2 + 12, cy, K);
    cx += 14;
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = on && !locked ? C.text : C.sub;
  drawText(ctx, text, cx, cy);
}

function drawGoldChip(ctx, assets, r, gold) {
  nine(ctx, assets, 'menu/inset.png', r, C.outline);
  drawFixedImage(ctx, assets, 'icons/gold.png', r.x + 20, r.y + r.height / 2, K);
  label(ctx, fmtGold(gold), rect(r.x + 38, r.y, r.width - 46, r.height), C.title, 16, true, 'right');
}

// 9-slice(원본 x2). 그림이 없으면 단색 사각형. 반환 = manifest 메타(textColor 등).
function nine(ctx, assets, path, r, fallback) {
  const st = getUi(assets, path);
  const meta = getUiMeta(assets, path);
  if (uiReady(st) && meta?.slice) drawNine(ctx, st.img, meta.slice, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), K);
  else {
    ctx.fillStyle = fallback;
    ctx.fillRect(r.x, r.y, r.width, r.height);
  }
  return meta;
}

// 한 줄 글자(넘치면 …). align = 'left'|'center'|'right', 세로는 r 가운데.
function label(ctx, text, r, color, size, bold, align, opts) {
  ctx.font = getFontString(size, bold);
  ctx.textAlign = align;
  ctx.fillStyle = color;
  let s = text;
  if (ctx.measureText(s).width > r.width) {
    while (s.length > 1 && ctx.measureText(`${s}…`).width > r.width) s = s.slice(0, -1);
    s = `${s}…`;
  }
  const x = align === 'left' ? r.x : align === 'right' ? r.x + r.width : r.x + r.width / 2;
  drawText(ctx, s, x, r.y + r.height / 2, opts);
}

// 데미지 폰트 폭(원본 x2) - 폰트가 없으면 null.
function numberWidth(assets, text) {
  const font = assets?.uiFont;
  if (!font?.chars) return null;
  let w = 1;
  for (const c of text) w += (font.widths[c] ?? 6) - 1;
  return w * K;
}

// 데미지 폰트 숫자(가운데 정렬, align 'left'면 x가 왼쪽). bg = 검은 바탕(골드 부족 비용). 반환 = 그린 폭.
function number(ctx, assets, text, x, cy, variant, align = 'center', bg = false) {
  const font = assets?.uiFont;
  const img = getUiFont(assets, variant);
  const w = numberWidth(assets, text);
  if (w == null || !uiReady(img)) {
    ctx.font = getFontString(15, true);
    ctx.textAlign = align;
    ctx.fillStyle = variant === 'red' ? C.red : variant === 'green' ? HUD_CONFIG.popup.upgradeColor : C.text;
    drawText(ctx, text, x, cy);
    return ctx.measureText(text).width;
  }
  const h = font.cellH * K;
  const cx = align === 'left' ? x + w / 2 : x;
  const top = Math.round(cy - h / 2);
  if (bg) {
    ctx.fillStyle = C.outline;
    ctx.fillRect(Math.round(cx - w / 2) - K, top - K, w + K * 2, h + K * 2);
  }
  drawDamage(ctx, img.img, font, text, cx, top, K);
  return w;
}
