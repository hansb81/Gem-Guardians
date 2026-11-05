// 웹에서는 진동 API가 없으므로 전부 no-op이다. Capacitor 단계에서 @capacitor/haptics
// 플러그인 호출로 교체한다.
export const haptics = {
  light() {},
  medium() {},
  heavy() {},
};

export default haptics;
