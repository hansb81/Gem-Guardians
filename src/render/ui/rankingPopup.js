// 랭킹 팝업(docs/ranking.md 3~5장, 목업 mockups/ranking/ranking.html 시안 1). 보관함 정비 팝업과 같은 틀·자리.
// 좌표는 전부 540 폭 기준(basis)이고 캔버스엔 scale(= 화면 폭 / 540)을 곱해 그린다(prepPopup과 같은 방식).
// 그림은 원본 x2 정수 배율(구간 배지만 내 정보 x3, 시즌 결과 x4), imageSmoothingEnabled=false.
//   layoutRankingPopup = 사각형·목록 위치만 계산하는 순수 함수(tests/rankingPopup.test.js)
//   drawRankingPopup   = 그리기만
//   hitRankingPopup    = 화면 좌표 -> { type, ... }
// st(src/game/rankingUi.js) = { sheet, tab, compState, sub, scroll, entries, unavailable, me, total, history,
//   season, nowMs, timerText, blinkAt, nick: { draft, statue, err, first }, pending, rewardsEnabled, tiers, floorGold }
import { drawNine, drawText, drawFixedImage, getUi, getUiMeta, uiReady } from '../uiKit.js';
import { getFontString } from '../../config/fonts.js';
import { t } from '../../config/i18n.js';

export const RANKING_TABS = ['normal', 'comp'];
export const STATUE_PICKS = ['red', 'blue', 'yellow', 'green', 'purple'];
const BASIS_W = 540;
const K = 2;
const SIDE = 26; // popup_menu 테두리 안쪽(정비 팝업과 같음)
const BOTTOM = 26;
const SHEET = { x: 12, top: 96, bottom: 48 };
const TAB_H = 44;
const TAB_OVERLAP = 6;
const ROW_H = 56;
const GAP = 4;
const DIV_H = 28;
const PODIUM_H = 196;
const FOOT_H = 44;
const STEP_H = { 1: 72, 2: 52, 3: 40 }; // 목업 단상 높이
const BLINK_MS = 1000;
// 팔레트(assets/gems/palette.hex) + 보조 글자색(characters.hex #a59cb2)
const C = {
  outline: '#0d0a10', bg1: '#221c2b', bg2: '#3b3347', bg3: '#655a74', bone: '#e8dcc0', dim: '#a59cb2',
  gold: '#c28a20', goldL: '#f2d264', brnM: '#7a5212', brnD: '#3a2808', redM: '#741426', redL: '#ec6a6a',
};

const rect = (x, y, width, height) => ({ x, y, width, height });
const inside = (x, y, r) => r && x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

// ---------- 배치 ----------
export function layoutRankingPopup(screenW, screenH, st) {
  const scale = screenW / BASIS_W;
  const H = Math.round(screenH / scale);
  const sheet = rect(SHEET.x, SHEET.top, BASIS_W - SHEET.x * 2, H - SHEET.top - SHEET.bottom);
  const ix = sheet.x + SIDE;
  const iw = sheet.width - SIDE * 2;
  const out = { scale, basisH: H, sheet, emblem: { cx: sheet.x + sheet.width / 2, cy: sheet.y } };
  out.close = rect(sheet.x + sheet.width - 52, sheet.y + 8, 44, 44);
  out.title = rect(ix + 48, sheet.y + 36, iw - 96, 32);
  const tabY = sheet.y + 80;
  // st.tabs = 보일 탭(토스 빌드는 일반 모드만 - 경쟁 모드는 자체 서버 전까지 숨김). 하나면 한 줄 전체.
  const one = (st.tabs ?? RANKING_TABS).length === 1;
  const tw = one ? iw : (iw - 6) / 2;
  out.tabs = { normal: rect(ix, tabY, tw, TAB_H), comp: rect(ix + tw + 6, tabY, tw, TAB_H) };
  out.body = rect(ix, tabY + TAB_H, iw, sheet.y + sheet.height - BOTTOM - tabY - TAB_H);
  const c = rect(out.body.x + 8, out.body.y + 8, out.body.width - 16, out.body.height - 16);
  out.content = c;
  const cBottom = c.y + c.height;
  out.mine = rect(c.x, cBottom - ROW_H, c.width, ROW_H);
  out.edit = rect(out.mine.x + out.mine.width - 52, out.mine.y + 6, 44, 44);
  out.goComp = rect(out.edit.x - 8 - 168, out.mine.y + 6, 168, 44);

  let y = c.y + 4;
  const comp = st.tab === 'comp';
  if (comp) {
    out.last = rect(c.x, y, c.width, 44);
    y += 48;
    out.season = rect(c.x, y, c.width, 32);
    y += 36;
    out.tierRow = rect(c.x, y, c.width, 64);
    out.rewardsBtn = rect(c.x + c.width - 10 - 112, y + 10, 112, 44);
    y += 68;
    if (st.compState === 'settle') {
      out.settle = rect(c.x, y, c.width, 40);
      y += 44;
    }
  }
  // 서버 랭킹 오프라인: "오프라인 · 마지막 갱신 N분 전" 한 줄(목록 위).
  if (!comp && st.offlineText) {
    out.offline = rect(c.x, y, c.width, 24);
    y += 28;
  }
  // 마켓 리더보드 버튼(토스 "토스 랭킹 보기") - 일반 모드 탭, 내 줄 바로 위.
  if (st.tossBoard && !comp) out.tossBoard = rect(c.x, out.mine.y - 50, c.width, 44);
  out.list = rect(c.x, y, c.width, (out.tossBoard ? out.tossBoard.y : out.mine.y) - 6 - y);
  if (comp && st.compState === 'locked') {
    out.lockCover = rect(c.x, out.list.y, c.width, cBottom - out.list.y);
    out.lockBand = rect(c.x + 24, Math.round(out.lockCover.y + out.lockCover.height / 2 - 64), c.width - 48, 128);
  }

  // 목록(스크롤 안 좌표, 0 = 목록 맨 위): 단상(1~3위) → 4~100위 줄(경쟁 탭은 보상 구간이 바뀔 때마다 구분 줄) → 끝 줄.
  const items = [];
  let ly = 0;
  const entries = st.entries ?? [];
  if (st.unavailable) items.push({ kind: 'offline', y: 0, h: out.list.height });
  else {
    const podium = entries.length >= 3;
    if (podium) {
      items.push({ kind: 'podium', y: 0, h: PODIUM_H, cols: podiumCols(c.x), meRank: entries.slice(0, 3).findIndex((e) => e.me) + 1 });
      ly = PODIUM_H + GAP;
    }
    let prev = null;
    for (const e of entries.slice(podium ? 3 : 0)) {
      if (comp && e.tierId !== prev && e.rank > 3) {
        items.push({ kind: 'divider', y: ly, h: DIV_H, tierId: e.tierId });
        ly += DIV_H + GAP;
      }
      prev = e.tierId;
      items.push({ kind: 'row', y: ly, h: ROW_H, entry: e });
      ly += ROW_H + GAP;
    }
    items.push({ kind: 'foot', y: ly, h: FOOT_H });
    ly += FOOT_H;
  }
  out.items = items;
  out.scrollMax = Math.max(0, ly - out.list.height);

  if (st.sub) out.sub = layoutSub(st, H);
  return out;
}

