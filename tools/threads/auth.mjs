// Threads 60일 토큰 발급(docs/threads-posting.md 5-2, 토큰 생성기를 못 쓸 때). 사용자가 터미널에서 직접 실행: npm run threads:auth
// 토큰은 화면에 찍지 않고 .env.threads 에만 쓴다.
import { existsSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';
import { ENV_FILE, api, mask, saveToken, secrets } from './post.mjs';

/** 주소창 URL(또는 code 그대로)에서 code를 꺼낸다. 끝의 '#_'는 Threads가 붙이는 꼬리. */
export function extractCode(input) {
  const s = input.trim();
  const code = /^https?:\/\//.test(s) ? new URL(s).searchParams.get('code') : s;
  return code?.replace(/#_$/, '') || null;
}

async function main() {
  if (!existsSync(ENV_FILE)) throw new Error('.env.threads 가 없습니다 (.env.threads.example 을 복사해 채우세요)');
  const env = parseEnv(readFileSync(ENV_FILE, 'utf8'));
  const { THREADS_APP_ID: id, THREADS_APP_SECRET: secret } = env;
  const redirect = env.THREADS_REDIRECT_URI || 'https://localhost/';
  if (!id || !secret) throw new Error('.env.threads 에 THREADS_APP_ID, THREADS_APP_SECRET 값이 필요합니다');
  secrets.add(secret);

  const auth = new URL('https://threads.net/oauth/authorize');
  auth.search = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    scope: 'threads_basic,threads_content_publish,threads_manage_replies,threads_read_replies',
    response_type: 'code',
  });
  console.log(`\n1) 브라우저에서 열고 로그인·허용:\n${auth}\n`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = extractCode(await rl.question('2) 이동된 주소창 URL 전체를 붙여 넣기: '));
  rl.close();
  if (!code) throw new Error('URL에서 code를 찾지 못했습니다');
  secrets.add(code);

  const short = await api('POST', 'https://graph.threads.net/oauth/access_token', {
    client_id: id, client_secret: secret, grant_type: 'authorization_code', redirect_uri: redirect, code,
  });
  secrets.add(short.access_token);
  const long = await api('GET', 'https://graph.threads.net/access_token', {
    grant_type: 'th_exchange_token', client_secret: secret, access_token: short.access_token,
  });
  secrets.add(long.access_token);
  const me = await api('GET', '/me', { fields: 'id,username', access_token: long.access_token });
  saveToken(long.access_token, new Date().toISOString().slice(0, 10));
  console.log(`\n@${me.username} 연결됨 (.env.threads 토큰·발급일 갱신)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`\n오류: ${mask(e.message)}`);
    process.exit(1);
  });
}
