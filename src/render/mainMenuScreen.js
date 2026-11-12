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
import { drawText, drawNine, getUi, getUiMeta, uiReady, pressButton } from './uiKit.js';
import { t, getLocale, setLocale, LOCALE_IDS } from '../config/i18n.js';
import { storage } from '../platform/storage.js';
import { audio } from '../audio/AudioManager.js';
import { HUD_CONFIG } from '../config/hud.js';
import { GAME_INFO } from '../config/gameInfo.js';
import { platform } from '../platform/index.js';
import { haptics } from '../platform/haptics.js';
import { drawImageSnapped, screen } from './screenFit.js';

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
  dim: '#a59cb2', // 보조 글자(characters.hex)
  overlay: 'rgba(13, 10, 16, 0.75)',
  title: '#ffe14a', // 메뉴 팝업 제목(인게임 HUD 제목 #f2d264와 다름).
};

const DEFAULT_LAYOUT = {
  currencyBar: [154, 28, 232, 56],
  attendance: [20, 28, 48, 48],
  event: [20, 92, 48, 48],
  mail: [20, 156, 48, 48], // assets/ui/menu/manifest.json layoutA_screenPx - assets/menu/manifest.json엔 아직 없다.
  settings: [472, 28, 48, 48],
  shop: [472, 92, 48, 48],
  playButton: [90, 760, 360, 64],
};
// 신단 받침대 = 보관함 입구(manifest.altarInventory). 떠 있는 결정(crystalReserved) = 랭킹 입구(docs/ranking.md 2장).
const DEFAULT_ALTAR = { hitArea_screenPx: [174, 510, 192, 174], plate_screenPx: [214, 648, 112, 36], crystalReserved_screenPx: [204, 270, 132, 234] };
// 랭킹 이름판 - 원석 영역 아래쪽(목업 mockups/ranking 시안 1). 받침대 영역과 겹치지 않는다.
const RANKING_PLATE = [214, 466, 112, 36];

// 재화 바 내부(바 왼쪽 위 기준). 아이콘은 16x16(화면 32), 숫자 칸은 inset 9-slice.
const BAR_ITEMS = [
  { icon: 'icons/gold.png', iconX: 18, boxX: 50, boxW: 72, key: 'gold' },
  { icon: 'icons/diamond.png', iconX: 132, boxX: 162, boxW: 62, key: 'diamonds' },
];
const BAR_BOX_Y = 14;
const BAR_BOX_H = 28;

const POPUP_SIZES = {
  mode: [400, 330],
  settings: [400, 496],
  help: [480, 820],
  about: [480, 820],
  attendance: [400, 180], // 서버가 켜져 있으면 ATT 높이(_popupCardBasis)
  event: [520, 640], // 폭 520 = 360dp 폰에서 320dp 배너(basis 480)+여백이 들어가게. 이벤트 목록은 스크롤, 광고 칸은 아래 고정.
  mail: [400, 180],
  exit: [400, 240],
};
// 이벤트 팝업 광고 칸(docs/ads.md 3장): 안내 문구 아래 "광고" 라벨 + 테두리 칸. 칸 = 320x50dp 배너가 들어갈 basis 크기 + 여백 pad.
// 칸 양옆·바로 위에는 버튼을 두지 않는다(AdMob: 버튼 옆 배너 금지) - 닫기 버튼(오른쪽 위)과는 100 이상 떨어져 있다.
// 칸은 카드 아랫변에서 bottom만큼 위, 라벨은 칸 위 labelGap.
const EVENT_AD = { labelGap: 12, pad: 4, bottom: 24, bannerW: 320, bannerH: 50, minCanvasCss: 340 };
// 이벤트 목록(배너 줄) - viewY부터 광고 라벨 위 gap까지 보이고 그 안에서 스크롤.
const EVENT_LIST = { viewY: 84, side: 24, gap: 20, rowH: 110, rowGap: 12 };
// 진동 토글 줄(진동을 지원하는 기기에서만 설정 팝업 맨 아래에 붙는다 - 팝업도 그만큼 길어진다).
const HAPTICS_BUTTON = { id: 'haptics', rect: [40, 468, 320, 46] };
const HAPTICS_EXTRA_H = 56;
// 종료 확인(뒤로가기 - 메뉴에서). 카드 왼쪽 위 기준.
const EXIT = { bodyY: 110, cancel: [40, 160, 150, 46], ok: [210, 160, 150, 46] };

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
    { id: 'mute', labelKey: 'menu.settings.mute', rect: [40, 244, 320, 46] },
    { id: 'help', labelKey: 'menu.settings.help', rect: [40, 300, 320, 46] },
    { id: 'about', labelKey: 'menu.settings.about', rect: [40, 356, 320, 46] },
    { id: 'language', labelKey: 'menu.settings.language', rect: [40, 412, 320, 46] },
  ],
};
// 도움말 팝업(카드 왼쪽 위 기준, 카드 480x820). 본문은 locale의 menu.help.pages(쪽마다 { title, image?, body: [문단] }).
// image = assets/ui/help/<이름>.png(tools/make_help_images.py로 만든 설명 그림, 원본 1px = 화면 2px).
// 튜토리얼 다시 보기 버튼은 docs/tutorial.md 5장대로 도움말 화면에 둔다.
const HELP = {
  headY: 100,
  bodyX: 30,
  bodyY: 134,
  bodyW: 420,
  lineH: 27,
  paraGap: 10,
  textSize: 14,
  imageScale: 2,
  imageGap: 24, // 그림 아래 ~ 첫 줄 가운데
  prev: [30, 690, 130, 46],
  next: [320, 690, 130, 46],
  replay: [30, 750, 420, 46],
};

// 게임 정보 팝업(카드 왼쪽 위 기준, 카드 480x820). 본문은 locale menu.about.body 한 쪽을 위아래로 스크롤한다.
const ABOUT = { viewY: 84, viewBottom: 790, bodyX: 30, bodyW: 420, textSize: 13, lineH: 24, headSize: 16, headH: 40, linkH: 48, link: [90, 4, 300, 38] };
// 본문 줄 높이: 소제목 / 링크 버튼({ link } - 누르면 GAME_INFO.links[link]를 새 창으로) / 문단.
const aboutLineH = (l) => (l.head ? ABOUT.headH : l.link ? ABOUT.linkH : ABOUT.lineH);
// 서버가 켜져 있으면 게임 정보 아래에 플레이어 코드(길게 누르면 복사)와 데이터 삭제 요청 버튼(docs/server.md §10, §14-3).
const ABOUT_NET = { viewBottom: 680, code: [30, 692, 420, 40], del: [90, 744, 300, 46] };

