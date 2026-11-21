// 운영 관리자 페이지(docs/admin.md §6) 전용 빌드. 게임 vite.config.js와 따로 - 게임 dist에는 admin/이 들어가지 않는다.
// 개발: npm run dev:admin (http://localhost:5180 - admin 함수 ADMIN_ORIGINS 기본값) / 빌드: npm run build:admin -> dist-admin/
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'admin',
  base: './',
  publicDir: false,
  server: { port: 5180, strictPort: true, fs: { allow: ['..'] } }, // config/, assets/items, src/config/locales를 읽는다
  preview: { port: 5180, strictPort: true },
  build: { outDir: '../dist-admin', emptyOutDir: true },
});
