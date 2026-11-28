// 이벤트(docs/events.md): 기간 표시(KST), 버튼 상태, 자동 열기 조건, 탭/드래그 구분, 모르는 kind 숨김, EventService 지급 흐름.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventPeriodText, eventButtonState, pickAutoOpenEvent, isTap, knownEvents, hasClaimableEvent } from '../src/game/eventRules.js';
import { EventService } from '../src/net/services.js';

const START = Date.parse('2026-12-01T00:00:00+09:00');
const END = Date.parse('2026-12-31T23:59:59+09:00');
const ev = (o = {}) => ({ id: 'launch2026', kind: 'claim', claimed: false, startsAt: START, endsAt: END, ...o });

test('기간 표시는 KST 기준(UTC로는 11월 30일이어도 12월 1일)', () => {
  assert.equal(eventPeriodText(START, END, 'ko'), '12월 1일 ~ 12월 31일');
  assert.equal(eventPeriodText(START, END, 'en'), 'Dec 1 – Dec 31');
  assert.equal(eventPeriodText(START, END, 'ko', true), '12월 1일 ~ 12월 31일 23:59');
  assert.equal(eventPeriodText(START, END, 'en', true), 'Dec 1 – Dec 31 23:59');
  assert.equal(eventPeriodText(null, END, 'ko'), '');
});

test('버튼 상태: 받음 > 받는 중 > 끝남 > 오프라인 > 받기, notice는 버튼 없음', () => {
  const now = START + 1000;
  assert.equal(eventButtonState(ev(), { now }), 'claim');
  assert.equal(eventButtonState(ev(), { now, busy: true }), 'busy');
  assert.equal(eventButtonState(ev({ claimed: true }), { now, busy: true, online: false }), 'claimed');
  assert.equal(eventButtonState(ev(), { now: END + 1, online: false }), 'expired');
  assert.equal(eventButtonState(ev({ expired: true }), { now }), 'expired'); // 서버가 expired라고 한 경우(기기 시계가 틀림)
  assert.equal(eventButtonState(ev(), { now, online: false }), 'offline');
  assert.equal(eventButtonState(ev({ kind: 'notice' }), { now }), null);
});

test('자동 열기: 튜토리얼·팝업·출석 차례 조건, 연 적 있는 것·받은 것·notice는 건너뜀', () => {
  const list = [ev({ id: 'a', claimed: true }), ev({ id: 'n', kind: 'notice' }), ev({ id: 'b' }), ev({ id: 'c' })];
  const ok = { tutorialDone: true, popupOpen: false, attDone: true };
  assert.equal(pickAutoOpenEvent(list, [], ok)?.id, 'b');
  assert.equal(pickAutoOpenEvent(list, ['b'], ok)?.id, 'c');
  assert.equal(pickAutoOpenEvent(list, ['b', 'c'], ok), null);
  assert.equal(pickAutoOpenEvent(list, [], { ...ok, tutorialDone: false }), null);
  assert.equal(pickAutoOpenEvent(list, [], { ...ok, popupOpen: true }), null);
  assert.equal(pickAutoOpenEvent(list, [], { ...ok, attDone: false }), null);
});

test('탭/드래그: 8 basis px 미만 이동만 탭(화면 배율 반영)', () => {
  assert.equal(isTap(100, 107, 1), true);
  assert.equal(isTap(100, 108, 1), false);
  assert.equal(isTap(100, 115, 2), true);
  assert.equal(isTap(100, 84, 2), false);
});

test('모르는 kind는 숨기고, 빨간 점은 안 받은 claim만', () => {
  assert.deepEqual(knownEvents([ev(), ev({ id: 'x', kind: 'login7' }), ev({ id: 'n', kind: 'notice' })]).map((e) => e.id), ['launch2026', 'n']);
  assert.deepEqual(knownEvents(null), []);
  assert.equal(hasClaimableEvent([ev({ claimed: true }), ev({ kind: 'notice' })]), false);
  assert.equal(hasClaimableEvent([ev({ claimed: true }), ev({ id: 'b' })]), true);
});

function fakeInventory() {
  const granted = new Set();
  return {
    granted,
    grant(bundle, { txId }) {
      if (granted.has(txId)) return { ok: false, reason: 'duplicate' };
      granted.add(txId);
      return { ok: true, delta: { ...bundle } };
    },
  };
}

test('EventService: 성공 = grant(txId) -> claims-granted, 목록 claimed, 제목 전달', async () => {
  const calls = [];
  const inv = fakeInventory();
  const api = {
    call: async (name, body) => {
      calls.push([name, body]);
      if (name === 'event-claim') return { ok: true, txId: 'event:launch2026', bundle: { diamonds: 100 }, title: { ko: '출시 기념 선물', en: 'Launch Gift' } };
      return { ok: true };
    },
    syncClaims: async () => [],
  };
  const s = new EventService(inv, api);
  s.setList([ev(), ev({ id: 'x', kind: 'login7' })]);
  assert.equal(s.list.length, 1);
  assert.equal(s.canClaim(), true);
  const res = await s.claim('launch2026');
  assert.deepEqual([res.ok, res.delta, res.title.ko], [true, { diamonds: 100 }, '출시 기념 선물']);
  assert.deepEqual(calls, [['event-claim', { eventId: 'launch2026' }], ['claims-granted', { txIds: ['event:launch2026'] }]]);
  assert.equal(s.list[0].claimed, true);
  assert.equal(s.canClaim(), false);
});

test('EventService: already = claimed 표시 + 미지급 복구, expired = 끝남 표시, 실패 목록 새로고침은 이전 목록 유지', async () => {
  let reason = 'already';
  let synced = 0;
  const api = {
    call: async (name) => (name === 'event-list' ? { ok: false, reason: 'offline' } : { ok: false, reason }),
    syncClaims: async () => void synced++,
  };
  const s = new EventService(fakeInventory(), api);
  s.setList([ev(), ev({ id: 'b' })]);
  assert.equal((await s.claim('launch2026')).reason, 'already');
  assert.deepEqual([s.list[0].claimed, synced], [true, 1]);
  reason = 'expired';
  await s.claim('b');
  assert.equal(eventButtonState(s.list[1], { now: START }), 'expired');
  await s.refresh();
  assert.equal(s.list.length, 2);
});
