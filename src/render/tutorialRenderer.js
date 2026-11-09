// 튜토리얼 화면(docs/tutorial.md 1장, assets/ui/tutorial/manifest.json) - src/tutorial/tutorial.js의 상태만 읽어
// 딤+스포트라이트, 강조 테두리, 칸 표시/손가락, 말풍선, 건너뛰기 버튼, 완료/스킵 팝업을 그린다.
// 이미지는 1배 원본을 2배로(스무딩 끔). 대상 사각형은 매 프레임 CanvasRenderer.getUiRect로 다시 얻는다(반응형).
import { loadImage } from './assetLoader.js';
import { drawNine, drawText, drawFixedImage, getUi, getUiMeta, uiReady, snap } from './uiKit.js';
import { getFontString } from '../config/fonts.js';
import { HUD_CONFIG } from '../config/hud.js';
import { t } from '../config/i18n.js';

const DIR = 'assets/ui/tutorial/';
const K = 2;
const HOLE_PAD = 8; // 원본 4px
const MOVE_MS = 200;
const APPEAR_MS = 120;
const HAND = { pressMs: 240, moveMs: 500, restMs: 400 }; // 누름(tap_ring 3f x 80ms) -> 이동 -> 뗌+쉼
const easeOut = (x) => 1 - (1 - x) * (1 - x);

