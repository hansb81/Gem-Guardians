// 입구: 마켓 어댑터와 저장 캐시를 먼저 준비한 뒤 게임(main.js)을 불러온다 - playerState/audio가
// 모듈을 읽는 순간 저장값을 동기로 읽기 때문(src/platform/storage.js).
import { initPlatform, platform, DEV_MODE, DEV_ALLOWED, PLATFORM_ID } from './platform/index.js';
import { initStorage, storage } from './platform/storage.js';

initPlatform({ dev: DEV_MODE })
  .catch((e) => console.error('[platform]', e)) // 어댑터 실패 - no-op 기본값으로 계속.
  .then(() => initStorage(platform.storage))
  .catch((e) => console.error('[storage]', e))
  .then(() => {
    platform.lifecycle.onPause(() => storage.flush());
    return import('./main.js');
  });

// 오프라인 실행·다음 실행 때 업데이트(public/sw.js) - 웹 프로덕션 빌드만. 첫 로딩과 겹치지 않게 load 뒤에.
if (PLATFORM_ID === 'web' && !DEV_ALLOWED && 'serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('[sw]', e)));
}
