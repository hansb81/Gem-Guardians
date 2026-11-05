// manifest.background 재생기 - "정지 베이스 한 장 + 움직이는 부분만 잘라낸 작은 시트 +
// 코드로 그리는 1px 입자"(assets/title/README.md v2 구조). 타이틀과 메인 메뉴가 같은
// manifest 구조를 쓰므로 디렉터리만 다르게 넘겨 그대로 재사용한다.
//
// 좌표는 전부 네이티브 px(180x320)이고, draw()에 받은 scale로 화면 px로 옮긴다.
// 입자 공식의 상수는 manifest의 rule 문자열을 코드로 옮긴 것이다(문자열을 평가하지 않는다).
import { loadImage } from './assetLoader.js';

const TAU = Math.PI * 2;

// manifest 공식의 %는 전부 양수 나머지.
function mod(a, b) {
  return ((a % b) + b) % b;
}

function ready(state) {
  return !!(state && state.loaded && !state.failed);
}

// 조각의 현재 프레임이 시트에서 차지하는 좌상단 위치. now는 ms.
export function pieceSrcPos(piece, now, frameMs, loopFrames) {
  const f = mod(Math.floor(now / frameMs), loopFrames);
  const k = piece.seq[mod(f, piece.periodFrames)];
  return { sx: (k % piece.cols) * piece.w, sy: Math.floor(k / piece.cols) * piece.h };
}

// 먼지 한 알(dust_motes rule): 문빛 안에서 올라가며 깜빡인다.
export function dustMote(item, t) {
  return {
    x: Math.round(90 + item.amp * Math.sin((TAU * mod(t, 6400)) / 6400 + item.phase)),
    y: Math.round(236 - mod((t * 96) / 6400 + item.offset, 96)),
    visible: mod(Math.floor(t / 160 + item.blinkIndex), 4) !== 0,
  };
}

// 물방울(water_drops rule) 머리 픽셀의 y - 바로 아래 1px이 꼬리다.
export function waterDropY(item, t) {
  return Math.floor(mod(t / 1600 + item.phase, 1) * 170) + 100;
}

// 불씨 하나(sparks rule): 둥실거리는 봉인 원석의 균열에서 올라간다.
export function spark(item, t) {
  const cy = 134 + Math.round(2 * Math.sin((TAU * mod(t, 6400)) / 3200));
  return {
    x: Math.round(90 + item.amp * Math.sin((TAU * mod(t, 6400)) / 6400 + item.phase * 6.28)),
    y: Math.round(cy + 10 - mod((mod(t, 6400) * 60) / 6400 + item.phase * 60, 60)),
    visible: mod(Math.floor(t / 160 + item.blinkIndex), 4) !== 0,
  };
}

export class LayeredBg {
  constructor(dir) {
    this.dir = dir;
    this.background = null;
    this.images = new Map(); // 파일명 -> loadImage 상태 | null(로딩 중)
  }

  // manifest.background를 받는 시점에 base/조각 시트를 로드한다(파일 목록이 여기 있다).
  setManifest(background) {
    if (!background || this.background) return;
    this.background = background;
    for (const file of [background.base, ...(background.pieces ?? []).map((p) => p.file)]) {
      if (!file || this.images.has(file)) continue;
      this.images.set(file, null);
      loadImage(`${this.dir}/${file}`).then((s) => this.images.set(file, s));
    }
  }

  // (offsetX, offsetY)를 네이티브 (0,0)으로 두고 1 네이티브 px = scale 화면 px로 그린다.
  // manifest나 이미지가 아직 없으면 그 부분만 조용히 건너뛴다(호출부는 멈추지 않는다).
  draw(ctx, offsetX, offsetY, scale, now) {
    const bg = this.background;
    if (!bg) return;

    // 네이티브 사각형 -> 화면 사각형. 경계를 반올림해 조각/입자가 베이스와 어긋나지 않게 한다.
    const place = (x, y, w, h) => {
      const dx = Math.round(offsetX + x * scale);
      const dy = Math.round(offsetY + y * scale);
      return [dx, dy, Math.round(offsetX + (x + w) * scale) - dx, Math.round(offsetY + (y + h) * scale) - dy];
    };
    const pixel = (x, y, color) => {
      if (!color) return;
      ctx.fillStyle = color;
      ctx.fillRect(...place(x, y, 1, 1));
    };

    const base = this.images.get(bg.base);
    const baseDrawn = ready(base);
    if (baseDrawn) {
      ctx.drawImage(base.img, ...place(0, 0, base.img.naturalWidth, base.img.naturalHeight));
    }

    const frameMs = bg.frameMs ?? 200;
    for (const piece of bg.pieces ?? []) {
      const sheet = this.images.get(piece.file);
      if (!ready(sheet)) continue;
      const { sx, sy } = pieceSrcPos(piece, now, frameMs, bg.loopFrames ?? piece.frames);
      ctx.drawImage(sheet.img, sx, sy, piece.w, piece.h, ...place(piece.x, piece.y, piece.w, piece.h));
    }

    for (const group of bg.particles ?? []) {
      const rule = group.rule ?? {};
      if (group.name === 'dust_motes') {
        for (const item of rule.items ?? []) {
          const m = dustMote(item, now);
          if (m.visible) pixel(m.x, m.y, item.color);
        }
      } else if (group.name === 'sparks') {
        for (const item of rule.items ?? []) {
          const sp = spark(item, now);
          if (sp.visible) pixel(sp.x, sp.y, item.color);
        }
      } else if (group.name === 'water_drops') {
        // shortcut: 밝은 돌(#655a74) 위 픽셀 건너뛰기(manifest "optional")는 안 한다 - 1px 차이.
        for (const item of rule.items ?? []) {
          const y = waterDropY(item, now);
          pixel(item.x, y, rule.colors?.top);
          pixel(item.x, y + 1, rule.colors?.bottom);
        }
      }
    }
    return baseDrawn;
  }
}
