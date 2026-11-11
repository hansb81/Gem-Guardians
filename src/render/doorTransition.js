// 타이틀 -> 메인 메뉴 "문 열림" 전환(assets/title/door_transition_spec.md, 총 1.6초).
// 문 안쪽 금빛과 문짝 회전은 오프스크린 캔버스에 네이티브 180x320 1배로 그린 뒤 한 번에
// 확대해 붙인다 - 디더 패턴이 배경과 같은 픽셀 격자에 맞고, 매 프레임 fillRect 수천 번도
// 피할 수 있다. 문이 다 열리면 메인 메뉴로 페이드 아웃한다(빛 퍼짐 연출 없음).
// 시간 상수는 전부 전환 시작 후 ms.
import { loadImage } from './assetLoader.js';
import { drawImageSnapped } from './screenFit.js';

export const DOOR_TRANSITION_MS = 1600;

const NATIVE_W = 180;
const NATIVE_H = 320;
// 문 아치: (70,132)-(110,236), 윗부분 반지름 20 (spec "구현 메모").
const DOOR = { x: 70, y: 132, w: 40, h: 104, cx: 90, cy: 190, archR: 20 };

const T = {
  ui: [0, 300], // 로고/부제/터치 글자 페이드아웃
  glow: [0, 350], // 문 안쪽 금빛
  leaves: [350, 1100], // 문짝 회전
  menu: [1100, 1600], // 메인 메뉴 페이드
};
const GLOW = ['#7a5212', '#c28a20', '#f2d264'];
// 금빛이 차오르는 3단계: [색, 시작, 끝, 최대 덮는 비율].
const GLOW_STAGES = [
  [GLOW[0], 0, 0.45, 1],
  [GLOW[1], 0.3, 0.8, 1],
  [GLOW[2], 0.6, 1, 0.85],
];
// 문짝 역광: 경첩(0)에서 자유 끝(1)으로 갈수록 어두워진다.
const BACKLIGHT = [
  ['#655a74', 0.25],
  ['#3b3347', 0.45],
  ['#221c2b', 0.65],
  ['#0d0a10', 0.85],
];
const EDGE_COLORS = ['#e8dcc0', '#f2d264']; // 자유 끝 세로줄(픽셀마다 번갈아)
const LEAF_MIN_SCALE = 0.65; // 자유 끝 세로 배율(최대 35% 줄어듦)
const MAX_ANGLE = (80 * Math.PI) / 180;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const phase = (t, [a, b]) => clamp01((t - a) / (b - a));
const easeInOut = (p) => (p < 0.5 ? 2 * p * p : 1 - 2 * (1 - p) * (1 - p));

export const uiFadeAlpha = (elapsed) => 1 - phase(elapsed, T.ui);
export const menuFadeAlpha = (elapsed) => easeInOut(phase(elapsed, T.menu));

// 3x3 분산 디더. coverage(0~1)를 9단계로 양자화한 타일을 캐시해 패턴으로 재사용한다
// (셀 크기가 네이티브용 1px과 화면용 3px로 갈려 있어 키가 섞이지 않는다).
const BAYER3 = [0, 7, 3, 6, 5, 2, 4, 1, 8];
const patternCache = new Map();
function ditherPattern(ctx, color, coverage, cell) {
  const level = Math.round(clamp01(coverage) * 9);
  if (level <= 0) return null;
  const key = `${color}|${level}|${cell}`;
  const hit = patternCache.get(key);
  if (hit) return hit;
  const tile = document.createElement('canvas');
  tile.width = 3 * cell;
  tile.height = 3 * cell;
  const g = tile.getContext('2d');
  g.fillStyle = color;
  for (let i = 0; i < 9; i++) {
    if (BAYER3[i] < level) g.fillRect((i % 3) * cell, Math.floor(i / 3) * cell, cell, cell);
  }
  const pattern = ctx.createPattern(tile, 'repeat');
  patternCache.set(key, pattern);
  return pattern;
}

function ditherRect(ctx, color, coverage, cell, x, y, w, h) {
  const pattern = ditherPattern(ctx, color, coverage, cell);
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
}

function ready(state) {
  return !!(state && state.loaded && !state.failed);
}

export class DoorTransition {
  constructor() {
    this.left = null;
    this.right = null;
    this._canvas = null;
    loadImage('assets/title/door_leaf_left.png').then((s) => {
      this.left = s;
    });
    loadImage('assets/title/door_leaf_right.png').then((s) => {
      this.right = s;
    });
  }

  _nativeCtx() {
    if (!this._canvas) {
      this._canvas = document.createElement('canvas');
      this._canvas.width = NATIVE_W;
      this._canvas.height = NATIVE_H;
    }
    return this._canvas.getContext('2d');
  }

