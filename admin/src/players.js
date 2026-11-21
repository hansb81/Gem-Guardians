// 플레이어 찾기 + 상세(docs/admin.md §2-2, §2-3). 상세는 #player/<uid>로 바로 열린다.
import { call, isOwner, write } from './api.js';
import { bundleText, itemName, TOWERS } from './bundle.js';
import { h, json, kst, num, reasonText, table, uid, writeButton } from './ui.js';

export async function search(root, { query }) {
  const q = h('input', { placeholder: '플레이어 코드(앞 8자) / uid / 닉네임 / 주문번호 / legacy_id', style: 'flex:1;min-width:260px' });
  q.value = query.get('q') ?? '';
  const out = h('div');
  const go = async () => {
    if (!q.value.trim()) return;
    history.replaceState(null, '', `#players?q=${encodeURIComponent(q.value.trim())}`);
    out.replaceChildren(h('div.muted', '찾는 중…'));
    const r = await call('player.search', { q: q.value.trim() });
    if (!r.ok) return out.replaceChildren(h('div.red', reasonText(r)));
    out.replaceChildren(table([
      { key: 'id', label: '코드', fmt: (v) => uid(v) }, { key: 'nickname', label: '닉네임' }, { key: 'platform', label: '플랫폼' },
      { key: 'best_floor', label: '최고 층', num: true }, { key: 'last_seen_at', label: '마지막 접속', fmt: kst },
      { key: 'banned', label: '정지', fmt: (v) => (v ? h('span.red', '정지') : '') },
      { key: 'rank_hidden', label: '랭킹', fmt: (v) => (v ? h('span.warn', '숨김') : '') },
    ], r.players, { empty: '찾은 플레이어 없음' }));
  };
  q.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  root.replaceChildren(h('h1', '플레이어'), h('div.panel', h('div.row', q, h('button.primary', { onclick: go }, '찾기'))), out);
  if (q.value) go();
}

const TABS = ['요약', '저장', '결제', '받은 보상', '우편', '랭킹', '로그'];

