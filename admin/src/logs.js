// 로그·감사(docs/admin.md §2-8): server_log(level·source·uid·기간) + admin_audit(대상·작업).
import { call } from './api.js';
import { auditCols } from './players.js';
import { h, json, kst, reasonText, table, uid } from './ui.js';

export async function render(root) {
  const level = h('select', ['', 'error', 'warn', 'info'].map((v) => h('option', { value: v }, v || '전체')));
  level.value = 'error';
  const source = h('input', { placeholder: '출처(예: admin, save-put)' });
  const who = h('input', { placeholder: 'uid(전체)' });
  const since = h('input', { type: 'date' });
  const logOut = h('div');
  const auditWho = h('input', { placeholder: '대상 uid(전체)' });
  const action = h('input', { placeholder: '작업(예: grant.send)' });
  const auditOut = h('div');

  const loadLogs = async () => {
    const r = await call('log.list', {
      level: level.value || undefined, source: source.value.trim() || undefined, uid: who.value.trim() || undefined,
      since: since.value ? `${since.value}T00:00:00+09:00` : undefined, limit: 500,
    });
    logOut.replaceChildren(r.ok ? table([
      { key: 'at', label: '시각', fmt: kst }, { key: 'level', label: '레벨' }, { key: 'source', label: '출처' },
      { key: 'body', label: '내용', fmt: json, sort: (l) => JSON.stringify(l.body) },
      { key: 'uid', label: 'uid', fmt: (_, l) => uid(l.body?.uid) },
    ], r.logs, { empty: '로그 없음' }) : h('div.red', reasonText(r)));
  };
  const loadAudit = async () => {
    const r = await call('audit.list', { player: auditWho.value.trim() || undefined, action: action.value.trim() || undefined, limit: 500 });
    auditOut.replaceChildren(r.ok ? table(auditCols, r.audit, { empty: '기록 없음' }) : h('div.red', reasonText(r)));
  };
  root.replaceChildren(
    h('h1', '로그·감사'),
    h('h2', 'server_log'),
    h('div.panel.row', '레벨 ', level, source, who, '부터 ', since, h('button.primary', { onclick: loadLogs }, '조회')), logOut,
    h('h2', '관리자 감사 (admin_audit)'),
    h('div.panel.row', auditWho, action, h('button.primary', { onclick: loadAudit }, '조회')), auditOut,
  );
  await Promise.all([loadLogs(), loadAudit()]);
}
