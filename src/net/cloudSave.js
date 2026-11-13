// 클라우드 저장 L1(docs/auth.md §3): 기기 save.v2(playerState.snapshot())를 서버에 한 덩어리로 올리고 받는다.
// 서버가 꺼져 있으면(net.enabled false) 아무것도 안 한다. 오프라인이면 dirty만 남기고 다음 기회에 - 게임은 그대로 진행.
// 기기 기록 cloudMeta { owner, rev, dirty, syncedAt, lastUploadAt, loadedNotice? } (storage KEYS, 기기 전용 - 올리지 않음).
// 의존성은 init으로 받는다(테스트가 가짜 call·storage·reload를 끼운다).

const SAVE_KEY = 'gemGuardians.save.v2';
const META_KEY = 'cloudMeta';
export const UPLOAD_GAP_MS = 5 * 60e3; // 층 클리어·메뉴 복귀 업로드 간격(§1-E 3번)
const NOW_REASONS = new Set(['grant', 'pause', 'account']); // 간격 없이 바로

const int = (v) => (Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);
// 충돌 카드용 요약 - 서버 save_summary와 같은 규칙(이 기기 쪽 카드).
export function saveSummary(d) {
  const towers = Array.isArray(d?.towerLevels) ? d.towerLevels : [];
  return {
    bestFloor: int(d?.bestFloor),
    floor: int(d?.floor),
    diamonds: int(d?.diamonds),
    gold: int(d?.gold),
    towerSum: towers.reduce((a, v) => a + int(v), 0),
    tutorialDone: d?.tutorial?.done === true,
  };
}

