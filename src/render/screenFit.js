// 안전 프레임(네이티브 180x320) + 블리드. 캔버스는 화면 전체, 게임 UI는 frame 안에만 그리고
// frame 밖(블리드)은 배경만 깔린다. computeScreenFit은 순수 함수 - main.js resize()와 tests/screenFit.test.js가 쓴다.
//
// 렌더러는 frame을 항상 논리 360x640(= 네이티브 x2)으로 그린다. 논리 1px = s/2 기기 px라, 예전에 CSS px로
// 정한 크기(UI 그림 k=2, 여백, 글자)가 모든 기기에서 frame에 대해 같은 비율이 되고 UI 그림 1px = s 기기 px가 된다.
export const FRAME_NATIVE_W = 180;
export const FRAME_NATIVE_H = 320;
const LOGICAL_PER_NATIVE = 2;
export const FRAME_LOGICAL_W = FRAME_NATIVE_W * LOGICAL_PER_NATIVE;
export const FRAME_LOGICAL_H = FRAME_NATIVE_H * LOGICAL_PER_NATIVE;
// 정수 배율로 내렸을 때 이만큼 이상 남으면 정수(픽셀 굵기 균일), 아니면 분수로 꽉 채운다.
const INT_SCALE_MIN_FILL = 0.92;

// deviceW/H = 캔버스 기기 px, insets/bannerCss = CSS px(bannerCss = 배너 높이 + 간격, 없으면 0).
// frame.{x,y,w,h} = 기기 px(원점은 정수 스냅), frame.css = 같은 사각형의 CSS px, frame.scale = 네이티브 1px당 기기 px,
// frame.unit = 논리 1px당 기기 px.
export function computeScreenFit(deviceW, deviceH, dpr, insets, bannerCss = 0) {
  const left = insets.left * dpr;
  const top = insets.top * dpr;
  const availW = Math.max(1, deviceW - (insets.left + insets.right) * dpr);
  const availH = Math.max(1, deviceH - (insets.top + insets.bottom + bannerCss) * dpr);
  const r = Math.min(availW / FRAME_NATIVE_W, availH / FRAME_NATIVE_H);
  const fl = Math.floor(r);
  const scale = r >= 2 && fl / r >= INT_SCALE_MIN_FILL ? fl : r;
  const w = FRAME_NATIVE_W * scale;
  const h = FRAME_NATIVE_H * scale;
  const x = Math.round(left + (availW - w) / 2);
  const y = Math.round(top + (availH - h) / 2);
  return {
    dpr,
    frame: { x, y, w, h, scale, unit: scale / LOGICAL_PER_NATIVE, css: { x: x / dpr, y: y / dpr, w: w / dpr, h: h / dpr } },
    full: { w: deviceW, h: deviceH, css: { w: deviceW / dpr, h: deviceH / dpr } },
  };
}

// 지금 화면 - CanvasRenderer.resize()가 채운다. unit = 논리 1px당 기기 px, full = 블리드 포함 캔버스 전체(frame 원점 기준 논리 좌표).
// 팝업 뒤 어둡게 깔기는 full에 칠한다(블리드까지).
export const screen = { unit: 1, full: { x: 0, y: 0, width: 0, height: 0 } };

// 논리 좌표를 기기 px 경계로 스냅(frame 원점이 정수 기기 px라 frame 좌표 기준으로 맞추면 된다).
// shortcut: 현재 ctx 배율이 unit이라고 가정 - prep/랭킹 팝업처럼 ctx.scale을 더 건 곳에선 근사.
export function snapPx(v, d = screen.unit) {
  return Math.round(v * d) / d;
}

// 화면 ctx용 drawImage - 목적지 사각형의 네 변을 기기 px로 스냅한다(5인자 / 9인자 형식).
export function drawImageSnapped(ctx, img, a, b, c, d, e, f, g, h) {
  if (e === undefined) {
    const x = snapPx(a);
    const y = snapPx(b);
    ctx.drawImage(img, x, y, snapPx(a + c) - x, snapPx(b + d) - y);
    return;
  }
  const x = snapPx(e);
  const y = snapPx(f);
  ctx.drawImage(img, a, b, c, d, x, y, snapPx(e + g) - x, snapPx(f + h) - y);
}

// 잼 그림 배율: 몸통(bodyPx) 1px = m 기기 px, m = round(칸 기기 px / bodyPx), 최소 1.
// 프레임이 분수 배율(데스크톱·폴드)이면 이미 정수 픽셀을 포기한 기기라 잼도 칸에 딱 맞게 분수로 그린다.
export function gemPixelScale(cellDevicePx, bodyPx = 32, intFrame = Number.isInteger(screen.unit * LOGICAL_PER_NATIVE)) {
  return intFrame ? Math.max(1, Math.round(cellDevicePx / bodyPx)) : cellDevicePx / bodyPx;
}
