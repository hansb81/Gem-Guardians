// 랭킹 팝업(docs/ranking.md 3~5장). 보관함 정비 팝업과 같은 틀·자리. 탭 아래 = 명예의 전당(1~3위, 고정) +
// 참가자가 적으면(config ranking.cardModeBelow 미만) 내 기록 카드, 아니면 4위부터 목록 + 맨 아래 내 줄.
// 좌표는 전부 540 폭 기준(basis)이고 캔버스엔 scale(= 화면 폭 / 540)을 곱해 그린다(prepPopup과 같은 방식).
// 그림은 원본 x2 정수 배율(전당 x3, 카드 방패 x4·숫자 x8), imageSmoothingEnabled=false.
//   layoutRankingPopup = 사각형·목록 위치만 계산하는 순수 함수(tests/rankingPopup.test.js)
//   drawRankingPopup   = 그리기만
//   hitRankingPopup    = 화면 좌표 -> { type, ... }
// st(src/game/rankingUi.js) = { sheet, tab, compState, sub, scroll, entries, unavailable, me, total, history,
//   season, nowMs, timerText, blinkAt, nick: { draft, statue, err, first }, tiers, floorGold,
//   cardBelow, myMetal(iron|bronze|silver|gold), crown({ img, w, h } 메뉴 왕관 시트) }
import { drawNine, drawText, drawFixedImage, getUi, getUiMeta, uiReady } from '../uiKit.js';
import { getFontString } from '../../config/fonts.js';
import { t } from '../../config/i18n.js';
import { drawImageSnapped, screen } from '../screenFit.js';
import { kstDate } from '../../core/kst.js';

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
const FOOT_H = 44;
const BAND_H = 32; // 경쟁 탭 시즌 한 줄 띠
// 명예의 전당: 원본 150x96을 x3(메인 메뉴와 같은 픽셀 크기). 안쪽 좌표는 assets/ui/ranking/manifest.json hall.
const HALL = { w: 450, h: 288, k: 3, gap: 16 };
const CARD = { x: 50, w: 440, h: 230 }; // 내 기록 카드(참가자 cardModeBelow 미만)
const BLINK_MS = 1000;
// 팔레트(assets/gems/palette.hex) + 보조 글자색(characters.hex #a59cb2)
const C = {
  outline: '#0d0a10', bg1: '#221c2b', bg2: '#3b3347', bg3: '#655a74', bone: '#e8dcc0', dim: '#a59cb2',
  gold: '#c28a20', goldL: '#f2d264', brnM: '#7a5212', brnD: '#3a2808', redM: '#741426', redL: '#ec6a6a',
};

// 내 금속(카드 테두리·진행 바 = mid, 기록 글자 = light). 전당 기록 글자색은 순위별.
const METAL = {
  iron: { mid: '#3b3347', light: '#a59cb2' },
  bronze: { mid: '#8a5a4a', light: '#d4a88c' },
  silver: { mid: '#655a74', light: '#e8dcc0' },
  gold: { mid: '#c28a20', light: '#f2d264' },
};
const HALL_VALUE = { 1: '#f2d264', 2: '#e8dcc0', 3: '#d4a88c' };

