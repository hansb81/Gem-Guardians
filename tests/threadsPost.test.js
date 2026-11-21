import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countChars, countLinks, splitPieces, validate } from '../tools/threads/post.mjs';

test('countChars: 이모지는 UTF-8 바이트, 한글은 1자', () => {
  assert.equal(countChars('가나다'), 3);
  assert.equal(countChars('💎'), 4);
  assert.equal(countChars('a👍🏽'), 1 + Buffer.byteLength('👍🏽'));
});

test('splitPieces: --- 줄로만 나눈다', () => {
  assert.deepEqual(splitPieces('\n첫 글\n---\n답글 a---b\n---  \n\n'), ['첫 글', '답글 a---b']);
});

test('validate', () => {
  const ok = () => true;
  assert.deepEqual(validate({ status: 'draft', topic_tag: '인디게임', media: ['a.gif'] }, ['hi'], ok), []);
  assert.equal(validate({ status: 'posted' }, ['hi'], ok).length, 1);
  assert.equal(validate({ status: 'failed', threads_id: '1' }, ['hi'], ok).length, 1);
  assert.equal(validate({ status: 'draft', topic_tag: 'a.b' }, ['hi'], ok).length, 1);
  assert.equal(validate({ status: 'draft' }, ['가'.repeat(501)], ok).length, 1);
  assert.equal(validate({ status: 'draft' }, ['💎'.repeat(126)], ok).length, 1); // 504 바이트
  assert.equal(validate({ status: 'draft' }, ['https://a '.repeat(6)], ok).length, 1);
  assert.equal(validate({ status: 'draft', media: Array(21).fill('x') }, ['hi'], ok).length, 1);
  assert.equal(validate({ status: 'draft', media: ['x'] }, ['hi'], () => false).length, 1);
  assert.equal(countLinks('a http://x.com b https://y.kr/z'), 2);
});

test('extractCode: 주소창 URL에서 code, 끝의 #_ 제거', async () => {
  const { extractCode } = await import('../tools/threads/auth.mjs');
  assert.equal(extractCode('https://localhost/?code=AQBx12#_'), 'AQBx12');
  assert.equal(extractCode('  AQBx12#_ \n'), 'AQBx12');
  assert.equal(extractCode('https://localhost/?error=denied'), null);
});
