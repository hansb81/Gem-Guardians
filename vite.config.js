import { defineConfig } from 'vite';
import { cpSync, readdirSync, writeFileSync } from 'node:fs';

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
    },
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
  plugins: [copyRuntimeFiles(PLATFORM)],
  };
});
