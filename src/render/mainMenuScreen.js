// 메인 메뉴 화면(assets/menu/README.md, manifest.json, mockups/main-menu.html 시안 A).
// 타이틀에서 터치하면 여기로 온다. 배경은 타이틀과 같은 v2 구조(정지 베이스 + 작은 애니
// 조각 + 코드로 그리는 불씨)라 LayeredBg를 그대로 쓴다 - 조각 시트가 아직 안 왔으면 정지
// 한 장(menu_bg.png), 그것도 없으면 단색 폴백. 그 위에 시안 A의 UI를 manifest의
// layoutA_screenPx(540x960 화면 px) 위치에 그린다. 팝업이 떠 있어도 배경은 계속 돈다.
//
// UI 그림은 assets/ui/menu 팩(assets/ui/menu/README.md) - 기존 인게임 UI 팩과 같은 규격
// (1배 파일, 화면 2배, imageSmoothingEnabled=false, 9-slice는 uiKit의 drawNine)이라
// assetLoader가 "menu/<파일>" 키로 같은 uiImages/uiManifest에 합쳐 둔다.
// 아래 좌표는 모두 540x960 기준("basis")이고 _toScreen이 실제 캔버스 크기로 옮긴다.
// 세부 배치 수치는 art/ui/menu/preview_*.png에서 잰 값이다.
import { loadImage } from './assetLoader.js';
import { LayeredBg } from './layeredBg.js';
import { getFontString } from '../config/fonts.js';
import { drawText, drawNine, getUi, getUiMeta, uiReady } from './uiKit.js';
import { t } from '../config/i18n.js';
import { audio } from '../audio/AudioManager.js';

const FALLBACK_BG = '#221c2b';
const NATIVE_W = 180;
const NATIVE_H = 320;
const DRAW_SCALE = 3; // manifest.layoutA_screenPx 좌표계 기준(네이티브 180x320의 3배 = 540x960).
const BASIS_W = 540;
const BASIS_H = 960;
const ASSET_SCALE = 2; // assets/ui/menu/manifest.json drawScale - 1배 파일을 화면 2배로.

