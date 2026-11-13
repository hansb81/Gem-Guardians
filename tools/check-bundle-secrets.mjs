// 빌드 결과(dist)에 비밀 키가 섞였으면 실패. 웹 클라이언트에 들어가도 되는 건 Supabase Project URL + anon 키뿐.
// 사용: node tools/check-bundle-secrets.mjs [dist]   (npm run build:web 마지막 단계)
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEXT = /\.(js|mjs|css|html|json|webmanifest|txt|md|map)$/;
const JWT = /eyJ[\w-]+\.(eyJ[\w-]+)\.[\w-]+/g;
const KEYS = [
  /\bsk_[A-Za-z0-9]{20,}/, // RevenueCat·Stripe 등 secret key
  /\bsb_secret_[\w-]{10,}/, // Supabase 새 형식 secret key
];

/** 문자열에서 비밀 키 후보를 찾는다. anon이 아닌 JWT(service_role 등)도 포함. */
export function findSecrets(text) {
  const found = [];
  for (const m of text.matchAll(JWT)) {
    let role = null;
    try {
      role = JSON.parse(Buffer.from(m[1], 'base64url').toString()).role;
    } catch { /* JWT 모양만 닮은 문자열 */ }
    if (role && role !== 'anon') found.push(`JWT role=${role}`);
  }
  for (const re of KEYS) {
    const m = text.match(re);
    if (m) found.push(`${m[0].slice(0, 10)}...`);
  }
  return found;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2] ?? 'dist';
  let bad = 0;
  for (const f of readdirSync(dir, { recursive: true })) {
    if (!TEXT.test(f)) continue;
    for (const hit of findSecrets(readFileSync(join(dir, f), 'utf8'))) {
      console.error(`비밀 키 의심: ${f}: ${hit}`);
      bad++;
    }
  }
  if (bad) process.exit(1);
  console.log(`check-bundle-secrets: ${dir} OK`);
}
