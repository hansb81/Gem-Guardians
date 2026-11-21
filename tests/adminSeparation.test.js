// 게임 빌드에 관리자 페이지가 섞이지 않는다(docs/admin.md §3): 게임 vite 빌드(web)를 임시 폴더로 돌려
// admin 파일 이름·관리자 코드 문자열이 없는지 본다. 관리자 빌드는 vite.config.admin.js -> dist-admin 따로.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';

// admin/src에만 있는 문자열(세션 키·action 이름·화면 제목)
const MARKERS = ['gg-admin-auth', 'grant.preview', 'mail.broadcast', 'purchase.regrant', 'Gem Guardians 관리자'];

test('게임 web 빌드 결과에 admin 파일·관리자 코드 없음', { timeout: 180e3 }, async () => {
  const out = mkdtempSync(join(tmpdir(), 'gg-game-dist-'));
  try {
    await build({ configFile: 'vite.config.js', mode: 'web', logLevel: 'error', build: { outDir: out, emptyOutDir: true } });
    const files = readdirSync(out, { recursive: true, withFileTypes: true }).filter((f) => f.isFile());
    assert.ok(files.length > 10, '빌드 결과가 있어야 함');
    for (const f of files) {
      const rel = join(f.parentPath, f.name).slice(out.length);
      assert.ok(!/admin/i.test(rel), `admin 이름 파일: ${rel}`);
      if (!/\.(js|html|css|json|txt|webmanifest)$/.test(f.name)) continue;
      const text = readFileSync(join(f.parentPath, f.name), 'utf8');
      for (const m of MARKERS) assert.ok(!text.includes(m), `${rel}에 관리자 코드 '${m}'`);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
