// 일반 웹(브라우저) 어댑터 - docs/platforms.md 2-1 "웹" 열. 결제·광고·리더보드 없음(D2, D4).
import { createPlatform } from '../interface.js';

const VIBRATE_MS = { light: 10, medium: 20, heavy: 35, success: [15, 40, 15], error: [40, 30, 40] };

function safeStorage(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback; // 프라이버시 모드·용량 초과 - 진행은 메모리로 계속.
  }
}

// CSS env(safe-area-inset-*)는 JS에서 바로 못 읽는다 - 숨은 요소의 padding으로 읽는다.
let probe = null;
function readInsets() {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;'
      + 'padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)';
    document.body.appendChild(probe);
  }
  const s = getComputedStyle(probe);
  return { top: parseFloat(s.paddingTop) || 0, right: parseFloat(s.paddingRight) || 0, bottom: parseFloat(s.paddingBottom) || 0, left: parseFloat(s.paddingLeft) || 0 };
}

function randomId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

const USER_ID_KEY = 'platformUserId';
// 데스크톱 크롬에도 vibrate 함수는 있다(아무 일도 안 함) - 터치 기기에서만 진동 있음으로(설정 토글 표시 기준).
const canVibrate = () => typeof navigator.vibrate === 'function' && matchMedia('(pointer: coarse)').matches;

export default createPlatform({
  id: 'web',
  caps: { iap: false, ads: false, banner: false, rewarded: false, leaderboard: false, externalLinks: true, haptics: canVibrate(), backButton: false, exit: false },
  storage: {
    get: async (key) => safeStorage(() => localStorage.getItem(key), null),
    set: async (key, str) => safeStorage(() => localStorage.setItem(key, str)),
    remove: async (key) => safeStorage(() => localStorage.removeItem(key)),
  },
  identity: {
    async getUserId() {
      let id = safeStorage(() => localStorage.getItem(USER_ID_KEY), null);
      if (!id) {
        id = randomId();
        safeStorage(() => localStorage.setItem(USER_ID_KEY, id));
      }
      return id;
    },
  },
  haptics: {
    impact(kind) {
      const ms = VIBRATE_MS[kind];
      if (ms && typeof navigator.vibrate === 'function') navigator.vibrate(ms);
    },
  },
  lifecycle: {
    // pagehide = 탭 닫기·이동(bfcache 포함) - visibilitychange가 안 오는 브라우저에서도 저장 flush가 돌게.
    onPause: (cb) => {
      document.addEventListener('visibilitychange', () => document.hidden && cb());
      window.addEventListener('pagehide', () => cb());
    },
    onResume: (cb) => document.addEventListener('visibilitychange', () => !document.hidden && cb()),
  },
  layout: {
    getInsets: readInsets,
    // 웹의 env() insets는 창 크기·방향이 바뀔 때만 달라지고, 그때는 main.js가 resize로 이미 다시 배치한다(중복 배치 방지).
    onInsetsChange: () => {},
  },
  links: {
    open(url) {
      window.open(url, '_blank', 'noopener');
      return true;
    },
  },
});
