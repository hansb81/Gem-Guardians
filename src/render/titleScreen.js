// 타이틀 화면(assets/title/README.md, manifest.json). 게임 렌더와는 독립적으로 자기
// 에셋(title_bg/logo/logo_shine)과 폰트 준비 여부를 직접 추적한다 - 메인 에셋 로딩이
// 끝나기 전에도, 혹은 실패해도 멈추지 않고 배경색+글자만으로 보여줄 수 있어야 한다
// (README "이미지 로딩 전이나 실패 시엔 ... 멈추지 않게").
import { loadImage } from './assetLoader.js';
import { getFontString } from '../config/fonts.js';
import { drawText } from './uiKit.js';
import { t } from '../config/i18n.js';

const FALLBACK_BG = '#0d0a10';
const NATIVE_W = 180;
const NATIVE_H = 320;
const DRAW_SCALE = 3; // manifest.text 좌표계 기준(네이티브 180x320의 3배 = 540x960).

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

export class TitleScreen {
  constructor() {
    this.manifest = null;
    this.bg = null;
    this.logo = null;
    this.logoShine = null;
    this.fontReady = false;

    this.exiting = false;
    this.exitElapsedMs = 0;
    this.exitDurationMs = 300;

    fetchJson('assets/title/manifest.json').then((m) => {
      this.manifest = m;
    });
    loadImage('assets/title/title_bg.png').then((s) => {
      this.bg = s;
    });
    loadImage('assets/title/logo.png').then((s) => {
      this.logo = s;
    });
    loadImage('assets/title/logo_shine.png').then((s) => {
      this.logoShine = s;
    });

    if (document.fonts) {
      document.fonts
        .load('16px Galmuri11')
        .then(() => {
          this.fontReady = true;
        })
        .catch(() => {
          this.fontReady = true;
        });
    } else {
      this.fontReady = true;
    }
  }

  // main.js가 탭/클릭/Enter/Space 시 호출한다 - 이미 진행 중이면 무시.
  startExit() {
    if (this.exiting) return;
    this.exiting = true;
    this.exitElapsedMs = 0;
  }

  isExitDone() {
    return this.exiting && this.exitElapsedMs >= this.exitDurationMs;
  }

  // ctx/width/height는 CanvasRenderer가 쓰는 것과 같은 css px 좌표계(dpr 변환은 이미
  // ctx에 걸려 있다). dtMs는 페이드아웃 진행용(timeScale 영향 안 받는 실제 경과 시간).
  draw(ctx, width, height, dtMs, nowMs) {
    ctx.fillStyle = FALLBACK_BG;
    ctx.fillRect(0, 0, width, height);
    if (width > 0 && height > 0) {
      // 캔버스 비율(LAYOUT_CONFIG.aspectRatio = 9/16)이 네이티브 180x320과 정확히 같은 비율이라
      // 정수 배율로 스냅하면 실제로는 거의 항상 캔버스 안에 또 다른 여백이 생긴다(모바일마다
      // 배율이 2.0x~2.9x 사이로 들쭉날쭉해 남는 쪽이 큼) - 분수 배율로 꽉 채우고, 비율이 어긋나는
      // 경우(반올림 오차)만 #0d0a10 여백으로 흡수한다.
      const scale = Math.min(width / NATIVE_W, height / NATIVE_H);
      const offsetX = (width - NATIVE_W * scale) / 2;
      const offsetY = (height - NATIVE_H * scale) / 2;
      const k = scale / DRAW_SCALE;

      ctx.save();
      ctx.imageSmoothingEnabled = false;
      this._drawBackground(ctx, offsetX, offsetY, scale, nowMs);
      this._drawLogo(ctx, offsetX, offsetY, scale, nowMs);
      if (this.fontReady) this._drawText(ctx, offsetX, offsetY, k, nowMs);
      ctx.restore();
    }

    if (this.exiting) {
      this.exitElapsedMs += dtMs;
      const alpha = Math.min(1, this.exitElapsedMs / this.exitDurationMs);
      ctx.fillStyle = `rgba(0, 0, 0, ${alpha})`;
      ctx.fillRect(0, 0, width, height);
    }
  }

