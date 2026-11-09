// 마켓 어댑터 하나만 골라 쓰는 입구. 게임 코드는 여기 platform만 부른다.
// initPlatform()이 끝나기 전에는 interface.js의 no-op 기본값이다(호출부는 항상 platform.xxx로 그때그때 읽는다).
import { defaultPlatform } from './interface.js';

// Vite define(vite.config.js). Vite 없이 열면(serve.py, node 테스트) 정의가 없으므로 web.
// eslint-disable-next-line no-undef
export const PLATFORM_ID = typeof __PLATFORM__ === 'undefined' ? 'web' : __PLATFORM__;

/** @type {import('./interface.js').Platform} */
export const platform = defaultPlatform();

// 빌드 타임 상수 비교라 번들러가 다른 마켓 분기(SDK import)를 통째로 버린다.
function loadAdapter() {
  if (PLATFORM_ID === 'toss') return import('./toss/index.js');
  // onestore = Android Capacitor 어댑터 그대로, 결제 provider만 원스토어(capacitor/iap/onestore.js).
  if (PLATFORM_ID === 'android' || PLATFORM_ID === 'onestore' || PLATFORM_ID === 'ios') return import('./capacitor/index.js');
  return import('./web/index.js');
}

let ready = null;
export function initPlatform({ dev = false } = {}) {
  ready ??= loadAdapter().then(async ({ default: adapter }) => {
    let p = adapter;
    // 가짜 결제는 웹 빌드에서만 - 실제 결제가 있는 마켓 빌드에서 ?dev=1로 공짜 지급이 열리면 안 된다.
    if (dev && PLATFORM_ID === 'web') p = (await import('./dev/index.js')).withDev(p);
    await p.init();
    Object.assign(platform, p);
  });
  return ready;
}
