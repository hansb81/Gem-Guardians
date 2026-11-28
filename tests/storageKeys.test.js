// storage KEYS(src/platform/storage.js): 여기 없는 키는 다음 실행 때 안 읽힌다 - locale이 빠져 언어가 늘 ko로 돌아가던 버그.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initStorage, storage } from '../src/platform/storage.js';

test('locale·cloudMeta는 다시 켜도 읽힌다', async () => {
  const mem = new Map([['dataEpoch', '2'], ['locale', '"en"'], ['cloudMeta', '{"owner":"me","rev":3}']]);
  await initStorage({ get: async (k) => mem.get(k) ?? null, set: async (k, v) => void mem.set(k, v), remove: async (k) => void mem.delete(k) });
  assert.equal(storage.load('locale'), 'en');
  assert.deepEqual(storage.load('cloudMeta'), { owner: 'me', rev: 3 });
  await storage.remove('locale');
  assert.equal(storage.load('locale'), null);
  assert.equal(mem.has('locale'), false);
});

// 읽기 오류를 '없음'으로 보면 dataEpoch가 다르다며 세이브를 전부 지웠다(감사 1번).
test('저장소 읽기 오류면 아무것도 지우지 않고, 그 실행은 디스크에 쓰지 않는다', async () => {
  const mem = new Map([['dataEpoch', '2'], ['gemGuardians.save.v2', '{"bestFloor":40}']]);
  const removed = [];
  const store = {
    get: async () => {
      throw new Error('io');
    },
    set: async (k, v) => void mem.set(k, v),
    remove: async (k) => void removed.push(k),
  };
  await assert.rejects(initStorage(store));
  assert.deepEqual(removed, []);
  storage.save('gemGuardians.save.v2', { bestFloor: 1 });
  await storage.flush();
  assert.equal(mem.get('gemGuardians.save.v2'), '{"bestFloor":40}', '기본값으로 덮지 않는다');
});

test('쓰기 실패한 키는 다음 flush 때 다시 쓴다', async () => {
  const mem = new Map([['dataEpoch', '2']]);
  let fail = true;
  await initStorage({
    get: async (k) => mem.get(k) ?? null,
    set: async (k, v) => {
      if (fail) throw new Error('quota');
      mem.set(k, v);
    },
    remove: async (k) => void mem.delete(k),
  });
  storage.save('locale', 'en');
  await storage.flush();
  assert.equal(mem.has('locale'), false);
  fail = false;
  await storage.flush();
  assert.equal(mem.get('locale'), '"en"');
});

test('깨진 JSON은 load가 null이고 원문을 .corrupt 키에 남긴다', async () => {
  const mem = new Map([['dataEpoch', '2'], ['gemGuardians.save.v2', '{"bestFloor":4']]);
  await initStorage({ get: async (k) => mem.get(k) ?? null, set: async (k, v) => void mem.set(k, v), remove: async (k) => void mem.delete(k) });
  assert.equal(storage.load('gemGuardians.save.v2'), null);
  assert.equal(storage.has('gemGuardians.save.v2'), true);
  await storage.flush();
  assert.equal(mem.get('gemGuardians.save.v2.corrupt'), '{"bestFloor":4');
});

test('dataEpoch가 바뀌면 게스트 로그인 세션은 지우고 연결 계정 세션·결제 대기열은 남긴다', async () => {
  const run = async (user) => {
    const mem = new Map([['dataEpoch', '1'], ['gemGuardians.save.v2', '{"bestFloor":40}'], ['pendingVerify', '[{"id":"o1"}]'], ['gemGuardians.auth', JSON.stringify({ user })]]);
    await initStorage({ get: async (k) => mem.get(k) ?? null, set: async (k, v) => void mem.set(k, v), remove: async (k) => void mem.delete(k) });
    return mem;
  };
  const guest = await run({ id: 'g', is_anonymous: true });
  assert.equal(guest.has('gemGuardians.auth'), false);
  assert.equal(guest.has('gemGuardians.save.v2'), false);
  assert.equal(guest.get('pendingVerify'), '[{"id":"o1"}]');
  assert.deepEqual(storage.load('pendingVerify'), [{ id: 'o1' }]);
  assert.equal(guest.get('dataEpoch'), '2');
  const linked = await run({ id: 'l', is_anonymous: false });
  assert.equal(linked.has('gemGuardians.auth'), true);
  assert.equal(linked.has('gemGuardians.save.v2'), false);
});