// 전당 아래를 내 기록 카드로 보여 줄지: 그 탭 참가자 수가 기준(config ranking.cardModeBelow) 미만일 때. 수를 모르면(null) 목록.
export const isCardMode = (total, below = 10) => total != null && total < below;

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
  const comp = st.tab === 'comp';
  // 전당 아래: 참가자가 적으면 내 기록 카드(맨 아래 내 줄은 숨김), 아니면 4위부터 목록 + 맨 아래 내 줄.
  out.cardMode = !st.unavailable && isCardMode(st.total, st.cardBelow);
  if (!out.cardMode) {
    out.mine = rect(c.x, cBottom - ROW_H, c.width, ROW_H);
    out.edit = rect(out.mine.x + out.mine.width - 52, out.mine.y + 6, 44, 44);
    out.goComp = rect(out.edit.x - 8 - 168, out.mine.y + 6, 168, 44);
  }

  let y = c.y + 2;
  if (comp) {
    // 시즌 한 줄 띠("45주차 · 22:54:27 남음 · 내 구간 … · 보상 보기 ›") - 띠 전체가 보상 보기(터치 44).
    out.band = rect(c.x, y, c.width, BAND_H);
    out.rewardsBtn = rect(c.x, y - 6, c.width, 44);
    y += BAND_H + 4;
    if (st.compState === 'settle') {
      out.settle = rect(c.x, y, c.width, 40);
      y += 44;
    }
  }
  // 서버 랭킹 오프라인: "오프라인 · 마지막 갱신 N분 전" 한 줄(전당 위).
  if (!comp && st.offlineText) {
    out.offline = rect(c.x, y, c.width, 24);
    y += 28;
  }
  // 명예의 전당(1~3위) - 스크롤하지 않는다. 순위표를 못 받았으면 없음(안내 문구만).
  if (!st.unavailable) {
    out.hall = rect(c.x - 1, y, HALL.w, HALL.h);
    y += HALL.h + HALL.gap;
  }
  const mineTop = out.mine ? out.mine.y : cBottom + 6;
  // 마켓 리더보드 버튼(토스 "토스 랭킹 보기") - 일반 모드 탭, 내 줄 바로 위.
  if (st.tossBoard && !comp) out.tossBoard = rect(c.x, mineTop - 50, c.width, 44);
  out.list = rect(c.x, y, c.width, (out.tossBoard ? out.tossBoard.y : mineTop) - 6 - y);
  if (comp && st.compState === 'locked') {
    const top = out.hall?.y ?? out.list.y;
    out.lockCover = rect(c.x - 1, top, c.width + 2, cBottom - top);
    out.lockBand = rect(c.x + 24, Math.round(out.lockCover.y + out.lockCover.height / 2 - 64), c.width - 48, 128);
  }

  // 전당 아래(스크롤 안 좌표, 0 = 맨 위): 카드 모드 = 카드 + 끝 줄, 목록 모드 = 4~100위 줄(경쟁 탭은 보상 구간이
  // 바뀔 때마다 구분 줄) + 끝 줄. 세로가 모자라면(경쟁 탭 정산 안내 등) 이 칸만 스크롤한다.
  const items = [];
  let ly = 0;
  const entries = st.entries ?? [];
  if (st.unavailable) items.push({ kind: 'offline', y: 0, h: out.list.height });
  else if (out.cardMode) {
    items.push({ kind: 'card', y: 0, h: CARD.h });
    items.push({ kind: 'foot', y: CARD.h + 20, h: 32 });
    ly = CARD.h + 52;
  } else {
    let prev = null;
    for (const e of entries.slice(3)) {
      if (comp && e.tierId !== prev) {
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

// 내 기록 카드 안 자리(x, y = 카드 왼쪽 위). 그리기와 터치 판정이 같이 쓴다.
function cardRects(x, y) {
  const rx = x + 150;
  return {
    card: rect(x, y, CARD.w, CARD.h),
    shield: rect(x + 26, y + 24, 104, 120), // rank_shield x4
    rankLabel: rect(x + 26, y + 152, 104, 14),
    name: rect(rx, y + 28, 208, 22),
    edit: rect(rx, y + 17, 236, 44), // 이름 + 연필 = 닉네임 바꾸기(카드 모드엔 맨 아래 내 줄이 없다)
    crown: rect(x + 392, y + 26, 38, 26), // rank_crown x2
    record: rect(rx, y + 65, 180, 22),
    date: rect(rx + 180, y + 69, 100, 14),
    until: rect(rx, y + 111, 200, 14),
    gap: rect(rx + 200, y + 111, 80, 14),
    bar: rect(rx, y + 135, 280, 16),
    btn: rect(rx, y + 166, 280, 48),
  };
}
const cardAt = (L, st) => cardRects(CARD.x, L.list.y - Math.min(st.scroll ?? 0, L.scrollMax));

function layoutSub(st, H) {
  const center = (w, h) => rect(Math.round((BASIS_W - w) / 2), Math.max(24, Math.round((H - h) / 2)), w, h);
  const withClose = (card) => ({ card, close: rect(card.x + card.width - 52, card.y + 8, 44, 44) });
  if (st.sub === 'rewards') {
    const n = st.tiers?.length ?? 0;
    const s = withClose(center(460, 84 + 48 + n * 44 + 70));
    s.title = rect(s.card.x + 48, s.card.y + 28, s.card.width - 96, 28);
    s.subline = rect(s.card.x + 32, s.card.y + 60, s.card.width - 64, 18);
    s.last = rect(s.card.x + 28, s.card.y + 84, s.card.width - 56, 44); // 지난 시즌 한 줄(눌러서 최근 8주)
    s.rows = Array.from({ length: n }, (_, i) => rect(s.card.x + 28, s.card.y + 132 + i * 44, s.card.width - 56, 44));
    s.note = rect(s.card.x + 32, s.card.y + 136 + n * 44, s.card.width - 64, 36);
    return s;
  }
  if (st.sub === 'history') {
    const n = Math.max(1, st.history?.length ?? 0);
    const s = withClose(center(460, 84 + n * 48 + 30));
    s.title = rect(s.card.x + 48, s.card.y + 28, s.card.width - 96, 28);
    s.rows = Array.from({ length: n }, (_, i) => rect(s.card.x + 28, s.card.y + 68 + i * 48, s.card.width - 56, 48));
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
    if (st.sub === 'rewards' && inside(bx, by, s.last)) return { type: 'history' };
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
  if (inside(bx, by, L.rewardsBtn)) return { type: 'rewards' };
  if (inside(bx, by, L.lockCover)) return { type: 'none' }; // 잠김: 목록·내 줄은 디더 덮개 아래
  if (L.cardMode && inside(bx, by, L.list)) {
    const R = cardAt(L, st);
    if (inside(bx, by, R.btn)) return { type: 'challenge' };
    if (inside(bx, by, R.edit)) return { type: 'edit' };
  }
  if (inside(bx, by, L.edit)) return { type: 'edit' };
  if (st.tab === 'comp' && st.compState === 'none' && inside(bx, by, L.goComp)) return { type: 'goComp' };
  if (inside(bx, by, L.mine)) return { type: 'mine' };
  if (inside(bx, by, L.list)) return { type: 'list', by };
  if (!inside(bx, by, L.sheet)) return { type: 'close' };
  return { type: 'none' };
}

// 내 줄이 목록 가운데 오는 스크롤 값(목록에 없으면 - 1~3위거나 순위 밖 - 맨 아래).
export function scrollToMeValue(L) {
  const it = L.items.find((i) => i.kind === 'row' && i.entry.me);
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
    fillDither(ctx, fullBasis(L));
    if (st.sub === 'rewards') drawRewards(ctx, assets, st, L.sub);
    else if (st.sub === 'history') drawHistory(ctx, assets, st, L.sub);
    else drawNick(ctx, assets, st, L.sub);
  }
  ctx.restore();
}

// 블리드 포함 캔버스 전체(basis 좌표) - 뒤 어둡게 깔기용.
function fullBasis(L) {
  const F = screen.full;
  return rect(F.x / L.scale, F.y / L.scale, F.width / L.scale, F.height / L.scale);
}

function drawSheet(ctx, assets, st, L) {
  fillDither(ctx, fullBasis(L));
  nine(ctx, assets, 'menu/popup_menu.png', L.sheet, C.bg1);
  if (!drawFixedImage(ctx, assets, 'ranking/emblem_rank.png', L.emblem.cx, L.emblem.cy, K)) drawFixedImage(ctx, assets, 'popups/emblem_win.png', L.emblem.cx, L.emblem.cy, K);
  drawFixedImage(ctx, assets, 'upgrade/btn_close.png', L.close.x + 22, L.close.y + 22, K);
  label(ctx, t('ranking.title'), L.title, C.goldL, 22, 'center');

  for (const key of st.tabs ?? RANKING_TABS) if (key !== st.tab) drawTab(ctx, assets, L.tabs[key], key, false, st);
  nine(ctx, assets, 'upgrade/tab_body.png', L.body, '#15121c');
  drawTab(ctx, assets, L.tabs[st.tab], st.tab, true, st);

  if (st.tab === 'comp') drawCompBand(ctx, assets, st, L);
  if (L.offline) label(ctx, st.offlineText, L.offline, C.dim, 11, 'center');
  if (L.hall) drawHall(ctx, assets, st, L.hall);
  drawList(ctx, assets, st, L);
  if (L.tossBoard) button(ctx, assets, 'buttons/btn_primary.png', L.tossBoard, t('ranking.tossBoard'), C.bone, 22);
  if (L.mine) drawMine(ctx, assets, st, L);
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

// 경쟁 탭 시즌 한 줄 띠: 주차 · 남은 시간 · 내 구간 · 보상 보기 ›(지난 시즌 기록은 보상 보기 안).
function drawCompBand(ctx, assets, st, L) {
  const b = L.band;
  ctx.fillStyle = C.bg2;
  ctx.fillRect(b.x, b.y, b.width, b.height);
  ctx.fillStyle = C.bg1;
  ctx.fillRect(b.x + 2, b.y + 2, b.width - 4, b.height - 4);
  drawFixedImage(ctx, assets, 'ranking/icon_timer.png', b.x + 18, b.y + b.height / 2, K);
  const me = st.compState === 'none' ? null : st.me;
  const tier = me?.rank ? t('ranking.myTier', { tier: tierLabel(me.tierId ?? 'part') }) : t(me ? 'ranking.offlineShort' : 'ranking.notJoined');
  label(ctx, t('ranking.band', { week: st.season.week, time: st.timerText, tier }), rect(b.x + 36, b.y, b.width - 36 - 100, b.height), C.bone, 11, 'left');
  label(ctx, t('ranking.rewardsBtn') + ' ›', rect(b.x + b.width - 100, b.y, 90, b.height), C.goldL, 11, 'right');

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
    if (it.kind === 'card') drawMyCard(ctx, assets, st, cardRects(CARD.x, y));
    else if (it.kind === 'divider') drawDivider(ctx, st, it.tierId, rect(lr.x, y, lr.width, it.h));
    else if (it.kind === 'row') drawRow(ctx, assets, st, it.entry, rect(lr.x, y, lr.width, it.h), false);
    else if (it.kind === 'foot') label(ctx, t('ranking.listFoot', { n: L.cardMode ? 3 : st.entries.length, total: fmt(st.total ?? 0) }), rect(lr.x, y, lr.width, it.h), C.dim, 11, 'center');
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

// 명예의 전당(1~3위): 배경 -> 횃불 -> 받침대 -> 석상(돌색, 발이 받침대에 박힘) -> 이름·기록. 사람이 없는 자리는 받침대만.
function drawHall(ctx, assets, st, r) {
  const m = assets?.rankingHall;
  const k = HALL.k;
  const pic = (file) => {
    const s = getUi(assets, 'ranking/hall/' + file);
    return uiReady(s) ? s.img : null;
  };
  const bg = m && pic(m.bg.file);
  if (bg) drawImageSnapped(ctx, bg, r.x, r.y, r.width, r.height);
  else {
    ctx.fillStyle = C.bg1;
    ctx.fillRect(r.x, r.y, r.width, r.height);
  }
  if (m) {
    const tc = m.torch;
    const tf = Math.floor(st.nowMs / tc.frameMs) % tc.frames;
    for (const sh of Object.values(tc.sheets)) {
      const img = pic(sh.file);
      if (img) drawImageSnapped(ctx, img, tf * tc.w, 0, tc.w, tc.h, r.x + sh.x * k, r.y + sh.y * k, tc.w * k, tc.h * k);
    }
    for (const rank of [2, 1, 3]) {
      const p = m.pedestals[rank];
      const img = pic(p.file);
      if (img) drawImageSnapped(ctx, img, r.x + p.x * k, r.y + p.y * k, p.w * k, p.h * k);
      const e = st.entries[rank - 1];
      const cx = r.x + m.statues[rank].feetCenterX * k;
      const top = r.y + m.statues[rank].top * k;
      if (e) drawStoneStatue(ctx, assets, e.statue, cx, top, Math.floor(st.nowMs / 160) + rank);
      // 글자 가운데 = 석상 윗변 -44(이름 11px), -20(기록 22px)
      label(ctx, e ? e.nickname || st.myName || t('ranking.me') : t('ranking.emptySeat'), rect(cx - 70, top - 51, 140, 14), e ? C.bone : C.bg3, 11, 'center');
      label(ctx, e ? valueText(st.tab, e.value) : '—', rect(cx - 70, top - 31, 140, 22), e ? HALL_VALUE[rank] : C.bg3, 22, 'center');
    }
  }
  strokeRect(ctx, r, C.bg2, 2);
}

// 내 기록 카드(참가자가 적을 때 목록 대신): 방패 + 내 순위, 이름·왕관, 최고 기록·날짜, 바로 위 순위까지 남은 값, 도전 버튼.
function drawMyCard(ctx, assets, st, R) {
  const me = st.tab === 'comp' && st.compState === 'none' ? null : st.me;
  const metalId = METAL[st.myMetal] ? st.myMetal : 'iron';
  const metal = METAL[metalId];
  const c = R.card;
  ctx.fillStyle = metal.mid;
  ctx.fillRect(c.x, c.y, c.width, c.height);
  ctx.fillStyle = C.bg2;
  ctx.fillRect(c.x + 3, c.y + 3, c.width - 6, c.height - 6);
  ctx.fillStyle = C.bg1;
  ctx.fillRect(c.x + 5, c.y + 5, c.width - 10, c.height - 10);

  const sh = getUi(assets, 'ranking/hall/rank_shield_' + metalId + '.png');
  if (uiReady(sh)) drawImageSnapped(ctx, sh.img, R.shield.x, R.shield.y, R.shield.width, R.shield.height);
  const dg = getUi(assets, 'ranking/hall/shield_digits.png');
  const rank = me?.rank ?? 0;
  // 숫자 그림은 한 자리(5x7, 6px 간격)를 x8 - 카드 모드는 참가자가 적어 한 자리다. 그 밖·순위 없음은 글자.
  if (rank >= 1 && rank <= 9 && uiReady(dg)) drawImageSnapped(ctx, dg.img, rank * 6, 0, 5, 7, R.shield.x + 24, R.shield.y + 20, 40, 56);
  else label(ctx, rank > 9 ? String(rank) : '?', rect(R.shield.x, R.shield.y + 20, R.shield.width, 56), C.bone, 22, 'center');
  label(ctx, t('ranking.card.myRank'), R.rankLabel, C.bg3, 11, 'center');

  label(ctx, st.myName || me?.nickname || t('ranking.me'), R.name, C.bone, 22, 'left');
  drawFixedImage(ctx, assets, 'ranking/icon_edit.png', R.edit.x + R.edit.width - 12, R.name.y + 11, K);
  const cr = st.crown;
  if (cr) drawImageSnapped(ctx, cr.img, 0, 0, cr.w, cr.h, R.crown.x, R.crown.y, cr.w * 2, cr.h * 2);
  button(ctx, assets, 'menu/btn_play.png', R.btn, t('ranking.card.go'), C.outline, 22, false);

  if (!me?.value) {
    label(ctx, t('ranking.card.none'), R.record, C.dim, 11, 'left');
    return;
  }
  label(ctx, st.tab === 'comp' ? valueText('comp', me.value) : t('ranking.card.best', { n: me.value }), R.record, metal.light, 22, 'left');
  label(ctx, dateText(me.at), R.date, C.bg3, 11, 'right');
  if (rank === 1) {
    label(ctx, t('ranking.card.keepFirst'), rect(R.until.x, R.until.y, R.bar.width, R.until.height), C.goldL, 11, 'left');
    return;
  }
  const above = rank > 1 ? st.entries[rank - 2] : null;
  if (!above) return;
  label(ctx, t('ranking.card.until', { rank: rank - 1, name: above.nickname }), R.until, C.bone, 11, 'left');
  label(ctx, '+' + valueText(st.tab, Math.max(0, above.value - me.value)), R.gap, C.goldL, 11, 'right');
  const b = R.bar;
  ctx.fillStyle = C.bg2;
  ctx.fillRect(b.x, b.y, b.width, b.height);
  ctx.fillStyle = C.outline;
  ctx.fillRect(b.x + 2, b.y + 2, b.width - 4, b.height - 4);
  ctx.fillStyle = metal.mid;
  ctx.fillRect(b.x + 4, b.y + 4, Math.round((b.width - 8) * Math.max(0, Math.min(1, me.value / (above.value || 1)))), b.height - 8);
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
  nine(ctx, assets, 'upgrade/card.png', s.last, C.bg2);
  const last = st.history?.[0];
  const lr = rect(s.last.x + 12, s.last.y, s.last.width - 24, s.last.height);
  label(ctx, last ? t('ranking.lastSeason', { rank: last.rank, pct: last.pct }) : t('ranking.lastNone'), lr, C.bone, 11, 'left');
  label(ctx, t('ranking.recent'), lr, C.dim, 11, 'right');
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
  return kstDate(ms).replaceAll('-', '.');
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
      if (img) drawImageSnapped(ctx, img, icx - img.width, cy - img.height, img.width * K, img.height * K);
    } else drawFixedImage(ctx, assets, p.kind === 'gold' ? 'icons/gold.png' : 'icons/diamond.png', icx, cy, K);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.bone;
    ctx.font = getFontString(size);
    drawText(ctx, fmt(p.n), px + 36, cy, outline(size));
    px += widths[i] + 12;
  });
}

// 석상 색 변환(RGBA 배열을 그 자리에서): keep(0xRRGGBB - 외곽선·네온 눈/불꽃)은 그대로, 나머지는 밝기 3단 돌색.
const STONE = [C.bg2, C.bg3, C.bone].map((hex) => parseInt(hex.slice(1), 16));
export function stonePixels(d, keep) {
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3] || keep.has((d[i] << 16) | (d[i + 1] << 8) | d[i + 2])) continue;
    const l = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    const c = STONE[l < 40 ? 0 : l < 110 ? 1 : 2];
    d[i] = c >> 16;
    d[i + 1] = (c >> 8) & 255;
    d[i + 2] = c & 255;
  }
}

