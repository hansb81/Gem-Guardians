// 결제(docs/admin.md §2-6): 필터(마켓·상태·기간·주문번호) + 목록(미지급이면 [복구 지급]) + 일별 매출(v_sales_daily).
import { call } from './api.js';
import { purchaseCols } from './players.js';
import { h, num, reasonText, table } from './ui.js';

const STORES = ['', 'play', 'ios', 'onestore', 'toss', 'dev'];
const STATUS = ['', 'verified', 'granted', 'refunded', 'pending', 'invalid'];

export async function render(root, { query }) {
  const sel = (opts, v) => {
    const s = h('select', opts.map((o) => h('option', { value: o }, o || '전체')));
    s.value = v ?? '';
    return s;
  };
  const store = sel(STORES, query.get('store'));
  const status = sel(STATUS, query.get('status'));
  const q = h('input', { placeholder: '주문번호(정확히)' });
  q.value = query.get('q') ?? '';
  const from = h('input', { type: 'date' });
  const to = h('input', { type: 'date' });
  const out = h('div');
  const go = async () => {
    out.replaceChildren(h('div.muted', '불러오는 중…'));
    const r = await call('purchase.list', {
      store: store.value || undefined, status: status.value || undefined, q: q.value.trim() || undefined,
      from: from.value ? `${from.value}T00:00:00+09:00` : undefined, to: to.value ? `${to.value}T23:59:59+09:00` : undefined, limit: 500,
    });
    if (!r.ok) return out.replaceChildren(h('div.red', reasonText(r)));
    out.replaceChildren(
      table(purchaseCols(go, { withPlayer: true }), r.purchases, { empty: '결제 없음' }),
      h('h2', '일별 매출 (verified·granted, KST)'),
      table([{ key: 'kst_date', label: '날짜' }, { key: 'store', label: '마켓' }, { key: 'n', label: '건수', num: true },
        { key: 'krw', label: '금액(₩)', num: true, fmt: num }], r.sales),
    );
  };
  root.replaceChildren(
    h('h1', '결제'),
    h('p.muted', '가격은 products.json 표시 가격 - 실제 정산은 각 마켓 정산서가 기준이에요(수수료·부가세·환율). 환불은 상태 refunded로.'),
    h('div.panel.row', '마켓 ', store, '상태 ', status, q, '기간 ', from, '~', to, h('button.primary', { onclick: go }, '조회')),
    out,
  );
  go();
}
