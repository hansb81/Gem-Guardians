// 호출부(canvasRenderer: haptics[eventCfg.haptics]?.())를 그대로 두는 얇은 래퍼 - 실제 진동은 platform.haptics.
// 사용자 설정(설정 팝업의 진동 토글, 저장 키 'haptics', 기본 켜짐)이 꺼져 있으면 아무것도 안 한다.
import { platform } from './index.js';
import { storage } from './storage.js';

const impact = (kind) => () => {
  if (haptics.enabled()) platform.haptics.impact(kind);
};

export const haptics = {
  light: impact('light'),
  medium: impact('medium'),
  heavy: impact('heavy'),
  enabled: () => storage.load('haptics') !== false,
  setEnabled: (on) => storage.save('haptics', !!on),
};

export default haptics;