// shortcut: 순위표 항목에 수호자 등급이 없어 색(기본 등급 그림)별로만 캐시한다 - 등급이 오면 key에 붙인다.
const stoneCache = new Map(); // 시트 키 -> 돌색으로 바꾼 idle 시트(프레임 전부)
function stoneOf(assets, key, own) {
  let c = stoneCache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = own.state.img.width;
  c.height = own.frameH;
  const x = c.getContext('2d');
  x.drawImage(own.state.img, 0, 0);
  const img = x.getImageData(0, 0, c.width, c.height);
  const neon = Object.values(assets.towerManifest?.neon ?? {}).flat();
  stonePixels(img.data, new Set([C.outline, ...neon].map((hex) => parseInt(hex.slice(1), 16))));
  x.putImageData(img, 0, 0);
  stoneCache.set(key, c);
  return c;
}

// 전당 받침대 위 석상: 대표 수호자 idle을 돌색 x3으로, cx = 발 가운데, top = 윗변. 시트는 왼쪽을 보므로 게임처럼 뒤집는다.
function drawStoneStatue(ctx, assets, color, cx, top, tick) {
  const key = 'tower_idle_' + color;
  const own = assets?.towerAnims?.get(key);
  if (!own || !uiReady(own.state)) return;
  const w = own.frameW * HALL.k;
  ctx.save();
  ctx.translate(Math.round(cx), 0);
  ctx.scale(-1, 1);
  drawImageSnapped(ctx, stoneOf(assets, key, own), (tick % Math.min(4, own.frames || 1)) * own.frameW, 0, own.frameW, own.frameH, -w / 2, top, w, own.frameH * HALL.k);
  ctx.restore();
}

