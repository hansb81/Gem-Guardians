// grantedTx 90일 정리(src/core/inventory/inventory.js pruneGrantedTx, docs/auth.md §1-E).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneGrantedTx } from '../src/core/inventory/inventory.js';

const TODAY = '2026-11-13';
const ago = (n) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400e3).toISOString().slice(0, 10);
// ISO 주 번호(월요일 날짜 기준)
function isoWeek(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  const th = new Date(d.getTime() + (3 - ((d.getUTCDay() + 6) % 7)) * 86400e3);
  const jan1 = Date.UTC(th.getUTCFullYear(), 0, 1);
  return `${th.getUTCFullYear()}-W${String(Math.floor((th - jan1) / 86400e3 / 7) + 1).padStart(2, '0')}`;
}

test('각 형식: 91일 전은 지우고 89일 전은 남김', () => {
  for (const f of [(d) => `att:${d}`, (d) => `free:${d}`, (d) => `pass:monthly:${d}`, (d) => `ad:chest:${d}:3`]) {
    assert.deepEqual(pruneGrantedTx([f(ago(91)), f(ago(89))], TODAY), [f(ago(89))]);
  }
  // rank: 그 주 월요일 기준. 2026-08-10(월) = 95일 전, 2026-08-17(월) = 88일 전.
  assert.equal(isoWeek('2026-08-10'), '2026-W33');
  assert.deepEqual(pruneGrantedTx(['rank:2026-W33', 'rank:2026-W34'], TODAY), ['rank:2026-W34']);
});

test('평생 한 번짜리·모르는 형식·못 읽는 날짜는 그대로', () => {
  const keep = ['start:hammer', 'unlock:defuse', 'boss:10', 'iap:dia.3:GPA.1-2-3', 'refund:iap:pack.adfree:GPA.9', 'coupon:WELCOME',
    'mail:123', 'tutorial_complete', 'event:halloween:2020-01-01', 'att:2020-02-31', 'att:soon', 'rank:2020-W60', 'pass:2020-01-01'];
  assert.deepEqual(pruneGrantedTx(keep, TODAY), keep);
  assert.deepEqual(pruneGrantedTx(keep, 'bad-day'), keep, '오늘을 못 읽으면 안 건드림');
});

test('2년치(출석·무료·월간 패스 매일, 시즌·우편 주 1, 쿠폰 월 1, 결제 60) -> 정리 후 약 600개 이하', () => {
  const tx = ['tutorial_complete', ...Array.from({ length: 15 }, (_, i) => `start:i${i}`), ...Array.from({ length: 9 }, (_, i) => `boss:${(i + 1) * 10}`)];
  for (let n = 730; n >= 0; n--) {
    const d = ago(n);
    tx.push(`att:${d}`, `free:${d}`, `pass:monthly:${d}`);
    if (n % 7 === 0) tx.push(`rank:${isoWeek(d)}`, `mail:${n}`);
    if (n % 30 === 0) tx.push(`coupon:c${n}`);
    if (n % 12 === 0) tx.push(`iap:dia.3:GPA.${n}`);
  }
  const kept = pruneGrantedTx(tx, TODAY);
  assert.ok(tx.length > 2300, `정리 전 ${tx.length}`);
  assert.ok(kept.length <= 600, `정리 후 ${kept.length}`);
  assert.ok(kept.includes('att:' + ago(90)) && !kept.includes('att:' + ago(91)));
});