// 단상 3칸(2·1·3 순서), 각 144 폭.
function podiumCols(x0) {
  return [2, 1, 3].map((rank, i) => ({ rank, x: x0 + i * 152, width: 144 }));
}

function layoutSub(st, H) {
  const center = (w, h) => rect(Math.round((BASIS_W - w) / 2), Math.max(24, Math.round((H - h) / 2)), w, h);
  const withClose = (card) => ({ card, close: rect(card.x + card.width - 52, card.y + 8, 44, 44) });
  if (st.sub === 'rewards') {
    const n = st.tiers?.length ?? 0;
    const s = withClose(center(460, 84 + n * 44 + 70));
    s.title = rect(s.card.x + 48, s.card.y + 28, s.card.width - 96, 28);
    s.subline = rect(s.card.x + 32, s.card.y + 60, s.card.width - 64, 18);
    s.rows = Array.from({ length: n }, (_, i) => rect(s.card.x + 28, s.card.y + 84 + i * 44, s.card.width - 56, 44));
    s.note = rect(s.card.x + 32, s.card.y + 88 + n * 44, s.card.width - 64, 36);
    return s;
  }
  if (st.sub === 'history') {
    const n = Math.max(1, st.history?.length ?? 0);
    const s = withClose(center(460, 84 + n * 48 + 30));
    s.title = rect(s.card.x + 48, s.card.y + 28, s.card.width - 96, 28);
    s.rows = Array.from({ length: n }, (_, i) => rect(s.card.x + 28, s.card.y + 68 + i * 48, s.card.width - 56, 48));
    return s;
  }
  if (st.sub === 'result') {
    const card = center(420, 380);
    const s = { card, close: st.rewardsEnabled ? null : rect(card.x + card.width - 52, card.y + 8, 44, 44) };
    const cx = card.x + card.width / 2;
    s.ribbon = rect(cx - 130, card.y + 28, 260, 40);
    s.badge = { cx, cy: card.y + 120 };
    s.rankLine = rect(card.x + 32, card.y + 164, card.width - 64, 26);
    s.tierLine = rect(card.x + 32, card.y + 196, card.width - 64, 16);
    s.rewards = rect(card.x + 32, card.y + 220, card.width - 64, 40);
    s.claim = rect(card.x + 32, card.y + card.height - 32 - 52, card.width - 64, 52);
    return s;
  }
  // nick
  const s = withClose(center(460, 420));
  const { card } = s;
  s.title = rect(card.x + 48, card.y + 28, card.width - 96, 28);
  s.label = rect(card.x + 32, card.y + 68, card.width - 64, 18);
  s.inputBox = rect(card.x + 32, card.y + 90, card.width - 64, 60);
  s.input = rect(s.inputBox.x + 10, s.inputBox.y + 8, s.inputBox.width - 20, 44);
  s.err = rect(card.x + 32, card.y + 156, card.width - 64, 18);
  s.statueLabel = rect(card.x + 32, card.y + 180, card.width - 64, 18);
  const gap = Math.floor((card.width - 64 - 5 * 72) / 4);
  s.picks = STATUE_PICKS.map((color, i) => ({ color, rect: rect(card.x + 32 + i * (72 + gap), card.y + 202, 72, 80) }));
  s.save = rect(card.x + 32, card.y + 296, card.width - 64, 52);
  s.hint = rect(card.x + 32, card.y + 358, card.width - 64, 18);
  return s;
}

