// 보상 지급(docs/admin.md §2-4, §4): 받는 사람 확인(grant.preview) -> 내용 -> 방식 -> [미리보기] -> [보내기] -> 지급 상세(#grant/<id>).
import { call, isOwner, write } from './api.js';
import { bundleDanger, bundleForm, bundleText } from './bundle.js';
import { h, kst, kstDate, reasonText, toast, uid, writeButton } from './ui.js';

export const DEFAULT_TITLE = { ko: '운영자 선물', en: 'A gift from the team' };

// 우편 제목 ko/en + 만료일(기본 30일, 그날 KST 23:59). -> { el, get(): {title, expiresAt, expText} }
export function mailFields() {
  const ko = h('input', { style: 'width:220px' });
  const en = h('input', { style: 'width:220px' });
  const exp = h('input', { type: 'date' });
  ko.value = DEFAULT_TITLE.ko;
  en.value = DEFAULT_TITLE.en;
  exp.value = kstDate(Date.now() + 30 * 86400e3);
  return {
    el: h('div.row', h('label', '제목(ko) ', ko), h('label', '제목(en) ', en), h('label', '만료일 ', exp)),
    get: () => ({
      title: { ko: ko.value.trim() || DEFAULT_TITLE.ko, en: en.value.trim() || DEFAULT_TITLE.en },
      expiresAt: exp.value ? `${exp.value}T23:59:59+09:00` : null, expText: exp.value ? exp.value.slice(5) : '30일 뒤',
    }),
  };
}

export async function render(root, r) {
  if (r.id) return detail(root, Number(r.id));
  return form(root, r.query.get('to') ?? '');
}

const STATUS = { found: '찾음', banned: '정지', deleted: '탈퇴 표시', missing: '없음', ambiguous: '여러 명(전체 uid로)' };

function form(root, to) {
  const who = h('textarea', { placeholder: '플레이어 코드(앞 8자) 또는 uid, 한 줄에 한 명(최대 200명)', style: 'min-height:90px' });
  who.value = to;
  const whoOut = h('div');
  const bundle = bundleForm();
  const modeMail = h('input', { type: 'radio', name: 'mode', checked: true });
  const modeDirect = h('input', { type: 'radio', name: 'mode' });
  const mail = mailFields();
  const mailBox = h('div', mail.el);
  const reason = h('input', { placeholder: '사유(필수, 감사 기록)', maxLength: 500, style: 'width:100%' });
  const note = h('input', { placeholder: '내부 메모(선택)', maxLength: 2000, style: 'width:100%' });
  const summary = h('div.panel');
  summary.hidden = true;
  let ready = null; // 미리보기 결과 { ids, body, lines, danger }

  const send = writeButton('보내기', {
    cls: 'primary',
    confirm: () => ready && { title: '보상 지급', lines: ready.lines, danger: ready.danger, okLabel: '보내기', reason: reason.value.trim() },
    send: (why) => write('grant.send', ready.body, why),
    okText: (x) => `지급 #${x.grantId} 완료 (${x.count}명)`,
    then: (x) => (location.hash = `#grant/${x.grantId}`),
  });
  send.disabled = true;
  const invalidate = () => {
    ready = null;
    send.disabled = true;
    summary.hidden = true;
  };
  modeMail.onchange = modeDirect.onchange = () => ((mailBox.hidden = modeDirect.checked), invalidate());

  const lines = () => who.value.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
  const preview = async () => {
    invalidate();
    const b = bundle.get();
    if (b.error) return toast(b.error, false);
    const list = lines();
    if (!list.length || list.length > 200) return toast('받는 사람은 1~200명', false);
    if (!reason.value.trim()) return toast('사유를 적어 주세요', false);
    const r = await call('grant.preview', { players: list, bundle: b });
    if (!r.ok) return toast(reasonText(r), false);
    whoOut.replaceChildren(h('div.tablewrap', h('table', h('tbody', r.players.map((p) => h('tr',
      h('td', p.q), h('td', { class: `status-${p.status}` }, STATUS[p.status] ?? p.status),
      h('td', p.id ? uid(p.id) : ''), h('td', p.nickname ?? ''), h('td.muted', p.app_version ?? '')))))));
    const bad = r.players.filter((p) => !p.id);
    if (bad.length) return toast(`확인 안 된 줄 ${bad.length}개 - 고친 뒤 다시 미리보기`, false);
    if (!r.bundleOk) return toast('지급 내용이 서버 검사를 통과하지 못했어요(상한·키 확인)', false);
    const ids = [...new Set(r.players.map((p) => p.id))];
    const first = r.players[0];
    const direct = modeDirect.checked;
    const m = mail.get();
    const text = `${first.nickname ?? first.id.slice(0, 8)}${ids.length > 1 ? ` 외 ${ids.length - 1}명` : ''}에게 ${bundleText(b)} / ${direct ? '바로 지급(다음 접속 때 자동)' : `우편 / 만료 ${m.expText}`}`;
    const danger = bundleDanger(b);
    if (r.oldApp?.length) danger.push(`옛 앱 버전 ${r.oldApp.length}명 - 레벨을 받지 못함`);
    const odd = r.players.filter((p) => p.status === 'banned' || p.status === 'deleted');
    if (odd.length) danger.push(`정지·탈퇴 표시된 사람 ${odd.length}명 포함`);
    ready = {
      ids, lines: [text, `사유: ${reason.value.trim()}`, note.value.trim() && `메모: ${note.value.trim()}`].filter(Boolean), danger,
      body: { players: ids, bundle: b, mode: direct ? 'direct' : 'mail', ...(direct ? {} : { title: m.title, expiresAt: m.expiresAt }), note: note.value.trim() || null },
    };
    summary.replaceChildren(h('div', h('b', text)), danger.map((d) => h('div.red', '⚠ ', d)));
    summary.hidden = false;
    send.disabled = !isOwner();
  };
  for (const el of [who, bundle.el, mailBox, reason, note]) el.addEventListener('input', invalidate);

  root.replaceChildren(
    h('h1', '보상 지급'),
    h('fieldset', h('legend', '받는 사람'), who, h('div.row', { style: 'margin-top:6px' }, h('button', {
      onclick: async () => {
        const r = await call('grant.preview', { players: lines() });
        if (!r.ok) return toast(reasonText(r), false);
        whoOut.replaceChildren(h('div.tablewrap', h('table', h('tbody', r.players.map((p) => h('tr',
          h('td', p.q), h('td', { class: `status-${p.status}` }, STATUS[p.status] ?? p.status), h('td', p.id ? uid(p.id) : ''), h('td', p.nickname ?? '')))))));
      },
    }, '받는 사람 확인')), whoOut),
    bundle.el,
    h('fieldset', h('legend', '방식'),
      h('div.row', h('label', modeMail, ' 우편 (기본 - 우편함에서 받기)'), h('label', modeDirect, ' 바로 지급 (결제 누락·버그 복구용, 다음 접속 때 자동)')),
      mailBox),
    h('fieldset', h('legend', '사유·메모'), reason, h('div', { style: 'height:6px' }), note),
    h('div.row', h('button', { onclick: preview }, '미리보기'), send),
    summary,
  );
}

