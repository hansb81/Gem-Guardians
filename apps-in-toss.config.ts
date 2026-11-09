// 앱인토스 설정(npx ait init 기준). npm run build:toss = vite build --mode toss 후 ait build(dist -> .ait).
// appName은 config/platform.toss.json 한 곳에서 - 콘솔에 등록한 앱 이름으로 바꾼다.
import { defineConfig } from '@apps-in-toss/web-framework/config';
import toss from './config/platform.toss.json';

export default defineConfig({
  appName: toss.appName,
  permissions: [],
  webBundleDir: 'dist',
});
