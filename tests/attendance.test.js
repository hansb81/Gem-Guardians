// 출석 보상표: config/attendance.json(게임) == server/supabase/functions/_shared/attendance.ts(서버 판정).
// 그리고 서버가 꺼져 있을 때 net 계층이 아무 요청도 안 하는지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initNet, net, call } from '../src/net/api.js';
import { AttendanceService } from '../src/net/services.js';

test('출석 보상표: config와 서버 사본이 같다', () => {
  const cfg = JSON.parse(readFileSync(new URL('../config/attendance.json', import.meta.url), 'utf8'));
  const ts = readFileSync(new URL('../server/supabase/functions/_shared/attendance.ts', import.meta.url), 'utf8');
  const literal = ts.slice(ts.indexOf('['), ts.lastIndexOf(']') + 1);
  const server = Function(`return ${literal}`)(); // TS 파일이지만 값 부분은 순수 JS 리터럴
  assert.equal(cfg.days.length, 7);
  assert.deepEqual(server, cfg.days);
});

test('서버 꺼짐: fetch를 한 번도 부르지 않고 offline', async () => {
  const orig = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error('no');
  };
  try {
    await initNet({ enabled: false, url: 'http://x', anonKey: 'k', features: { attendance: true } });
    assert.equal(net.enabled, false);
    assert.deepEqual(await call('hello'), { ok: false, reason: 'offline' });
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = orig;
  }
});

test('출석 서비스: 로그인 전(오프라인)이면 offline, 받기도 offline', async () => {
  const att = new AttendanceService({ grant: () => assert.fail('지급하면 안 됨') });
  assert.deepEqual(await att.refresh(), { ok: false, reason: 'offline' });
  assert.equal(att.canClaim(), false);
  assert.equal((await att.claim()).reason, 'offline');
});
