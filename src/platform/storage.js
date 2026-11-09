// 저장소: load(key) -> value|null, save(key, value) -> void (동기, 호출부 그대로).
// 실제 저장은 platform.storage(전부 async - 토스 Storage가 Promise라서, docs/platforms.md 4장):
// 시작할 때 initStorage()가 KEYS를 한 번 읽어 메모리 캐시 -> save는 캐시에 쓰고 300ms 디바운스 후 비동기 flush,
// 앱이 백그라운드로 가면(lifecycle.onPause) flush()로 즉시.
// initStorage 전(node 테스트 등)에는 메모리에만 있고 아무 데도 쓰지 않는다.

// 읽을 키 전부 - 새 키를 쓰면 여기에 추가해야 다음 실행 때 읽힌다(platform.storage에 키 목록 API가 없다).
const KEYS = ['gemGuardians.save.v2', 'gemGuardians.save.v1', 'sfxVolume', 'bgmVolume', 'muted', 'haptics', 'leaderboardSubmitted'];
// 전체 데이터 초기화: 이 값을 올리면 모든 접속자의 저장 데이터가 다음 실행 때 한 번 비워진다.
const DATA_EPOCH = 1;
const FLUSH_MS = 300;

const cache = new Map(); // key -> JSON 문자열
const dirty = new Set();
let backend = null; // { get, set, remove } (platform.storage)
let timer = null;

export async function initStorage(store) {
  backend = store;
  cache.clear();
  if ((await store.get('dataEpoch')) !== String(DATA_EPOCH)) {
    await Promise.all(KEYS.map((k) => store.remove(k)));
    await store.set('dataEpoch', String(DATA_EPOCH));
    return;
  }
  const values = await Promise.all(KEYS.map((k) => store.get(k)));
  KEYS.forEach((k, i) => values[i] != null && cache.set(k, values[i]));
}

export const storage = {
  load(key) {
    const raw = cache.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },
  save(key, value) {
    cache.set(key, JSON.stringify(value));
    dirty.add(key);
    if (backend && !timer) timer = setTimeout(() => storage.flush(), FLUSH_MS);
  },
  // 쓰기 실패(용량 초과, 프라이버시 모드 등)는 어댑터가 삼킨다 - 진행은 메모리상으로 계속된다.
  flush() {
    clearTimeout(timer);
    timer = null;
    if (!backend) return Promise.resolve();
    const keys = [...dirty];
    dirty.clear();
    return Promise.all(keys.map((k) => backend.set(k, cache.get(k)).catch(() => {})));
  },
};