export function createCloudSave() {
  let deps = null;
  let meta = null;
  let base = 0; // 다음 put의 baseRev
  let ready = false; // 시작 판정이 끝나 올려도 됨
  let blocked = false; // 충돌·서버 save 적용 - 이번 세션엔 더 올리지 않음(덮어쓰기 금지)
  let inflight = null;
  let again = false;
  let gen = 0; // 저장 횟수 - 업로드 중에 또 저장되면 dirty를 남긴다
  let lastTry = 0;
  let rank = null; // 다음 put에 실을 새 최고 층 { bestFloor, reachedAt }
  let held = false; // 계정 전환 중 - 다른 계정 id로 이 기기 save를 올리지 않게(src/net/account.js)
  let conflict = null; // 마지막 충돌의 서버 쪽 { rev, summary, updatedAt, deviceId, platform, data? }

  const on = () => !!meta && deps.net.on && !!deps.net.features?.cloudSave;
  const writeMeta = () => deps.storage.save(META_KEY, meta);

  // extra = { reason:'rewind', localRev } 등 body에 더 실을 것(force와 같이).
  async function put(force = false, extra = null) {
    const sentGen = gen;
    const sentRank = rank;
    lastTry = deps.now();
    const body = { baseRev: base, data: deps.playerState.snapshot(), deviceId: (await deps.deviceId) ?? null, appVersion: deps.appVersion };
    if (force) Object.assign(body, { force: true }, extra);
    if (sentRank) body.rank = sentRank;
    const res = await deps.call('save-put', body);
    if (res.ok) {
      base = res.rev;
      const t = deps.now();
      meta = { ...meta, owner: deps.net.playerId, rev: res.rev, dirty: gen !== sentGen, syncedAt: t, lastUploadAt: t };
      writeMeta();
      if (rank === sentRank) rank = null;
    } else if (res.reason === 'conflict') {
      blocked = true; // 다음 시작 때 판정에 맡긴다
      conflict = res.server ?? null;
    }
    // offline·rateLimited·error·tooBig: 조용히 dirty 유지
    return res;
  }

  const result = (res) =>
    res.ok ? { action: 'uploaded' } : res.reason === 'conflict' ? { action: 'conflict', server: res.server ?? null, kind: 'device' } : { action: 'none' };

  const api = {
    init({ playerState, storage, net, call, reload, deviceId = null, appVersion = '', now = Date.now }) {
      deps = { playerState, storage, net, call, reload, deviceId, appVersion, now };
      if (!net.enabled) return; // 서버 꺼짐 = 지금 동작 그대로(cloudMeta도 안 씀)
      meta = { owner: null, rev: 0, dirty: false, syncedAt: 0, lastUploadAt: 0, ...storage.load(META_KEY) };
      base = meta.rev;
      // 오프라인 세션도 dirty를 남겨야 다음 시작 때 서버 save가 이 진행을 덮지 않는다 -> net.on과 상관없이.
      playerState.onSaved = api.markDirty;
    },

    // hello 응답의 save 메타(rev·updatedAt·deviceId | null)로 §3-4 판정(docs/auth.md §12의 L1 판정 변경 반영).
    // 결과 { action: 'none'|'uploaded'|'applied'|'conflict', server?, kind? } - kind 'owner' = 이 계정 / 이 기기, 'device' = 다른 기기 / 이 기기.
    async syncOnStart(helloSave) {
      if (!on()) return { action: 'none' };
      const uid = deps.net.playerId;
      // 서버에 없음: 기기 save를 baseRev 0으로(owner가 달라도 - 덮을 게 없다).
      if (!helloSave) {
        ready = true;
        base = 0;
        return result(await put());
      }
      const S = helloSave.rev;
      const L = meta.rev;
      // owner 다름 + 이 계정에 서버 save 있음: 확인 없이 덮지 않는다 -> 충돌 팝업(이 계정 / 이 기기).
      // 서버 쪽 S > L, 기기 dirty: 두 기기에서 각각 진행 -> 충돌 팝업(다른 기기 / 이 기기).
      const owner = meta.owner !== uid;
      if (owner || (S > L && meta.dirty)) {
        const got = await deps.call('save-get');
        if (!got.ok || !got.save) return { action: 'none' }; // 못 받았으면 이번 세션은 올리지 않음(다음 시작 때 다시)
        blocked = true;
        conflict = got.save;
        return { action: 'conflict', server: got.save, kind: owner ? 'owner' : 'device' };
      }
      if (S > L) {
        const got = await deps.call('save-get');
        if (!got.ok || !got.save) return { action: 'none' };
        await api.applyServer(got.save);
        return { action: 'applied' };
      }
      ready = true;
      base = S;
      // S < L: 서버가 되감김(DB를 옛 백업으로 복구) - 기기가 더 새것이라 dirty 여부와 상관없이 force로 올림.
      if (S < L) return result(await put(true, { reason: 'rewind', localRev: L }));
      if (meta.dirty) return result(await put()); // S == L
      meta = { ...meta, syncedAt: deps.now() };
      writeMeta();
      return { action: 'none' };
    },

    markDirty() {
      gen++;
      if (meta && !meta.dirty) {
        meta = { ...meta, dirty: true };
        writeMeta();
      }
    },

    // dirty(또는 실을 랭킹)면 put. grant·pause·account는 바로, floor·menu는 마지막 업로드 시도 후 5분 지났을 때만.
    async flush(reason) {
      if (!on() || !ready || blocked || held) return null;
      if (!meta.dirty && !rank) return null;
      const now = NOW_REASONS.has(reason);
      if (!now && deps.now() - lastTry < UPLOAD_GAP_MS) return null;
      if (inflight) {
        if (now) again = true;
        return inflight;
      }
      inflight = put();
      const res = await inflight.finally(() => {
        inflight = null;
      });
      if (again) {
        again = false;
        return api.flush('account');
      }
      return res;
    },

    // 계정 연결·로그아웃 전(docs/auth.md §5-1 2번): 서버가 이 기기 save와 같아졌으면 true(안 바뀌었으면 호출 없이 true).
    async ensureUploaded() {
      if (!on() || !ready || blocked || held) return false;
      if (meta.dirty || rank) await api.flush('account');
      return !meta.dirty && !rank;
    },

    // 계정 전환 동안 업로드 멈춤(true) / 다시(false).
    hold(v) {
      held = !!v;
    },

    // 새 최고 층 -> 다음 put의 body.rank. 실을 수 없으면 false(호출부가 예전처럼 rank-normal).
    noteRank(bestFloor, reachedAt) {
      if (!on() || !ready || blocked) return false;
      rank = { bestFloor, reachedAt };
      return true;
    },

    // 서버 data로 save.v2를 바꾸고 다시 불러오기(실행 중에 playerState를 갈아끼우지 않는다).
    async applyServer(save) {
      blocked = true;
      deps.playerState.saveBlocked = true; // reload 전 저장이 받은 save를 덮지 않게
      deps.storage.save(SAVE_KEY, save.data);
      meta = { ...meta, owner: deps.net.playerId, rev: save.rev, dirty: false, syncedAt: deps.now(), loadedNotice: true };
      writeMeta();
      await deps.storage.flush();
      deps.reload();
    },

    // 충돌에서 서버 쪽을 고름 - 충돌 응답에 data가 없으면(업로드 중 충돌) 받아서 적용.
    async applyConflictServer() {
      const s = conflict?.data ? conflict : (await deps.call('save-get')).save;
      if (!s) return false;
      await api.applyServer(s);
      return true;
    },

    // 충돌에서 '이 기기'를 고름: force put(서버는 이전 것을 save_backups(overwrite)로 남김).
    async forceUpload() {
      if (!on()) return null;
      const res = await put(true);
      if (res.ok) {
        blocked = false;
        ready = true;
        conflict = null;
      } else blocked = true; // 실패면 다음 시작 때 다시 묻는다
      return res;
    },

    // 설정 한 줄용. offline = 서버는 켜져 있는데 연결 안 됨(저장 대기 중).
    status() {
      return { on: on(), offline: !!meta && !deps.net.on, lastSyncAt: meta?.syncedAt ?? 0, dirty: !!meta?.dirty };
    },

    // 서버 save를 불러와 다시 뜬 첫 화면 - 토스트 한 번.
    takeLoadedNotice() {
      if (!meta?.loadedNotice) return false;
      const { loadedNotice, ...rest } = meta;
      meta = rest;
      writeMeta();
      return true;
    },

    // 개발 패널: rev 충돌 흉내(cloudMeta.rev-1 + dirty) - 다음 시작 때 충돌 팝업.
    devFakeConflict() {
      if (!meta) return;
      meta = { ...meta, rev: meta.rev - 1, dirty: true };
      writeMeta();
    },
  };
  return api;
}

export const CloudSave = createCloudSave();