export async function detail(root, { id, query }) {
  const r = await call('player.get', { id });
  if (!r.ok) return root.replaceChildren(h('div.red', reasonText(r)));
  const p = r.player;
  const reload = () => detail(root, { id, query });
  const tab = TABS.includes(query.get('tab')) ? query.get('tab') : '요약';
  const body = h('div');
  const tabs = h('div.tabs', TABS.map((t) => h('button', {
    class: t === tab ? 'on' : '',
    onclick: () => (history.replaceState(null, '', `#player/${id}?tab=${encodeURIComponent(t)}`), reload()),
  }, t)));
  const who = `${p.nickname ?? '(닉네임 없음)'} ${id.slice(0, 8)}`;
  const set = (action, extra, label, danger = []) => writeButton(label, {
    cls: danger.length ? 'danger' : '',
    confirm: { title: label, lines: [`대상: ${who}`], danger },
    send: (reason) => write(action, { id, ...extra }, reason), okText: `${label} 완료`, then: reload,
  });
  const owner = isOwner();

  root.replaceChildren(
    h('div.row', { style: 'justify-content:space-between' },
      h('h1', p.nickname ?? '(닉네임 없음)', ' ', h('span.muted', uid(id, { link: false }))),
      owner && h('div.row',
        h('a', { href: `#grant?to=${id}` }, h('button.primary', '보상 지급')),
        p.banned ? set('player.ban', { banned: false }, '정지 해제') : set('player.ban', { banned: true }, '정지', ['이 플레이어를 정지합니다(랭킹 제출·쿠폰 등 막힘)']))),
    tabs, body);

  const views = {
    요약: () => {
      const note = h('textarea', { maxLength: 2000 });
      note.value = p.note ?? '';
      const kind = r.auth ? (r.auth.isAnonymous ? '게스트' : r.auth.providers.filter((x) => x !== 'anonymous').join(', ') || '연결됨') : '?';
      return [
        h('div.panel.kv',
          'uid', h('span', h('span.uid', id), ' ', uid(id, { link: false })), '코드', id.slice(0, 8),
          '닉네임', p.nickname ?? '-', '플랫폼', p.platform ?? '-', '가입', kst(p.created_at), '마지막 접속', kst(p.last_seen_at),
          '앱 버전', p.app_version ?? '-', '계정 종류', kind, '정지', p.banned ? h('span.red', '정지') : '아님',
          '랭킹', p.rank_hidden ? h('span.warn', '숨김') : '보임', '탈퇴', p.deleted_at ? h('span.red', kst(p.deleted_at)) : '-',
          'legacy_id', p.legacy_id ?? '-'),
        h('div.panel', h('h2', '메모'), note, owner && h('div.row', { style: 'margin-top:6px' },
          writeButton('메모 저장', {
            confirm: () => ({ title: '메모 저장', lines: [`대상: ${who}`, `메모: ${note.value || '(비움)'}`], reason: '메모' }),
            send: (reason) => write('player.note', { id, note: note.value || null }, reason), okText: '메모 저장됨',
          }))),
      ];
    },
    저장: () => {
      const s = r.save;
      if (!s) return h('div.muted', '클라우드 저장 없음');
      const d = s.picked ?? {};
      return [
        h('div.panel.kv',
          '기기 기준 마지막 업로드', kst(s.updated_at), 'rev', s.rev, '앱 버전', s.app_version ?? '-', '플랫폼', s.platform ?? '-',
          '골드', num(d.gold), '다이아', num(d.diamonds), '층', d.floor, '최고 층', d.bestFloor,
          '타워 레벨', h('span', (d.towerLevels ?? []).map((v, i) => `${TOWERS[i] ?? i} Lv ${v}`).join(' · ')),
          '스킬', json(d.skills), '플래그', (d.flags ?? []).join(', ') || '-', '요약(summary)', json(s.summary)),
        h('h2', '아이템'),
        table([{ key: 'id', label: '아이템' }, { key: 'n', label: '개수', num: true }],
          Object.entries(d.items ?? {}).map(([id, n]) => ({ id: itemName(id), n }))),
        h('p.muted', '읽기 전용 - 기기가 주인이라 서버에서 고칠 수 없어요.'),
      ];
    },
    결제: () => table(purchaseCols(reload), r.purchases),
    '받은 보상': () => {
      const kinds = [...new Set((r.claims ?? []).map((c) => c.kind))];
      const sel = h('select', h('option', { value: '' }, '전체'), kinds.map((k) => h('option', k)));
      const out = h('div');
      const draw = () => out.replaceChildren(table([
        { key: 'claimed_at', label: '기록', fmt: kst }, { key: 'kind', label: '종류' }, { key: 'tx_id', label: 'tx' },
        { key: 'bundle', label: '내용', fmt: bundleText },
        { key: 'granted_at', label: '기기 지급', fmt: (v) => (v ? kst(v) : h('span.red', '미지급')) },
        { key: 'tx_id', label: '', sort: () => 0, fmt: (tx, c) => {
          const g = /^admin:(\d+)$/.exec(tx)?.[1];
          return g && !c.granted_at && owner && writeButton('회수', {
            confirm: { title: `지급 #${g} - 이 사람 몫 회수`, lines: [`대상: ${who}`, `바로 지급: ${bundleText(c.bundle)}`, '기기가 아직 안 받은 것만'] },
            send: (reason) => write('grant.revoke', { grantId: Number(g), player: id }, reason),
            okText: (x) => (x.revoked ? '회수했어요' : '이미 기기가 받았어요'), then: reload,
          });
        } },
      ], (r.claims ?? []).filter((c) => !sel.value || c.kind === sel.value)));
      sel.onchange = draw;
      draw();
      return [h('div.row', '종류 ', sel, h('span.muted', '최근 100건')), out];
    },
    우편: () => table([
      { key: 'id', label: 'id' }, { key: 'created_at', label: '보낸 시각', fmt: kst }, { key: 'title_ko', label: '제목' },
      { key: 'bundle', label: '내용', fmt: bundleText }, { key: 'expires_at', label: '만료', fmt: kst },
      { key: 'claimed', label: '받음', fmt: (v) => (v ? h('span.ok', '받음') : '안 받음') },
      { key: 'revoked_at', label: '회수', fmt: (v) => (v ? h('span.warn', kst(v)) : '') },
      { key: 'grant_id', label: '', fmt: (g, m) => g && h('span', h('a', { href: `#grant/${g}` }, `지급 #${g}`), ' ',
        owner && !m.claimed && !m.revoked_at && writeButton('회수', {
          confirm: { title: `지급 #${g} - 이 사람 몫 회수`, lines: [`대상: ${who}`, `우편: ${m.title_ko} (${bundleText(m.bundle)})`, '같은 지급의 다른 사람 우편은 그대로'] },
          send: (reason) => write('grant.revoke', { grantId: g, player: id }, reason),
          okText: (x) => (x.revoked ? '회수했어요' : '이미 받았거나 회수된 우편이에요'), then: reload,
        })) },
    ], r.mail),
    랭킹: () => [
      h('div.panel.kv',
        '일반 최고 층', r.normalBest ? `${r.normalBest.best_floor}층 (${kst(r.normalBest.reached_at)})` : '-',
        '랭킹 표시', p.rank_hidden ? h('span.warn', '숨김') : '보임', '닉네임', p.nickname ?? '-'),
      h('h2', '경쟁 기록'),
      table([{ key: 'season_id', label: '시즌' }, { key: 'points', label: '포인트', num: true, fmt: num }, { key: 'floor', label: '층', num: true },
        { key: 'at', label: '시각', fmt: kst }], r.compBest),
      owner && h('div.row', { style: 'margin-top:10px' },
        p.rank_hidden ? set('player.rankHide', { hidden: false }, '랭킹 숨김 해제') : set('player.rankHide', { hidden: true }, '랭킹 숨김'),
        p.nickname && set('player.nicknameReset', {}, '닉네임 초기화')),
    ],
    로그: () => [
      h('h2', 'server_log (이 uid)'),
      table([{ key: 'at', label: '시각', fmt: kst }, { key: 'level', label: '레벨' }, { key: 'source', label: '출처' }, { key: 'body', label: '내용', fmt: json }], r.logs),
      h('h2', '관리자 감사'), table(auditCols, r.audit),
    ],
  };
  const v = views[tab]();
  body.replaceChildren(...[v].flat().filter(Boolean));
}

