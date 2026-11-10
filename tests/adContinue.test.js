// 패배 팝업 이어하기 판정(src/game/adContinue.js, docs/ads.md 2장).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continueOptions, usedToday, recordUse, kstDay } from '../src/game/adContinue.js';

const CFG = { enabled: true, dailyCap: 5, sharePerFloorWithRevive: true, competitive: false, loadTimeoutMs: 8000 };
const KST = (iso) => Date.parse(`${iso}+09:00`);
const base = { cfg: CFG, mode: 'normal', tutorial: false, featherOk: true, floorLeft: 1, adReady: true, save: null, nowMs: KST('2026-11-10T12:00:00') };

test('기본: 깃털·광고 둘 다', () => {
  assert.deepEqual(continueOptions(base), { revive: true, ad: true });
});

test('층당 공유: floorLeft 0이면 광고 없음, 깃털 판정은 호출부(canUse) 그대로', () => {
  assert.equal(continueOptions({ ...base, floorLeft: 0 }).ad, false);
  assert.equal(continueOptions({ ...base, featherOk: false }).revive, false);
});

test('dailyCap: 오늘 5회 쓰면 숨김, KST 0시에 리셋', () => {
  let save = null;
  const t = base.nowMs;
  for (let i = 0; i < 5; i++) save = recordUse(save, t);
  assert.equal(usedToday(save, t), 5);
  assert.equal(continueOptions({ ...base, save }).ad, false);
  assert.equal(continueOptions({ ...base, save, nowMs: KST('2026-11-10T23:59:59') }).ad, false, '같은 KST 날');
  assert.equal(continueOptions({ ...base, save, nowMs: KST('2026-11-11T00:00:00') }).ad, true, 'KST 0시 리셋');
  // UTC 15:00 = KST 0시 경계
  assert.equal(kstDay(Date.parse('2026-11-10T14:59:59Z')) + 1, kstDay(Date.parse('2026-11-10T15:00:00Z')));
  assert.deepEqual(recordUse(save, KST('2026-11-11T09:00:00')), { day: kstDay(KST('2026-11-11T09:00:00')), count: 1 });
});

test('광고 불가(caps.rewarded=false, 광고 제거 없음)면 광고 숨김 - adFree면 adReady=true로 같은 규칙', () => {
  assert.equal(continueOptions({ ...base, adReady: false }).ad, false);
  assert.equal(continueOptions({ ...base, adReady: true, save: { day: kstDay(base.nowMs), count: 5 } }).ad, false, 'adFree도 dailyCap 같음');
});

test('튜토리얼 중 광고 숨김, enabled=false면 숨김', () => {
  assert.deepEqual(continueOptions({ ...base, tutorial: true }), { revive: true, ad: false });
  assert.equal(continueOptions({ ...base, cfg: { ...CFG, enabled: false } }).ad, false);
});

test('경쟁 모드: 깃털·광고 둘 다 없음(competitive:false), 허용하면 일반과 같음', () => {
  assert.deepEqual(continueOptions({ ...base, mode: 'competitive' }), { revive: false, ad: false });
  assert.deepEqual(continueOptions({ ...base, mode: 'competitive', cfg: { ...CFG, competitive: true } }), { revive: true, ad: true });
});