// 출석(7일판) - 카드 왼쪽 위 기준. 1줄 4칸 + 2줄 3칸, 아래 받기 버튼.
const ATT = { cellW: 80, cellH: 100, gap: 8, rowY: [92, 200], claim: [100, 318, 200, 50] };
// 우편함 - 한 줄 = 제목 + 보상 + 받기 버튼.
// shortcut: 스크롤 없이 최근 MAIL.rows통만 보임 - 전체 우편을 처음 보내기 전에 스크롤 추가(쑹 2026-11-09).
const MAIL = { y: 92, rowH: 72, rows: 6, claim: [272, 10, 92, 44] };
const PLACEHOLDER = '#5a5266'; // 아이템 아이콘이 아직 안 불렸을 때 자리
const TOAST = { y: 730, ms: 3000 };

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
    // 종료 확인 모달 종류: 'app' = 메뉴에서 앱 종료, 'floor' = 전투(층 클리어·패배 정비 팝업)에서 마을로.
    this.exitKind = 'app';
    this._transform = null; // 최근 draw()의 {offsetX, offsetY, k} - 포인터 판정에 그대로 쓴다.
    this._assets = null; // CanvasRenderer.assets(uiImages/uiManifest) - draw()마다 받는다.

    this.popup = null; // null | 'mode' | 'settings' | 'help' | 'about' | 'attendance' | 'event' | 'mail' | 'exit' (보관함은 main.js의 정비 팝업)
    this._modeLockHint = false;
    this._pressed = null; // 누르고 있는 버튼 id - _pressed 그림으로 바꿔 그린다.
    this._drag = null; // 설정 슬라이더를 끌고 있는 중 - { channel, rect } | null.
    this._helpPage = 0;
    this._helpWrap = null; // { key, lines } - 쪽·배율·언어가 같으면 줄바꿈 결과를 다시 쓴다.
    this._aboutScroll = 0; // 게임 정보 본문 스크롤(basis px).
    this._eventScroll = 0; // 이벤트 목록 스크롤(basis px).
    // 이벤트 목록 [{ id, title: { ko, en } }] - 이벤트 API가 생기면 main.js가 채운다(docs/server.md §19-11).
    this.events = [];
    this._aboutWrap = null; // { key, lines } - 배율·언어가 같으면 줄바꿈 결과를 다시 쓴다.
    this._helpImages = {}; // 이름 -> 로드 상태(도움말을 처음 열 때 그 쪽 그림만 불러온다).
    this.mailBadge = () => false; // main.js: 서버가 켜져 있으면 "안 받은 우편 있음"
    this.attendanceBadge = () => true; // main.js: 서버가 켜져 있으면 "오늘 받을 수 있음"
    // 서버(출석·우편·플레이어 코드) - main.js가 채운다. null = 서버 꺼짐(출석·우편은 예전 자리 팝업).
    // { att: { status, busy } | null, mail: { list, reason, busy } | null, playerCode: () => string|null } - 기능 스위치가 꺼진 것은 null
    this.server = null;
    this.aboutNotice = null; // { key, until } 플레이어 코드 줄에 잠깐 띄우는 글(복사했어요 등)
    this.popupAd = () => false; // main.js: 이벤트 팝업에 광고 칸을 그릴지(caps.popupBanner + 광고 제거 없음)
    this.popupAdDebug = () => false; // main.js: 테스트 광고면 배너 목표 위치 테두리(실기기 위치 확인용)
    this.itemIcons = () => null; // main.js: renderer.itemAssets.icons(아이템 팩, 하단 바와 같은 그림)
    this._toast = null; // { text, until } 메뉴 한 줄 알림 - until은 메뉴에 처음 그려질 때 정한다
    this.rankingBadge = () => false; // main.js가 랭킹 서비스에 연결(받기 전 시즌 보상이 있으면 빨간 점)

    fetchJson('assets/menu/manifest.json').then((m) => {
      this.manifest = m;
      // 받침대 반복 조각은 배경 조각과 같은 시계·규칙이라 pieces 끝에 붙인다(배경 조각 다음, sparks 전).
      const idle = m?.altarInventory?.idle;
      if (idle && m.background) m.background.pieces = [...(m.background.pieces ?? []), idle];
      this.bgLayers.setManifest(m?.background);
    });
    loadImage('assets/menu/menu_bg.png').then((s) => {
      this.bg = s;
    });
  }

  _layout() {
    return { ...DEFAULT_LAYOUT, ...this.manifest?.layoutA_screenPx };
  }

  _altar() {
    return this.manifest?.altarInventory ?? DEFAULT_ALTAR;
  }

  _crystal() {
    return this._altar().crystalReserved_screenPx ?? DEFAULT_ALTAR.crystalReserved_screenPx;
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
    const { offsetX, offsetY, scale } = this._setTransform(width, height);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this._drawBackground(ctx, offsetX, offsetY, scale, nowMs);
    this._drawUi(ctx, playerState);
    this._drawToast(ctx, nowMs);
    if (this.popup) this._drawPopup(ctx, width, height);
    ctx.restore();
  }

  // 메뉴 한 줄 알림(예: 받지 못한 보상 복구). 타이틀에서 불려도 메뉴가 보일 때부터 TOAST.ms 동안.
  showToast(text) {
    this._toast = { text, until: null };
  }

  _drawToast(ctx, nowMs) {
    const tt = this._toast;
    if (!tt) return;
    tt.until ??= nowMs + TOAST.ms;
    if (nowMs >= tt.until) {
      this._toast = null;
      return;
    }
    this._text(ctx, tt.text, BASIS_W / 2, TOAST.y, { size: 15, align: 'center', color: COLORS.title });
  }

  // 메뉴 밖(전투 scene)에서 종료 확인 모달만 위에 덮어 그린다 - 입력도 같은 handlePointerDown으로 받는다.
  drawPopupOnly(ctx, width, height, assets = null) {
    if (!this.popup || width <= 0 || height <= 0) return;
    this._assets = assets;
    this._setTransform(width, height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    this._drawPopup(ctx, width, height);
    ctx.restore();
  }

  _setTransform(width, height) {
    const scale = Math.min(width / NATIVE_W, height / NATIVE_H);
    const offsetX = (width - NATIVE_W * scale) / 2;
    const offsetY = (height - NATIVE_H * scale) / 2;
    const k = scale / DRAW_SCALE;
    this._transform = { offsetX, offsetY, k };
    this._ak = ASSET_SCALE * k; // 에셋 1배 파일 -> 화면 배율.
    return { offsetX, offsetY, scale };
  }

  _drawBackground(ctx, offsetX, offsetY, scale, nowMs) {
    if (this.bgLayers.draw(ctx, offsetX, offsetY, scale, nowMs)) return;
    if (ready(this.bg)) {
      drawImageSnapped(ctx, this.bg.img, offsetX, offsetY, NATIVE_W * scale, NATIVE_H * scale);
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
    drawImageSnapped(ctx, state.img, offsetX + bx * k, offsetY + by * k, state.img.width * this._ak, state.img.height * this._ak);
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
    // 이벤트는 받을 보상이 있다고 보고 배지를 띄운다(보상 상태가 생기면 여기에 연결).
    this._drawIconButton(ctx, 'attendance', layout.attendance, COLORS.gold, this.attendanceBadge());
    this._drawIconButton(ctx, 'event', layout.event, COLORS.purple, true);
    this._drawIconButton(ctx, 'mail', layout.mail, COLORS.bone, this.mailBadge());
    this._drawIconButton(ctx, 'settings', layout.settings, COLORS.bg3, false);
    this._drawIconButton(ctx, 'shop', layout.shop, COLORS.blue, false);
    this._drawPlayButton(ctx);
    this._drawAltarPlate(ctx, playerState);
    this._drawRankingPlate(ctx);
  }

  // 원석 아래 이름판 "랭킹" + 빨간 점(받기 전 시즌 보상). 보관함 이름판과 같은 모양·글자·눌림(1px).
  _drawRankingPlate(ctx) {
    const [x, y0, w, h] = RANKING_PLATE;
    const y = y0 + (this._pressed === 'crystal' ? 1 : 0);
    if (!this._nine(ctx, 'menu/plate.png', [x, y, w, h])) this._panel(ctx, [x, y, w, h], COLORS.bg2, COLORS.bg3);
    this._text(ctx, t('menu.ranking'), x + w / 2, y + h / 2, { size: 18, align: 'center' });
    if (this.rankingBadge()) this._sprite(ctx, 'menu/badge.png', x + w - 10, y0 - 6);
  }

  // 받침대 이름판 "보관함" + 빨간 점(새 아이템 / 빈 칸에 넣을 아이템). 누르는 동안 이름판만 1px 아래로.
  _drawAltarPlate(ctx, playerState) {
    const [x, y0, w, h] = this._altar().plate_screenPx;
    const y = y0 + (this._pressed === 'altar' ? 1 : 0);
    if (!this._nine(ctx, 'menu/plate.png', [x, y, w, h])) this._panel(ctx, [x, y, w, h], COLORS.bg2, COLORS.bg3);
    this._text(ctx, t('menu.inventory'), x + w / 2, y + h / 2, { size: 18, align: 'center' });
    const inv = playerState?.inventory;
    const floor = playerState?.bestFloor ?? 1;
    if (inv && (inv.hasUnseenItems(floor) || inv.hasFillableSlot(floor))) this._sprite(ctx, 'menu/badge.png', x + w - 10, y0 - 6);
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
    if (!this._nine(ctx, `menu/btn_play${down ? '_pressed' : ''}.png`, rect)) this._panel(ctx, rect, COLORS.gold, HUD_CONFIG.text.title);

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
    const [w, h0] = POPUP_SIZES[this.popup] ?? [400, 200];
    let h = this.popup === 'settings' && platform.caps.haptics ? h0 + HAPTICS_EXTRA_H : h0;
    if (this.server?.att && this.popup === 'attendance') h = ATT.claim[1] + ATT.claim[3] + 32;
    if (this.server?.mail && this.popup === 'mail') h = MAIL.y + MAIL.rows * MAIL.rowH + 24;
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
    ctx.fillRect(screen.full.x, screen.full.y, screen.full.width, screen.full.height); // 블리드까지

    const card = this._popupCardBasis();
    if (!this._nine(ctx, 'menu/popup_menu.png', card)) this._panel(ctx, card, '#221c2b', COLORS.bg3);

    const [cx, cy, cw] = card;
    // 문장(48x48)을 윗변 가운데에 반쯤 걸쳐서. 전용 문장이 없는 팝업은 설정 문장을 쓴다. 제목은 금색 #f2d264.
    this._sprite(ctx, this.popup === 'mode' ? 'menu/emblem_mode.png' : 'menu/emblem_settings.png', cx + cw / 2 - 24, cy - 24);
    const title = t(`menu.${this._popupKey()}.title`);
    this._text(ctx, title, cx + cw / 2, cy + 52, { size: 22, color: COLORS.title, align: 'center' });

    const close = this._closeRects(card);
    this._sprite(ctx, `menu/btn_close${this._pressed === 'close' ? '_pressed' : ''}.png`, close.imgX, close.imgY);

    if (this.popup === 'mode') this._drawModePopup(ctx, card);
    else if (this.popup === 'settings') this._drawSettingsPopup(ctx, card);
    else if (this.popup === 'help') this._drawHelpPopup(ctx, card);
    else if (this.popup === 'about') this._drawAboutPopup(ctx, card);
    else if (this.popup === 'exit') this._drawExitPopup(ctx, card);
    else if (this.popup === 'attendance' && this.server?.att) this._drawAttendancePopup(ctx, card);
    else if (this.popup === 'mail' && this.server?.mail) this._drawMailPopup(ctx, card);
    else this._drawPlaceholderPopup(ctx, card);
  }

  // ---- 서버 팝업(출석·우편) ----

  // 서버 응답 상태 한 줄(불러오는 중 / 연결이 필요해요 / 잠시 후 다시). 그린 게 있으면 true.
  _drawNetState(ctx, [cx, cy, cw], loaded, reason) {
    if (loaded && !reason) return false;
    const key = !loaded ? 'net.loading' : reason === 'offline' ? 'net.needNet' : 'net.error';
    this._text(ctx, t(key), cx + cw / 2, cy + 160, { size: 15, align: 'center' });
    return true;
  }

  // 보상 묶음 -> 줄 목록 ['다이아 10', '무지개 1'].
  _bundleLines(b) {
    const out = [];
    if (b?.gold) out.push(`${t('reward.gold')} ${b.gold}`);
    if (b?.diamonds) out.push(`${t('reward.diamonds')} ${b.diamonds}`);
    for (const [id, n] of Object.entries(b?.items ?? {})) out.push(`${t(`item.name.${id}`)} ${n}`);
    return out;
  }

  // 보상 아이콘(32x32 자리): 골드·다이아는 UI 팩, 아이템은 아이템 팩(14x14 -> x2, 가운데). 못 그리면 회색 자리.
  _bundleIcon(ctx, b, bx, by) {
    const icon = b?.diamonds ? 'icons/diamond.png' : b?.gold ? 'icons/gold.png' : null;
    if (icon && this._sprite(ctx, icon, bx, by)) return;
    const st = icon ? null : this.itemIcons()?.get(Object.keys(b?.items ?? {})[0]);
    if (uiReady(st)) {
      const { offsetX, offsetY, k } = this._transform;
      const w = st.img.width * ASSET_SCALE;
      const h = st.img.height * ASSET_SCALE;
      drawImageSnapped(ctx, st.img, offsetX + (bx + (32 - w) / 2) * k, offsetY + (by + (32 - h) / 2) * k, w * k, h * k);
      return;
    }
    const r = this._toScreen([bx, by, 32, 32]);
    ctx.fillStyle = PLACEHOLDER;
    ctx.fillRect(r.x, r.y, r.width, r.height);
  }

  _attCell(card, i) {
    const row = i < 4 ? 0 : 1;
    const n = row ? 3 : 4;
    const col = row ? i - 4 : i;
    const x0 = (card[2] - (n * ATT.cellW + (n - 1) * ATT.gap)) / 2;
    return [card[0] + x0 + col * (ATT.cellW + ATT.gap), card[1] + ATT.rowY[row], ATT.cellW, ATT.cellH];
  }

  _drawAttendancePopup(ctx, card) {
    const s = this.server.att.status;
    if (this._drawNetState(ctx, card, !!s, s && !s.ok ? s.reason : null)) return;
    const todayIdx = s.claimedToday ? -1 : s.days; // 오늘 받을 칸(0부터)
    s.rewards.forEach((b, i) => {
      const r = this._attCell(card, i);
      if (!this._nine(ctx, 'panels/panel_inset.png', r)) this._panel(ctx, r, COLORS.bg2, COLORS.bg3);
      this._text(ctx, t('net.att.day', { n: i + 1 }), r[0] + r[2] / 2, r[1] + 14, { size: 11, align: 'center', color: COLORS.title });
      this._bundleIcon(ctx, b, r[0] + r[2] / 2 - 16, r[1] + 26);
      this._bundleLines(b).forEach((line, j) => this._text(ctx, line, r[0] + r[2] / 2, r[1] + 70 + j * 14, { size: 10, align: 'center' }));
      if (i < s.days) {
        const sr = this._toScreen(r);
        ctx.fillStyle = COLORS.overlay;
        ctx.fillRect(sr.x, sr.y, sr.width, sr.height);
        this._text(ctx, t('net.att.claimed'), r[0] + r[2] / 2, r[1] + r[3] / 2, { size: 15, align: 'center', color: COLORS.title });
      } else if (i === todayIdx) {
        const sr = this._toScreen(r);
        ctx.strokeStyle = COLORS.title;
        ctx.lineWidth = Math.max(2, 2 * this._transform.k);
        ctx.strokeRect(sr.x, sr.y, sr.width, sr.height);
      }
    });
    const can = !s.claimedToday && !this.server.att.busy;
    const r = [card[0] + ATT.claim[0], card[1] + ATT.claim[1], ATT.claim[2], ATT.claim[3]];
    const down = this._pressed === 'attClaim';
    const img = can ? `buttons/btn_primary${down ? '_pressed' : ''}.png` : 'buttons/btn_secondary.png';
    if (!this._nine(ctx, img, r)) this._panel(ctx, r, COLORS.bg2, COLORS.bg3);
    this._text(ctx, t(s.claimedToday ? 'net.att.tomorrow' : 'net.att.claim'), r[0] + r[2] / 2, r[1] + r[3] / 2 + (down ? 2 : 0), { size: 15, align: 'center' });
  }

  _mailRows(card) {
    const list = this.server.mail.list ?? [];
    return list.slice(0, MAIL.rows).map((m, i) => {
      const row = [card[0] + 24, card[1] + MAIL.y + i * MAIL.rowH, card[2] - 48, MAIL.rowH - 8];
      return { m, row, btn: [row[0] + MAIL.claim[0] - 24, row[1] + MAIL.claim[1], MAIL.claim[2], MAIL.claim[3]] };
    });
  }

  _drawMailPopup(ctx, card) {
    const ms = this.server.mail;
    if (this._drawNetState(ctx, card, !!ms.list, ms.list ? null : ms.reason)) return;
    if (!ms.list.length) {
      this._text(ctx, t('net.mail.empty'), card[0] + card[2] / 2, card[1] + 160, { size: 15, align: 'center' });
      return;
    }
    const loc = getLocale();
    for (const { m, row, btn } of this._mailRows(card)) {
      if (!this._nine(ctx, 'panels/panel_inset.png', row)) this._panel(ctx, row, COLORS.bg2, COLORS.bg3);
      this._text(ctx, m.title?.[loc] || m.title?.ko || '', row[0] + 12, row[1] + 20, { size: 13 });
      this._text(ctx, this._bundleLines(m.bundle).join(', '), row[0] + 12, row[1] + 44, { size: 11, color: COLORS.dim });
      const down = this._pressed === `mail:${m.id}`;
      const img = m.claimed || ms.busy ? 'buttons/btn_secondary.png' : `buttons/btn_primary${down ? '_pressed' : ''}.png`;
      if (!this._nine(ctx, img, btn)) this._panel(ctx, btn, COLORS.bg2, COLORS.bg3);
      this._text(ctx, t(m.claimed ? 'net.mail.claimed' : 'net.mail.claim'), btn[0] + btn[2] / 2, btn[1] + btn[3] / 2 + (down ? 2 : 0), { size: 13, align: 'center' });
    }
  }

  _drawPlaceholderPopup(ctx, card) {
    if (this.popup === 'event') return this._drawEventPopup(ctx, card);
    const [cx, cy, cw] = card;
    this._text(ctx, t(`menu.${this.popup}.body`), cx + cw / 2, cy + 110, { size: 13, align: 'center' });
  }

  // 이벤트 목록 보기 영역(basis) - 광고 칸이 있으면 그 라벨 위까지.
  _eventView(card) {
    const [cx, cy, cw, ch] = card;
    const bottom = this.popupAd() ? this._adSlotBasis(card)[1] - EVENT_AD.labelGap - EVENT_LIST.gap : cy + ch - EVENT_AD.bottom;
    return [cx + EVENT_LIST.side, cy + EVENT_LIST.viewY, cw - EVENT_LIST.side * 2, bottom - cy - EVENT_LIST.viewY];
  }

  // 이벤트 배너 줄은 보기 영역 안에서만 스크롤되고, 광고 칸은 그 아래 제자리(배너 좌표가 스크롤과 무관).
  _drawEventPopup(ctx, card) {
    const view = this._eventView(card);
    const list = this.events;
    if (!list.length) {
      this._text(ctx, t('menu.event.body'), view[0] + view[2] / 2, view[1] + view[3] / 2, { size: 13, align: 'center' });
    } else {
      const step = EVENT_LIST.rowH + EVENT_LIST.rowGap;
      this._eventScroll = Math.max(0, Math.min(this._eventScroll, list.length * step - EVENT_LIST.rowGap - view[3]));
      const sv = this._toScreen(view);
      ctx.save();
      ctx.beginPath();
      ctx.rect(sv.x, sv.y, sv.width, sv.height);
      ctx.clip();
      const loc = getLocale();
      for (let i = 0; i < list.length; i++) {
        const y = view[1] + i * step - this._eventScroll;
        if (y + EVENT_LIST.rowH < view[1] || y > view[1] + view[3]) continue;
        const row = [view[0], y, view[2], EVENT_LIST.rowH];
        // shortcut: 배너 그림 없이 제목 글자만 - 이벤트 배너 이미지가 생기면 여기서 그림을 그린다.
        if (!this._nine(ctx, 'panels/panel_inset.png', row)) this._panel(ctx, row, COLORS.bg2, COLORS.bg3);
        this._text(ctx, list[i].title?.[loc] || list[i].title?.ko || '', row[0] + row[2] / 2, y + EVENT_LIST.rowH / 2, { size: 15, align: 'center' });
      }
      ctx.restore();
    }
    if (!this.popupAd()) return;
    const [cx, , cw] = card;
    const slot = this._adSlotBasis(card);
    this._text(ctx, t('menu.event.ad'), cx + cw / 2, slot[1] - EVENT_AD.labelGap, { size: 11, align: 'center', color: '#655a74', outline: false });
    if (!this._nine(ctx, 'panels/panel_inset.png', slot)) this._panel(ctx, slot, '#221c2b', '#3b3347');
    if (this.popupAdDebug()) {
      // 배너가 뜰 자리(칸 가운데 320x50 CSS px) - 실기기에서 네이티브 배너와 어긋나는지 눈으로 비교.
      const r = this._toScreen(slot);
      ctx.strokeStyle = '#ff3df2';
      ctx.lineWidth = 1;
      ctx.strokeRect(r.x + r.width / 2 - EVENT_AD.bannerW / 2 + 0.5, r.y + r.height / 2 - EVENT_AD.bannerH / 2 + 0.5, EVENT_AD.bannerW - 1, EVENT_AD.bannerH - 1);
    }
  }

  // 광고 칸 크기(basis) - 320x50 CSS px 배너 + 여백. 폭은 카드 안(좌우 12)으로 자른다(그러면 배너는 안 띄운다).
  _adSlotSize(cardW) {
    const k = this._transform?.k ?? 1;
    return [Math.min(EVENT_AD.bannerW / k + EVENT_AD.pad * 2, cardW - 24), EVENT_AD.bannerH / k + EVENT_AD.pad * 2];
  }

  _adSlotBasis([cx, cy, cw, ch]) {
    const [w, h] = this._adSlotSize(cw);
    return [cx + (cw - w) / 2, cy + ch - EVENT_AD.bottom - h, w, h];
  }

  // 이벤트 팝업 배너를 띄울 화면 CSS px {x, y, width, height}(칸 가운데 320x50) - 배너 좌표 계산은 여기 한 곳.
  // basis -> 캔버스 좌표(_toScreen, CSS 단위라 devicePixelRatio는 이미 빠져 있음) -> 캔버스 화면 위치(getBoundingClientRect).
  // 칸이 없거나, 배너가 칸에 안 들어가거나, 화면 밖이거나, 캔버스 폭 < minCanvasCss면 null(빈 칸만).
  adBannerCss(canvas) {
    if (this.popup !== 'event' || !this.popupAd() || !this._transform) return null;
    // box = 안전 frame 사각형(CSS px, main.js가 getBoundingClientRect를 frame으로 바꿔 둠), s = 렌더 논리 px당 CSS px.
    const box = canvas.getBoundingClientRect();
    if (box.width < EVENT_AD.minCanvasCss) return null;
    const s = box.u ?? 1;
    const r = this._toScreen(this._adSlotBasis(this._popupCardBasis()));
    const { bannerW: w, bannerH: h } = EVENT_AD;
    if (r.width * s < w || r.height * s < h) return null;
    const x = Math.round(box.left + (r.x + r.width / 2) * s - w / 2);
    const y = Math.round(box.top + (r.y + r.height / 2) * s - h / 2);
    if (x < 0 || y < 0 || x + w > window.innerWidth || y + h > window.innerHeight) return null;
    return { x, y, width: w, height: h };
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
        drawImageSnapped(ctx, fill.img, offsetX + g.fillX * k, offsetY + (g.y - 4) * k, fillW * k, TRACK_FILL.h * k);
      }
      // 손잡이(10x14 -> 화면 20x28)는 채움 끝에 가운데 맞춤.
      const dragging = this._drag?.channel === row.channel;
      this._sprite(ctx, `menu/slider_knob${dragging ? '_pressed' : ''}.png`, g.fillX + fillW - 10, g.y - 14);
      this._text(ctx, String(Math.round(value * 100)), cx + SETTINGS.valueX, g.y, { size: 13, align: 'right' });
    }

    for (const btn of this._settingsButtons()) {
      const [bx, by, bw, bh] = btn.rect;
      const down = this._pressed === btn.id;
      const rect = [cx + bx, cy + by, bw, bh];
      if (!this._nine(ctx, `buttons/btn_secondary${down ? '_pressed' : ''}.png`, rect)) this._panel(ctx, rect, COLORS.bg2, COLORS.bg3);
      const label = btn.id === 'mute' && audio.muted ? 'menu.settings.unmute' : btn.id === 'haptics' ? (haptics.enabled() ? 'menu.settings.hapticsOn' : 'menu.settings.hapticsOff') : btn.labelKey;
      this._text(ctx, t(label), cx + bx + bw / 2, cy + by + bh / 2 + (down ? 2 : 0), { size: 15, align: 'center' });
    }
  }

  _settingsButtons() {
    return platform.caps.haptics ? [...SETTINGS.buttons, HAPTICS_BUTTON] : SETTINGS.buttons;
  }

  // 로케일 키 - 종료 확인은 종류(exitKind)마다 문구가 다르다.
  _popupKey() {
    if (this.popup !== 'exit') return this.popup;
    return { floor: 'quitFloor', deleteData: 'deleteData' }[this.exitKind] ?? 'exit';
  }

  _drawExitPopup(ctx, [cx, cy, cw]) {
    const key = this._popupKey();
    this._text(ctx, t(`menu.${key}.body`), cx + cw / 2, cy + EXIT.bodyY, { size: 15, align: 'center' });
    for (const [id, r] of [['exitCancel', EXIT.cancel], ['exitOk', EXIT.ok]]) {
      const down = this._pressed === id;
      const rect = [cx + r[0], cy + r[1], r[2], r[3]];
      if (!this._nine(ctx, `buttons/btn_secondary${down ? '_pressed' : ''}.png`, rect)) this._panel(ctx, rect, COLORS.bg2, COLORS.bg3);
      this._text(ctx, t(`menu.${key}.${id === 'exitOk' ? 'ok' : 'cancel'}`), rect[0] + r[2] / 2, rect[1] + r[3] / 2 + (down ? 2 : 0), { size: 15, align: 'center' });
    }
  }

  _drawHelpPopup(ctx, card) {
    const [cx, cy, cw] = card;
    const pages = t('menu.help.pages');
    if (!Array.isArray(pages) || pages.length === 0) return;
    this._helpPage = Math.min(this._helpPage, pages.length - 1);
    const page = pages[this._helpPage];
    this._text(ctx, page.title, cx + cw / 2, cy + HELP.headY, { size: 18, color: HUD_CONFIG.text.title, align: 'center' });

    let y = cy + HELP.bodyY;
    const pic = page.image ? this._helpImage(page.image) : null;
    if (pic) {
      const { offsetX, offsetY, k } = this._transform;
      const w = pic.img.width * HELP.imageScale;
      const h = pic.img.height * HELP.imageScale;
      drawImageSnapped(ctx, pic.img, offsetX + (cx + (cw - w) / 2) * k, offsetY + y * k, w * k, h * k);
      y += h + HELP.imageGap;
    }
    for (const line of this._helpLines(ctx, page)) {
      if (line === null) y += HELP.paraGap;
      else {
        this._text(ctx, line, cx + HELP.bodyX, y, { size: HELP.textSize });
        y += HELP.lineH;
      }
    }

    const last = pages.length - 1;
    this._helpButton(ctx, card, 'helpPrev', HELP.prev, t('menu.help.prev'), this._helpPage > 0);
    this._helpButton(ctx, card, 'helpNext', HELP.next, t('menu.help.next'), this._helpPage < last);
    this._text(ctx, `${this._helpPage + 1} / ${pages.length}`, cx + cw / 2, cy + HELP.prev[1] + HELP.prev[3] / 2, { size: 15, align: 'center' });
    this._helpButton(ctx, card, 'tutorialReplay', HELP.replay, t('tutorial.replay'), true);
  }

  _drawAboutPopup(ctx, card) {
    const [cx, cy, cw] = card;
    const lines = this._aboutLines(ctx);
    const bottom = this._aboutBottom();
    const viewH = bottom - ABOUT.viewY;
    let contentH = 0;
    for (const l of lines) contentH += aboutLineH(l);
    this._aboutScroll = Math.max(0, Math.min(this._aboutScroll, contentH - viewH));

    const { offsetX, offsetY, k } = this._transform;
    ctx.save();
    ctx.beginPath();
    ctx.rect(offsetX + cx * k, offsetY + (cy + ABOUT.viewY) * k, cw * k, viewH * k);
    ctx.clip();
    let y = cy + ABOUT.viewY - this._aboutScroll;
    for (const l of lines) {
      const h = aboutLineH(l);
      if (y + h > cy + ABOUT.viewY && y < cy + bottom) {
        if (l.link) {
          const b = ABOUT.link;
          this._panel(ctx, [cx + b[0], y + b[1], b[2], b[3]], COLORS.bg2, COLORS.bg3);
          this._text(ctx, l.text, cx + cw / 2, y + b[1] + b[3] / 2, { size: ABOUT.textSize, align: 'center', color: COLORS.title });
        } else if (l.head) this._text(ctx, l.head, cx + cw / 2, y + h / 2 + 4, { size: ABOUT.headSize, color: HUD_CONFIG.text.title, align: 'center' });
        else this._text(ctx, l.text, cx + ABOUT.bodyX, y + h / 2, { size: ABOUT.textSize });
      }
      y += h;
    }
    ctx.restore();
    if (this.server) this._drawAboutNet(ctx, card);
  }

  _aboutBottom() {
    return this.server ? ABOUT_NET.viewBottom : ABOUT.viewBottom;
  }

  // 플레이어 코드(서버 id 앞 8자 - 문의 대응용, 길게 누르면 복사) + 내 데이터 삭제 요청.
  _drawAboutNet(ctx, [cx, cy, cw]) {
    const code = this.server.playerCode();
    const notice = this.aboutNotice && performance.now() < this.aboutNotice.until ? t(this.aboutNotice.key) : null;
    const c = ABOUT_NET.code;
    if (!this._nine(ctx, 'panels/panel_inset.png', [cx + c[0], cy + c[1], c[2], c[3]])) this._panel(ctx, [cx + c[0], cy + c[1], c[2], c[3]], COLORS.bg2, COLORS.bg3);
    const text = notice ?? (code ? t('net.about.code', { code }) : t('net.about.noCode'));
    this._text(ctx, text, cx + cw / 2, cy + c[1] + c[3] / 2, { size: 13, align: 'center', color: notice ? COLORS.title : COLORS.bone });
    const d = ABOUT_NET.del;
    const r = [cx + d[0], cy + d[1], d[2], d[3]];
    const down = this._pressed === 'deleteData';
    if (!this._nine(ctx, `buttons/btn_danger${down ? '_pressed' : ''}.png`, r)) this._panel(ctx, r, COLORS.bg2, COLORS.redLight);
    this._text(ctx, t('net.about.delete'), r[0] + r[2] / 2, r[1] + r[3] / 2 + (down ? 2 : 0), { size: 15, align: 'center' });
  }

  // 본문을 { head } / { text } 줄 목록으로 자른다. '{versionLine}'은 GAME_INFO로 채운다.
  _aboutLines(ctx) {
    const body = t('menu.about.body');
    const key = `${this._transform.k}|${body}`;
    if (this._aboutWrap?.key === key) return this._aboutWrap.lines;
    const lines = [];
    const versionLine = t('menu.about.version', GAME_INFO);
    for (const item of Array.isArray(body) ? body : []) {
      if (typeof item === 'object') {
        lines.push(item);
        continue;
      }
      let line = '';
      for (const word of item.replace('{versionLine}', versionLine).split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && this._measure(ctx, next, ABOUT.textSize) > ABOUT.bodyW) {
          lines.push({ text: line });
          line = word;
        } else line = next;
      }
      lines.push({ text: line });
    }
    this._aboutWrap = { key, lines };
    return lines;
  }

  _openAboutLinkAt(screenY) {
    let y = this._popupCardBasis()[1] + ABOUT.viewY - this._aboutScroll;
    const by = (screenY - this._transform.offsetY) / this._transform.k;
    for (const l of this._aboutWrap?.lines ?? []) {
      const h = aboutLineH(l);
      if (l.link && by >= y && by < y + h && platform.links.open(GAME_INFO.links[l.link])) audio.play('ui_click');
      y += h;
    }
  }

  // 게임 정보가 열려 있으면 휠로 스크롤하고 true(main.js가 기본 동작을 막는다).
  handleWheel(deltaY) {
    const key = this.popup === 'about' ? '_aboutScroll' : this.popup === 'event' ? '_eventScroll' : null;
    if (!key) return false;
    this[key] += deltaY * 0.5; // 범위는 그릴 때 자른다.
    return true;
  }

  _helpImage(name) {
    if (!(name in this._helpImages)) {
      this._helpImages[name] = null;
      loadImage(`assets/ui/help/${name}.png`).then((s) => {
        this._helpImages[name] = s;
      });
    }
    const state = this._helpImages[name];
    return ready(state) ? state : null;
  }

  _helpButton(ctx, [cx, cy], id, [bx, by, bw, bh], label, enabled) {
    const down = enabled && this._pressed === id;
    const rect = [cx + bx, cy + by, bw, bh];
    if (!this._nine(ctx, `buttons/btn_secondary${down ? '_pressed' : ''}.png`, rect)) this._panel(ctx, rect, COLORS.bg2, COLORS.bg3);
    this._text(ctx, label, cx + bx + bw / 2, cy + by + bh / 2 + (down ? 2 : 0), { size: 15, align: 'center', color: enabled ? COLORS.bone : COLORS.bg3 });
  }

  // 문단을 본문 폭에 맞춰 줄로 자른다(공백 단위, 한 단어가 폭보다 길면 그 줄만 넘친다). null = 문단 사이 간격.
  _helpLines(ctx, page) {
    const key = `${this._helpPage}|${this._transform.k}|${page.title}`;
    if (this._helpWrap?.key === key) return this._helpWrap.lines;
    const lines = [];
    for (const para of page.body) {
      if (lines.length) lines.push(null);
      let line = '';
      for (const word of para.split(' ')) {
        const next = line ? `${line} ${word}` : word;
        if (line && this._measure(ctx, next, HELP.textSize) > HELP.bodyW) {
          lines.push(line);
          line = word;
        } else line = next;
      }
      lines.push(line);
    }
    this._helpWrap = { key, lines };
    return lines;
  }

  _drawModePopup(ctx, card) {
    const [cx, cy] = card;
    const normal = MODE.normal;
    const comp = MODE.competitive;

    const down = this._pressed === 'modeNormal';
    const nRect = [cx + normal[0], cy + normal[1], normal[2], normal[3]];
    if (!this._nine(ctx, `menu/mode_normal${down ? '_pressed' : ''}.png`, nRect)) this._panel(ctx, nRect, COLORS.purple, HUD_CONFIG.text.title);
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

  // main.js가 pointerdown마다 호출한다. 'startNormalGame'이면 game scene, 'openShop'이면 상점 scene으로 넘어간다.
  handlePointerDown(x, y) {
    if (!this._transform) return null;

    if (this.popup) return this._handlePopupPointerDown(x, y);

    const layout = this._layout();
    if (pressButton(x, y, this._toScreen(layout.playButton))) {
      this._pressed = 'play';
      this.popup = 'mode';
      this._modeLockHint = false;
      return null;
    }
    if (pressButton(x, y, this._toScreen(layout.shop))) {
      this._pressed = 'shop';
      return 'openShop'; // 상점은 팝업이 아니라 전체 화면 씬(src/render/shopScreen.js) - main.js가 넘어간다.
    }
    // 상단 재화 바: 골드 칸 → 골드 교환, 다이아 칸 → 다이아 탭. 경계는 두 칸(BAR_ITEMS) 사이.
    const [bx, by, bw, bh] = layout.currencyBar;
    const split = BAR_ITEMS[1].iconX - 5;
    if (pressButton(x, y, this._toScreen([bx, by, split, bh]))) return 'openShopGold';
    if (pressButton(x, y, this._toScreen([bx + split, by, bw - split, bh]))) return 'openShopDia';
    for (const id of ['attendance', 'event', 'mail', 'settings']) {
      if (!pressButton(x, y, this._toScreen(layout[id]))) continue;
      this._pressed = id;
      this.popup = id;
      this._eventScroll = 0;
      // 서버가 켜져 있으면 main.js가 출석 상태·우편 목록을 새로 받는다.
      return this.server?.[id === 'attendance' ? 'att' : id] ? `open:${id}` : null;
    }
    // 받침대·원석은 누를 때 소리·연출 없이 눌림만 - 영역 안에서 떼야 열린다(handlePointerUp). 두 영역은 안 겹친다.
    if (pointInRect(x, y, this._toScreen(this._altar().hitArea_screenPx))) this._pressed = 'altar';
    else if (pointInRect(x, y, this._toScreen(this._crystal()))) this._pressed = 'crystal';
    return null;
  }

  // 뒤로가기(main.js 핸들러 스택): 열린 팝업을 X와 같은 규칙으로 닫는다. 닫았으면 true.
  closePopup() {
    if (!this.popup) return false;
    if (this.popup === 'exit' && this.exitKind === 'deleteData') this.popup = 'about';
    else this.popup = this.popup === 'help' || this.popup === 'about' ? 'settings' : null;
    this._drag = null;
    return true;
  }

  _handlePopupPointerDown(x, y) {
    const card = this._popupCardBasis();
    if (pressButton(x, y, this._toScreen(this._closeRects(card).hit), 'cancel')) {
      this._pressed = 'close';
      this.popup = this.popup === 'help' || this.popup === 'about' ? 'settings' : null; // 도움말·게임 정보 X는 설정으로 돌아간다.
      return null;
    }

    if (this.popup === 'help') {
      const hit = (r) => this._toScreen([card[0] + r[0], card[1] + r[1], r[2], r[3]]);
      const pages = t('menu.help.pages');
      const count = Array.isArray(pages) ? pages.length : 1;
      if (this._helpPage > 0 && pressButton(x, y, hit(HELP.prev))) {
        this._pressed = 'helpPrev';
        this._helpPage--;
        return null;
      }
      if (this._helpPage < count - 1 && pressButton(x, y, hit(HELP.next))) {
        this._pressed = 'helpNext';
        this._helpPage++;
        return null;
      }
      if (pressButton(x, y, hit(HELP.replay))) {
        this.popup = null;
        return 'replayTutorial'; // main.js가 바로 튜토리얼 연습 전투로 들어간다(세이브 안 건드림).
      }
    }

    if (this.popup === 'event' && pointInRect(x, y, this._toScreen(this._eventView(card)))) {
      this._drag = { scrollFromY: y, scrollStart: this._eventScroll, key: '_eventScroll' };
      return null;
    }

    if (this.popup === 'about') {
      const view = [card[0], card[1] + ABOUT.viewY, card[2], this._aboutBottom() - ABOUT.viewY];
      if (pointInRect(x, y, this._toScreen(view))) {
        this._drag = { scrollFromY: y, scrollStart: this._aboutScroll, key: '_aboutScroll' };
        return null;
      }
      if (this.server) {
        const at = (r) => this._toScreen([card[0] + r[0], card[1] + r[1], r[2], r[3]]);
        if (pointInRect(x, y, at(ABOUT_NET.code))) return 'playerCodeDown'; // main.js: 0.5초 누르고 있으면 복사
        if (pressButton(x, y, at(ABOUT_NET.del))) {
          this._pressed = 'deleteData';
          this.exitKind = 'deleteData';
          this.popup = 'exit'; // 확인 모달(종료 확인과 같은 틀)
          return null;
        }
      }
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
      for (const btn of this._settingsButtons()) {
        const rect = [card[0] + btn.rect[0], card[1] + btn.rect[1], btn.rect[2], btn.rect[3]];
        if (pressButton(x, y, this._toScreen(rect))) {
          this._pressed = btn.id;
          if (btn.id === 'mute') audio.toggleMute();
          if (btn.id === 'haptics') haptics.setEnabled(!haptics.enabled());
          if (btn.id === 'language') {
            const next = LOCALE_IDS[(LOCALE_IDS.indexOf(getLocale()) + 1) % LOCALE_IDS.length];
            setLocale(next);
            storage.save('locale', next);
          }
          if (btn.id === 'about') {
            this.popup = 'about';
            this._aboutScroll = 0;
          }
          if (btn.id === 'help') {
            this.popup = 'help';
            this._helpPage = 0;
          }
          return null;
        }
      }
    }

    if (this.popup === 'exit') {
      const hit = (r) => this._toScreen([card[0] + r[0], card[1] + r[1], r[2], r[3]]);
      if (pressButton(x, y, hit(EXIT.cancel), 'cancel')) {
        this._pressed = 'exitCancel';
        this.popup = this.exitKind === 'deleteData' ? 'about' : null;
      } else if (pressButton(x, y, hit(EXIT.ok))) {
        this._pressed = 'exitOk';
        this.popup = this.exitKind === 'deleteData' ? 'about' : null;
        // main.js: 마을로 / me-delete / platform.lifecycle.exit()
        return { floor: 'quitFloor', deleteData: 'deleteData' }[this.exitKind] ?? 'exitApp';
      }
      return null;
    }

    if (this.popup === 'attendance' && this.server?.att) {
      const r = [card[0] + ATT.claim[0], card[1] + ATT.claim[1], ATT.claim[2], ATT.claim[3]];
      const s = this.server.att.status;
      if (s?.ok && !s.claimedToday && !this.server.att.busy && pressButton(x, y, this._toScreen(r), 'none')) {
        this._pressed = 'attClaim';
        return 'attClaim';
      }
      return null;
    }

    if (this.popup === 'mail' && this.server?.mail) {
      if (this.server.mail.busy) return null;
      for (const { m, btn } of this._mailRows(card)) {
        if (m.claimed || !pressButton(x, y, this._toScreen(btn), 'none')) continue;
        this._pressed = `mail:${m.id}`;
        return `mailClaim:${m.id}`;
      }
      return null;
    }

    if (this.popup === 'mode') {
      const nRect = [card[0] + MODE.normal[0], card[1] + MODE.normal[1], MODE.normal[2], MODE.normal[3]];
      // 전환음(ui_game_enter)은 main.js가 전환 시작과 함께 낸다.
      if (pressButton(x, y, this._toScreen(nRect), 'none')) {
        this._pressed = 'modeNormal';
        this.popup = null;
        return 'startNormalGame';
      }
      const cRect = [card[0] + MODE.competitive[0], card[1] + MODE.competitive[1], MODE.competitive[2], MODE.competitive[3]];
      if (pressButton(x, y, this._toScreen(cRect))) {
        this._modeLockHint = true;
        return null;
      }
    }

    if (!pointInRect(x, y, this._toScreen(card))) {
      this.popup = null; // 카드 바깥(오버레이) 탭 = 닫기.
      audio.play('ui_cancel');
    }
    return null;
  }

  _applySliderAt(x, geom) {
    const { offsetX, k } = this._transform;
    const fillX = offsetX + geom.fillX * k;
    audio.setVolume(this._drag.channel, clamp01((x - fillX) / (geom.fillMaxW * k)));
  }

  handlePointerMove(x, y) {
    if (!this._drag || !this._transform) return;
    if (this._drag.scrollFromY != null) this[this._drag.key] = this._drag.scrollStart - (y - this._drag.scrollFromY) / this._transform.k;
    else this._applySliderAt(x, this._drag.geom);
  }

  // (x, y)가 없으면(pointercancel) 누름만 푼다. 받침대를 영역 안에서 떼면 'openInventory'(main.js가 정비 팝업을 연다),
  // 원석이면 'openRanking'(main.js가 랭킹 팝업을 연다).
  handlePointerUp(x, y) {
    const up = this._transform && x != null;
    const altar = up && this._pressed === 'altar' && pointInRect(x, y, this._toScreen(this._altar().hitArea_screenPx));
    const crystal = up && this._pressed === 'crystal' && pointInRect(x, y, this._toScreen(this._crystal()));
    // 게임 정보 본문을 끌지 않고 뗐으면(탭) 그 자리의 링크 버튼을 연다.
    const d = this._drag;
    if (up && this.popup === 'about' && d?.key === '_aboutScroll' && Math.abs(y - d.scrollFromY) < 8 * this._transform.k) this._openAboutLinkAt(y);
    this._pressed = null;
    this._drag = null;
    if (!altar && !crystal) return null;
    audio.play('ui_click');
    return altar ? 'openInventory' : 'openRanking';
  }
}
