// 대시보드(docs/admin.md §2-1): 오늘(KST) 숫자 카드 + 최근 결제 10 + 최근 오류 10.
import { call } from './api.js';
import { h, json, kst, num, reasonText, table } from './ui.js';

const card = (k, v, cls = '') => h('div.card', h('div.k', k), h('div.v', { class: cls }, v));

export async function render(root) {
  const r = await call('dashboard');
  if (!r.ok) return root.replaceChildren(h('div.red', reasonText(r)));
  const s = r.stats;
  root.replaceChildren(
    h('h1', `대시보드 `, h('span.muted', `${s.today} (KST)`)),
    h('div.grid',
      card('오늘 접속', num(s.activeToday)), card('오늘 신규', num(s.newToday)), card('최근 30일 접속', num(r.active30d)),
      card('오늘 매출', `₩${num(s.salesToday)}`), card('7일 매출', `₩${num(s.sales7d)}`),
      card('미지급 claims', num(s.pendingClaims), s.pendingClaims ? 'warn' : ''),
      card('오늘 오류 로그', num(s.errorsToday), s.errorsToday ? 'red' : ''),
      card('탈퇴: 오늘 / 삭제 실패 남음', `${num(s.deletedToday)} / ${num(s.deleteStuck)}`, s.deleteStuck ? 'warn' : '')),
    h('h2', '최근 결제 10건'),
    table([
      { key: 'kst_at', label: '시각', fmt: kst }, { key: 'store', label: '마켓' }, { key: 'product_key', label: '상품' },
      { key: 'price_krw', label: '가격', num: true, fmt: num }, { key: 'status', label: '상태' },
      { key: 'player_code', label: '플레이어', fmt: (v) => v && h('a', { href: `#players?q=${v}` }, v) },
      { key: 'order_id', label: '주문번호' }, { key: 'granted_at', label: '지급', fmt: (v) => (v ? kst(v) : h('span.red', '미지급')) },
    ], r.purchases),
    h('h2', '최근 오류 10건'),
    table([{ key: 'at', label: '시각', fmt: kst }, { key: 'source', label: '출처' }, { key: 'body', label: '내용', fmt: json }], r.errors),
  );
}