  // 타이틀 배경 위에 겹쳐 그린다(배경은 호출부가 이미 그린 상태).
  draw(ctx, offsetX, offsetY, scale, elapsed) {
    const g = this._nativeCtx();
    g.clearRect(0, 0, NATIVE_W, NATIVE_H);
    g.imageSmoothingEnabled = false;
    this._drawDoor(g, elapsed);
    drawImageSnapped(ctx, this._canvas, 0, 0, NATIVE_W, NATIVE_H, offsetX, offsetY, NATIVE_W * scale, NATIVE_H * scale);
  }

  _archPath(g) {
    g.beginPath();
    g.moveTo(DOOR.x, DOOR.y + DOOR.h);
    g.lineTo(DOOR.x, DOOR.y + DOOR.archR);
    g.arc(DOOR.cx, DOOR.y + DOOR.archR, DOOR.archR, Math.PI, 0);
    g.lineTo(DOOR.x + DOOR.w, DOOR.y + DOOR.h);
    g.closePath();
  }

  _glowPass(g, lit) {
    for (const [color, from, to, max] of GLOW_STAGES) {
      ditherRect(g, color, clamp01((lit - from) / (to - from)) * max, 1, DOOR.x, DOOR.y, DOOR.w, DOOR.h);
    }
  }

  _drawDoor(g, elapsed) {
    g.save();
    this._archPath(g);
    g.clip();

    const lit = phase(elapsed, T.glow);
    this._glowPass(g, lit); // 문 안쪽(문짝 뒤)

    // 회전 전(0~350ms)에는 문틈만 2px까지 벌어져 안쪽 금빛이 새어 나온다 - art/title/door_transition_preview.gif처럼
    // 문짝 자체는 어두운 채로 두고 가운데 줄만 밝아진다.
    const ajar = Math.round(2 * lit);
    const open = easeInOut(phase(elapsed, T.leaves));
    if (open < 1) {
      this._drawLeaf(g, this.left, DOOR.x, 1, open, ajar);
      this._drawLeaf(g, this.right, DOOR.x + DOOR.w - 1, -1, open, ajar);
    }
    g.restore();
  }

  // dir = +1이면 경첩이 왼쪽(hingeX에서 오른쪽으로 펴짐), -1이면 오른쪽.
  // 세로 1px 열마다 drawImage - 보이는 열 수 = 20·cos(각), 자유 끝으로 갈수록
  // 세로가 y=190으로 수렴하며 줄고(최대 35%) 역광으로 어두워진다.
  _drawLeaf(g, leaf, hingeX, dir, open, ajar) {
    if (!ready(leaf)) return;
    const cos = Math.cos(open * MAX_ANGLE);
    const cols = Math.max(0, Math.round((DOOR.w / 2) * cos) - ajar);
    if (cols <= 0) return;
    const srcW = leaf.img.naturalWidth;
    const srcH = leaf.img.naturalHeight;

    for (let i = 0; i < cols; i++) {
      const f = cols > 1 ? i / (cols - 1) : 0; // 0 = 경첩, 1 = 자유 끝
      // 경첩은 좌 문짝이면 소스 x=0, 우 문짝이면 소스 오른쪽 끝에서 시작한다.
      const srcStep = Math.min(srcW - 1, Math.floor((i + 0.5) / cos));
      const sx = dir > 0 ? srcStep : srcW - 1 - srcStep;
      const vs = 1 - (1 - LEAF_MIN_SCALE) * f * open; // 닫혀 있을 땐 줄지 않는다
      const dy = DOOR.cy - (DOOR.cy - DOOR.y) * vs;
      const dh = srcH * vs;
      const dx = hingeX + dir * i;
      g.drawImage(leaf.img, sx, 0, 1, srcH, dx, dy, 1, dh);

      // 역광은 열리면서 들어온다 - 닫혀 있을 때 문짝 색이 갑자기 바뀌지 않게.
      const [tint, alpha] = BACKLIGHT[Math.min(BACKLIGHT.length - 1, Math.floor(f * BACKLIGHT.length))];
      g.globalAlpha = alpha * open;
      g.fillStyle = tint;
      g.fillRect(dx, dy, 1, dh);
      g.globalAlpha = 1;

      if (i === cols - 1) {
        const y0 = Math.round(dy);
        const y1 = Math.round(dy + dh);
        for (let y = y0; y < y1; y++) {
          g.fillStyle = EDGE_COLORS[y & 1];
          g.fillRect(dx, y, 1, 1);
        }
      }
    }
  }
}
