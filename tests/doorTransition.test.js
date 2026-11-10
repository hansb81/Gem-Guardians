// 문 열림 전환(assets/title/door_transition_spec.md)의 타임라인 테스트. 그림은 눈으로
// 보는 수밖에 없지만, 구간 경계와 알파 곡선은 숫자로 고정해 둔다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DOOR_TRANSITION_MS, uiFadeAlpha, menuFadeAlpha } from '../src/render/doorTransition.js';

test('전환 길이는 spec대로 1.6초', () => {
  assert.equal(DOOR_TRANSITION_MS, 1600);
});

test('로고/글자는 0~300ms에 사라지고 그 뒤로는 계속 0', () => {
  assert.equal(uiFadeAlpha(0), 1);
  assert.equal(uiFadeAlpha(150), 0.5);
  assert.equal(uiFadeAlpha(300), 0);
  assert.equal(uiFadeAlpha(1600), 0);
});

test('메뉴 크로스페이드는 1100ms에 시작해 1600ms에 끝난다(ease in-out)', () => {
  assert.equal(menuFadeAlpha(0), 0);
  assert.equal(menuFadeAlpha(1100), 0);
  assert.equal(menuFadeAlpha(1350), 0.5); // 가운데
  assert.equal(menuFadeAlpha(DOOR_TRANSITION_MS), 1);
  // 단조 증가 - 중간에 되돌아가면 화면이 깜빡인다.
  let prev = -1;
  for (let t = 1050; t <= 1700; t += 25) {
    const a = menuFadeAlpha(t);
    assert.ok(a >= prev, `t=${t}`);
    prev = a;
  }
});
