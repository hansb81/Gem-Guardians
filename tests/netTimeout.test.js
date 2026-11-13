// src/net/api.js initNet: Supabase 인증(세션 읽기·익명 로그인)이 멈추면 시간 상한 뒤 오프라인으로 계속(net.on false, hello 안 부름).
import test from 'node:test';
import assert from 'node:assert/strict';
import { initNet, net } from '../src/net/api.js';
import { platform } from '../src/platform/index.js';

test('익명 로그인이 응답 없으면 authTimeoutMs 뒤 오프라인으로 계속, hello 안 부름', async () => {
  const mem = new Map();
  platform.storage = { get: async (k) => mem.get(k) ?? null, set: async (k, v) => void mem.set(k, v), remove: async (k) => void mem.delete(k) };
  const urls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = (url) => {
    urls.push(String(url));
    return new Promise(() => {}); // 영영 응답 없음
  };
  try {
    const t0 = Date.now();
    await initNet({ enabled: true, url: 'http://sb', anonKey: 'k', features: {} }, { authTimeoutMs: 300 });
    const ms = Date.now() - t0;
    assert.ok(ms >= 250 && ms < 3000, `${ms}ms`);
    assert.equal(net.on, false);
    assert.equal(net.playerId, null);
    assert.ok(urls.some((u) => u.includes('/auth/v1/')), '익명 로그인은 시도');
    assert.ok(!urls.some((u) => u.includes('/functions/v1/hello')), 'hello 안 부름');
  } finally {
    globalThis.fetch = orig;
  }
});
