// assets/ui/README.md의 drawNine/drawDamage를 그대로 구현한 공용 헬퍼.
// CanvasRenderer/BattleRenderer가 공유한다 - 이미지 로드 실패 시 호출부가 폴백 도형을
// 그리도록, 여기서는 이미지가 준비됐는지(uiReady)만 판단하고 그리기 자체는 실패하지 않는다.
import { audio } from '../audio/AudioManager.js';

const BUTTON_SOUND = { click: 'ui_click', cancel: 'ui_cancel', none: null };

// 모든 캔버스 버튼의 공용 판정: rect 안이면 버튼음을 내고 true. sound: 'click'(기본) |
// 'cancel'(취소/닫기/뒤로/팝업 X) | 'none'(전환음 등 자체 소리가 있는 버튼).
export function pressButton(x, y, rect, sound = 'click') {
  if (!rect || x < rect.x || x >= rect.x + rect.width || y < rect.y || y >= rect.y + rect.height) return false;
  if (BUTTON_SOUND[sound]) audio.play(BUTTON_SOUND[sound]);
  return true;
}

export function uiReady(state) {
  return !!(state && state.loaded && !state.failed);
}

// path(manifest.json의 키, 예: "icons/gold.png") -> 로드된 이미지 상태.
export function getUi(assets, path) {
  return assets?.uiImages?.get(path) ?? null;
}

export function getUiFont(assets, variant) {
  return assets?.uiFontImages?.get(variant) ?? null;
}

export function getUiMeta(assets, path) {
  return assets?.uiManifest?.assets?.[path] ?? null;
}

// 목표 화면 크기(px) -> "원본 px 정수 x k"로 스냅한 크기. 9-slice/박스 이미지가 늘어날 때
// 가장자리 무늬가 깨지지 않도록(README §9-slice 그리기) 항상 이 값을 w/h로 써야 한다.
export function snap(px, k = 2) {
  return Math.max(k, Math.round(px / k) * k);
}

// 고정 크기 아이콘(골드/다이아/벽/자물쇠, 버튼 아이콘, 팝업 엠블럼) - 원본 px x k를 중심
// (cx, cy) 기준으로 그린다. 그렸으면 true, 이미지가 없으면 false(호출부가 폴백 도형을
// 그려야 함을 알려준다).
export function drawFixedImage(ctx, assets, path, cx, cy, k = 2) {
  const state = getUi(assets, path);
  if (!uiReady(state)) return false;
  const w = state.img.width * k;
  const h = state.img.height * k;
  ctx.drawImage(state.img, cx - w / 2, cy - h / 2, w, h);
  return true;
}

// s = manifest slice [l, t, r, b], (x, y, w, h) = 화면 좌표, k = 배율(기본 2).
export function drawNine(ctx, img, s, x, y, w, h, k = 2) {
  const [l, t, r, b] = s;
  const sw = img.width;
  const sh = img.height;
  const sx = [0, l, sw - r, sw];
  const dx = [0, l * k, w - r * k, w];
  const sy = [0, t, sh - b, sh];
  const dy = [0, t * k, h - b * k, h];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      const cw = sx[i + 1] - sx[i];
      const ch = sy[j + 1] - sy[j];
      const dw = dx[i + 1] - dx[i];
      const dh = dy[j + 1] - dy[j];
      if (cw > 0 && ch > 0 && dw > 0 && dh > 0) {
        ctx.drawImage(img, sx[i], sy[j], cw, ch, x + dx[i], y + dy[j], dw, dh);
      }
    }
  }
}

// 텍스트 좌표는 정수로 맞춘다(CLAUDE.md 다국어 폰트 규칙). Canvas의 fillText는
// imageSmoothingEnabled 같은 끄기 옵션이 없어 안티앨리어싱을 피할 수 없으므로(픽셀 폰트도
// 작은 크기에선 뿌옇게 보임), 기본으로 얇은 외곽선을 먼저 그려 또렷함/배경 대비를 보완한다.
// 다양한 배경(어두운 패널, 밝은 버튼, 스프라이트 위) 위에서 공용으로 써야 하므로 outline을
// 끄고 싶은 특수한 호출부만 { outline: false }를 넘기면 된다.
export function drawText(ctx, text, x, y, { outline = true, outlineColor = 'rgba(0, 0, 0, 0.65)', outlineWidth = 2 } = {}) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (outline) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = outlineColor;
    ctx.lineWidth = outlineWidth;
    ctx.strokeText(text, px, py);
    ctx.restore();
  }
  ctx.fillText(text, px, py);
}

// cx = 가운데 x. 치명타는 호출부가 k=3을 넘겨 더 크게 그린다(README: 평소 2배, 치명타 3배).
export function drawDamage(ctx, img, font, text, cx, y, k = 2) {
  let w = 1;
  for (const c of text) w += font.widths[c] - 1;
  let x = Math.round(cx - (w * k) / 2);
  for (const c of text) {
    const i = font.chars.indexOf(c);
    const gw = font.widths[c];
    ctx.drawImage(img, i * font.cellW, 0, gw, font.cellH, x, y, gw * k, font.cellH * k);
    x += (gw - 1) * k;
  }
}