// ---------- 터치 ----------
// x, y = 캔버스 화면 좌표. by = 목록 안 basis y(드래그 시작용).
export function hitRankingPopup(L, x, y, st) {
  const bx = x / L.scale;
  const by = y / L.scale;
  const s = L.sub;
  if (s) {
    if (inside(bx, by, s.close)) return { type: 'subClose' };
    if (st.sub === 'result' && inside(bx, by, s.claim)) return { type: 'claim' };
    if (st.sub === 'nick') {
      for (const p of s.picks) if (inside(bx, by, p.rect)) return { type: 'pick', statue: p.color };
      if (inside(bx, by, s.save)) return { type: 'saveNick' };
      if (inside(bx, by, s.inputBox)) return { type: 'input' };
    }
    if (!inside(bx, by, s.card)) return { type: 'subOutside' };
    return { type: 'none' };
  }
  if (!st.sheet) return { type: 'none' };
  if (inside(bx, by, L.close)) return { type: 'close' };
  for (const key of st.tabs ?? RANKING_TABS) if (inside(bx, by, L.tabs[key])) return { type: 'tab', tab: key };
  if (inside(bx, by, L.tossBoard)) return { type: 'tossBoard' };
  if (inside(bx, by, L.last)) return { type: 'history' };
  if (inside(bx, by, L.rewardsBtn)) return { type: 'rewards' };
  if (inside(bx, by, L.lockCover)) return { type: 'none' }; // 잠김: 목록·내 줄은 디더 덮개 아래
  if (inside(bx, by, L.edit)) return { type: 'edit' };
  if (st.tab === 'comp' && st.compState === 'none' && inside(bx, by, L.goComp)) return { type: 'goComp' };
  if (inside(bx, by, L.mine)) return { type: 'mine' };
  if (inside(bx, by, L.list)) return { type: 'list', by };
  if (!inside(bx, by, L.sheet)) return { type: 'close' };
  return { type: 'none' };
}

// 내 줄이 목록 가운데 오는 스크롤 값(목록에 없으면 맨 아래).
export function scrollToMeValue(L) {
  const it = L.items.find((i) => (i.kind === 'row' && i.entry.me) || (i.kind === 'podium' && i.meRank));
  if (!it) return L.scrollMax;
  return Math.max(0, Math.min(L.scrollMax, Math.round(it.y + it.h / 2 - L.list.height / 2)));
}

// ---------- 그리기 ----------
let dither = null;
function ditherPattern(ctx) {
  if (dither) return dither;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 4;
  const g = c.getContext('2d');
  g.fillStyle = C.outline;
  g.fillRect(0, 0, 2, 2);
  g.fillRect(2, 2, 2, 2);
  dither = ctx.createPattern(c, 'repeat');
  return dither;
}

function fillDither(ctx, r) {
  ctx.fillStyle = ditherPattern(ctx);
  ctx.fillRect(r.x, r.y, r.width, r.height);
}

export function drawRankingPopup(ctx, assets, st, L) {
  ctx.save();
  ctx.scale(L.scale, L.scale);
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = 'middle';
  if (st.sheet) drawSheet(ctx, assets, st, L);
  if (L.sub) {
    fillDither(ctx, rect(0, 0, BASIS_W, L.basisH));
    if (st.sub === 'rewards') drawRewards(ctx, assets, st, L.sub);
    else if (st.sub === 'history') drawHistory(ctx, assets, st, L.sub);
    else if (st.sub === 'result') drawResult(ctx, assets, st, L.sub);
    else drawNick(ctx, assets, st, L.sub);
  }
  ctx.restore();
}

function drawSheet(ctx, assets, st, L) {
  fillDither(ctx, rect(0, 0, BASIS_W, L.basisH));
  nine(ctx, assets, 'menu/popup_menu.png', L.sheet, C.bg1);
  if (!drawFixedImage(ctx, assets, 'ranking/emblem_rank.png', L.emblem.cx, L.emblem.cy, K)) drawFixedImage(ctx, assets, 'popups/emblem_win.png', L.emblem.cx, L.emblem.cy, K);
  drawFixedImage(ctx, assets, 'upgrade/btn_close.png', L.close.x + 22, L.close.y + 22, K);
  label(ctx, t('ranking.title'), L.title, C.goldL, 22, 'center');

  for (const key of st.tabs ?? RANKING_TABS) if (key !== st.tab) drawTab(ctx, assets, L.tabs[key], key, false, st);
  nine(ctx, assets, 'upgrade/tab_body.png', L.body, '#15121c');
  drawTab(ctx, assets, L.tabs[st.tab], st.tab, true, st);

  if (st.tab === 'comp') drawCompHeader(ctx, assets, st, L);
  if (L.offline) label(ctx, st.offlineText, L.offline, C.dim, 11, 'center');
  drawList(ctx, assets, st, L);
  if (L.tossBoard) button(ctx, assets, 'buttons/btn_primary.png', L.tossBoard, t('ranking.tossBoard'), C.bone, 22);
  drawMine(ctx, assets, st, L);
  if (L.lockCover) drawLock(ctx, assets, L);
}

