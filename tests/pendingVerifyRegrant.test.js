// 계정 삭제(또는 계정 전환으로 다른 save를 불러옴) 뒤 남은 pendingVerify가 새 save에 다시 지급되지 않는지
// (docs/auth.md §14). 지급이 끝난 항목은 서버 기록(iap-granted)만, 결제 직후 앱이 죽어 아직 못 준 항목은 지급.
import test from 'node:test';
import assert from 'node:assert/strict';
import { net } from '../src/net/api.js';
import { IapService } from '../src/net/services.js';
import { platform } from '../src/platform/index.js';
import { storage } from '../src/platform/storage.js';
import { withVerify, syncServerIap } from '../src/shop/iap.js';

// 실제 지급과 같은 규칙의 지갑: txId iap:{키}:{주문}가 grantedTx에 있으면 duplicate(delta null).
function wallet() {
  const w = { diamonds: 0, grantedTx: [] };
  w.onGrant = async (k, o) => {
    const tx = `iap:${k}:${o}`;
    if (w.grantedTx.includes(tx)) return { delta: null };
    w.grantedTx.push(tx);
    w.diamonds += 330;
    return { delta: { diamonds: 330 } };
  };
  return w;
}
function serverOn(strict, answers) {
  Object.assign(net, { enabled: true, on: true, features: { iapStrict: strict }, hello: null, playerId: 'P' });
  platform.dev = true;
  const granted = [];
  IapService.verify = async () => answers.shift() ?? { ok: false, reason: 'offline' };
  IapService.granted = (txId, bundle) => granted.push([txId, bundle]);
  return granted;
}
const sync = (w) => syncServerIap({ onGrant: w.onGrant, onRevoke: () => {}, grantedTx: () => w.grantedTx });

test('지급 끝난 pendingVerify 1건 + 계정 삭제(새 save) -> 재실행 뒤 다이아가 늘지 않고 서버 기록만', async () => {
  storage.save('pendingVerify', []);
  serverOn(false, [{ ok: false, reason: 'offline' }]);
  const before = wallet();
  await withVerify(before.onGrant)('dia.3', 'GPA.1'); // 오프라인 결제: 지급 + pendingVerify
  assert.equal(before.diamonds, 330);
  assert.equal(storage.load('pendingVerify')[0].granted, true);

  const fresh = wallet(); // 삭제 -> reload = 새 게스트 save(grantedTx 비어 있음), pendingVerify는 남음
  const granted = serverOn(false, [{ ok: true, txId: 'iap:dia.3:GPA.1' }]);
  await sync(fresh);
  assert.equal(fresh.diamonds, 0, '다시 지급 안 함');
  assert.deepEqual(granted, [['iap:dia.3:GPA.1', { diamonds: 330 }]], '서버엔 처음 준 bundle로 지급 기록');
  assert.deepEqual(storage.load('pendingVerify'), []);
});

test('아직 지급 안 된 건(iapStrict 보류·결제 직후 앱 종료)은 재확인 때 지급', async () => {
  storage.save('pendingVerify', []);
  serverOn(true, [{ ok: false, reason: 'offline' }]);
  const w = wallet();
  await withVerify(w.onGrant)('dia.3', 'GPA.2'); // strict: 지급 보류
  assert.equal(w.diamonds, 0);
  assert.equal(storage.load('pendingVerify')[0].granted, false);
  serverOn(true, [{ ok: true, txId: 'iap:dia.3:GPA.2' }]);
  await sync(w);
  assert.equal(w.diamonds, 330);
  assert.deepEqual(storage.load('pendingVerify'), []);
});

test('예전 형식(granted 없음): bundle이 있으면 지급 끝난 것으로 본다', async () => {
  storage.save('pendingVerify', [{ store: 'dev', productKey: 'dia.3', orderId: 'GPA.3', bundle: { diamonds: 330 } }]);
  const granted = serverOn(false, [{ ok: true, txId: 'iap:dia.3:GPA.3' }]);
  const fresh = wallet();
  await sync(fresh);
  assert.equal(fresh.diamonds, 0);
  assert.equal(granted.length, 1);
});
