import { defineConfig } from 'vite';
import { cpSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';

// 마켓 빌드 값(docs/platforms.md 5장): vite build --mode toss 처럼 mode로 고른다(PLATFORM 환경 변수가 있으면 우선).
const PLATFORMS = ['web', 'toss', 'android', 'onestore', 'ios'];

// 게임은 assets/·config/·src/config/*.json을 런타임 fetch로 읽는다(import 아님) - 빌드 결과에 그대로 복사한다.
function copyRuntimeFiles(platform) {
  return {
    name: 'copy-runtime-files',
    apply: 'build',
    writeBundle({ dir }) {
      cpSync('assets', `${dir}/assets`, { recursive: true });
      cpSync('config', `${dir}/config`, { recursive: true });
      for (const f of readdirSync('src/config')) if (f.endsWith('.json')) cpSync(`src/config/${f}`, `${dir}/src/config/${f}`);
      // 어느 마켓용 JS인지 표시 - Android flavor(play/onestore)가 빌드 전에 자기 이름과 맞는지 본다(android/app/build.gradle).
      writeFileSync(`${dir}/platform.txt`, platform === 'android' ? 'play' : platform);
      if (platform === 'web') writeWebFiles(dir);
    },
  };
}

// 웹(Cloudflare Pages) 전용: public/(_headers, manifest, sw.js, 아이콘) 복사 + sw.js에 버전·미리 받을 목록 채우기.
// 토스·Capacitor 빌드에는 넣지 않는다(서비스 워커·매니페스트가 필요 없고 WebView에서 오히려 캐시가 꼬인다).
function writeWebFiles(dir) {
  cpSync('public', dir, { recursive: true });
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((f) => f.isFile())
    .map((f) => relative(dir, join(f.parentPath, f.name)).replaceAll(sep, '/'))
    .filter((f) => f !== 'sw.js' && f !== '_headers')
    .sort();
  const hash = createHash('sha256');
  for (const f of files) hash.update(f).update(readFileSync(`${dir}/${f}`));
  const precache = files.filter((f) => !f.startsWith('assets/') && f !== 'platform.txt').map((f) => (f === 'index.html' ? './' : f));
  const sw = readFileSync('public/sw.js', 'utf8')
    .replace('__SW_VERSION__', hash.digest('hex').slice(0, 12))
    .replace('__SW_PRECACHE__', JSON.stringify(precache));
  writeFileSync(`${dir}/sw.js`, sw);
}

// 웹 빌드만 index.html에 매니페스트 링크(설치형 웹앱). 서비스 워커 등록은 src/boot.js.
function webManifestLink() {
  return {
    name: 'web-manifest-link',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: 'manifest.webmanifest' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'theme-color', content: '#0d0a10' }, injectTo: 'head' },
    ],
  };
}

export default defineConfig(({ mode }) => {
  const PLATFORM = process.env.PLATFORM || (PLATFORMS.includes(mode) ? mode : 'web');
  if (!PLATFORMS.includes(PLATFORM)) throw new Error(`PLATFORM must be one of ${PLATFORMS.join('|')}`);
  return {
  base: './', // 토스 .ait / Capacitor는 하위 경로·file 스킴에서 열리므로 상대 경로.
  publicDir: false,
  define: { __PLATFORM__: JSON.stringify(PLATFORM) },
  build: { outDir: 'dist', emptyOutDir: true, assetsDir: '_app' }, // 게임 assets/와 섞이지 않게.
  plugins: [copyRuntimeFiles(PLATFORM), PLATFORM === 'web' && webManifestLink()],
  };
});
