// 안전 프레임(네이티브 180x320) + 블리드. 캔버스는 화면 전체, 게임 UI는 frame 안에만 그리고
// frame 밖(블리드)은 배경만 깔린다. 순수 함수 - main.js resize()와 tests/screenFit.test.js가 쓴다.
export const FRAME_NATIVE_W = 180;
export const FRAME_NATIVE_H = 320;
// 정수 배율로 내렸을 때 이만큼 이상 남으면 정수(픽셀 굵기 균일), 아니면 분수로 꽉 채운다.
const INT_SCALE_MIN_FILL = 0.92;

// deviceW/H = 캔버스 기기 px, insets/bannerCss = CSS px(bannerCss = 배너 높이 + 간격, 없으면 0).
// frame.{x,y,w,h} = 기기 px(원점은 정수 스냅), frame.css = 같은 사각형의 CSS px, frame.scale = 네이티브 1px당 기기 px.
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
    frame: { x, y, w, h, scale, css: { x: x / dpr, y: y / dpr, w: w / dpr, h: h / dpr } },
    full: { w: deviceW, h: deviceH, css: { w: deviceW / dpr, h: deviceH / dpr } },
  };
}

// frame 좌표(CSS px)를 기기 px 경계로 스냅(frame 원점이 정수 기기 px라 frame 좌표 기준으로 맞추면 된다).
export function snapPx(v, dpr) {
  return Math.round(v * dpr) / dpr;
}
