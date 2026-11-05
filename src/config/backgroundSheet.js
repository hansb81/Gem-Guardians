// 층 번호 -> assets/backgrounds 시트 이름. assets/backgrounds/manifest.json의 lookup 규칙을
// 그대로 옮긴 것 - 테마 개수/층수/바퀴 수는 manifest에서 읽으므로 하드코딩하지 않는다.
// 브라우저 API 사용 금지(core/config 쪽, render와 분리).
export function pickBackgroundSheetName(manifest, floor) {
  const { themeOrder, floorsPerTheme, laps } = manifest;
  const themeIndex = Math.floor((floor - 1) / floorsPerTheme);
  const theme = themeOrder[themeIndex % themeOrder.length];
  const idx = (floor - 1) % floorsPerTheme;
  const lap = Math.min(laps - 1, Math.floor((floor - 1) / (floorsPerTheme * themeOrder.length)));
  return { theme, idx, lap, name: `${theme}_f${idx}_lap${lap}` };
}
