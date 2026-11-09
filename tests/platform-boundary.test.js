// 저장은 src/platform(어댑터)만 만진다 - 게임 코드가 localStorage/sessionStorage를 직접 부르면 토스·Capacitor
// 빌드에서 세이브가 어댑터 저장소와 갈라진다(docs/platforms.md 2·4장). 주석 속 언급은 허용.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const PLATFORM = join(SRC, 'platform') + sep;

function* jsFiles(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* jsFiles(p);
    else if (e.name.endsWith('.js')) yield p;
  }
}

// shortcut: 주석 제거가 단순 정규식 - 문자열 안의 '//'(URL 등)도 주석으로 보고 뒤를 버린다. 오탐 없이 놓칠 수만 있다.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('src/platform 밖에서는 localStorage/sessionStorage를 직접 부르지 않는다', () => {
  const hits = [];
  for (const file of jsFiles(SRC)) {
    if (file.startsWith(PLATFORM)) continue;
    stripComments(readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
      if (/\b(localStorage|sessionStorage)\b/.test(line)) hits.push(`${relative(SRC, file)}:${i + 1}`);
    });
  }
  assert.deepEqual(hits, []);
});
