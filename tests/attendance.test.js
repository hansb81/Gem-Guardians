// 출석 보상표: config/attendance.json(게임) == server/supabase/functions/_shared/attendance.ts(서버 판정).
// 그리고 서버가 꺼져 있을 때 net 계층이 아무 요청도 안 하는지.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initNet, net, call } from '../src/net/api.js';
import { AttendanceService } from '../src/net/services.js';
import { autoOpenAttendance } from '../src/game/serverUi.js';
import { storage } from '../src/platform/storage.js';

test('출석 보상표: config와 서버 사본이 같다(days·streak)', () => {
  const cfg = JSON.parse(readFileSync(new URL('../config/attendance.json', import.meta.url), 'utf8'));
  const ts = readFileSync(new URL('../server/supabase/functions/_shared/attendance.ts', import.meta.url), 'utf8');
  // TS 파일이지만 값 부분은 순수 JS 리터럴 - export마다 "= 값;"을 잘라 읽는다.
  const server = (name) => Function(`return ${ts.match(new RegExp(`export const ${name} = ([^;]*);`))[1]}`)();
  assert.equal(cfg.days.length, 7);
  assert.deepEqual(server('ATTENDANCE_DAYS'), cfg.days);
  assert.deepEqual(server('ATTENDANCE_STREAK'), cfg.streak);
  assert.ok(cfg.streak.goal > 0);
});

test('출석 정령석(docs/spirit-stones.md B): 7일째 5, 연속 보너스 5, 받은 번들 그대로 지급(txId att:{날짜})', async () => {
  const cfg = JSON.parse(readFileSync(new URL('../config/attendance.json', import.meta.url), 'utf8'));
  assert.deepEqual(cfg.days[6], { diamonds: 50, items: { rainbow: 1 }, spiritStones: 5 });
  assert.deepEqual(cfg.streak.bonus, { diamonds: 30, items: { revive: 1 }, spiritStones: 5 });
  assert.ok(cfg.days.slice(0, 6).every((d) => !d.spiritStones), '1~6일째는 그대로');
  // 판 7일째 + 연속 7일째가 겹친 날 서버가 합친 번들(bundle_add, server/supabase/tests/att_streak_test.ts가 SQL로 확인) -> 정령석 10.
  const { Inventory } = await import('../src/game/inventory.js');
  const inv = new Inventory(null, { wallet: { gold: 0, diamonds: 0 } });
  const bundle = { diamonds: 80, items: { rainbow: 1, revive: 1 }, spiritStones: cfg.days[6].spiritStones + cfg.streak.bonus.spiritStones };
  const api = { call: async (name) => (name === 'att-claim' ? { ok: true, day: 7, txId: 'att:2026-11-25', bundle, streak: 7, streakBonus: cfg.streak.bonus } : { ok: true }), syncClaims: async () => [] };
  const res = await new AttendanceService(inv, api).claim();
  assert.equal(res.delta.spiritStones, 10);
  assert.equal(inv.spiritStones, 10);
  assert.ok(inv.data.grantedTx.includes('att:2026-11-25'));
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

test('출석 서비스: 받기 응답의 streak를 status에 넣고, 연속 보너스는 결과로 돌려준다(지급은 합친 bundle 1번)', async () => {
  const grants = [];
  const inventory = { grant: (bundle, meta) => (grants.push([bundle, meta.txId]), { ok: true, delta: bundle }) };
  const bonus = { diamonds: 30, items: { revive: 1 } };
  const bundle = { diamonds: 80, items: { rainbow: 1, revive: 1 } };
  const calls = [];
  const api = {
    call: async (name) => (calls.push(name), name === 'att-claim' ? { ok: true, day: 7, txId: 'att:2026-11-21', bundle, streak: 7, streakBonus: bonus } : { ok: true }),
    syncClaims: async () => [],
  };
  const att = new AttendanceService(inventory, api);
  att.status = { ok: true, today: '2026-11-21', days: 6, claimedToday: false, rewards: [], streak: 6, streakBroken: false, streakGoal: 7, streakBonus: bonus };
  const res = await att.claim();
  assert.deepEqual(grants, [[bundle, 'att:2026-11-21']]);
  assert.deepEqual([res.ok, res.streakBonus], [true, bonus]);
  assert.deepEqual([att.status.days, att.status.claimedToday, att.status.streak, att.status.streakBonusGot], [7, true, 7, bonus]);
  assert.equal(att.status.streakBonus, bonus, '보상표는 그대로');
  assert.deepEqual(calls, ['att-claim', 'claims-granted']);

  // 보너스 없는 날 + 끊겼던 상태에서 받으면 1일.
  api.call = async (name) => (name === 'att-claim' ? { ok: true, day: 4, txId: 'att:2026-11-25', bundle: { diamonds: 10 }, streak: 1, streakBonus: null } : { ok: true });
  att.status = { ok: true, today: '2026-11-25', days: 3, claimedToday: false, rewards: [], streak: 0, streakBroken: true, streakGoal: 7, streakBonus: bonus };
  assert.equal((await att.claim()).streakBonus, null);
  assert.deepEqual([att.status.streak, att.status.streakBroken, att.status.streakBonusGot], [1, false, null]);
});

test('출석 팝업 자동 열기: 하루 1번(서버 today 기준), 받았거나 튜토리얼 전·다른 팝업 중이면 안 연다', () => {
  const att = { status: { ok: true, today: '2026-11-21', claimedToday: false } };
  const menu = { popup: null };
  assert.equal(autoOpenAttendance(null, menu, true), false, '서버 꺼짐');
  assert.equal(autoOpenAttendance({ status: null }, menu, true), false, '상태 아직 모름');
  assert.equal(autoOpenAttendance(att, menu, false), false, '튜토리얼 전');
  menu.popup = 'coupon';
  assert.equal(autoOpenAttendance(att, menu, true), false, '다른 팝업');
  assert.equal(storage.load('attAutoDate'), null, '안 열었으면 기록도 안 함');
  menu.popup = null;
  assert.equal(autoOpenAttendance(att, menu, true), true);
  assert.equal(menu.popup, 'attendance');
  assert.equal(storage.load('attAutoDate'), '2026-11-21');
  menu.popup = null; // 닫음
  assert.equal(autoOpenAttendance(att, menu, true), false, '같은 날 두 번째');
  att.status = { ok: true, today: '2026-11-22', claimedToday: true };
  assert.equal(autoOpenAttendance(att, menu, true), false, '이미 받은 날');
  att.status.claimedToday = false;
  assert.equal(autoOpenAttendance(att, menu, true), true, '다음 날 다시 1번');
});
