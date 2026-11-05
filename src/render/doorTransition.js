// 타이틀 -> 메인 메뉴 "문 열림" 전환(assets/title/door_transition_spec.md, 총 2.2초).
// 네이티브 180x320 안에서 벌어지는 부분(문 안쪽 금빛, 문짝 회전, 빛살)은 오프스크린
// 캔버스에 1배로 그린 뒤 한 번에 확대해 붙인다 - 디더 패턴이 배경과 같은 픽셀 격자에
// 맞고, 매 프레임 fillRect 수천 번도 피할 수 있다. 마지막 원형 폭발만 화면 px로 그린다.
// 시간 상수는 전부 전환 시작 후 ms.
import { loadImage } from './assetLoader.js';

export const DOOR_TRANSITION_MS = 2200;

const NATIVE_W = 180;
const NATIVE_H = 320;
// 문 아치: (70,132)-(110,236), 윗부분 반지름 20 (spec "구현 메모").
const DOOR = { x: 70, y: 132, w: 40, h: 104, cx: 90, cy: 190, archR: 20 };
const BASIS_H = 960; // 폭발 반지름/디더 폭이 기준으로 삼는 화면 높이(540x960).

const T = {
  ui: [0, 300], // 로고/부제/터치 글자 페이드아웃
  glow: [0, 350], // 문 안쪽 금빛
  leaves: [350, 1100], // 문짝 회전
  rays: [500, 1100], // 문 밖 빛살
  burst: [950, 1450], // 원형 빛 폭발
  menu: [1250, 2200], // 메인 메뉴 크로스페이드
};
// 효과음 자리(파일은 나중에 - 없는 키는 AudioManager가 그냥 무시한다).
const CUES = [
  [0, 'door_scrape'],
  [350, 'door_open'],
  [950, 'light_rise'],
];

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
const RAY_COLORS = ['#3a2808', '#7a5212', '#c28a20'];
const LEAF_MIN_SCALE = 0.65; // 자유 끝 세로 배율(최대 35% 줄어듦)
const MAX_ANGLE = (80 * Math.PI) / 180;
const BURST_CAP = 0.55; // 눈부심 방지 - 덮는 비율 상한

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

function ditherCircle(ctx, color, coverage, cell, cx, cy, r) {
  if (r <= 0) return;
  const pattern = ditherPattern(ctx, color, coverage, cell);
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
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
  draw(ctx, offsetX, offsetY, scale, elapsed, height) {
    const g = this._nativeCtx();
    g.clearRect(0, 0, NATIVE_W, NATIVE_H);
    g.imageSmoothingEnabled = false;
    this._drawDoor(g, elapsed);
    this._drawRays(g, elapsed);
    ctx.drawImage(this._canvas, 0, 0, NATIVE_W, NATIVE_H, offsetX, offsetY, NATIVE_W * scale, NATIVE_H * scale);
    this._drawBurst(ctx, offsetX, offsetY, scale, elapsed, height);
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

    // 회전 전(0~350ms)에는 문틈만 2px까지 벌어져 안쪽 금빛이 새어 나온다 - preview.gif처럼
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

  // 문 밖으로 퍼지는 빛살 - 가로 60, 세로 50(네이티브)까지 자라는 타원 3겹.
  _drawRays(g, elapsed) {
    const p = phase(elapsed, T.rays);
    if (p <= 0) return;
    g.save();
    for (let i = 0; i < RAY_COLORS.length; i++) {
      const k = 1 - i / RAY_COLORS.length; // 바깥 겹일수록 크다
      const pattern = ditherPattern(g, RAY_COLORS[i], (0.5 - i * 0.05) * p, 1);
      if (!pattern) continue;
      g.fillStyle = pattern;
      g.beginPath();
      g.ellipse(DOOR.cx, DOOR.cy, 60 * p * k, 50 * p * k, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  // 문 중심에서 터져 나가는 금빛 원. 화면 px 기준이고(기준 높이 960),
  // 덮는 비율은 BURST_CAP까지만 - 장면이 디더 사이로 계속 비친다.
  _drawBurst(ctx, offsetX, offsetY, scale, elapsed, height) {
    const p = phase(elapsed, T.burst);
    if (p <= 0) return;
    const unit = (height || BASIS_H) / BASIS_H;
    const r = Math.pow(p, 0.8) * 1150 * unit;
    const edge = 160 * unit;
    const cx = offsetX + DOOR.cx * scale;
    const cy = offsetY + DOOR.cy * scale;
    const core = r - edge;

    const steps = 6;
    for (let i = 0; i < steps; i++) {
      const t = (i + 1) / steps;
      ditherCircle(ctx, GLOW[0], BURST_CAP * t, 3, cx, cy, r - edge * (1 - t));
    }
    ditherCircle(ctx, GLOW[1], BURST_CAP, 3, cx, cy, Math.min(core, r * 0.8));
    ditherCircle(ctx, GLOW[2], BURST_CAP, 3, cx, cy, Math.min(core, r * 0.45));
  }

  // 아직 재생하지 않은 효과음 훅을 elapsed까지 흘려보낸다.
  fireCues(audio, prevElapsed, elapsed) {
    for (const [at, key] of CUES) {
      if (prevElapsed <= at && elapsed > at) audio.play(key);
    }
  }
}
