import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeScreenFit } from '../src/render/screenFit.js';

const NO = { top: 0, right: 0, bottom: 0, left: 0 };

test('screenFit: 폰 1080x1920 = 정수 6배, 꽉 참', () => {
  const { frame, full } = computeScreenFit(1080, 1920, 3, NO);
  assert.deepEqual([frame.x, frame.y, frame.w, frame.h, frame.scale], [0, 0, 1080, 1920, 6]);
  assert.deepEqual(frame.css, { x: 0, y: 0, w: 360, h: 640 });
  assert.equal(full.css.w, 360);
});

test('screenFit: 데스크톱 1280x720 dpr1 = 2/2.25 < 0.92라 분수 2.25, 가로 가운데', () => {
  const { frame } = computeScreenFit(1280, 720, 1, NO);
  assert.equal(frame.scale, 2.25);
  assert.deepEqual([frame.x, frame.y, frame.w, frame.h], [438, 0, 405, 720]);
});

test('screenFit: 정수/분수 경계(0.92)와 r < 2는 분수', () => {
  assert.equal(computeScreenFit(1000, Math.round(320 * 2.17), 1, NO).frame.scale, 2); // 2/2.17 = 0.9217
  assert.ok(Math.abs(computeScreenFit(1000, 320 * 2.18, 1, NO).frame.scale - 2.18) < 1e-9); // 0.917
  assert.equal(computeScreenFit(300, 500, 1, NO).frame.scale, 500 / 320);
});

test('screenFit: insets를 빼고 그 안 가운데, 원점은 정수 기기 px', () => {
  const { frame } = computeScreenFit(1080, 1920, 3, { top: 40, right: 0, bottom: 30, left: 0 });
  assert.deepEqual([frame.x, frame.y, frame.w, frame.h, frame.scale], [90, 175, 900, 1600, 5]);
  assert.ok(frame.y >= 120 && frame.y + frame.h <= 1920 - 90);
});

test('screenFit: 배너 자리(높이+간격)를 아래에서 뺀다', () => {
  const { frame } = computeScreenFit(1080, 1920, 3, NO, 58);
  assert.ok(frame.scale > 5 && frame.scale < 6 && !Number.isInteger(frame.scale)); // 5/5.456 < 0.92
  assert.equal(frame.y + frame.h, 1920 - 58 * 3);
  assert.ok(Number.isInteger(frame.x) && Number.isInteger(frame.y));
});