function drawStatue(ctx, assets, color, x, y) {
  // 수호자(idle 시트에 drawScale이 있는 그림): 전투 화면과 같은 배율로 idle 첫 프레임을 32x40 칸의
  // 아래 가운데에 그린다(20x26 x 1.5 = 30x39). 시트는 왼쪽을 보므로 뒤집어 오른쪽을 보게 한다.
  const own = assets?.towerAnims?.get('tower_idle_' + color);
  if (own?.drawScale && uiReady(own.state)) {
    const w = own.frameW * own.drawScale;
    const h = own.frameH * own.drawScale;
    ctx.save();
    ctx.translate(Math.round(x) + 16, 0);
    ctx.scale(-1, 1);
    drawImageSnapped(ctx, own.state.img, 0, 0, own.frameW, own.frameH, -w / 2, Math.round(y) + 40 - h, w, h);
    ctx.restore();
    return;
  }
  const st = assets?.towerImages?.get(color);
  if (uiReady(st)) drawImageSnapped(ctx, st.img, Math.round(x), Math.round(y), st.img.width * K, st.img.height * K);
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
  ctx.fillStyle = C.brnD;
  ctx.fillRect(x + 2, y + 2, w - 4, 12);
  ctx.textAlign = 'center';
  ctx.fillStyle = C.goldL;
  // 외곽선 없는 11px 글자는 번져 보인다(fonts.js 주석) - 다른 글자처럼 외곽선을 준다.
  drawText(ctx, text, x + w / 2, y + 8, outline(11));
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