async function detail(root, id) {
  const r = await call('grant.list', { limit: 500 });
  if (!r.ok) return root.replaceChildren(h('div.red', reasonText(r)));
  const g = r.grants.find((x) => x.id === id);
  if (!g) return root.replaceChildren(h('div.red', `지급 #${id}를 찾지 못했어요(최근 500건 안에 없음)`));
  const all = g.player_ids == null;
  root.replaceChildren(
    h('h1', `지급 #${g.id} `, h('span.muted', all ? '전체 발송' : g.mode === 'mail' ? '우편' : '바로 지급')),
    h('div.panel.kv',
      '시각', kst(g.at), '관리자', uid(g.admin_id, { link: false }), '대상', all ? '전체' : `${g.count}명`,
      '받은 수', `${g.received}${all ? '' : ` / ${g.count}`}`, '내용', bundleText(g.bundle),
      '제목', g.title_ko ? `${g.title_ko} / ${g.title_en}` : '-', '만료', kst(g.expires_at) || '-',
      '사유', g.reason, '메모', g.note ?? '-', '회수', g.revoked_at ? h('span.warn', kst(g.revoked_at)) : '-'),
    isOwner() && !g.revoked_at && writeButton('전체 회수', {
      cls: 'danger',
      confirm: { title: `지급 #${g.id} 전체 회수`, lines: [bundleText(g.bundle), all ? '전체 발송 우편' : `${g.count}명`],
        danger: [g.mode === 'mail' ? '안 받은 우편만 회수돼요(이미 받은 사람은 그대로)' : '기기가 아직 안 받은 것만 회수돼요'] },
      send: (reason) => write('grant.revoke', { grantId: g.id }, reason),
      okText: (x) => `회수 ${x.revoked}, 이미 받음 ${x.received}`, then: () => detail(root, id),
    }),
    !all && h('h2', '받는 사람'), !all && h('div', (g.player_ids ?? []).map((p) => h('div', uid(p)))),
  );
}