  _drawBackground(ctx, offsetX, offsetY, scale, nowMs) {
    if (!ready(this.bg)) return;
    const layer = this.manifest?.layers?.find((l) => l.name === 'bg') ?? { frameW: NATIVE_W, frameH: NATIVE_H, frames: 64, cols: 8, frameMs: 100 };
    const i = Math.floor(nowMs / layer.frameMs) % layer.frames;
    const sx = (i % layer.cols) * layer.frameW;
    const sy = Math.floor(i / layer.cols) * layer.frameH;
    ctx.drawImage(this.bg.img, sx, sy, layer.frameW, layer.frameH, offsetX, offsetY, layer.frameW * scale, layer.frameH * scale);
  }

  _drawLogo(ctx, offsetX, offsetY, scale, nowMs) {
    const layer = this.manifest?.layers?.find((l) => l.name === 'logo') ?? { x: 33, y: 21, w: 114, h: 56 };
    const shineLayer = this.manifest?.layers?.find((l) => l.name === 'logo_shine') ?? { frames: 12, frameMs: 100, repeatEveryMs: 3200 };
    const dx = offsetX + layer.x * scale;
    const dy = offsetY + layer.y * scale;
    const dw = layer.w * scale;
    const dh = layer.h * scale;

    const t = nowMs % shineLayer.repeatEveryMs;
    if (t < shineLayer.frames * shineLayer.frameMs && ready(this.logoShine)) {
      const frame = Math.floor(t / shineLayer.frameMs);
      ctx.drawImage(this.logoShine.img, frame * layer.w, 0, layer.w, layer.h, dx, dy, dw, dh);
      return;
    }
    if (ready(this.logo)) ctx.drawImage(this.logo.img, 0, 0, layer.w, layer.h, dx, dy, dw, dh);
  }

  _drawText(ctx, offsetX, offsetY, k, nowMs) {
    const text = this.manifest?.text ?? {};
    const outlineColor = text.outline ?? '#0d0a10';
    const outlineWidth = text.outlinePx ?? 2;
    const sx = (v) => offsetX + v * k;
    const sy = (v) => offsetY + v * k;
    const sz = (v) => v * k;

    const subtitle = text.subtitle ?? { cx: 270, cy: 266, fontPx: 16, color: '#f2d264', dashes: { color: '#7a5212', w: 18, h: 2, leftX: 180, rightX: 342, y: 266 } };
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = getFontString(sz(subtitle.fontPx));
    ctx.fillStyle = subtitle.color;
    drawText(ctx, t('title.subtitle'), sx(subtitle.cx), sy(subtitle.cy), { outlineColor, outlineWidth });

    const d = subtitle.dashes;
    const dw = sz(d.w);
    const dh = sz(d.h);
    ctx.fillStyle = d.color;
    ctx.fillRect(sx(d.leftX) - dw / 2, sy(d.y) - dh / 2, dw, dh);
    ctx.fillRect(sx(d.rightX) - dw / 2, sy(d.y) - dh / 2, dw, dh);

    const tap = text.tapToStart ?? { cx: 270, cy: 880, fontPx: 22, color: '#f2d264', blinkMs: 500 };
    if (Math.floor(nowMs / tap.blinkMs) % 2 === 0) {
      ctx.font = getFontString(sz(tap.fontPx));
      ctx.fillStyle = tap.color;
      drawText(ctx, t('title.tap'), sx(tap.cx), sy(tap.cy), { outlineColor, outlineWidth });
    }

    const version = text.version ?? { text: 'v0.1', right: 530, bottom: 950, fontPx: 11, color: '#3b3347' };
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.font = getFontString(sz(version.fontPx));
    ctx.fillStyle = version.color;
    drawText(ctx, version.text, sx(version.right), sy(version.bottom), { outlineColor, outlineWidth });
  }
}
