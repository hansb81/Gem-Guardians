// 우편함(docs/admin.md §2-5, §5-3): 보낸 지급(우편) 목록 + [전체 발송](최근 30일 접속자 수 표시, '전체 발송' 직접 입력).
import { call, isOwner, write } from './api.js';
import { bundleDanger, bundleForm, bundleText } from './bundle.js';
import { mailFields } from './grant.js';
import { h, kst, num, reasonText, table, toast, writeButton } from './ui.js';

const CONFIRM = '전체 발송';

export async function render(root) {
  const [list, dash] = await Promise.all([call('grant.list', { limit: 500 }), call('dashboard')]);
  if (!list.ok) return root.replaceChildren(h('div.red', reasonText(list)));
  const reload = () => render(root);
  root.replaceChildren(
    h('h1', '우편함'),
    isOwner() && broadcastBox(dash.ok ? dash.active30d : null, reload),
    h('h2', '보낸 우편 (개인·전체)'),
    table([
      { key: 'id', label: '#', num: true, fmt: (v) => h('a', { href: `#grant/${v}` }, `#${v}`) },
      { key: 'at', label: '시각', fmt: kst },
      { key: 'player_ids', label: '대상', fmt: (v, g) => (v == null ? h('b', '전체') : `${g.count}명`), sort: (g) => g.count ?? 1e9 },
      { key: 'title_ko', label: '제목' }, { key: 'bundle', label: '내용', fmt: bundleText },
      { key: 'expires_at', label: '만료', fmt: kst }, { key: 'received', label: '받은 수', num: true, fmt: num },
      { key: 'revoked_at', label: '회수', fmt: (v) => (v ? h('span.warn', kst(v)) : '') },
      { key: 'reason', label: '사유' },
    ], list.grants.filter((g) => g.mode === 'mail')),
  );
}

function broadcastBox(active30d, reload) {
  const bundle = bundleForm();
  const mail = mailFields();
  const typed = h('input', { placeholder: `'${CONFIRM}'을 직접 입력` });
  const btn = writeButton('전체 발송', {
    cls: 'danger',
    confirm: () => {
      const b = bundle.get();
      if (b.error) return void toast(b.error, false);
      const m = mail.get();
      return {
        title: '전체 발송', okLabel: '전체 발송',
        lines: [`모든 플레이어(최근 30일 접속 ${num(active30d)}명 기준)에게 ${bundleText(b)}`, `우편 / 만료 ${m.expText}`, `제목: ${m.title.ko} / ${m.title.en}`],
        danger: ['전체 발송 - 하루 3회까지, 되돌리려면 회수(이미 받은 사람은 그대로)', ...bundleDanger(b)],
      };
    },
    send: (reason) => {
      const m = mail.get();
      return write('mail.broadcast', { bundle: bundle.get(), title: m.title, expiresAt: m.expiresAt, confirm: typed.value.trim() }, reason);
    },
    okText: (x) => `전체 발송 완료 (지급 #${x.grantId})`,
    then: reload,
  });
  btn.disabled = true;
  typed.addEventListener('input', () => (btn.disabled = typed.value.trim() !== CONFIRM));
  const box = h('details.panel',
    h('summary', h('b', '전체 발송'), h('span.muted', ` - 최근 30일 접속자 ${active30d == null ? '?' : num(active30d)}명`)),
    h('div', { style: 'margin-top:10px' }, bundle.el, h('fieldset', h('legend', '우편'), mail.el),
      h('div.row', typed, btn, h('span.red', '받는 사람 없이 모든 플레이어 우편함에 들어가요'))));
  return box;
}
