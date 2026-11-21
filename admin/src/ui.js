// 화면 부품: 요소 만들기, 토스트, KST 시각, uid 칸, 표(정렬·50줄 페이지), 쓰기 확인창.

// h('div.cls', {attrs, on*}, ...children) - children: 문자열·노드·배열·null.
export function h(tag, props, ...kids) {
  const [name, ...cls] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (cls.length) el.className = cls.join(' ');
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className += ` ${v}`;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  const add = (c) => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) c.forEach(add);
    else el.append(c instanceof Node ? c : String(c));
  };
  kids.forEach(add);
  return el;
}

export function toast(text, ok = true) {
  const t = h('div.toast', { class: ok ? '' : 'err' }, text);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ok ? 3500 : 7000);
}

// 서버 reason -> 한국어.
const REASONS = {
  auth: '로그인이 필요해요', mfa: '2단계 인증(OTP)이 필요해요', notAdmin: '관리자 계정이 아니에요', anonymous: '게스트 계정은 안 돼요',
  role: '권한이 없어요(조회 전용 계정)', rateLimited: '요청이 너무 많아요. 1분 뒤 다시', badAction: '모르는 요청', badRequest: '입력값이 잘못됐어요',
  error: '서버 오류(로그 확인)', network: '네트워크 오류', badBundle: '지급 내용이 잘못됐어요(상한·키 확인)', badMode: '지급 방식이 잘못됐어요',
  badPlayers: '받는 사람은 1~200명', missing: '없는 플레이어가 있어요', notFound: '찾을 수 없어요', confirm: '확인 문구가 달라요',
  dailyLimit: '전체 발송은 하루 3회까지', notEligible: '복구 대상이 아니에요(verified·미지급만)', unknownProduct: '모르는 상품',
};
export const reasonText = (r) => (r?.reason ? `${REASONS[r.reason] ?? r.reason}${r.message ? `: ${r.message}` : ''}` : '실패');
export const done = (r, okText) => (r.ok ? toast(okText) : toast(reasonText(r), false), r.ok);

// KST 'YYYY-MM-DD HH:mm'. 오프셋 없는 문자열(뷰의 kst_at 등)은 이미 KST로 본다.
export function kst(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(v)) return v.replace('T', ' ').slice(0, 16);
  const ms = typeof v === 'number' ? v : Date.parse(v);
  return Number.isNaN(ms) ? String(v) : new Date(ms + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ');
}
export const kstDate = (ms = Date.now()) => new Date(ms + 9 * 3600e3).toISOString().slice(0, 10);
export const num = (v) => (v == null ? '' : Number(v).toLocaleString('ko-KR'));

// uid 앞 8자 + 복사(전체 uid). link면 플레이어 상세로.
export function uid(id, { link = true } = {}) {
  if (!id) return '';
  const code = String(id).slice(0, 8);
  return h('span.uid', link ? h('a', { href: `#player/${id}` }, code) : code,
    h('button.link', { title: id, onclick: (e) => (e.preventDefault(), navigator.clipboard.writeText(id).then(() => toast('uid 복사됨'))) }, '복사'));
}

export const json = (v) => h('pre', v == null ? '' : JSON.stringify(v));

// 표: cols = [{ key, label, fmt?(v,row), num?, sort?(row) }]. 머리 누르면 정렬, 50줄 페이지.
export function table(cols, rows, { pageSize = 50, empty = '없음' } = {}) {
  const wrap = h('div');
  let sortKey = null, dir = 1, page = 0;
  const draw = () => {
    const list = [...(rows ?? [])];
    if (sortKey) {
      const c = cols.find((x) => x.key === sortKey);
      const val = (r) => (c.sort ? c.sort(r) : r[c.key]);
      list.sort((a, b) => {
        const x = val(a), y = val(b);
        return (x == null ? 1 : y == null ? -1 : x < y ? -1 : x > y ? 1 : 0) * dir;
      });
    }
    const pages = Math.max(1, Math.ceil(list.length / pageSize));
    page = Math.min(page, pages - 1);
    const shown = list.slice(page * pageSize, (page + 1) * pageSize);
    wrap.replaceChildren(
      h('div.tablewrap', h('table',
        h('thead', h('tr', cols.map((c) => h('th', {
          class: c.num ? 'num' : '',
          onclick: () => ((dir = sortKey === c.key ? -dir : 1), (sortKey = c.key), draw()),
        }, c.label, sortKey === c.key ? (dir > 0 ? ' ▲' : ' ▼') : '')))),
        h('tbody', shown.length
          ? shown.map((r) => h('tr', cols.map((c) => h('td', { class: c.num ? 'num' : '' }, c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? ''))))
          : h('tr', h('td.muted', { colSpan: cols.length }, empty))),
      )),
      pages <= 1 ? '' : h('div.pager',
        h('button', { disabled: page === 0, onclick: () => (page--, draw()) }, '이전'),
        `${page + 1} / ${pages} (${list.length}줄)`,
        h('button', { disabled: page >= pages - 1, onclick: () => (page++, draw()) }, '다음')),
    );
  };
  draw();
  return wrap;
}

// 쓰기 확인창: lines = 무엇을 누구에게(문자열 배열), danger = 빨간 줄. 사유(필수) 입력 -> Promise<사유|null>.
// extra = 확인창 안에 더 넣을 입력(예: '전체 발송' 직접 입력)과 그 검사.
export function confirmWrite({ title, lines = [], danger = [], okLabel = '실행', extra = null, reason: preset = '' }) {
  return new Promise((resolve) => {
    const reason = h('textarea', { placeholder: '사유(필수, 감사 기록에 남음)', maxLength: 500 });
    reason.value = preset;
    const ok = h('button.primary', { disabled: true }, okLabel);
    const check = () => (ok.disabled = !reason.value.trim() || (extra?.valid && !extra.valid()));
    reason.addEventListener('input', check);
    extra?.el.addEventListener('input', check);
    const close = (v) => (back.remove(), resolve(v));
    ok.onclick = () => close(reason.value.trim());
    const back = h('div.dialog-back', h('div.dialog',
      h('h2', title),
      h('div.lines', lines.map((l) => h('div', l)), danger.map((l) => h('div.red', '⚠ ', l))),
      extra?.el, reason,
      h('div.actions', h('button', { onclick: () => close(null) }, '취소'), ok)));
    document.body.append(back);
    check();
    reason.focus();
  });
}

// 버튼 잠금 + 확인창 + 전송 + 토스트. send(reason) -> 응답. 성공이면 then(응답).
export function writeButton(label, { cls = '', confirm, send, okText, then }) {
  const b = h(`button${cls ? `.${cls}` : ''}`, label);
  b.onclick = async () => {
    const opts = typeof confirm === 'function' ? await confirm() : confirm;
    if (!opts) return;
    const reason = await confirmWrite(opts);
    if (!reason) return;
    b.disabled = true;
    try {
      const r = await send(reason);
      if (done(r, typeof okText === 'function' ? okText(r) : okText ?? '완료')) await then?.(r);
    } finally {
      b.disabled = false;
    }
  };
  return b;
}