const COLORS = {
  outline: '#0d0a10',
  bone: '#e8dcc0',
  bg2: '#3b3347',
  bg3: '#655a74',
  gold: '#c28a20',
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

// 재화 바 내부(바 왼쪽 위 기준). 아이콘은 16x16(화면 32), 숫자 칸은 inset 9-slice.
const BAR_ITEMS = [
  { icon: 'icons/gold.png', iconX: 18, boxX: 50, boxW: 72, key: 'gold' },
  { icon: 'icons/diamond.png', iconX: 132, boxX: 162, boxW: 62, key: 'diamonds' },
];
const BAR_BOX_Y = 14;
const BAR_BOX_H = 28;

const POPUP_SIZES = {
  mode: [400, 330],
  settings: [400, 440],
  shop: [480, 700],
  attendance: [400, 180],
  event: [400, 180],
};

// 설정 팝업 본문(카드 왼쪽 위 기준). 슬라이더 홈은 slider_track(16x8)을 가로 3-slice로 늘린다.
const SETTINGS = {
  rows: [
    { channel: 'sfx', labelKey: 'menu.settings.sfx', labelY: 101, sliderY: 130 },
    { channel: 'bgm', labelKey: 'menu.settings.bgm', labelY: 177, sliderY: 207 },
  ],
  trackX: 40,
  trackW: 280,
  valueX: 360,
  buttons: [
    { id: 'help', labelKey: 'menu.settings.help', rect: [40, 272, 320, 46] },
    { id: 'about', labelKey: 'menu.settings.about', rect: [40, 342, 320, 46] },
  ],
};
// slider_track manifest의 fill = { x: 2, y: 2, h: 4, padRight: 2 } 원본 px -> 화면 2배.
const TRACK_FILL = { x: 4, y: 4, h: 8, padRight: 4 };

// 모드 선택 팝업 본문(카드 왼쪽 위 기준).
const MODE = {
  titleY: 50,
  normal: [40, 82, 320, 68],
  competitive: [40, 182, 320, 68],
  hintY: 278,
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

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export class MainMenuScreen {
  constructor() {
    this.manifest = null;
    this.bg = null; // 정지 폴백(menu_bg.png) - 조각 시트가 오기 전까지만 쓴다.
    this.bgLayers = new LayeredBg('assets/menu');
    this._transform = null; // 최근 draw()의 {offsetX, offsetY, k} - 포인터 판정에 그대로 쓴다.
    this._assets = null; // CanvasRenderer.assets(uiImages/uiManifest) - draw()마다 받는다.

    this.popup = null; // null | 'mode' | 'settings' | 'shop' | 'attendance' | 'event'
    this._modeLockHint = false;
    this._pressed = null; // 누르고 있는 버튼 id - _pressed 그림으로 바꿔 그린다.
    this._drag = null; // 설정 슬라이더를 끌고 있는 중 - { channel, rect } | null.

    fetchJson('assets/menu/manifest.json').then((m) => {
      this.manifest = m;
      this.bgLayers.setManifest(m?.background);
    });
    loadImage('assets/menu/menu_bg.png').then((s) => {
      this.bg = s;
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

  draw(ctx, width, height, playerState, nowMs = 0, assets = null) {
    ctx.fillStyle = FALLBACK_BG;
    ctx.fillRect(0, 0, width, height);
    if (width <= 0 || height <= 0) return;

    this._assets = assets;
    const scale = Math.min(width / NATIVE_W, height / NATIVE_H);
    const offsetX = (width - NATIVE_W * scale) / 2;
    const offsetY = (height - NATIVE_H * scale) / 2;
    const k = scale / DRAW_SCALE;
    this._transform = { offsetX, offsetY, k };
    this._ak = ASSET_SCALE * k; // 에셋 1배 파일 -> 화면 배율.

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this._drawBackground(ctx, offsetX, offsetY, scale, nowMs);
    this._drawUi(ctx, playerState);
    if (this.popup) this._drawPopup(ctx, width, height);
    ctx.restore();
  }

  _drawBackground(ctx, offsetX, offsetY, scale, nowMs) {
    if (this.bgLayers.draw(ctx, offsetX, offsetY, scale, nowMs)) return;
    if (ready(this.bg)) {
      ctx.drawImage(this.bg.img, offsetX, offsetY, NATIVE_W * scale, NATIVE_H * scale);
    }
  }

  // ---- 그리기 헬퍼 (모두 basis(540x960) 좌표를 받는다) ----

  // 9-slice. 이미지/슬라이스가 없으면 false(호출부가 색 도형으로 폴백).
  _nine(ctx, path, basisRect) {
    const state = getUi(this._assets, path);
    const slice = getUiMeta(this._assets, path)?.slice;
    if (!uiReady(state) || !slice) return false;
    const r = this._toScreen(basisRect);
    drawNine(ctx, state.img, slice, r.x, r.y, r.width, r.height, this._ak);
    return true;
  }

  // 원본 크기 그대로(화면 2배)인 고정 이미지. (bx, by) = 왼쪽 위 basis 좌표.
  _sprite(ctx, path, bx, by, alpha = 1) {
    const state = getUi(this._assets, path);
    if (!uiReady(state)) return false;
    const { offsetX, offsetY, k } = this._transform;
    if (alpha !== 1) ctx.globalAlpha = alpha;
    ctx.drawImage(state.img, offsetX + bx * k, offsetY + by * k, state.img.width * this._ak, state.img.height * this._ak);
    if (alpha !== 1) ctx.globalAlpha = 1;
    return true;
  }

  // sizePx = basis 기준 글자 크기(540x960에서의 px). y는 글자 가운데.
  _text(ctx, text, bx, by, { size = 11, color = COLORS.bone, align = 'left', outline = true } = {}) {
    const { offsetX, offsetY, k } = this._transform;
    ctx.font = getFontString(size * k);
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    drawText(ctx, text, offsetX + bx * k, offsetY + by * k, { outline, outlineColor: COLORS.outline, outlineWidth: Math.max(1, 1.5 * k) });
  }

  // basis 좌표계에서 잰 글자 폭(아이콘과 함께 가운데 정렬할 때 쓴다).
  _measure(ctx, text, size) {
    const { k } = this._transform;
    ctx.font = getFontString(size * k);
    return ctx.measureText(text).width / k;
  }

  // 에셋이 아직 없을 때의 폴백 도형(로딩 중/파일 누락) - 자리와 터치 영역은 그대로 보인다.
  _panel(ctx, basisRect, bg, border) {
    const r = this._toScreen(basisRect);
    ctx.fillStyle = COLORS.outline;
    ctx.fillRect(r.x, r.y, r.width, r.height);
    const inset = Math.max(1, Math.min(r.width, r.height) * 0.04);
    ctx.fillStyle = bg;
    ctx.fillRect(r.x + inset, r.y + inset, r.width - inset * 2, r.height - inset * 2);
    ctx.strokeStyle = border;
    ctx.lineWidth = Math.max(1, inset);
    ctx.strokeRect(r.x + inset * 1.5, r.y + inset * 1.5, r.width - inset * 3, r.height - inset * 3);
  }

  // ---- 메뉴 본체 ----

  _drawUi(ctx, playerState) {
    const layout = this._layout();
    this._drawCurrencyBar(ctx, playerState);
    // 출석/이벤트는 받을 보상이 있다고 보고 배지를 띄운다(보상 상태가 생기면 여기에 연결).
    this._drawIconButton(ctx, 'attendance', layout.attendance, COLORS.gold, true);
    this._drawIconButton(ctx, 'event', layout.event, COLORS.purple, true);
    this._drawIconButton(ctx, 'settings', layout.settings, COLORS.bg3, false);
    this._drawIconButton(ctx, 'shop', layout.shop, COLORS.blue, false);
    this._drawPlayButton(ctx);
  }

  _drawCurrencyBar(ctx, playerState) {
    const bar = this._layout().currencyBar;
    if (!this._nine(ctx, 'menu/plate.png', bar)) this._panel(ctx, bar, COLORS.bg2, COLORS.bg3);

    const [bx, by, , bh] = bar;
    const midY = by + bh / 2;
    for (const item of BAR_ITEMS) {
      this._sprite(ctx, item.icon, bx + item.iconX, midY - 16);
      this._nine(ctx, 'menu/inset.png', [bx + item.boxX, by + BAR_BOX_Y, item.boxW, BAR_BOX_H]);
      const value = Number(playerState?.[item.key] ?? 0);
      this._text(ctx, value.toLocaleString('en-US'), bx + item.boxX + item.boxW - 5, midY, { align: 'right' });
    }
  }

  _drawIconButton(ctx, id, basisRect, fallbackBorder, badge) {
    const suffix = this._pressed === id ? '_pressed' : '';
    if (!this._sprite(ctx, `menu/btn_${id}${suffix}.png`, basisRect[0], basisRect[1])) {
      this._panel(ctx, basisRect, COLORS.bg2, fallbackBorder);
      this._text(ctx, t(`menu.icon.${id}`), basisRect[0] + basisRect[2] / 2, basisRect[1] + basisRect[3] / 2, { size: 10, align: 'center' });
    }
    // badge는 버튼 오른쪽 위로 (+36, -4) 화면 px (assets/ui/menu/README.md).
    if (badge) this._sprite(ctx, 'menu/badge.png', basisRect[0] + 36, basisRect[1] - 4);
  }

  _drawPlayButton(ctx) {
    const rect = this._layout().playButton;
    const down = this._pressed === 'play';
    if (!this._nine(ctx, `menu/btn_play${down ? '_pressed' : ''}.png`, rect)) this._panel(ctx, rect, COLORS.gold, COLORS.yellow);

    const [x, y, w, h] = rect;
    const label = t('menu.play');
    const labelW = this._measure(ctx, label, 22);
    const glyphW = 20; // play_glyph 10x12 -> 화면 20x24
    const gap = 10;
    const startX = x + (w - (glyphW + gap + labelW)) / 2;
    const cy = y + h / 2 + (down ? 4 : 0); // 눌림: 글자/아이콘만 4px 아래로.
    this._sprite(ctx, 'menu/play_glyph.png', startX, cy - 12);
    this._text(ctx, label, startX + glyphW + gap, cy, { size: 22, color: COLORS.outline, align: 'left', outline: false });
  }

  // ---- 팝업 ----

  // 팝업 카드(basis 540x960 가운데 정렬) - 종류별로 크기가 다르다.
  _popupCardBasis() {
    const [w, h] = POPUP_SIZES[this.popup] ?? [400, 200];
    return [(BASIS_W - w) / 2, (BASIS_H - h) / 2, w, h];
  }

  // 닫기 버튼: 그림은 16x16(화면 32), 터치 영역은 44x44로 넓게.
  _closeRects(card) {
    const imgX = card[0] + card[2] - 46;
    const imgY = card[1] + 14;
    return { imgX, imgY, hit: [imgX + 16 - 22, imgY + 16 - 22, 44, 44] };
  }

  _drawPopup(ctx, width, height) {
    ctx.fillStyle = COLORS.overlay;
    ctx.fillRect(0, 0, width, height);

    const card = this._popupCardBasis();
    if (!this._nine(ctx, 'menu/popup_menu.png', card)) this._panel(ctx, card, '#221c2b', COLORS.bg3);

    const [cx, cy, cw] = card;
    // 문장(48x48)을 윗변 가운데에 반쯤 걸쳐서. 전용 문장이 없는 팝업은 설정 문장을 쓴다.
    const emblem = this.popup === 'mode' ? 'menu/emblem_mode.png' : 'menu/emblem_settings.png';
    this._sprite(ctx, emblem, cx + cw / 2 - 24, cy - 24);
    this._text(ctx, t(`menu.${this.popup}.title`), cx + cw / 2, cy + 52, { size: 22, color: COLORS.yellow, align: 'center' });

    const close = this._closeRects(card);
    this._sprite(ctx, `menu/btn_close${this._pressed === 'close' ? '_pressed' : ''}.png`, close.imgX, close.imgY);

    if (this.popup === 'mode') this._drawModePopup(ctx, card);
    else if (this.popup === 'settings') this._drawSettingsPopup(ctx, card);
    else this._drawPlaceholderPopup(ctx, card);
  }

  _drawPlaceholderPopup(ctx, [cx, cy, cw]) {
    this._text(ctx, t(`menu.${this.popup}.body`), cx + cw / 2, cy + 110, { size: 13, align: 'center' });
  }

  // 슬라이더 한 줄의 홈/채움/손잡이 위치(basis). 터치 판정과 그리기가 같은 값을 쓴다.
  _sliderGeom(card, row) {
    const x = card[0] + SETTINGS.trackX;
    const y = card[1] + row.sliderY;
    const fillX = x + TRACK_FILL.x;
    const fillMaxW = SETTINGS.trackW - TRACK_FILL.x - TRACK_FILL.padRight;
    return { x, y, w: SETTINGS.trackW, fillX, fillMaxW, hit: { x, y: y - 22, width: SETTINGS.trackW, height: 44 } };
  }

  _drawSettingsPopup(ctx, card) {
    const [cx, cy] = card;
    for (const row of SETTINGS.rows) {
      const value = clamp01(row.channel === 'bgm' ? audio.bgmVolume : audio.sfxVolume);
      const g = this._sliderGeom(card, row);
      this._text(ctx, t(row.labelKey), cx + SETTINGS.trackX, cy + row.labelY, { size: 13 });
      this._nine(ctx, 'menu/slider_track.png', [g.x, g.y - 8, g.w, 16]);

      const fill = getUi(this._assets, 'menu/slider_fill.png');
      const fillW = g.fillMaxW * value;
      if (uiReady(fill) && fillW > 0) {
        const { offsetX, offsetY, k } = this._transform;
        ctx.drawImage(fill.img, offsetX + g.fillX * k, offsetY + (g.y - 4) * k, fillW * k, TRACK_FILL.h * k);
      }
      // 손잡이(10x14 -> 화면 20x28)는 채움 끝에 가운데 맞춤.
      const dragging = this._drag?.channel === row.channel;
      this._sprite(ctx, `menu/slider_knob${dragging ? '_pressed' : ''}.png`, g.fillX + fillW - 10, g.y - 14);
      this._text(ctx, String(Math.round(value * 100)), cx + SETTINGS.valueX, g.y, { size: 13, align: 'right' });
    }

    for (const btn of SETTINGS.buttons) {
      const [bx, by, bw, bh] = btn.rect;
      const down = this._pressed === btn.id;
      const rect = [cx + bx, cy + by, bw, bh];
      if (!this._nine(ctx, `buttons/btn_secondary${down ? '_pressed' : ''}.png`, rect)) this._panel(ctx, rect, COLORS.bg2, COLORS.bg3);
      this._text(ctx, t(btn.labelKey), cx + bx + bw / 2, cy + by + bh / 2 + (down ? 2 : 0), { size: 15, align: 'center' });
    }
  }

  _drawModePopup(ctx, card) {
    const [cx, cy] = card;
    const normal = MODE.normal;
    const comp = MODE.competitive;

    const down = this._pressed === 'modeNormal';
    const nRect = [cx + normal[0], cy + normal[1], normal[2], normal[3]];
    if (!this._nine(ctx, `menu/mode_normal${down ? '_pressed' : ''}.png`, nRect)) this._panel(ctx, nRect, COLORS.purple, COLORS.yellow);
    this._sprite(ctx, 'menu/icon_mode_normal.png', nRect[0] + 12, nRect[1] + nRect[3] / 2 - 20);
    this._text(ctx, t('menu.mode.normal'), nRect[0] + 70, nRect[1] + nRect[3] / 2, { size: 22 });

    const cRect = [cx + comp[0], cy + comp[1], comp[2], comp[3]];
    if (!this._nine(ctx, 'menu/mode_locked.png', cRect)) this._panel(ctx, cRect, COLORS.bg2, COLORS.bg3);
    this._sprite(ctx, 'menu/icon_mode_competitive.png', cRect[0] + 12, cRect[1] + cRect[3] / 2 - 20, 0.45);
    this._text(ctx, t('menu.mode.competitive'), cRect[0] + 70, cRect[1] + cRect[3] / 2, { size: 22, color: COLORS.bg3 });
    this._sprite(ctx, 'icons/lock.png', cRect[0] + cRect[2] - 40, cRect[1] + cRect[3] / 2 - 12);

    if (this._modeLockHint) {
      this._text(ctx, t('menu.mode.locked'), cx + card[2] / 2, cy + MODE.hintY, { size: 13, color: COLORS.redLight, align: 'center' });
    }
  }

  // ---- 입력 ----

  // main.js가 pointerdown마다 호출한다. 'startNormalGame'을 돌려주면 game scene으로 넘어간다.
  handlePointerDown(x, y) {
    if (!this._transform) return null;

    if (this.popup) return this._handlePopupPointerDown(x, y);

    const layout = this._layout();
    if (pointInRect(x, y, this._toScreen(layout.playButton))) {
      this._pressed = 'play';
      this.popup = 'mode';
      this._modeLockHint = false;
      return null;
    }
    for (const id of ['attendance', 'event', 'settings', 'shop']) {
      if (!pointInRect(x, y, this._toScreen(layout[id]))) continue;
      this._pressed = id;
      this.popup = id;
      return null;
    }
    return null;
  }

  _handlePopupPointerDown(x, y) {
    const card = this._popupCardBasis();
    if (pointInRect(x, y, this._toScreen(this._closeRects(card).hit))) {
      this._pressed = 'close';
      this.popup = null;
      return null;
    }

    if (this.popup === 'settings') {
      for (const row of SETTINGS.rows) {
        const g = this._sliderGeom(card, row);
        if (!pointInRect(x, y, this._toScreen([g.hit.x, g.hit.y, g.hit.width, g.hit.height]))) continue;
        this._drag = { channel: row.channel, geom: g };
        this._applySliderAt(x, g);
        audio.play('gem_select');
        return null;
      }
      for (const btn of SETTINGS.buttons) {
        const rect = [card[0] + btn.rect[0], card[1] + btn.rect[1], btn.rect[2], btn.rect[3]];
        if (pointInRect(x, y, this._toScreen(rect))) {
          this._pressed = btn.id; // 도움말/게임 정보 화면은 아직 없다 - 눌림 표시만.
          return null;
        }
      }
    }

    if (this.popup === 'mode') {
      const nRect = [card[0] + MODE.normal[0], card[1] + MODE.normal[1], MODE.normal[2], MODE.normal[3]];
      if (pointInRect(x, y, this._toScreen(nRect))) {
        this._pressed = 'modeNormal';
        this.popup = null;
        return 'startNormalGame';
      }
      const cRect = [card[0] + MODE.competitive[0], card[1] + MODE.competitive[1], MODE.competitive[2], MODE.competitive[3]];
      if (pointInRect(x, y, this._toScreen(cRect))) {
        this._modeLockHint = true;
        return null;
      }
    }

    if (!pointInRect(x, y, this._toScreen(card))) this.popup = null; // 카드 바깥(오버레이) 탭 = 닫기.
    return null;
  }

  _applySliderAt(x, geom) {
    const { offsetX, k } = this._transform;
    const fillX = offsetX + geom.fillX * k;
    audio.setVolume(this._drag.channel, clamp01((x - fillX) / (geom.fillMaxW * k)));
  }

  handlePointerMove(x) {
    if (!this._drag || !this._transform) return;
    this._applySliderAt(x, this._drag.geom);
  }

  handlePointerUp() {
    this._pressed = null;
    this._drag = null;
  }
}
