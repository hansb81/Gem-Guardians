// 보상 광고(docs/server.md §8-2). 배치 기획 전이라 AD_PLACEMENTS는 비어 있다 - 비어 있으면 ad-nonce/ad-claim은
// unknownPlacement. 배치를 정하면 여기에 { 보상 bundle, 하루 한도 } 한 줄씩(값진 보상만 - 싼 보상은 서버 없이 기기 판정).
//   예) chest: { bundle: { diamonds: 5 }, perDay: 3 }
export const AD_PLACEMENTS: Record<string, { bundle: Record<string, unknown>; perDay: number }> = {};

// ---------- AdMob SSV 서명 확인 ----------
// 콜백 쿼리 = ...&signature=<base64url DER ECDSA>&key_id=<id> (signature·key_id가 항상 끝).
// 서명 대상 = "&signature=" 앞까지의 쿼리 문자열 그대로. 공개키 = verifier-keys.json(P-256 SPKI base64), 24시간 캐시.
const KEYS_URL = "https://www.gstatic.com/admob/reward/verifier-keys.json";
let keys = new Map<string, CryptoKey>();
let keysAt = 0;

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

// DER SEQUENCE{INTEGER r, INTEGER s} -> r||s 64바이트(WebCrypto ECDSA 형식).
export function derToRaw(der: Uint8Array): Uint8Array {
  if (der[0] !== 0x30) throw new Error("not DER");
  let i = der[1] & 0x80 ? 2 + (der[1] & 0x7f) : 2;
  const out = new Uint8Array(64);
  for (let k = 0; k < 2; k++) {
    if (der[i] !== 0x02) throw new Error("not INTEGER");
    const len = der[i + 1];
    let v = der.subarray(i + 2, i + 2 + len);
    while (v.length > 32 && v[0] === 0) v = v.subarray(1);
    out.set(v, k * 32 + 32 - v.length);
    i += 2 + len;
  }
  return out;
}

export async function importKeys(json: { keys: { keyId: number | string; base64: string }[] }) {
  const m = new Map<string, CryptoKey>();
  for (const k of json.keys ?? []) {
    m.set(String(k.keyId), await crypto.subtle.importKey("spki", b64(k.base64), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]));
  }
  return m;
}

async function keyOf(id: string) {
  if (!keys.has(id) || Date.now() - keysAt > 86400e3) {
    const res = await fetch(KEYS_URL, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`admob keys ${res.status}`);
    keys = await importKeys(await res.json());
    keysAt = Date.now();
  }
  return keys.get(id) ?? null;
}

// 쿼리 문자열(앞 '?' 없이) -> 서명이 맞으면 파라미터, 아니면 null. getKey는 테스트에서 바꿔 끼운다.
export async function verifySsv(query: string, getKey: (id: string) => Promise<CryptoKey | null> = keyOf) {
  const at = query.indexOf("&signature=");
  if (at < 0) return null;
  const params = new URLSearchParams(query);
  const sig = params.get("signature");
  const key = await getKey(params.get("key_id") ?? "");
  if (!sig || !key) return null;
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, derToRaw(b64(sig)),
    new TextEncoder().encode(query.slice(0, at)));
  return ok ? params : null;
}
