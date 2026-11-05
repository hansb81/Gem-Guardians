// 메인 메뉴 화면(assets/menu/README.md, manifest.json, mockups/main-menu.html 시안 A).
// 타이틀에서 터치하면 여기로 온다. 배경은 menu_bg_anim.png(64프레임, 8열, 100ms)를
// 네이티브 180x320 기준 3배로 재생하고(시트 로딩 전엔 정지 이미지 menu_bg.png, 둘 다
// 없으면 단색 폴백), 그 위에 시안 A의 UI를 manifest의 layoutA_screenPx(540x960 화면 px)
// 위치에 그린다. 아이콘 그림이 아직 없어 글자만 있는 자리고, 설정/상점/출석/이벤트
// 팝업도 자리만 있는 placeholder다.
import { loadImage } from './assetLoader.js';
import { getFontString } from '../config/fonts.js';
import { drawText } from './uiKit.js';
import { t } from '../config/i18n.js';

const FALLBACK_BG = '#221c2b';
const NATIVE_W = 180;
const NATIVE_H = 320;
const DRAW_SCALE = 3; // manifest.layoutA_screenPx 좌표계 기준(네이티브 180x320의 3배 = 540x960).

const COLORS = {
  outline: '#0d0a10',
  bone: '#e8dcc0',
  bg2: '#3b3347',
  bg3: '#655a74',
  gold: '#c28a20',
  goldLight: '#f2d264',
  diamond: '#8cc4ee',
  diamondBorder: '#386cbc',
  purple: '#7a3cae',
  blue: '#386cbc',
  redLight: '#ec6a6a',
  yellow: '#ffe14a',
  overlay: 'rgba(13, 10, 16, 0.75)',
};

const DEFAULT_LAYOUT = {
  currencyBar: [154, 28, 232, 56],
  attendance: [20, 28, 48, 48],
  event: [20, 92, 48, 48],
  settings: [472, 28, 48, 48],
  shop: [472, 92, 48, 48],
  playButton: [90, 760, 360, 64],
};

