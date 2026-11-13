import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSecrets } from '../tools/check-bundle-secrets.mjs';

const jwt = (payload) => `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig_x`;

test('anon JWT·평범한 코드는 통과', () => {
  assert.deepEqual(findSecrets(`const k="${jwt({ role: 'anon' })}"; mask_value; "service_role 등 비밀값은 넣지 않는다"`), []);
});

test('service_role JWT·sk_·sb_secret_은 잡는다', () => {
  assert.equal(findSecrets(jwt({ role: 'service_role' })).length, 1);
  assert.equal(findSecrets('x="sk_AbCdEfGhIjKlMnOpQrStUv12"').length, 1);
  assert.equal(findSecrets('sb_secret_abcdefghijkl').length, 1);
});
