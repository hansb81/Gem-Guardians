// 다국어 픽셀 폰트 설정 - 폰트 이름/크기는 이 파일에서만 관리하고 render 코드는
// getFontString()으로 읽는다(index.html @font-face와 짝). 우선순위: 한국어/영어/가나는
// Galmuri11, 중국어/일본어 한자는 Fusion Pixel, 그 외는 Noto Sans(assets/fonts/*-OFL.txt, SIL OFL 1.1).
export const FONT_CONFIG = {
  family: "'Galmuri11', 'Fusion Pixel', 'Noto Sans', sans-serif",
  baseSize: 12, // Galmuri11 기본 크기(px). 타이틀류 큰 텍스트는 이 값의 배수로 맞추면 가장 또렷하다.
};

// targetPx를 정수 px로 반올림해 ctx.font 문자열을 만든다.
// 주의: Canvas 2D의 fillText/strokeText는 imageSmoothingEnabled 같은 끄기 옵션이 없어
// 안티앨리어싱을 피할 수 없다 - baseSize의 배수로 스냅해도 "완전히 선명"해지진 않고,
// 오히려 좁은 배지/라벨처럼 촘촘히 맞춘 자리에서는 강제로 커져 다음 UI와 겹친다(실측 확인됨).
// 그래서 여기서는 정수 px로만 반올림하고, 선명해 보이는 효과는 drawText의 외곽선으로 보완한다.
export function getFontString(targetPx, bold = false) {
  const px = Math.max(1, Math.round(targetPx));
  return `${bold ? 'bold ' : ''}${px}px ${FONT_CONFIG.family}`;
}

// document.fonts.load()로 게임 시작 전에 기다릴 폰트 목록.
export const FONT_LOAD_SPECS = [
  `${FONT_CONFIG.baseSize}px Galmuri11`,
  `${FONT_CONFIG.baseSize}px "Fusion Pixel"`,
  `${FONT_CONFIG.baseSize}px "Noto Sans"`,
];