// 결제 표(플레이어 상세·결제 메뉴 공용). verified + 미지급이면 [복구 지급].
export function purchaseCols(reload, { withPlayer = false } = {}) {
  return [
    { key: 'id', label: 'id', num: true }, { key: 'purchased_at', label: '구매', fmt: kst }, { key: 'store', label: '마켓' },
    { key: 'product_key', label: '상품' }, { key: 'price_krw', label: '가격', num: true, fmt: num }, { key: 'status', label: '상태' },
    { key: 'granted_at', label: '기기 지급', fmt: (v) => (v ? kst(v) : h('span.red', '미지급')) },
    { key: 'refunded_at', label: '환불', fmt: kst }, { key: 'order_id', label: '주문번호' },
    ...(withPlayer ? [{ key: 'player_id', label: '플레이어', fmt: (v) => uid(v) }] : []),
    { key: 'tx_id', label: '', fmt: (_, p) => isOwner() && p.status === 'verified' && !p.granted_at && writeButton('복구 지급', {
      confirm: { title: '결제 복구 지급', lines: [`${p.product_key} · 주문 ${p.order_id}`, `원래 tx ${p.tx_id}로 바로 지급(기기가 이미 받았으면 중복 없음)`] },
      send: (reason) => write('purchase.regrant', { id: p.id }, reason),
      okText: (x) => (x.created ? `복구 지급 등록${x.firstPurchaseBonus ? ' (첫 구매 2배 포함)' : ''}: ${bundleText(x.bundle)}` : '이미 등록돼 있어요'),
      then: reload,
    }) },
  ];
}

export const auditCols = [
  { key: 'at', label: '시각', fmt: kst }, { key: 'admin_id', label: '관리자', fmt: (v) => uid(v, { link: false }) },
  { key: 'action', label: '작업' }, { key: 'target_player', label: '대상', fmt: (v) => uid(v) }, { key: 'target', label: '대상2' },
  { key: 'reason', label: '사유' }, { key: 'before', label: '전', fmt: json }, { key: 'after', label: '후', fmt: json }, { key: 'ip', label: 'ip' },
];
