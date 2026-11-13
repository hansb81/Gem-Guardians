// storage KEYS(src/platform/storage.js): 여기 없는 키는 다음 실행 때 안 읽힌다 - locale이 빠져 언어가 늘 ko로 돌아가던 버그.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initStorage, storage } from '../src/platform/storage.js';

test('locale·cloudMeta는 다시 켜도 읽힌다', async () => {
  const mem = new Map([['dataEpoch', '1'], ['locale', '"en"'], ['cloudMeta', '{"owner":"me","rev":3}']]);
  await initStorage({ get: async (k) => mem.get(k) ?? null, set: async (k, v) => void mem.set(k, v), remove: async (k) => void mem.delete(k) });
  assert.equal(storage.load('locale'), 'en');
  assert.deepEqual(storage.load('cloudMeta'), { owner: 'me', rev: 3 });
  await storage.remove('locale');
  assert.equal(storage.load('locale'), null);
  assert.equal(mem.has('locale'), false);
});
