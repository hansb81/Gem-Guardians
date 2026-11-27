// 랭킹(비정상 계정 찾기): 일반 최고 층 / 경쟁 시즌 순위. 게임 순위표와 달리 숨김·정지·탈퇴도 섞어 보여 주고 상태 칸에 표시.
// "가입→도달" = 가입부터 그 기록까지 걸린 시간, "층당" = 그 시간 / 층(짧을수록 의심 - 서버 자동 숨김 기준은 층당 10초 + 20층 여유).
import { call } from './api.js';
import { h, kst, num, reasonText, table, uid } from './ui.js';

const one = (v) => (Array.isArray(v) ? v[0] : v); // PostgREST 1:1 묶음이 배열로 올 때
function dur(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  if (sec < 3600) return `${Math.round(sec / 60)}분`;
  if (sec < 86400) return `${(sec / 3600).toFixed(1)}시간`;
  return `${(sec / 86400).toFixed(1)}일`;
}
const state = (p) => h('span', [
  p.rank_hidden && h('span.warn', '숨김 '), p.banned && h('span.red', '정지 '), p.deleted_at && h('span.muted', '탈퇴'),
].filter(Boolean));

// 행 정리: 순위(받은 순서) + 가입→도달 초 + 층당 초 + save 요약.
function prep(rows, floorKey, atKey) {
  return (rows ?? []).map((r, i) => {
    const p = r.players ?? {};
    const sec = (Date.parse(r[atKey]) - Date.parse(p.created_at)) / 1000;
    const floor = r[floorKey];
    const s = one(p.saves)?.summary ?? {};
    return { ...r, p, rank: i + 1, sec, perFloor: floor > 0 ? sec / floor : null, towerSum: s.towerSum, diamonds: s.diamonds, gold: s.gold };
  });
}

const common = [
  { key: 'rank', label: '순위', num: true },
  { key: 'nick', label: '닉네임', fmt: (_, r) => r.p.nickname ?? h('span.muted', '-'), sort: (r) => r.p.nickname },
  { key: 'player_id', label: 'uid', fmt: (v) => uid(v) },
];
const tail = [
  { key: 'sec', label: '가입→도달', num: true, fmt: dur },
  { key: 'state', label: '상태', fmt: (_, r) => state(r.p), sort: (r) => (r.p.banned ? 2 : 0) + (r.p.rank_hidden ? 1 : 0) },
  { key: 'towerSum', label: '탑 합', num: true },
  { key: 'diamonds', label: '다이아', num: true, fmt: num },
  { key: 'gold', label: '골드', num: true, fmt: num },
  { key: 'plat', label: '플랫폼', fmt: (_, r) => `${r.p.platform ?? ''} ${r.p.app_version ?? ''}`, sort: (r) => r.p.platform },
  { key: 'joined', label: '가입', fmt: (_, r) => kst(r.p.created_at), sort: (r) => r.p.created_at },
];

export async function render(root, { query }) {
  const mode = h('select', h('option', { value: 'normal' }, '일반(최고 층)'), h('option', { value: 'comp' }, '경쟁(시즌)'));
  mode.value = query.get('mode') === 'comp' ? 'comp' : 'normal';
  const season = h('input', { placeholder: '시즌(예: 2026-W48, 비우면 이번 주)', size: 26 });
  const limit = h('select', [100, 200, 500].map((n) => h('option', { value: n }, `${n}명`)));
  limit.value = '200';
  const hiddenOnly = h('input', { type: 'checkbox' });
  const out = h('div');
  const go = async () => {
    out.replaceChildren(h('div.muted', '불러오는 중…'));
    const comp = mode.value === 'comp';
    const r = await call('rank.list', {
      mode: mode.value, seasonId: comp && season.value.trim() ? season.value.trim() : undefined,
      limit: Number(limit.value), hiddenOnly: hiddenOnly.checked,
    });
    if (!r.ok) return out.replaceChildren(h('div.red', reasonText(r)));
    const cols = comp
      ? [...common, { key: 'points', label: '포인트', num: true, fmt: num }, { key: 'floor', label: '층', num: true },
        { key: 'at', label: '기록 시각', fmt: kst }, ...tail]
      : [...common, { key: 'best_floor', label: '최고 층', num: true }, { key: 'reached_at', label: '도달 시각', fmt: kst },
        { key: 'perFloor', label: '층당', num: true, fmt: (v) => (v == null ? '' : `${Math.round(v)}초`) }, ...tail];
    out.replaceChildren(
      comp ? h('p.muted', `시즌 ${r.seasonId}`) : '',
      table(cols, comp ? prep(r.rows, 'floor', 'at') : prep(r.rows, 'best_floor', 'reached_at'), { empty: '기록 없음' }),
    );
  };
  root.replaceChildren(
    h('h1', '랭킹'),
    h('p.muted', '숨김·정지·탈퇴 계정도 같이 보여요(게임 순위표에는 안 나옴). 순위는 이 목록 안의 순서예요. ' +
      '가입→도달이 짧거나 층당 시간이 짧으면 의심해 보세요 - 서버는 층당 10초(+20층 여유)보다 빠르면 자동으로 랭킹 숨김해요. 머리 칸을 누르면 정렬.'),
    h('div.panel.row', mode, season, limit, h('label', hiddenOnly, ' 숨김만'), h('button.primary', { onclick: go }, '조회')),
    out,
  );
  await go();
}
