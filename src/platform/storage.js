// 저장소: load(key) -> value|null, save(key, value) -> void (동기, 호출부 그대로).
// 실제 저장은 platform.storage(전부 async - 토스 Storage가 Promise라서, docs/platforms.md 4장):
// 시작할 때 initStorage()가 KEYS를 한 번 읽어 메모리 캐시 -> save는 캐시에 쓰고 300ms 디바운스 후 비동기 flush,
// 앱이 백그라운드로 가면(lifecycle.onPause) flush()로 즉시.
// initStorage 전(node 테스트 등)에는 메모리에만 있고 아무 데도 쓰지 않는다.

// 읽을 키 전부 - 새 키를 쓰면 여기에 추가해야 다음 실행 때 읽힌다(platform.storage에 키 목록 API가 없다).
const KEYS = ['gemGuardians.save.v2', 'gemGuardians.save.v1', 'sfxVolume', 'bgmVolume', 'muted', 'haptics', 'guardianFx', 'leaderboardSubmitted', 'devServer', 'devCheats', 'pendingVerify', 'adContinue', 'locale', 'cloudMeta', 'mailDeleted', 'attAutoDate', 'eventAutoOpened', 'crownBand', 'lastSeenSeasonId'];
// adContinue = 옛 키(지금은 save 안 playerState.adContinue) - 한 번 읽어 옮기고 지운다. cloudMeta = 클라우드 저장 기기 기록(src/net/cloudSave.js).
// 전체 데이터 초기화: 이 값을 올리면 모든 접속자의 저장 데이터가 다음 실행 때 한 번 비워진다.
const DATA_EPOCH = 2; // 2026-11-28 오픈 후 전체 초기화(게스트 서버 계정 삭제와 같은 날 배포)
const FLUSH_MS = 300;
const AUTH_KEY = 'gemGuardians.auth'; // src/net/api.js storageKey (supabase 세션 JSON)

async function isGuestSession(store) {
  try {
    return JSON.parse(await store.get(AUTH_KEY))?.user?.is_anonymous === true;
  } catch {
    return false; // 없음·깨짐 = 그대로(깨진 세션은 supabase가 버린다)
  }
}

const cache = new Map(); // key -> JSON 문자열
const dirty = new Set();
let backend = null; // { get, set, remove } (platform.storage)
let timer = null;

// 읽기 오류(store.get이 throw)면 backend를 붙이지 않고 그대로 던진다 - 그 실행은 메모리에서만 돌고,
// 디스크의 세이브를 지우거나(dataEpoch를 못 읽어 '다름'으로 보는 것) 기본값으로 덮어쓰지 않는다. 다음 실행 때 다시 읽는다.
export async function initStorage(store) {
  backend = null;
  cache.clear();
  if ((await store.get('dataEpoch')) !== String(DATA_EPOCH)) {
    backend = store;
    // 결제 대기열(pendingVerify)은 영수증이라 남긴다(account.js 계정 삭제와 같음).
    await Promise.all(KEYS.filter((k) => k !== 'pendingVerify').map((k) => store.remove(k)));
    const v = await store.get('pendingVerify');
    if (v != null) cache.set('pendingVerify', v);
    // 게스트 로그인 세션도 지운다 - 남기면 클라우드 저장이 빈 기기에 서버 세이브를 다시 받아온다. 연결 계정(Google 등)은 남겨 서버 세이브를 받는다.
    if (await isGuestSession(store)) await store.remove(AUTH_KEY);
    await store.set('dataEpoch', String(DATA_EPOCH));
    return;
  }
  const values = await Promise.all(KEYS.map((k) => store.get(k)));
  KEYS.forEach((k, i) => values[i] != null && cache.set(k, values[i]));
  backend = store;
}

export const storage = {
  load(key) {
    const raw = cache.get(key);
    if (raw == null) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // 깨진 값은 '{key}.corrupt'에 원문 그대로 남긴다(복구용 - KEYS에 없어 다시 읽지는 않음). 이 키는 곧 새 값으로 덮인다.
      if (!cache.has(`${key}.corrupt`)) {
        cache.set(`${key}.corrupt`, raw);
        dirty.add(`${key}.corrupt`);
        if (backend && !timer) timer = setTimeout(() => storage.flush(), FLUSH_MS);
      }
      return null;
    }
  },
  save(key, value) {
    cache.set(key, JSON.stringify(value));
    dirty.add(key);
    if (backend && !timer) timer = setTimeout(() => storage.flush(), FLUSH_MS);
  },
  remove(key) {
    cache.delete(key);
    dirty.delete(key);
    return backend ? backend.remove(key).catch(() => {}) : Promise.resolve();
  },
  // 개발 패널 '전체 데이터 초기화' - 서버 세션(gemGuardians.auth)·기기 ID까지 지워 새 게스트로. 개발 토글은 남긴다.
  removeAll() {
    const keys = [...KEYS, 'gemGuardians.auth', 'platformUserId'].filter((k) => k !== 'devServer' && k !== 'devCheats');
    return Promise.all(keys.map((k) => storage.remove(k)));
  },
  // 쓰기 실패(용량 초과 등)면 진행은 메모리상으로 계속되고, 그 키는 dirty로 되돌려 다음 저장·onPause 때 다시 쓴다.
  flush() {
    clearTimeout(timer);
    timer = null;
    if (!backend) return Promise.resolve();
    const keys = [...dirty];
    dirty.clear();
    return Promise.all(keys.map((k) => backend.set(k, cache.get(k)).catch((e) => {
      console.warn('[storage] set', k, e);
      if (cache.has(k)) dirty.add(k);
    })));
  },
  // 키에 값은 있는데 load가 null(JSON이 깨짐)인지 보려고 - playerState가 깨진 세이브를 클라우드에 빈 진행으로 올리지 않게.
  has: (key) => cache.has(key),
};
