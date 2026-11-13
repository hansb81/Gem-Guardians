// 클라우드 저장 L1(src/net/cloudSave.js, docs/auth.md §3-4) - 시작 판정·업로드 간격·랭킹 실어 보내기·충돌·서버 save 적용.
// 앞쪽은 가짜 call·storage·reload로 CloudSave만, 뒤쪽은 fetch를 가짜로 바꿔 실제 serverUi·api·랭킹 서비스로 호출 수를 센다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createCloudSave, saveSummary, UPLOAD_GAP_MS } from '../src/net/cloudSave.js';
import { storage } from '../src/platform/storage.js';

const SERVER_DATA = { saveVersion: 3, gold: 9, diamonds: 1240, floor: 37, bestFloor: 37, towerLevels: [30, 30, 30, 30, 22] };

function setup({ meta = null, on = true, enabled = true, put = null } = {}) {
  const store = new Map();
  if (meta) store.set('cloudMeta', meta);
  const fakeStorage = {
    load: (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
    save: (k, v) => store.set(k, structuredClone(v)),
    flushes: 0,
    async flush() {
      this.flushes++;
    },
  };
  const calls = [];
  const handlers = {
    'save-put': put ?? ((b) => ({ ok: true, rev: b.force ? 99 : b.baseRev + 1 })),
    'save-get': () => ({ ok: true, save: { rev: 9, data: SERVER_DATA, summary: saveSummary(SERVER_DATA), updatedAt: 1, deviceId: 'other', platform: 'android' } }),
  };
  const call = async (name, body) => {
    calls.push({ name, body });
    return handlers[name]?.(body) ?? { ok: false, reason: 'offline' };
  };
  const player = {
    onSaved: null,
    saveBlocked: false,
    snapshot: () => ({ saveVersion: 3, bestFloor: 5, diamonds: 10, towerLevels: [1, 1, 1, 1, 1] }),
    save() {
      if (!this.saveBlocked) this.onSaved?.();
    },
  };
  const net = { enabled, on, features: { cloudSave: true }, playerId: 'me' };
  let t = 1_700_000_000_000;
  const reloads = [];
  const cs = createCloudSave();
  cs.init({ playerState: player, storage: fakeStorage, net, call, reload: () => reloads.push(1), deviceId: Promise.resolve('dev-1'), appVersion: '0.1.0', now: () => t });
  return { cs, calls, store, storage: fakeStorage, player, net, reloads, advance: (ms) => (t += ms), puts: () => calls.filter((c) => c.name === 'save-put') };
}

test('시작 판정: 서버에 save 없음 -> baseRev 0으로 올림, owner·rev 기록', async () => {
  const s = setup();
  assert.deepEqual(await s.cs.syncOnStart(null), { action: 'uploaded' });
  assert.equal(s.puts().length, 1);
  assert.equal(s.puts()[0].body.baseRev, 0);
  assert.equal(s.puts()[0].body.deviceId, 'dev-1');
  assert.deepEqual(s.puts()[0].body.data, s.player.snapshot());
  const m = s.store.get('cloudMeta');
  assert.equal(m.owner, 'me');
  assert.equal(m.rev, 1);
  assert.equal(m.dirty, false);
});

test('시작 판정: owner 다름 + 서버 save 없음 -> baseRev 0으로 올리고 owner 갱신', async () => {
  const s = setup({ meta: { owner: 'old-id', rev: 3, dirty: false } });
  assert.equal((await s.cs.syncOnStart(null)).action, 'uploaded');
  assert.equal(s.puts()[0].body.baseRev, 0);
  assert.equal(s.store.get('cloudMeta').owner, 'me');
});

test('시작 판정: owner 다름 + 서버 save 있음 -> conflict(이 계정 / 이 기기), put 0번', async () => {
  const s = setup({ meta: { owner: 'old-id', rev: 3, dirty: false } });
  const r = await s.cs.syncOnStart({ rev: 7, updatedAt: 1, deviceId: 'x' });
  assert.equal(r.action, 'conflict');
  assert.equal(r.kind, 'owner');
  assert.equal(r.server.summary.bestFloor, 37);
  assert.equal(s.puts().length, 0);
  assert.equal(s.reloads.length, 0);
  s.player.save();
  assert.equal(await s.cs.flush('grant'), null);
  assert.equal(s.puts().length, 0);
  // 서버 쪽을 고르면 applyServer(owner = 지금 id)
  await s.cs.applyConflictServer();
  assert.equal(s.store.get('cloudMeta').owner, 'me');
  assert.equal(s.reloads.length, 1);
});

for (const dirty of [false, true]) {
  test(`시작 판정: S < L, dirty ${dirty} -> force put(reason rewind, localRev), applyServer 안 부름`, async () => {
    const s = setup({ meta: { owner: 'me', rev: 12, dirty } });
    assert.equal((await s.cs.syncOnStart({ rev: 5 })).action, 'uploaded');
    assert.deepEqual(s.calls.map((c) => c.name), ['save-put']);
    const b = s.puts()[0].body;
    assert.equal(b.force, true);
    assert.equal(b.reason, 'rewind');
    assert.equal(b.localRev, 12);
    assert.equal(b.baseRev, 5);
    assert.equal(s.reloads.length, 0);
    assert.equal(s.store.has('gemGuardians.save.v2'), false);
    // 그 뒤 일반 업로드는 force 없이
    s.player.save();
    await s.cs.flush('grant');
    assert.equal(s.puts()[1].body.force, undefined);
  });
}

test('시작 판정: S == L - dirty면 올림, 아니면 아무 호출 없음', async () => {
  const dirty = setup({ meta: { owner: 'me', rev: 4, dirty: true } });
  assert.equal((await dirty.cs.syncOnStart({ rev: 4 })).action, 'uploaded');
  assert.equal(dirty.puts()[0].body.baseRev, 4);
  const clean = setup({ meta: { owner: 'me', rev: 4, dirty: false } });
  assert.equal((await clean.cs.syncOnStart({ rev: 4 })).action, 'none');
  assert.equal(clean.calls.length, 0);
});

test('시작 판정: S > L, 기기 dirty 아님 -> save-get 후 applied(save.v2·cloudMeta 쓰고 flush 뒤 reload)', async () => {
  const s = setup({ meta: { owner: 'me', rev: 4, dirty: false } });
  assert.equal((await s.cs.syncOnStart({ rev: 9 })).action, 'applied');
  assert.deepEqual(s.calls.map((c) => c.name), ['save-get']);
  assert.deepEqual(s.store.get('gemGuardians.save.v2'), SERVER_DATA);
  const m = s.store.get('cloudMeta');
  assert.equal(m.rev, 9);
  assert.equal(m.dirty, false);
  assert.equal(m.owner, 'me');
  assert.equal(s.storage.flushes, 1);
  assert.equal(s.reloads.length, 1);
  assert.equal(s.player.saveBlocked, true, 'reload 전 저장이 받은 save를 덮지 않음');
  // 다시 뜬 첫 화면 토스트는 한 번만.
  const after = setup({ meta: m });
  assert.equal(after.cs.takeLoadedNotice(), true);
  assert.equal(after.cs.takeLoadedNotice(), false);
});

test('시작 판정: S > L, 기기 dirty -> conflict(서버 쪽 요약 포함), 이번 세션엔 put 없음', async () => {
  const s = setup({ meta: { owner: 'me', rev: 4, dirty: true } });
  const r = await s.cs.syncOnStart({ rev: 9 });
  assert.equal(r.action, 'conflict');
  assert.equal(r.server.summary.bestFloor, 37);
  assert.equal(s.reloads.length, 0);
  s.player.save();
  assert.equal(await s.cs.flush('grant'), null);
  assert.equal(s.puts().length, 0);
  assert.equal(s.cs.noteRank(40, 1), false, '충돌 중이면 랭킹은 예전처럼 따로');
  // '이 기기'를 고르면 force put -> 다시 올릴 수 있음
  assert.equal((await s.cs.forceUpload()).ok, true);
  assert.equal(s.puts()[0].body.force, true);
  s.player.save();
  assert.equal((await s.cs.flush('grant')).ok, true);
  assert.equal(s.puts()[1].body.baseRev, 99);
});

test('간격: 5분 안에 floor·menu 10번 -> put 1번, grant·pause는 바로', async () => {
  const s = setup({ meta: { owner: 'me', rev: 4, dirty: false } });
  await s.cs.syncOnStart({ rev: 4 });
  for (let i = 0; i < 10; i++) {
    s.player.save();
    await s.cs.flush(i % 2 ? 'menu' : 'floor');
    s.advance(20e3); // 10번 = 200초 < 5분
  }
  assert.equal(s.puts().length, 1);
  s.player.save();
  await s.cs.flush('grant');
  s.player.save();
  await s.cs.flush('pause');
  assert.equal(s.puts().length, 3);
  // 5분이 지나면 floor도 다시
  s.player.save();
  s.advance(UPLOAD_GAP_MS);
  await s.cs.flush('floor');
  assert.equal(s.puts().length, 4);
  // dirty 아니면 안 올림
  await s.cs.flush('grant');
  assert.equal(s.puts().length, 4);
});

test('업로드 중에 또 저장되면 dirty가 남고, 바로 올릴 것은 끝난 뒤 한 번 더', async () => {
  let release;
  const s = setup({
    meta: { owner: 'me', rev: 1, dirty: false },
    put: (b) => new Promise((r) => (release = () => r({ ok: true, rev: b.baseRev + 1 }))),
  });
  await s.cs.syncOnStart({ rev: 1 });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  s.player.save();
  const first = s.cs.flush('grant');
  await tick(); // put이 deviceId를 기다린 뒤 call까지
  s.player.save(); // 업로드 중 저장
  s.cs.flush('grant'); // 진행 중 -> 끝나고 한 번 더
  release();
  await tick();
  assert.equal(s.store.get('cloudMeta').dirty, true, '중간 저장분은 남음');
  release(); // 끝난 뒤 한 번 더 올린 것
  await first;
  assert.equal(s.puts().length, 2);
  assert.equal(s.store.get('cloudMeta').dirty, false);
});

test('noteRank 후 put body에 rank, 성공하면 다음 put엔 없음', async () => {
  const s = setup({ meta: { owner: 'me', rev: 1, dirty: false } });
  await s.cs.syncOnStart({ rev: 1 });
  assert.equal(s.cs.noteRank(12, 555), true);
  await s.cs.flush('floor'); // dirty 아니어도 실을 랭킹이 있으면 올림
  assert.deepEqual(s.puts()[0].body.rank, { bestFloor: 12, reachedAt: 555 });
  s.player.save();
  await s.cs.flush('pause');
  assert.equal(s.puts()[1].body.rank, undefined);
});

test('업로드 중 conflict -> 그 세션에선 더 put 안 함, offline·rateLimited는 dirty 유지', async () => {
  let reason = 'offline';
  const s = setup({ meta: { owner: 'me', rev: 1, dirty: false }, put: () => ({ ok: false, reason }) });
  await s.cs.syncOnStart({ rev: 1 });
  s.player.save();
  await s.cs.flush('grant');
  assert.equal(s.store.get('cloudMeta').dirty, true);
  reason = 'rateLimited';
  await s.cs.flush('pause');
  assert.equal(s.store.get('cloudMeta').dirty, true);
  reason = 'conflict';
  await s.cs.flush('pause');
  assert.equal(s.puts().length, 3);
  s.player.save();
  await s.cs.flush('grant');
  await s.cs.flush('pause');
  assert.equal(s.puts().length, 3, '충돌 뒤엔 안 올림');
});

test('서버 꺼짐(net.enabled false)이면 call 0번, cloudMeta도 안 씀', async () => {
  const s = setup({ enabled: false, on: false });
  s.player.save();
  assert.deepEqual(await s.cs.syncOnStart(null), { action: 'none' });
  assert.equal(await s.cs.flush('grant'), null);
  assert.equal(s.cs.noteRank(5, 1), false);
  assert.equal(s.calls.length, 0);
  assert.equal(s.store.has('cloudMeta'), false);
  assert.equal(s.player.onSaved, null);
});

test('오프라인 시작(net.on false): 호출 없이 dirty만 남김 - 다음 시작 때 서버 save가 이 진행을 덮지 않게', async () => {
  const s = setup({ on: false, meta: { owner: 'me', rev: 2, dirty: false } });
  assert.equal((await s.cs.syncOnStart({ rev: 2 })).action, 'none');
  s.player.save();
  assert.equal(await s.cs.flush('pause'), null);
  assert.equal(s.calls.length, 0);
  assert.equal(s.store.get('cloudMeta').dirty, true);
  assert.deepEqual(s.cs.status(), { on: false, offline: true, lastSyncAt: 0, dirty: true });
});

test('adContinue 옛 키 -> save 안(playerState.adContinue)으로 옮겨지고 옛 키 삭제', async () => {
  storage.save('adContinue', { day: 20405, count: 3 });
  const { playerState } = await import('../src/game/playerState.js?adContinue');
  assert.deepEqual(playerState.adContinue, { day: 20405, count: 3 });
  assert.equal(storage.load('adContinue'), null);
  assert.deepEqual(storage.load('gemGuardians.save.v2').adContinue, { day: 20405, count: 3 });
  assert.deepEqual(playerState.snapshot().adContinue, { day: 20405, count: 3 });
});

// ---- 실제 serverUi·api·랭킹 서비스(fetch만 가짜) ----

test('시작: hello 한 번으로 출석·우편·claims가 채워지고 att-status·mail-list·claims-pending은 안 부름, 새 최고 층은 save-put에', async () => {
  const mem = new Map();
  const { platform } = await import('../src/platform/index.js');
  platform.storage = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => void mem.set(k, v), remove: async (k) => void mem.delete(k) };
  const fns = [];
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const res = (b) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.includes('/auth/v1/')) {
      return res({ access_token: 'tok', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'r', user: { id: 'uid-1', aud: 'authenticated', role: 'authenticated', is_anonymous: true } });
    }
    const name = u.split('/functions/v1/')[1];
    fns.push({ name, body: init?.body ? JSON.parse(init.body) : null });
    if (name === 'hello') {
      return res({
        ok: true, features: { cloudSave: true }, pending: 1,
        att: { ok: true, today: '2026-11-13', days: 2, claimedToday: false, rewards: [] },
        mail: { ok: true, mail: [{ id: 7, title: { ko: '선물', en: 'Gift' }, bundle: { diamonds: 5 }, expiresAt: null, claimed: false }] },
        claims: { ok: true, claims: [{ txId: 'coupon:WELCOME', kind: 'coupon', bundle: { diamonds: 5 } }] },
        save: null,
      });
    }
    if (name === 'save-put') return res({ ok: true, rev: 1 });
    return res({ ok: true });
  };
  try {
    const { setupServer } = await import('../src/game/serverUi.js');
    const { playerState } = await import('../src/game/playerState.js?hello');
    const { net, call } = await import('../src/net/api.js');
    const { CloudSave } = await import('../src/net/cloudSave.js');
    const { ServerRankingService } = await import('../src/ranking/serverRankingService.js');
    const before = playerState.diamonds;
    const menu = { showToast() {} };
    const ui = setupServer({ enabled: true, url: 'http://sb', anonKey: 'k', features: { attendance: true, mail: true } }, { menu, rewardPopup: {}, player: playerState });
    CloudSave.init({ playerState, storage, net, call, reload: () => {}, deviceId: 'dev-1', appVersion: 't' });
    await ui.started;
    assert.deepEqual((await CloudSave.syncOnStart(net.hello.save)).action, 'uploaded');

    const names = fns.map((f) => f.name);
    assert.equal(names.filter((n) => n === 'hello').length, 1);
    for (const n of ['att-status', 'mail-list', 'claims-pending', 'save-get']) assert.ok(!names.includes(n), `${n} 안 부름`);
    assert.equal(ui.att.status.days, 2);
    assert.equal(ui.mail.list[0].id, 7);
    assert.equal(ui.mail.unread(), 1);
    assert.equal(playerState.diamonds, before + 5, 'hello의 claims로 지급');
    assert.equal(menu.server.cloud().on, true);

    const ranking = new ServerRankingService({ player: playerState, config: JSON.parse(readFileSync(new URL('../config/ranking.json', import.meta.url), 'utf8')) });
    await ranking.submit('normal', { floor: 30, at: 1234 });
    await CloudSave.flush('pause');
    assert.ok(!fns.some((f) => f.name === 'rank-normal'), 'rank-normal 호출 0');
    const lastPut = fns.filter((f) => f.name === 'save-put').at(-1);
    assert.equal(lastPut.body.rank.bestFloor, 30);
  } finally {
    globalThis.fetch = origFetch;
  }
});