function drawTab(ctx, assets, r, key, on, st) {
  nine(ctx, assets, on ? 'upgrade/tab_on.png' : 'upgrade/tab_off.png', rect(r.x, r.y, r.width, r.height + TAB_OVERLAP), C.bg2);
  const text = t(`ranking.tab.${key}`);
  ctx.font = getFontString(22);
  const locked = key === 'comp' && st.compLocked;
  let cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2 + 4;
  if (locked) {
    const w = 24 + 6 + ctx.measureText(text).width;
    drawFixedImage(ctx, assets, 'icons/lock.png', cx - w / 2 + 12, cy, K);
    cx += 15;
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = on ? C.goldL : C.bg3;
  drawText(ctx, text, cx, cy, outline(22));
}

function drawCompHeader(ctx, assets, st, L) {
  // 지난 시즌 한 줄(눌러서 최근 8주)
  nine(ctx, assets, 'upgrade/card.png', L.last, C.bg2);
  const last = st.history?.[0];
  const lr = rect(L.last.x + 12, L.last.y, L.last.width - 24, L.last.height);
  label(ctx, last ? t('ranking.lastSeason', { rank: last.rank, pct: last.pct }) : t('ranking.lastNone'), lr, C.bone, 11, 'left');
  label(ctx, t('ranking.recent'), lr, C.dim, 11, 'right');

  // 시즌 타이머
  const s = L.season;
  drawFixedImage(ctx, assets, 'ranking/icon_timer.png', s.x + 16, s.y + s.height / 2, K);
  label(ctx, t('ranking.season', { week: st.season.week }), rect(s.x + 34, s.y, 220, s.height), C.bone, 11, 'left');
  label(ctx, st.timerText, rect(s.x + 200, s.y, s.width - 204, s.height), C.goldL, 22, 'right');

  // 내 구간 줄
  const tr = L.tierRow;
  nine(ctx, assets, 'panels/panel_inset.png', tr, C.outline);
  const me = st.compState === 'none' ? null : st.me;
  const tierId = me?.tierId ?? 'part';
  drawFixedImage(ctx, assets, `ranking/tier_${tierId}.png`, tr.x + 30, tr.y + tr.height / 2, K);
  const tx = rect(tr.x + 56, tr.y + 12, L.rewardsBtn.x - tr.x - 64, 18);
  if (me?.rank) {
    label(ctx, t('ranking.myTier', { tier: tierLabel(tierId) }), tx, C.bone, 11, 'left');
    const next = me.next ? t('ranking.nextTier', { tier: tierLabel(me.next.tierId), n: fmt(me.next.gap) }) : t('ranking.keepFirst');
    label(ctx, next, rect(tx.x, tx.y + 22, tx.width, 18), C.dim, 11, 'left');
  } else {
    label(ctx, t(me ? 'ranking.offlineShort' : 'ranking.notJoined'), tx, C.bone, 11, 'left');
    label(ctx, t('ranking.joinHint'), rect(tx.x, tx.y + 22, tx.width, 18), C.dim, 11, 'left');
  }
  button(ctx, assets, 'buttons/btn_secondary.png', L.rewardsBtn, t('ranking.rewardsBtn'), C.bone, 11);

  if (L.settle) {
    const b = L.settle;
    ctx.fillStyle = C.outline;
    ctx.fillRect(b.x, b.y, b.width, b.height);
    ctx.fillStyle = C.redL;
    ctx.fillRect(b.x + 2, b.y + 2, b.width - 4, b.height - 4);
    ctx.fillStyle = C.redM;
    ctx.fillRect(b.x + 4, b.y + 4, b.width - 8, b.height - 8);
    label(ctx, t('ranking.settleTitle'), rect(b.x + 12, b.y + 4, b.width - 24, 16), C.bone, 11, 'left');
    label(ctx, t('ranking.settleBody'), rect(b.x + 12, b.y + 20, b.width - 24, 16), C.bone, 11, 'left');
  }
}

function drawList(ctx, assets, st, L) {
  const lr = L.list;
  const scroll = Math.min(st.scroll, L.scrollMax);
  ctx.save();
  ctx.beginPath();
  ctx.rect(lr.x, lr.y, lr.width, lr.height);
  ctx.clip();
  for (const it of L.items) {
    const y = Math.round(lr.y + it.y - scroll);
    if (y + it.h < lr.y || y > lr.y + lr.height) continue;
    if (it.kind === 'podium') drawPodium(ctx, assets, st, it, y);
    else if (it.kind === 'divider') drawDivider(ctx, st, it.tierId, rect(lr.x, y, lr.width, it.h));
    else if (it.kind === 'row') drawRow(ctx, assets, st, it.entry, rect(lr.x, y, lr.width, it.h), false);
    else if (it.kind === 'foot') label(ctx, t('ranking.listFoot', { n: st.entries.length, total: fmt(st.total ?? 0) }), rect(lr.x, y, lr.width, it.h), C.dim, 11, 'center');
    else if (it.kind === 'offline') {
      const mid = lr.y + lr.height / 2;
      label(ctx, t('ranking.offline'), rect(lr.x, mid - 24, lr.width, 22), C.bone, 22, 'center');
      label(ctx, t('ranking.offlineHint'), rect(lr.x, mid + 8, lr.width, 16), C.dim, 11, 'center');
    }
  }
  ctx.restore();
  if (L.scrollMax > 0) {
    // 스크롤 위치 막대(보관함과 같은 금색 2px)
    const h = Math.max(24, Math.round((lr.height * lr.height) / (lr.height + L.scrollMax)));
    const y = lr.y + Math.round(((lr.height - h) * scroll) / L.scrollMax);
    ctx.fillStyle = C.gold;
    ctx.fillRect(lr.x + lr.width + 2, y, 2, h);
  }
}

const blinkOn = (st) => st.blinkAt >= 0 && st.nowMs - st.blinkAt < BLINK_MS && Math.floor((st.nowMs - st.blinkAt) / 125) % 2 === 0;

function drawPodium(ctx, assets, st, it, top) {
  const bottom = top + PODIUM_H;
  for (const col of it.cols) {
    const e = st.entries[col.rank - 1];
    const step = rect(col.x, bottom - STEP_H[col.rank], col.width, STEP_H[col.rank]);
    nine(ctx, assets, `ranking/podium_${col.rank}.png`, step, C.bg2);
    label(ctx, String(col.rank), step, C.bone, 22, 'center');
    const cx = col.x + col.width / 2;
    const valueY = step.y - 3 - 11;
    label(ctx, valueText(st.tab, e.value), rect(col.x, valueY - 11, col.width, 22), C.goldL, 22, 'center');
    const nameY = valueY - 11 - 3 - 7;
    label(ctx, e.nickname || t('ranking.me'), rect(col.x + 2, nameY - 7, col.width - 4, 14), C.bone, 11, 'center');
    const statueY = nameY - 7 - 3 - 40;
    drawStatue(ctx, assets, e.statue, cx - 16, statueY);
    if (!drawFixedImage(ctx, assets, `ranking/medal_${col.rank}.png`, cx, statueY - 3 - 14, K)) {
      ctx.fillStyle = C.goldL;
      ctx.fillRect(cx - 14, statueY - 31, 28, 28);
    }
    if (e.me) {
      meTag(ctx, col.x + 4, statueY - 30);
      if (blinkOn(st)) strokeRect(ctx, rect(col.x, statueY - 34, col.width, bottom - statueY + 34), C.bone, 4);
    }
  }
}

function drawDivider(ctx, st, tierId, r) {
  const tier = st.tiers.find((x) => x.id === tierId);
  const text = `${tierLabel(tierId)} · ${rewardText(tier, st.floorGold)}`;
  ctx.font = getFontString(11);
  const w = Math.min(r.width - 24, Math.ceil(ctx.measureText(text).width));
  const cy = r.y + r.height / 2;
  ctx.fillStyle = C.brnM;
  const side = Math.floor((r.width - w) / 2) - 8;
  ctx.fillRect(r.x, cy - 1, side, 2);
  ctx.fillRect(r.x + r.width - side, cy - 1, side, 2);
  label(ctx, text, rect(r.x + side + 8, r.y, w, r.height), C.goldL, 11, 'center');
}

// 한 줄: 순위 · 석상 2배 · 닉네임 · 값 · 작은 글씨(일반 = 도달 날짜, 경쟁 = 층). fixed = 맨 아래 내 줄.
function drawRow(ctx, assets, st, e, r, fixed) {
  nine(ctx, assets, e?.me ? 'upgrade/card_selected.png' : 'upgrade/card.png', r, C.bg2);
  const mid = r.y + r.height / 2;
  const rk = rect(r.x + 4, r.y, 52, r.height);
  if (!e?.rank) label(ctx, '-', rk, C.dim, 22, 'center');
  else if (fixed && e.rank > (st.entries?.length || 100)) {
    label(ctx, t('ranking.top'), rect(rk.x, mid - 18, rk.width, 14), C.dim, 11, 'center');
    label(ctx, `${e.pct}%`, rect(rk.x, mid - 2, rk.width, 22), C.bone, 22, 'center');
  } else label(ctx, String(e.rank), rk, C.bone, 22, 'center');
  drawStatue(ctx, assets, e?.statue ?? st.myStatue, r.x + 62, mid - 20);
  const right = fixed ? r.x + r.width - 56 : r.x + r.width - 12;
  let valW = 0;
  if (fixed && st.tab === 'comp' && st.compState === 'none') {
    const b = rect(right - 168, mid - 22, 168, 44);
    button(ctx, assets, 'buttons/btn_primary.png', b, t('ranking.goComp'), C.bone, 11);
    valW = 176;
  } else if (!e?.value) {
    label(ctx, t('ranking.noRecord'), rect(right - 100, r.y, 100, r.height), C.dim, 11, 'right');
    valW = 108;
  } else {
    ctx.font = getFontString(22);
    const v = valueText(st.tab, e.value);
    valW = Math.ceil(ctx.measureText(v).width) + 8;
    label(ctx, v, rect(right - valW, mid - 19, valW, 22), C.goldL, 22, 'right');
    const sub = st.tab === 'comp' ? t('ranking.floor', { n: e.sub }) : dateText(e.at);
    label(ctx, sub, rect(right - 120, mid + 6, 120, 14), C.dim, 11, 'right');
  }
  label(ctx, e?.nickname || st.myName || t('ranking.me'), rect(r.x + 102, r.y, right - valW - 8 - r.x - 102, r.height), C.bone, 22, 'left');
  if (e?.me && !fixed) {
    meTag(ctx, r.x - 2, r.y - 4);
    if (blinkOn(st)) strokeRect(ctx, r, C.bone, 4);
  }
}

function drawMine(ctx, assets, st, L) {
  const me = st.tab === 'comp' && st.compState === 'none' ? null : st.me;
  drawRow(ctx, assets, st, me ?? { me: true, statue: st.myStatue, nickname: st.myName }, L.mine, true);
  drawFixedImage(ctx, assets, 'ranking/icon_edit.png', L.edit.x + 22, L.edit.y + 22, K);
}

function drawLock(ctx, assets, L) {
  fillDither(ctx, L.lockCover);
  const b = L.lockBand;
  nine(ctx, assets, 'panels/panel_iron.png', b, C.bg2);
  const cx = b.x + b.width / 2;
  drawFixedImage(ctx, assets, 'icons/lock.png', cx, b.y + 26, K);
  label(ctx, t('ranking.locked'), rect(b.x, b.y + 44, b.width, 22), C.goldL, 22, 'center');
  label(ctx, t('ranking.lockedCond'), rect(b.x, b.y + 74, b.width, 16), C.bone, 11, 'center');
  label(ctx, t('ranking.lockedPreview'), rect(b.x, b.y + 94, b.width, 16), C.dim, 11, 'center');
}

// ---------- 작은 팝업 ----------
function subFrame(ctx, assets, s, title) {
  nine(ctx, assets, 'menu/popup_menu.png', s.card, C.bg1);
  if (s.close) drawFixedImage(ctx, assets, 'upgrade/btn_close.png', s.close.x + 22, s.close.y + 22, K);
  if (title) label(ctx, title, s.title, C.goldL, 22, 'center');
}

function drawRewards(ctx, assets, st, s) {
  subFrame(ctx, assets, s, t('ranking.rewards.title'));
  label(ctx, t('ranking.rewards.sub', { week: st.season.week, total: fmt(st.total ?? 0) }), s.subline, C.dim, 11, 'left');
  const mine = st.compState === 'none' ? null : st.me?.tierId;
  st.tiers.forEach((tier, i) => {
    const r = s.rows[i];
    if (tier.id === mine) {
      ctx.fillStyle = C.brnD;
      ctx.fillRect(r.x, r.y + 2, r.width, r.height - 4);
      strokeRect(ctx, rect(r.x, r.y + 2, r.width, r.height - 4), C.goldL, 4);
    }
    drawFixedImage(ctx, assets, `ranking/tier_${tier.id}.png`, r.x + 24, r.y + r.height / 2, K);
    let text = tierLabel(tier.id);
    if (tier.id === 'part') text += ` (${t('ranking.partCrit')})`;
    if (tier.id === mine) text += `  ${t('ranking.rewards.mine')}`;
    label(ctx, text, rect(r.x + 48, r.y, 200, r.height), tier.id === mine ? C.goldL : C.bone, 11, 'left');
    rewardIcons(ctx, assets, tier, st, r.x + r.width - 8, r.y + r.height / 2, 11, 'right');
  });
  wrapLabel(ctx, t('ranking.rewards.note'), s.note, C.dim, 11);
}

function drawHistory(ctx, assets, st, s) {
  subFrame(ctx, assets, s, t('ranking.history.title'));
  if (!st.history?.length) {
    label(ctx, t('ranking.history.empty'), s.rows[0], C.dim, 11, 'center');
    return;
  }
  st.history.forEach((h, i) => {
    const r = s.rows[i];
    ctx.fillStyle = C.bg2;
    ctx.fillRect(r.x, r.y + r.height - 2, r.width, 2);
    drawFixedImage(ctx, assets, `ranking/tier_${h.tierId}.png`, r.x + 20, r.y + r.height / 2, K);
    label(ctx, t('ranking.history.week', { week: weekOf(h.seasonId) }), rect(r.x + 44, r.y, 64, r.height), C.bone, 11, 'left');
    label(ctx, t('ranking.rank', { n: h.rank }), rect(r.x + 112, r.y, 96, r.height), C.goldL, 22, 'left');
    label(ctx, t('ranking.topPct', { n: h.pct }), rect(r.x + 212, r.y, 90, r.height), C.bone, 11, 'left');
    label(ctx, t('ranking.points', { n: fmt(h.points) }), rect(r.x + 300, r.y, r.width - 300, r.height), C.dim, 11, 'right');
  });
}

function drawResult(ctx, assets, st, s) {
  const p = st.pending;
  subFrame(ctx, assets, s, null);
  nine(ctx, assets, 'ranking/ribbon.png', s.ribbon, C.redM);
  label(ctx, t('ranking.result.title', { week: weekOf(p.seasonId) }), s.ribbon, C.bone, 11, 'center');
  if (!drawFixedImage(ctx, assets, `ranking/tier_${p.tierId}.png`, s.badge.cx, s.badge.cy, 4)) {
    ctx.fillStyle = C.bg3;
    ctx.fillRect(s.badge.cx - 32, s.badge.cy - 32, 64, 64);
  }
  label(ctx, t('ranking.result.rankPct', { rank: p.rank, pct: p.pct }), s.rankLine, C.goldL, 22, 'center');
  label(ctx, t('ranking.result.tierLine', { tier: tierLabel(p.tierId), n: fmt(p.points) }), s.tierLine, C.bone, 11, 'center');
  const tier = st.tiers.find((x) => x.id === p.tierId);
  rewardIcons(ctx, assets, tier, st, s.rewards.x + s.rewards.width / 2, s.rewards.y + s.rewards.height / 2, 22, 'center', p.rewards);
  if (st.rewardsEnabled) button(ctx, assets, 'buttons/btn_gold.png', s.claim, t('ranking.result.claim'), C.outline, 22, false);
  else button(ctx, assets, 'upgrade/btn_disabled.png', s.claim, t('ranking.result.claimLater'), C.dim, 11);
}

function drawNick(ctx, assets, st, s) {
  const n = st.nick;
  subFrame(ctx, assets, s, t(n.first ? 'ranking.nick.title' : 'ranking.nick.titleEdit'));
  label(ctx, `${t('ranking.nick.label')}  ${t('ranking.nick.rule')}`, s.label, C.bone, 11, 'left');
  label(ctx, `${[...n.draft].length}/10`, s.label, C.dim, 11, 'right');
  nine(ctx, assets, 'panels/panel_inset.png', s.inputBox, C.outline);
  if (!n.domInput) label(ctx, n.draft || t('ranking.nick.placeholder'), s.input, n.draft ? C.bone : C.bg3, 22, 'left');
  if (n.err) label(ctx, t(`ranking.nick.${n.err}`), s.err, C.redL, 11, 'left');
  label(ctx, t('ranking.nick.statue'), s.statueLabel, C.bone, 11, 'left');
  for (const p of s.picks) {
    nine(ctx, assets, p.color === n.statue ? 'upgrade/card_selected.png' : 'upgrade/card.png', p.rect, C.bg2);
    drawStatue(ctx, assets, p.color, p.rect.x + 20, p.rect.y + 20);
  }
  const ok = n.valid;
  if (ok) button(ctx, assets, 'buttons/btn_gold.png', s.save, t('ranking.nick.save'), C.outline, 22, false);
  else button(ctx, assets, 'upgrade/btn_disabled.png', s.save, t('ranking.nick.save'), C.bg3, 22);
  if (n.first) label(ctx, t('ranking.nick.later'), s.hint, C.dim, 11, 'center');
}

// ---------- 작은 헬퍼 ----------
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const weekOf = (seasonId) => Number(String(seasonId).split('-W')[1]) || 0;
const valueText = (tab, v) => (tab === 'comp' ? t('ranking.points', { n: fmt(v) }) : t('ranking.floor', { n: v }));
const tierLabel = (id) => t(`ranking.tier.${id}`);
// 날짜(KST) 2026.11.05
function dateText(ms) {
  if (!ms) return '';
  const d = new Date(ms + 9 * 3600e3);
  return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCDate()).padStart(2, '0')}`;
}

function rewardParts(tier, floorGold, bundle) {
  const r = bundle ?? {
    diamonds: tier?.rewards?.diamonds,
    gold: tier?.rewards?.goldFloorMul ? Math.round(tier.rewards.goldFloorMul * (floorGold ?? 0)) : 0,
    items: tier?.rewards?.items,
  };
  const out = [];
  if (r.diamonds) out.push({ kind: 'diamonds', n: r.diamonds });
  for (const [id, n] of Object.entries(r.items ?? {})) out.push({ kind: 'item', id, n });
  if (r.gold) out.push({ kind: 'gold', n: r.gold });
  return out;
}

function rewardText(tier, floorGold) {
  return rewardParts(tier, floorGold)
    .map((p) => `${p.kind === 'item' ? t(`item.name.${p.id}`) : t(`ranking.reward.${p.kind}`)} ${fmt(p.n)}`)
    .join(' + ');
}

// 보상 아이콘 + 수량을 한 줄로. align 'right' = x가 오른쪽 끝, 'center' = x가 가운데.
function rewardIcons(ctx, assets, tier, st, x, cy, size, align, bundle) {
  const parts = rewardParts(tier, st.floorGold, bundle);
  ctx.font = getFontString(size);
  const widths = parts.map((p) => 32 + 4 + Math.ceil(ctx.measureText(fmt(p.n)).width));
  const total = widths.reduce((a, b) => a + b, 0) + (parts.length - 1) * 12;
  let px = align === 'right' ? x - total : Math.round(x - total / 2);
  parts.forEach((p, i) => {
    const icx = px + 16;
    if (p.kind === 'item') {
      const img = st.itemIcon?.(p.id);
      if (img) ctx.drawImage(img, icx - img.width, cy - img.height, img.width * K, img.height * K);
    } else drawFixedImage(ctx, assets, p.kind === 'gold' ? 'icons/gold.png' : 'icons/diamond.png', icx, cy, K);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.bone;
    ctx.font = getFontString(size);
    drawText(ctx, fmt(p.n), px + 36, cy, outline(size));
    px += widths[i] + 12;
  });
}

function drawStatue(ctx, assets, color, x, y) {
  const st = assets?.towerImages?.get(color);
  if (uiReady(st)) ctx.drawImage(st.img, Math.round(x), Math.round(y), st.img.width * K, st.img.height * K);
  else {
    ctx.fillStyle = C.bg3;
    ctx.fillRect(x + 4, y + 4, 24, 36);
  }
}

function meTag(ctx, x, y) {
  ctx.font = getFontString(11);
  const text = t('ranking.me');
  const w = Math.ceil(ctx.measureText(text).width) + 10;
  ctx.fillStyle = C.outline;
  ctx.fillRect(x, y, w, 16);
  ctx.fillStyle = C.gold;
  ctx.fillRect(x + 2, y + 2, w - 4, 12);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.outline;
  drawText(ctx, text, x + w / 2, y + 8, { outline: false });
}

function strokeRect(ctx, r, color, w) {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.width, w);
  ctx.fillRect(r.x, r.y + r.height - w, r.width, w);
  ctx.fillRect(r.x, r.y, w, r.height);
  ctx.fillRect(r.x + r.width - w, r.y, w, r.height);
}

function button(ctx, assets, path, r, text, color, size, withOutline = true) {
  nine(ctx, assets, path, r, C.bg2);
  label(ctx, text, rect(r.x + 8, r.y - 1, r.width - 16, r.height), color, size, 'center', withOutline ? undefined : { outline: false });
}

// 9-slice(원본 x2). 그림이 없으면 단색 사각형.
function nine(ctx, assets, path, r, fallback) {
  const st = getUi(assets, path);
  const meta = getUiMeta(assets, path);
  if (uiReady(st) && meta?.slice) drawNine(ctx, st.img, meta.slice, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height), K);
  else {
    ctx.fillStyle = fallback;
    ctx.fillRect(r.x, r.y, r.width, r.height);
  }
}

// 단색 외곽선(#0d0a10): 11px는 선 2, 22px는 선 3(메뉴·정비 팝업 글자와 같은 느낌).
const outline = (size) => ({ outlineColor: C.outline, outlineWidth: size >= 18 ? 3 : 2 });

// 한 줄 글자(넘치면 …). 세로는 r 가운데.
function label(ctx, text, r, color, size, align, opts) {
  ctx.font = getFontString(size);
  ctx.textAlign = align;
  ctx.fillStyle = color;
  let s = String(text);
  if (r.width > 0 && ctx.measureText(s).width > r.width) {
    while (s.length > 1 && ctx.measureText(`${s}…`).width > r.width) s = s.slice(0, -1);
    s = `${s}…`;
  }
  const x = align === 'left' ? r.x : align === 'right' ? r.x + r.width : r.x + r.width / 2;
  drawText(ctx, s, x, r.y + r.height / 2, opts ?? outline(size));
}

// 두 줄까지 줄바꿈(공백 기준).
function wrapLabel(ctx, text, r, color, size) {
  ctx.font = getFontString(size);
  const words = String(text).split(' ');
  const lines = [''];
  for (const w of words) {
    const tryLine = lines[lines.length - 1] ? `${lines[lines.length - 1]} ${w}` : w;
    if (ctx.measureText(tryLine).width > r.width && lines[lines.length - 1]) lines.push(w);
    else lines[lines.length - 1] = tryLine;
  }
  lines.slice(0, 2).forEach((line, i) => label(ctx, line, rect(r.x, r.y + i * 18, r.width, 18), color, size, 'left'));
}
