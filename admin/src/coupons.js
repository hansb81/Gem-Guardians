// 쿠폰(docs/admin.md §2-7, docs/coupon.md): 현황(v_coupon_stats) + 새 공용 코드 + 일회용 묶음(CSV) + 켜기/끄기.
// 번들 입력은 보상 지급 폼 재사용(coupon 모드 = coupon_bundle_ok 범위: 골드·다이아·아이템만).
import { call, isOwner, write } from './api.js';
import { bundleForm, bundleText } from './bundle.js';
import { DEFAULT_TITLE } from './grant.js';
import { h, kst, kstDate, num, reasonText, table, toast, writeButton } from './ui.js';

const PLATFORMS = ['web', 'toss', 'android', 'onestore', 'ios'];

export async function render(root) {
  const r = await call('coupon.list');
  if (!r.ok) return root.replaceChildren(h('div.red', reasonText(r)));
  const reload = () => render(root);
  root.replaceChildren(
    h('h1', '쿠폰'),
    table([
      { key: 'campaign', label: '캠페인' }, { key: 'title_ko', label: '제목' }, { key: 'codes', label: '코드 수', num: true, fmt: num },
      { key: 'uses', label: '사용', num: true, fmt: num }, { key: 'granted', label: '기기 지급', num: true, fmt: num },
      { key: 'first_used', label: '첫 사용', fmt: kst }, { key: 'last_used', label: '마지막 사용', fmt: kst },
      { key: 'ends_at', label: '끝', fmt: kst },
      { key: 'enabled', label: '상태', fmt: (v, c) => h('span', v ? h('span.ok', '켜짐') : h('span.muted', '꺼짐'), ' ',
        isOwner() && writeButton(v ? '끄기' : '켜기', {
          confirm: { title: `쿠폰 ${v ? '끄기' : '켜기'}`, lines: [`캠페인 ${c.campaign} (코드 ${c.codes}개 전부)`] },
          send: (reason) => write('coupon.toggle', { campaign: c.campaign, enabled: !v }, reason), okText: v ? '껐어요' : '켰어요', then: reload,
        })) },
    ], r.coupons, { empty: '쿠폰 없음' }),
    isOwner() && createBox(reload),
    isOwner() && batchBox(reload),
  );
}

// 공통 칸: 제목 ko/en, 끝나는 날(기본 30일), 플랫폼(체크 없음 = 전부), 메모, 번들.
function common() {
  const ko = h('input');
  const en = h('input');
  ko.value = DEFAULT_TITLE.ko;
  en.value = DEFAULT_TITLE.en;
  const ends = h('input', { type: 'date' });
  ends.value = kstDate(Date.now() + 30 * 86400e3);
  const plats = Object.fromEntries(PLATFORMS.map((p) => [p, h('input', { type: 'checkbox' })]));
  const note = h('input', { placeholder: '메모(선택)', style: 'width:100%' });
  const bundle = bundleForm({ coupon: true });
  const el = [
    h('div.row', h('label', '제목(ko) ', ko), h('label', '제목(en) ', en), h('label', '끝나는 날 ', ends)),
    h('div.row', { style: 'margin:6px 0' }, '플랫폼(없으면 전부) ', PLATFORMS.map((p) => h('label', plats[p], ` ${p}`))),
    bundle.el, note,
  ];
  const get = () => {
    const b = bundle.get();
    if (b.error) return { error: b.error };
    const platforms = PLATFORMS.filter((p) => plats[p].checked);
    return {
      title: { ko: ko.value.trim(), en: en.value.trim() }, bundle: b, endsAt: ends.value ? `${ends.value}T23:59:59+09:00` : null,
      platforms: platforms.length ? platforms : null, note: note.value.trim() || null, endsText: ends.value || '없음',
    };
  };
  return { el, get };
}

function createBox(reload) {
  const code = h('input', { placeholder: '코드(영문·숫자 4~20자, 하이픈 무시)' });
  const campaign = h('input', { placeholder: '캠페인(비우면 코드와 같음)' });
  const maxUses = h('input', { type: 'number', min: 1, placeholder: '전체 한도(비우면 무제한)' });
  const c = common();
  let body = null;
  const btn = writeButton('공용 쿠폰 만들기', {
    cls: 'primary',
    confirm: () => {
      const v = c.get();
      if (v.error) return void toast(v.error, false);
      if (!code.value.trim()) return void toast('코드를 적어 주세요', false);
      body = { code: code.value.trim(), campaign: campaign.value.trim() || null, maxUses: maxUses.value ? Number(maxUses.value) : null, ...v };
      return { title: '공용 쿠폰 만들기', lines: [`코드 ${body.code} · ${bundleText(v.bundle)}`, `끝 ${v.endsText} · 한도 ${body.maxUses ?? '무제한'} · 플랫폼 ${v.platforms?.join(', ') ?? '전부'}`] };
    },
    send: (reason) => write('coupon.create', body, reason),
    okText: (x) => `쿠폰 ${x.data?.code ?? ''} 만들었어요`, then: reload,
  });
  return h('details.panel', h('summary', h('b', '새 공용 코드')), h('div', { style: 'margin-top:10px' },
    h('div.row', code, campaign, maxUses), c.el, h('div.row', { style: 'margin-top:8px' }, btn)));
}

function batchBox(reload) {
  const campaign = h('input', { placeholder: '묶음 이름(계정당 1장 단위)' });
  const count = h('input', { type: 'number', min: 1, max: 5000, placeholder: '개수(1~5000)' });
  const c = common();
  let body = null;
  const btn = writeButton('일회용 묶음 만들기', {
    cls: 'primary',
    confirm: () => {
      const v = c.get();
      if (v.error) return void toast(v.error, false);
      if (!campaign.value.trim() || !(Number(count.value) >= 1 && Number(count.value) <= 5000)) return void toast('묶음 이름·개수(1~5000)를 적어 주세요', false);
      body = { campaign: campaign.value.trim(), count: Number(count.value), ...v };
      return { title: '일회용 쿠폰 묶음', lines: [`${body.campaign} · ${body.count}장 · ${bundleText(v.bundle)}`, `끝 ${v.endsText}`] };
    },
    send: (reason) => write('coupon.batch', body, reason),
    okText: (x) => `${x.data?.length ?? 0}장 만들었어요 - CSV 저장`,
    then: (x) => {
      downloadCsv(`coupons-${body.campaign}.csv`, ['code', ...(x.data ?? []).map((r) => r.code)]);
      return reload();
    },
  });
  return h('details.panel', h('summary', h('b', '일회용 묶음 만들기')), h('div', { style: 'margin-top:10px' },
    h('div.row', campaign, count), c.el, h('div.row', { style: 'margin-top:8px' }, btn,
      h('span.muted', '만든 코드는 이때만 CSV로 받아요(목록에는 묶음 합계만).'))));
}

function downloadCsv(name, lines) {
  const a = h('a', { href: URL.createObjectURL(new Blob([`${lines.join('\n')}\n`], { type: 'text/csv' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10e3);
}
