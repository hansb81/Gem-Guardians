// 입구: 마켓 어댑터와 저장 캐시를 먼저 준비한 뒤 게임(main.js)을 불러온다 - playerState/audio가
// 모듈을 읽는 순간 저장값을 동기로 읽기 때문(src/platform/storage.js).
import { initPlatform, platform } from './platform/index.js';
import { initStorage, storage } from './platform/storage.js';

const dev = new URLSearchParams(location.search).get('dev') === '1';
initPlatform({ dev })
  .catch((e) => console.error('[platform]', e)) // 어댑터 실패 - no-op 기본값으로 계속.
  .then(() => initStorage(platform.storage))
  .catch((e) => console.error('[storage]', e))
  .then(() => {
    platform.lifecycle.onPause(() => storage.flush());
    return import('./main.js');
  });
