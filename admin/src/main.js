// 관리자 페이지 입구: 로그인(aal2) -> me -> 왼쪽 메뉴 7개 + 해시 라우터(#player/<uid> 등 바로 열기).
import { call, logout, me, supabase, watchIdle } from './api.js';
import { hasAal2, loginScreen } from './login.js';
import { h, reasonText } from './ui.js';
import * as dashboard from './dashboard.js';
import * as players from './players.js';
import * as grant from './grant.js';
import * as mail from './mail.js';
import * as purchases from './purchases.js';
import * as coupons from './coupons.js';
import * as logs from './logs.js';

const MENU = [
  ['dashboard', '대시보드'], ['players', '플레이어'], ['grant', '보상 지급'], ['mail', '우편함'],
  ['purchases', '결제'], ['coupons', '쿠폰'], ['logs', '로그·감사'],
];
// 해시 첫 칸 -> 화면. #player/<uid>, #grant/<id>는 상세.
const ROUTES = {
  dashboard: dashboard.render, players: players.search, player: players.detail, grant: grant.render,
  mail: mail.render, purchases: purchases.render, coupons: coupons.render, logs: logs.render,
};

const app = document.getElementById('app');
let content = null;
let menu = null;

function parseHash() {
  const [path, qs] = location.hash.slice(1).split('?');
  const [name, id] = path.split('/');
  return { name: ROUTES[name] ? name : 'dashboard', id: id ? decodeURIComponent(id) : null, query: new URLSearchParams(qs ?? '') };
}

async function route() {
  if (!content) return;
  const r = parseHash();
  const top = r.name === 'player' ? 'players' : r.name;
  for (const a of menu.querySelectorAll('a')) a.classList.toggle('on', a.dataset.k === top);
  content.replaceChildren(h('div.muted', '불러오는 중…'));
  try {
    await ROUTES[r.name](content, r);
  } catch (e) {
    content.replaceChildren(h('div.red', `화면 오류: ${e.message ?? e}`));
  }
}

function shell() {
  menu = h('nav.menu', h('div.brand', 'Gem Guardians 관리자'),
    MENU.map(([k, label]) => h('a', { href: `#${k}`, 'data-k': k }, label)),
    h('div.who', `${me.role === 'owner' ? '운영자' : '조회 전용'} · `, h('button.link', { onclick: () => logout() }, '로그아웃')));
  content = h('main.content');
  app.replaceChildren(h('div.layout', menu, content));
  route();
}

async function start(notice = '') {
  content = null;
  if (!(await supabase.auth.getSession()).data.session || !(await hasAal2())) return loginScreen(app, () => start(), notice);
  const r = await call('me');
  if (!r.ok) {
    await supabase.auth.signOut().catch(() => {});
    return loginScreen(app, () => start(), reasonText(r));
  }
  me.uid = r.uid;
  me.role = r.role;
  shell();
}

addEventListener('hashchange', route);
// 로그아웃(직접·30분 무동작) 또는 서버가 auth/mfa/notAdmin -> 로그인 화면.
watchIdle(async (msg, reason) => {
  if (reason) await supabase.auth.signOut().catch(() => {});
  start(msg ?? (reason ? reasonText({ reason }) : ''));
});
start();