// 구멍 묶음의 바깥 rect. 비어 있으면 상대 묶음(그것도 비면 화면) 가운데의 크기 0 rect - 거기서 펼쳐지거나 거기로 접힌다.
function boundsOf(list, other, r) {
  if (list.length === 0) {
    const c = other.length ? boundsOf(other, [], r) : { x: 0, y: 0, width: r.cssWidth, height: r.cssHeight };
    return { x: c.x + c.width / 2, y: c.y + c.height / 2, width: 0, height: 0 };
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const h of list) {
    x0 = Math.min(x0, h.x);
    y0 = Math.min(y0, h.y);
    x1 = Math.max(x1, h.x + h.width);
    y1 = Math.max(y1, h.y + h.height);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}
const lerp = (a, b, k) => a + (b - a) * k;

export class TutorialRenderer {
  constructor() {
    this.manifest = null;
    this.images = new Map();
    this.layout = { skip: null, buttons: null }; // main.js 입력 판정용
    this.skipPressed = false;
    this.touching = false; // 터치 중엔 손가락 숨김(main.js가 켠다)
    this._holes = [];
    this._from = null;
    this._holeKey = null;
    this._holeAtMs = 0;
    this._bubbleKey = null;
    this._bubbleAtMs = 0;
    this._pulseAtMs = -1e9;
  }

  async load() {
    try {
      const res = await fetch(`${DIR}manifest.json`);
      this.manifest = await res.json();
    } catch {
      return; // 에셋 없음 - 도형 폴백만.
    }
    await Promise.all(Object.keys(this.manifest.assets).map(async (name) => this.images.set(name, await loadImage(DIR + name))));
  }

  _img(name) {
    const s = this.images.get(name);
    return uiReady(s) ? s.img : null;
  }

  _meta(name) {
    return this.manifest?.assets?.[name] ?? {};
  }

  // 원본 1배 이미지(가로 스트립이면 frame번째)를 2배로.
  _draw(ctx, name, frame, x, y, k = K) {
    const img = this._img(name);
    if (!img) return false;
    const w = this._meta(name).w ?? img.width;
    const h = this._meta(name).h ?? img.height;
    ctx.drawImage(img, frame * w, 0, w, h, Math.round(x), Math.round(y), w * k, h * k);
    return true;
  }

  _nine(ctx, name, x, y, w, h) {
    const img = this._img(name);
    if (!img) return false;
    drawNine(ctx, img, this._meta(name).slice, Math.round(x), Math.round(y), snap(w), snap(h));
    return true;
  }

  // 건너뛰기 버튼 - 일시정지 버튼 자리(오른쪽 끝 맞춤). 대상 rect(topRightButton)로도 쓰이므로 그리기 전에 먼저 정한다.
  layoutSkip(ctx, pause) {
    if (!pause) return null;
    ctx.font = getFontString(12, true);
    const textW = Math.ceil(ctx.measureText(t('tutorial.skip.button')).width);
    const h = snap(Math.max(14 * K, pause.height));
    const w = snap(8 + textW + 4 + 9 * K + 8);
    return { x: Math.round(pause.x + pause.width - w), y: Math.round(pause.y + pause.height / 2 - h / 2), width: w, height: h };
  }

  // r = CanvasRenderer, tut = Tutorial
  draw(ctx, r, tut, now) {
    const W = r.cssWidth;
    const H = r.cssHeight;
    const L = r.lastLayout;
    if (!L || W === 0) return;
    for (const e of tut.events) if (e.type === 'tutorialHintPulse') this._pulseAtMs = now;
    ctx.save();
    ctx.imageSmoothingEnabled = false;

    const step = tut.step;
    const lesson = tut.lesson;
    const holes = this._updateHoles(r, tut, now);
    const finishing = tut.finished || tut._finishing;
    if (!finishing) {
      const dim = this.manifest?.dim ?? { color: '#0d0a10', alpha: 0.72 };
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      for (const h of holes) ctx.rect(h.x, h.y, h.width, h.height);
      ctx.globalAlpha = dim.alpha;
      ctx.fillStyle = dim.color;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
      const frame = Math.floor(now / 400) % 2 ? 'hl_frame_b.png' : 'hl_frame.png';
      for (const h of holes) this._nine(ctx, frame, h.x, h.y, h.width, h.height);
    }

    const board = L.board;
    const pair = tut.guideSwap;
    if (pair && board) this._drawSwapGuide(ctx, board, pair, now);
    if (!finishing && step?.arrow) this._drawArrow(ctx, holes[0], H, now);
    if (lesson && L.scoreBar) this._drawPips(ctx, L.scoreBar, tut);

    const textKey = tut.textKey;
    if (textKey && !finishing) this._drawBubble(ctx, r, tut, textKey, holes, now);
    if (pair && board && !this.touching) this._drawHand(ctx, board, pair, now);

    this.layout.skip = finishing || tut.popup === 'done' ? null : L.skipButton;
    if (this.layout.skip) this._drawSkipButton(ctx, this.layout.skip);
    this.layout.buttons = tut.popup ? this._drawPopup(ctx, r, tut.popup, W, H, tut.practice) : null;
    ctx.restore();
  }

  // 지금 스텝의 구멍 목록(화면 rect) - 스텝/단계가 바뀌면 200ms 동안 이전 위치에서 보간.
  _updateHoles(r, tut, now) {
    const s = tut.step;
    const out = [];
    if (s && s.type !== 'done') {
      for (const name of [].concat(s.target ?? [])) {
        const rect = r.getUiRect(name);
        if (!rect) continue;
        // 화면 가장자리 대상(재화 바 등)은 테두리가 화면 밖으로 나가지 않게 화면 안으로 자른다.
        const x = Math.max(0, rect.x - HOLE_PAD);
        const y = Math.max(0, rect.y - HOLE_PAD);
        out.push({ x, y, width: Math.min(r.cssWidth, rect.x + rect.width + HOLE_PAD) - x, height: Math.min(r.cssHeight, rect.y + rect.height + HOLE_PAD) - y });
      }
      const b = r.lastLayout.board;
      for (const [row, col] of tut.guideCells ?? []) {
        out.push({ x: b.x + col * b.cellSize, y: b.y + row * b.cellSize, width: b.cellSize, height: b.cellSize });
      }
    }
    const key = `${tut.stepIndex}:${tut.guideSwap ? tut.phase : ''}`;
    if (key !== this._holeKey) {
      this._from = this._holes;
      this._holeKey = key;
      this._holeAtMs = now;
    }
    const k = easeOut(Math.min(1, (now - this._holeAtMs) / MOVE_MS));
    if (this._from && k < 1 && this._from.length !== out.length) {
      // 구멍 개수가 바뀜 - 이전 묶음의 바깥 rect -> 새 묶음의 바깥 rect를 구멍 하나로 보간하고, 끝나면 실제 구멍들로.
      const a = boundsOf(this._from, out, r);
      const b = boundsOf(out, this._from, r);
      return [{ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), width: lerp(a.width, b.width, k), height: lerp(a.height, b.height, k) }];
    }
    if (this._from && k < 1) {
      for (let i = 0; i < out.length; i++) {
        const a = this._from[i];
        const o = out[i];
        o.x = lerp(a.x, o.x, k);
        o.y = lerp(a.y, o.y, k);
        o.width = lerp(a.width, o.width, k);
        o.height = lerp(a.height, o.height, k);
      }
    }
    if (k >= 1 || !this._from) this._holes = out;
    return out;
  }

  // 작은 대상 옆 화살표 - 위 절반이면 아래에서 위를 가리키고(180도), 아니면 위에서 아래로. 600ms에 2px 흔들기.
  _drawArrow(ctx, hole, H, now) {
    if (!hole) return;
    const bob = Math.round(Math.sin((now / 600) * Math.PI * 2)) * 2;
    const cx = hole.x + hole.width / 2;
    const size = 11 * K;
    if (hole.y + hole.height / 2 < H / 2) {
      ctx.save();
      ctx.translate(Math.round(cx), Math.round(hole.y + hole.height + 4 + size / 2 + bob));
      ctx.rotate(Math.PI);
      this._draw(ctx, 'arrow.png', 0, -size / 2, -size / 2);
      ctx.restore();
    } else {
      this._draw(ctx, 'arrow.png', 0, cx - size / 2, hole.y - 4 - size + bob);
    }
  }

  _cellCenter(board, [row, col]) {
    return { x: board.x + (col + 0.5) * board.cellSize, y: board.y + (row + 0.5) * board.cellSize };
  }

  _drawSwapGuide(ctx, board, pair, now) {
    const img = this._img('cell_mark.png');
    const f = Math.floor(now / 300) % 2;
    // cell_mark는 셀 32px 기준 - 정수 배율(칸 64px면 2배)로 칸 가운데에 맞춘다.
    const s = Math.max(1, Math.floor(board.cellSize / 32));
    const off = (board.cellSize - 32 * s) / 2;
    if (img) for (const [row, col] of pair) ctx.drawImage(img, f * 32, 0, 32, 32, Math.round(board.x + col * board.cellSize + off), Math.round(board.y + row * board.cellSize + off), 32 * s, 32 * s);
    const a = this._cellCenter(board, pair[0]);
    const b = this._cellCenter(board, pair[1]);
    ctx.save();
    ctx.translate(Math.round((a.x + b.x) / 2), Math.round((a.y + b.y) / 2));
    if (pair[0][1] === pair[1][1]) ctx.rotate(Math.PI / 2); // 세로 스왑
    this._draw(ctx, 'swap_arrow.png', 0, -13, -7);
    ctx.restore();
  }

  _drawHand(ctx, board, pair, now) {
    const from = this._cellCenter(board, pair[0]);
    const to = this._cellCenter(board, pair[1]);
    const cycle = HAND.pressMs + HAND.moveMs + HAND.restMs;
    const tm = (now - this._holeAtMs) % cycle;
    let p = from;
    let frame = 1;
    if (tm < HAND.pressMs) this._draw(ctx, 'tap_ring.png', Math.floor(tm / 80), from.x - 7.5 * K, from.y - 7.5 * K);
    else if (tm < HAND.pressMs + HAND.moveMs) {
      const k = (tm - HAND.pressMs) / HAND.moveMs;
      p = { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k) };
    } else {
      p = to;
      frame = 0;
    }
    const since = now - this._pulseAtMs;
    const s = since < 200 ? 1.3 - 0.3 * (since / 200) : 1;
    this._draw(ctx, 'hand.png', frame, p.x - 5 * K * s, p.y - 1 * K * s, K * s);
  }

  // 점수줄 오른쪽 레슨 진행 pip 4개(완료=초록, 현재=금, 남음=빈칸), 간격 10px(원본).
  _drawPips(ctx, bar, tut) {
    const cur = tut.lessonIds.indexOf(tut.step.lesson);
    const n = tut.lessonIds.length;
    const pitch = 10 * K;
    const x0 = bar.x + bar.width - 12 - (n - 1) * pitch - 7 * K;
    const y = bar.y + bar.height / 2 - (7 * K) / 2;
    for (let i = 0; i < n; i++) {
      const done = i < cur || (i === cur && (tut.phase === 'praise' || tut.phase === 'praiseDelay'));
      this._draw(ctx, done ? 'pip_done.png' : i === cur ? 'pip_on.png' : 'pip_off.png', 0, x0 + i * pitch, y);
    }
  }

  _wrap(ctx, text, maxW) {
    const lines = [];
    let line = '';
    for (const word of text.split(' ')) {
      const cand = line ? `${line} ${word}` : word;
      if (ctx.measureText(cand).width <= maxW || !line) line = cand;
      else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  _drawBubble(ctx, r, tut, textKey, holes, now) {
    const W = r.cssWidth;
    const H = r.cssHeight;
    const L = r.lastLayout;
    const meta = this._meta('guide_box.png');
    const bx = 16;
    const bw = W - 32;
    const textX = bx - 4 * K + 28 * K + 6;
    const textW = bx + bw - 8 * K - textX;
    const bodySize = 12;
    const lineH = 16;
    const body = t(textKey);
    ctx.font = getFontString(bodySize);
    const lines = this._wrap(ctx, body, textW);
    const bh = Math.max(18 * K + 8, 12 + lineH + 4 + lines.length * lineH + 12); // 안쪽 여백 + 제목 + 본문 줄 수

    let by;
    if (tut.step.type === 'lesson') by = L.scoreBar.y + L.scoreBar.height + 4;
    else if (holes.length === 0) by = H / 2 - bh / 2;
    else {
      const top = Math.min(...holes.map((h) => h.y));
      const bottom = Math.max(...holes.map((h) => h.y + h.height));
      const gap = tut.step.arrow ? 11 * K + 12 : 8;
      by = (top + bottom) / 2 < H / 2 ? bottom + gap + 10 * K : top - gap - bh;
    }
    by = Math.max(10 * K + 4, Math.min(H - bh - 8, by));

    if (textKey !== this._bubbleKey) {
      this._bubbleKey = textKey;
      this._bubbleAtMs = now;
    }
    const appear = Math.min(1, (now - this._bubbleAtMs) / APPEAR_MS);
    by = Math.round(by + 4 * (1 - appear));
    ctx.globalAlpha = appear;

    if (!this._nine(ctx, 'guide_box.png', bx, by, bw, bh)) {
      ctx.fillStyle = '#221c2b';
      ctx.fillRect(bx, by, bw, bh);
    }
    this._draw(ctx, 'portrait_frame.png', 0, bx - 4 * K, by - 10 * K);
    this._draw(ctx, 'guide_spirit.png', Math.floor(now / (this._meta('guide_spirit.png').frameMs ?? 180)) % 4, bx - 4 * K + 2 * K, by - 10 * K + 2 * K);

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    let y = by + 12 + lineH / 2;
    ctx.font = getFontString(13, true);
    ctx.fillStyle = meta.speakerColor ?? '#f2d264';
    drawText(ctx, t(tut.titleKey), textX, y);
    y += lineH + 4;

    const typing = tut.phase !== 'praise' && !tut.revealed;
    let left = typing ? Math.floor(tut.textMs / (tut.config.typeMsPerChar ?? 30)) : Infinity;
    ctx.font = getFontString(bodySize);
    ctx.fillStyle = meta.textColor ?? '#e8dcc0';
    for (const line of lines) {
      if (left <= 0) break;
      drawText(ctx, line.slice(0, left), textX, y);
      left -= line.length + 1;
      y += lineH;
    }
    if (tut.step.type === 'info' && left > 0 && Math.floor(now / 500) % 2 === 0) {
      this._draw(ctx, 'next_tri.png', 0, bx + bw - 8 * K - 7 * K, by + bh - 6 * K - 5 * K);
    }
    ctx.globalAlpha = 1;
  }

  _drawSkipButton(ctx, rect) {
    const pressed = this.skipPressed;
    const name = pressed ? 'btn_skip_pressed.png' : 'btn_skip.png';
    if (!this._nine(ctx, name, rect.x, rect.y, rect.width, rect.height)) {
      ctx.fillStyle = HUD_CONFIG.popup.ghost;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    }
    const dy = pressed ? (this._meta('btn_skip_pressed.png').textOffsetY ?? 1) * K : 0;
    const midY = rect.y + rect.height / 2 - 1 + dy;
    ctx.font = getFontString(12, true);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = this._meta('btn_skip.png').textColor ?? '#e8dcc0';
    drawText(ctx, t('tutorial.skip.button'), rect.x + 8, midY);
    this._draw(ctx, 'skip_glyph.png', 0, rect.x + rect.width - 8 - 9 * K, midY - (7 * K) / 2);
  }

  // 완료(popup_win + emblem_done + btn_gold) / 스킵 확인(popup_pause + emblem_pause + secondary·primary).
  // 레이아웃은 기존 일시정지·결과 팝업(CanvasRenderer._drawPopup)과 같은 비율. 반환 = 버튼 rect 맵.
  _drawPopup(ctx, r, kind, W, H, practice) {
    const assets = r.assets;
    const cfg = HUD_CONFIG.popup;
    const cardW = Math.min(W * 0.72, 300);
    const cardH = cardW * 0.62;
    const cardX = (W - cardW) / 2;
    const cardY = (H - cardH) / 2;
    const done = kind === 'done';
    const popupPath = done ? 'popups/popup_win.png' : 'popups/popup_pause.png';
    const ps = getUi(assets, popupPath);
    const pm = getUiMeta(assets, popupPath);
    if (uiReady(ps) && pm?.slice) drawNine(ctx, ps.img, pm.slice, cardX, cardY, snap(cardW), snap(cardH));
    else {
      ctx.fillStyle = cfg.cardBg;
      ctx.fillRect(cardX, cardY, cardW, cardH);
    }
    if (done) this._draw(ctx, 'emblem_done.png', 0, cardX + cardW / 2 - 12 * K, cardY - 12 * K);
    else drawFixedImage(ctx, assets, 'popups/emblem_pause.png', cardX + cardW / 2, cardY, K);

    const base = done ? 'tutorial.done' : 'tutorial.skip';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = done ? cfg.winColor : cfg.pauseColor;
    ctx.font = getFontString(Math.max(16, cardH * 0.16), true);
    drawText(ctx, t(`${base}.title`), cardX + cardW / 2, cardY + cardH * 0.28);
    ctx.fillStyle = HUD_CONFIG.text.dim;
    ctx.font = getFontString(Math.max(11, cardH * 0.08));
    const lines = this._wrap(ctx, t(`${base}.body`), cardW - 32);
    lines.forEach((line, i) => drawText(ctx, line, cardX + cardW / 2, cardY + cardH * 0.48 + (i - (lines.length - 1) / 2) * 15));

    const buttons = done
      ? [['start', 'buttons/btn_gold.png', t(practice ? 'tutorial.done.menuButton' : 'tutorial.done.button')]]
      : [['skip', 'buttons/btn_secondary.png', t('tutorial.skip.skip')], ['keep', 'buttons/btn_primary.png', t('tutorial.skip.keep')]];
    const gap = 8;
    const bw = (cardW - 24 - gap * (buttons.length - 1)) / buttons.length;
    const bh = Math.max(32, cardH * 0.22);
    const by = cardY + cardH - 16 - bh;
    const rects = {};
    buttons.forEach(([action, path, label], i) => {
      const bx = cardX + 12 + i * (bw + gap);
      const st = getUi(assets, path);
      const meta = getUiMeta(assets, path);
      if (uiReady(st) && meta?.slice) drawNine(ctx, st.img, meta.slice, bx, by, snap(bw), snap(bh));
      else {
        ctx.fillStyle = action === 'skip' ? cfg.ghost : cfg.primary;
        ctx.fillRect(bx, by, bw, bh);
      }
      // 완료 버튼(btn_gold)은 부활 버튼처럼 흰 글자 + 크게 - manifest의 어두운 글자는 외곽선과 겹쳐 금색 위에서 뭉개진다.
      const gold = action === 'start';
      ctx.fillStyle = gold ? '#ffffff' : meta?.textColor ?? HUD_CONFIG.text.primary;
      ctx.font = getFontString(Math.max(gold ? 14 : 11, bh * (gold ? 0.42 : 0.32)), true);
      drawText(ctx, label, bx + bw / 2, by + bh / 2);
      rects[action] = { x: bx, y: by, width: bw, height: bh };
    });
    return rects;
  }
}