async function fetchJson(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function ready(state) {
  return !!(state && state.loaded && !state.failed);
}

function pointInRect(x, y, rect) {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export class MainMenuScreen {
  constructor() {
    this.manifest = null;
    this.bg = null;
    this.bgAnim = null;
    this._transform = null; // 최근 draw()의 {offsetX, offsetY, k} - 포인터 판정에 그대로 쓴다.

    this.popup = null; // null | 'mode' | 'settings' | 'shop' | 'attendance' | 'event'
    this._modeLockHint = false;

    fetchJson('assets/menu/manifest.json').then((m) => {
      this.manifest = m;
    });
    loadImage('assets/menu/menu_bg.png').then((s) => {
      this.bg = s;
    });
    loadImage('assets/menu/menu_bg_anim.png').then((s) => {
      this.bgAnim = s;
    });
  }

  _layout() {
    return this.manifest?.layoutA_screenPx ?? DEFAULT_LAYOUT;
  }

  // 화면 px -> manifest 좌표계(540x960) 사각형 변환. draw()가 매 프레임 _transform을
  // 갱신하므로, 그 프레임의 pointerdown도 같은 값을 쓴다(레이아웃이 바뀐 다음 프레임에만 어긋날 수 있음).
  _toScreen([x, y, w, h]) {
    const { offsetX, offsetY, k } = this._transform;
    return { x: offsetX + x * k, y: offsetY + y * k, width: w * k, height: h * k };
  }

  draw(ctx, width, height, playerState, nowMs = 0) {
    ctx.fillStyle = FALLBACK_BG;
    ctx.fillRect(0, 0, width, height);
    if (width <= 0 || height <= 0) return;

    const scale = Math.min(width / NATIVE_W, height / NATIVE_H);
    const offsetX = (width - NATIVE_W * scale) / 2;
    const offsetY = (height - NATIVE_H * scale) / 2;
    const k = scale / DRAW_SCALE;
    this._transform = { offsetX, offsetY, k };

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this._drawBackground(ctx, offsetX, offsetY, scale, nowMs);
    this._drawUi(ctx, playerState);
    ctx.restore();

    if (this.popup) this._drawPopup(ctx, width, height);
  }

  _drawBackground(ctx, offsetX, offsetY, scale, nowMs) {
    if (ready(this.bgAnim)) {
      const anim = this.manifest?.anim ?? { frameW: NATIVE_W, frameH: NATIVE_H, frames: 64, cols: 8, frameMs: 100 };
      const i = Math.floor(nowMs / anim.frameMs) % anim.frames;
      const sx = (i % anim.cols) * anim.frameW;
      const sy = Math.floor(i / anim.cols) * anim.frameH;
      ctx.drawImage(this.bgAnim.img, sx, sy, anim.frameW, anim.frameH, offsetX, offsetY, NATIVE_W * scale, NATIVE_H * scale);
      return;
    }
    if (ready(this.bg)) {
      ctx.drawImage(this.bg.img, offsetX, offsetY, NATIVE_W * scale, NATIVE_H * scale);
    }
  }

  _drawUi(ctx, playerState) {
    this._drawCurrencyBar(ctx, playerState);
    this._drawIconButton(ctx, this._layout().attendance, COLORS.gold, t('menu.icon.attendance'), true);
    this._drawIconButton(ctx, this._layout().event, COLORS.purple, t('menu.icon.event'), true);
    this._drawIconButton(ctx, this._layout().settings, COLORS.bg3, t('menu.icon.settings'), false);
    this._drawIconButton(ctx, this._layout().shop, COLORS.blue, t('menu.icon.shop'), false);
    this._drawPlayButton(ctx);
  }

  _drawCurrencyBar(ctx, playerState) {
    const r = this._toScreen(this._layout().currencyBar);
    this._panel(ctx, r, COLORS.bg2, COLORS.bg3);

    const fontPx = Math.max(8, r.height * 0.26);
    ctx.font = getFontString(fontPx);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const midY = r.y + r.height / 2;
    const iconSize = r.height * 0.36;

    const drawItem = (cx, color, value) => {
      ctx.fillStyle = color;
      ctx.fillRect(cx - iconSize / 2, midY - iconSize / 2, iconSize, iconSize);
      ctx.fillStyle = COLORS.bone;
      drawText(ctx, String(value), cx + iconSize / 2 + 6, midY, { outlineColor: COLORS.outline, outlineWidth: 1.5 });
    };
    drawItem(r.x + r.width * 0.28, COLORS.goldLight, playerState?.gold ?? 0);
    drawItem(r.x + r.width * 0.68, COLORS.diamond, playerState?.diamonds ?? 0);
  }

  _drawIconButton(ctx, basisRect, borderColor, label, badge) {
    const r = this._toScreen(basisRect);
    this._panel(ctx, r, COLORS.bg2, borderColor);

    const fontPx = Math.max(7, r.height * 0.22);
    ctx.font = getFontString(fontPx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.bone;
    drawText(ctx, label, r.x + r.width / 2, r.y + r.height / 2, { outlineColor: COLORS.outline, outlineWidth: 1.5 });

    if (badge) {
      const bSize = r.width * 0.22;
      ctx.fillStyle = COLORS.redLight;
      ctx.fillRect(r.x + r.width - bSize * 0.6, r.y - bSize * 0.4, bSize, bSize);
    }
  }

  _drawPlayButton(ctx) {
    const r = this._toScreen(this._layout().playButton);
    ctx.fillStyle = COLORS.outline;
    ctx.fillRect(r.x, r.y, r.width, r.height);
    const inset = Math.max(1, r.height * 0.06);
    ctx.fillStyle = COLORS.goldLight;
    ctx.fillRect(r.x + inset, r.y + inset, r.width - inset * 2, r.height - inset * 2);
    ctx.strokeStyle = COLORS.gold;
    ctx.lineWidth = Math.max(1, inset);
    ctx.strokeRect(r.x + inset * 2, r.y + inset * 2, r.width - inset * 4, r.height - inset * 4);

    ctx.font = getFontString(Math.max(10, r.height * 0.34));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.outline;
    drawText(ctx, `▶ ${t('menu.play')}`, r.x + r.width / 2, r.y + r.height / 2, { outline: false });
  }

  _panel(ctx, r, bg, border) {
    ctx.fillStyle = COLORS.outline;
    ctx.fillRect(r.x, r.y, r.width, r.height);
    const inset = Math.max(1, Math.min(r.width, r.height) * 0.04);
    ctx.fillStyle = bg;
    ctx.fillRect(r.x + inset, r.y + inset, r.width - inset * 2, r.height - inset * 2);
    ctx.strokeStyle = border;
    ctx.lineWidth = Math.max(1, inset);
    ctx.strokeRect(r.x + inset * 1.5, r.y + inset * 1.5, r.width - inset * 3, r.height - inset * 3);
  }

  // 팝업 카드 크기(manifest 좌표계, 540x960 기준) - 종류별로 다르다.
  _popupCardBasis() {
    const sizes = {
      mode: [400, 230],
      settings: [400, 300],
      shop: [480, 700],
      attendance: [400, 180],
      event: [400, 180],
    };
    const [w, h] = sizes[this.popup] ?? [400, 200];
    return [(540 - w) / 2, (960 - h) / 2, w, h];
  }

  _drawPopup(ctx, width, height) {
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, 0, width, height);

    const card = this._toScreen(this._popupCardBasis());
    this._panel(ctx, card, '#221c2b', COLORS.bg3);

    const closeSize = card.width * 0.11;
    const closeX = card.x + card.width - closeSize - card.width * 0.02;
    const closeY = card.y + card.height * 0.02;
    ctx.fillStyle = COLORS.bg2;
    ctx.fillRect(closeX, closeY, closeSize, closeSize);
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 2;
    ctx.strokeRect(closeX, closeY, closeSize, closeSize);
    ctx.font = getFontString(closeSize * 0.6);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.bone;
    drawText(ctx, '✕', closeX + closeSize / 2, closeY + closeSize / 2, { outline: false });

    const padX = card.width * 0.05;
    ctx.textAlign = 'left';
    ctx.font = getFontString(card.width * 0.055);
    ctx.fillStyle = COLORS.yellow;
    drawText(ctx, t(`menu.${this.popup}.title`), card.x + padX, card.y + card.height * 0.1, { outlineColor: COLORS.outline, outlineWidth: 1.5 });

    if (this.popup === 'mode') this._drawModePopup(ctx, card);
    else this._drawPlaceholderPopup(ctx, card);
  }

  _drawPlaceholderPopup(ctx, card) {
    const padX = card.width * 0.05;
    ctx.font = getFontString(card.width * 0.03);
    ctx.fillStyle = COLORS.bone;
    ctx.textAlign = 'left';
    const lines = this.popup === 'settings' ? [t('menu.settings.sfx'), t('menu.settings.bgm')] : [t(`menu.${this.popup}.body`)];
    lines.forEach((line, i) => {
      drawText(ctx, line, card.x + padX, card.y + card.height * 0.2 + i * card.height * 0.08, { outlineColor: COLORS.outline, outlineWidth: 1 });
    });
  }

  _modeButtonRects(card) {
    const padX = card.width * 0.05;
    const btnW = card.width - padX * 2;
    const btnH = card.height * 0.2;
    const normal = { x: card.x + padX, y: card.y + card.height * 0.28, width: btnW, height: btnH };
    const competitive = { x: card.x + padX, y: normal.y + btnH + card.height * 0.06, width: btnW, height: btnH };
    return { normal, competitive };
  }

  _drawModePopup(ctx, card) {
    const { normal, competitive } = this._modeButtonRects(card);

    ctx.fillStyle = COLORS.purple;
    ctx.fillRect(normal.x, normal.y, normal.width, normal.height);
    ctx.strokeStyle = COLORS.outline;
    ctx.lineWidth = 2;
    ctx.strokeRect(normal.x, normal.y, normal.width, normal.height);
    ctx.font = getFontString(normal.height * 0.4);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = COLORS.bone;
    drawText(ctx, t('menu.mode.normal'), normal.x + normal.width / 2, normal.y + normal.height / 2, { outline: false });

    ctx.fillStyle = COLORS.bg2;
    ctx.fillRect(competitive.x, competitive.y, competitive.width, competitive.height);
    ctx.strokeRect(competitive.x, competitive.y, competitive.width, competitive.height);
    ctx.fillStyle = COLORS.bg3;
    drawText(ctx, `\u{1F512} ${t('menu.mode.competitive')}`, competitive.x + competitive.width / 2, competitive.y + competitive.height / 2, { outline: false });

    if (this._modeLockHint) {
      ctx.font = getFontString(card.width * 0.028);
      ctx.fillStyle = COLORS.redLight;
      drawText(ctx, t('menu.mode.locked'), competitive.x + competitive.width / 2, competitive.y + competitive.height + card.height * 0.08, { outline: false });
    }
  }

  // main.js가 pointerdown마다 호출한다. 'startNormalGame'을 돌려주면 game scene으로 넘어간다.
  handlePointerDown(x, y) {
    if (!this._transform) return null;

    if (this.popup) return this._handlePopupPointerDown(x, y);

    const layout = this._layout();
    if (pointInRect(x, y, this._toScreen(layout.playButton))) {
      this.popup = 'mode';
      this._modeLockHint = false;
      return null;
    }
    if (pointInRect(x, y, this._toScreen(layout.attendance))) this.popup = 'attendance';
    else if (pointInRect(x, y, this._toScreen(layout.event))) this.popup = 'event';
    else if (pointInRect(x, y, this._toScreen(layout.settings))) this.popup = 'settings';
    else if (pointInRect(x, y, this._toScreen(layout.shop))) this.popup = 'shop';
    return null;
  }

  _handlePopupPointerDown(x, y) {
    const card = this._toScreen(this._popupCardBasis());
    const closeSize = card.width * 0.11;
    const closeRect = { x: card.x + card.width - closeSize - card.width * 0.02, y: card.y + card.height * 0.02, width: closeSize, height: closeSize };
    if (pointInRect(x, y, closeRect)) {
      this.popup = null;
      return null;
    }

    if (this.popup === 'mode') {
      const { normal, competitive } = this._modeButtonRects(card);
      if (pointInRect(x, y, normal)) {
        this.popup = null;
        return 'startNormalGame';
      }
      if (pointInRect(x, y, competitive)) {
        this._modeLockHint = !this._modeLockHint;
        return null;
      }
    }

    if (!pointInRect(x, y, card)) this.popup = null; // 카드 바깥(오버레이) 탭 = 닫기.
    return null;
  }
}
