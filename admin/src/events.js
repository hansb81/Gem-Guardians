// 이벤트(docs/events.md): 목록(상태·받은 사람 수) + 만들기·고치기 폼 + 켜기/끄기 + 배너 그림 업로드(미리보기).
// 보상 입력은 보상 지급 폼 재사용(coupon + stones = event_bundle_ok 범위). SQL event_create/event_set_enabled도 그대로 쓸 수 있다.
import { call, isOwner, write } from './api.js';
import { bundleForm, bundleText } from './bundle.js';
import { confirmWrite, h, kst, kstDate, num, reasonText, table, toast, writeButton } from './ui.js';
import { eventPeriodText } from '../../src/game/eventRules.js';
import stampUrl from '../../assets/ui/events/stamp_claimed.png?url';
import fontUrl from '../../assets/fonts/Galmuri11.woff2?url';

const PLATFORMS = ['web', 'toss', 'android', 'onestore', 'ios'];
const BANNERS = import.meta.glob('../../assets/ui/events/banner_*.png', { eager: true, query: '?url', import: 'default' });
const bannerKeys = Object.keys(BANNERS).map((p) => p.match(/banner_(\w+)\.png$/)[1]).filter((k) => k !== 'default');
const localBanner = (key) => BANNERS[`../../assets/ui/events/banner_${key}.png`] ?? BANNERS['../../assets/ui/events/banner_default.png'];
const BW = 236, BH = 55; // 배너 원본 크기(게임은 2배)
const font = new FontFace('Galmuri11', `url(${fontUrl})`);
const fontReady = font.load().then((f) => document.fonts.add(f)).catch(() => {});

function status(e, now = Date.now()) {
  if (!e.enabled) return h('span.muted', '꺼짐');
  if (e.starts_at && now < Date.parse(e.starts_at)) return h('span', '예정');
  if (e.ends_at && now >= Date.parse(e.ends_at)) return h('span.muted', '끝남');
  return h('span.ok', '켜짐');
}

export async function render(root) {
  const r = await call('event.list');
  if (!r.ok) return root.replaceChildren(h('div.red', reasonText(r)));
  const reload = () => render(root);
  const editBox = h('div');
  const edit = (e) => {
    editBox.replaceChildren(editor(e, reload));
    editBox.scrollIntoView({ behavior: 'smooth' });
  };
  root.replaceChildren(
    h('h1', '이벤트'),
    h('div.muted', { style: 'margin-bottom:8px' }, '켜고 끈 것은 앱이 다음에 시작하거나 이벤트 팝업을 열 때 반영돼요. 받기는 계정당 1번.'),
    table([
      { key: 'id', label: 'id' }, { key: 'title_ko', label: '제목' }, { key: 'kind', label: '종류' },
      { key: 'enabled', label: '상태', fmt: (_, e) => status(e) },
      { key: 'starts_at', label: '기간(KST)', fmt: (_, e) => `${kst(e.starts_at)} ~ ${kst(e.ends_at)}` },
      { key: 'sort', label: '순서', num: true }, { key: 'platforms', label: '마켓', fmt: (v) => v?.join(', ') ?? '전부' },
      { key: 'bundle', label: '보상', fmt: (v) => bundleText(v) },
      { key: 'claimed_count', label: '받은 사람', num: true, fmt: num },
      { key: 'banner_url', label: '배너', fmt: (v, e) => h('img', { src: v || localBanner(e.banner), width: BW, height: BH, style: 'image-rendering:pixelated' }) },
      { key: 'id', label: '', fmt: (_, e) => isOwner() && h('span.row',
        h('button', { onclick: () => edit(e) }, '고치기'),
        writeButton(e.enabled ? '끄기' : '켜기', {
          confirm: { title: `이벤트 ${e.enabled ? '끄기' : '켜기'}`, lines: [`${e.id} · ${e.title_ko ?? ''}`] },
          send: (reason) => write('event.toggle', { id: e.id, enabled: !e.enabled }, reason), okText: e.enabled ? '껐어요' : '켰어요', then: reload,
        })) },
    ], r.events, { empty: '이벤트 없음' }),
    isOwner() && h('div.row', { style: 'margin:10px 0' }, h('button.primary', { onclick: () => edit(null) }, '새 이벤트')),
    editBox,
  );
}

// e = 고칠 이벤트(null = 새로).
function editor(e, reload) {
  const isNew = !e;
  const input = (v = '', attrs = {}) => Object.assign(h('input', attrs), { value: v ?? '' });
  const area = (v = '') => Object.assign(h('textarea', { rows: 2, style: 'width:100%' }), { value: v ?? '' });
  const id = input(e?.id, { placeholder: 'id(영문·숫자·_·- 40자, 예 launch2026)', disabled: !isNew });
  const titleKo = input(e?.title_ko), titleEn = input(e?.title_en);
  const bodyKo = area(e?.body_ko), bodyEn = area(e?.body_en);
  const kind = h('select', h('option', { value: 'claim' }, 'claim (1회 보상)'), h('option', { value: 'notice' }, 'notice (안내만)'));
  kind.value = e?.kind ?? 'claim';
  const banner = h('select', h('option', { value: '' }, '기본 배너'), bannerKeys.map((k) => h('option', { value: k }, k)));
  banner.value = e?.banner ?? '';
  const start = input(e ? kstDate(Date.parse(e.starts_at)) : kstDate(), { type: 'date' });
  const end = input(e ? kstDate(Date.parse(e.ends_at)) : kstDate(Date.now() + 30 * 86400e3), { type: 'date' });
  const plats = Object.fromEntries(PLATFORMS.map((p) => [p, h('input', { type: 'checkbox', checked: !!e?.platforms?.includes(p) })]));
  const sort = input(e?.sort ?? 0, { type: 'number', step: 1, style: 'width:80px' });
  const enabled = h('input', { type: 'checkbox', checked: !!e?.enabled });
  const bundle = bundleForm({ coupon: true, stones: true });
  bundle.set(e?.bundle ?? {});
  const bundleBox = h('div', bundle.el);
  const syncKind = () => (bundleBox.style.display = kind.value === 'claim' ? '' : 'none');
  kind.onchange = syncKind;
  syncKind();

  let body = null;
  const save = writeButton(isNew ? '만들기' : '저장', {
    cls: 'primary',
    confirm: () => {
      const b = kind.value === 'claim' ? bundle.get() : null;
      if (b?.error) return void toast(b.error, false);
      if (!id.value.trim() || !titleKo.value.trim() || !titleEn.value.trim()) return void toast('id·제목(ko/en)을 적어 주세요', false);
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id.value.trim())) return void toast('id는 영문·숫자·_·- 만, 40자까지 (띄어쓰기·한글·점 안 됨. 예 launch2026)', false);
      if (!start.value || !end.value || end.value < start.value) return void toast('기간을 확인해 주세요', false);
      const platforms = PLATFORMS.filter((p) => plats[p].checked);
      body = {
        id: id.value.trim(), isNew, kind: kind.value, title: { ko: titleKo.value.trim(), en: titleEn.value.trim() },
        body: { ko: bodyKo.value.trim(), en: bodyEn.value.trim() }, bundle: b, banner: banner.value || null,
        startsAt: `${start.value}T00:00:00+09:00`, endsAt: `${end.value}T23:59:59+09:00`, // 끝 = 그날 23:59:59 KST
        platforms: platforms.length ? platforms : null, sort: Number(sort.value) || 0, enabled: enabled.checked,
      };
      return {
        title: isNew ? '이벤트 만들기' : `이벤트 ${body.id} 고치기`,
        lines: [`${body.title.ko} · ${body.kind} · ${b ? bundleText(b) : '보상 없음'}`,
          `${start.value} 00:00 ~ ${end.value} 23:59:59 (KST) · 마켓 ${platforms.join(', ') || '전부'} · ${body.enabled ? '켜짐' : '꺼짐'}`],
      };
    },
    // 이미 받은 사람이 있는 이벤트의 보상을 바꾸면 한 번 더 묻는다(받은 사람은 그대로).
    send: async (reason) => {
      const r = await write('event.save', body, reason);
      if (r.reason !== 'bundleChanged') return r;
      const again = await confirmWrite({
        title: '보상 바꾸기', okLabel: '바꾸기', reason,
        danger: [`이미 ${num(r.claimed)}명이 받았어요. 바꾼 보상은 앞으로 받는 사람부터예요(이미 받은 사람은 그대로).`],
      });
      return again ? write('event.save', { ...body, confirmBundle: true }, again) : { ok: false, reason: '취소했어요' };
    },
    okText: isNew ? '만들었어요' : '저장했어요', then: reload,
  });

  return h('div.panel',
    h('b', isNew ? '새 이벤트' : `이벤트 ${e.id}`),
    h('div.row', { style: 'margin-top:8px' }, id, h('label', '종류 ', kind), h('label', '앱 안 배너 ', banner), h('label', '순서 ', sort),
      h('label', enabled, ' 켜기')),
    h('div.row', { style: 'margin-top:6px' }, h('label', '제목(ko) ', titleKo), h('label', '제목(en) ', titleEn)),
    h('div', { style: 'margin-top:6px' }, '설명(ko)', bodyKo, '설명(en)', bodyEn),
    h('div.row', { style: 'margin-top:6px' }, h('label', '시작 ', start), h('label', '끝 ', end, ' 23:59:59'), h('span.muted', 'KST')),
    h('div.row', { style: 'margin:6px 0' }, '마켓(없으면 전부) ', PLATFORMS.map((p) => h('label', plats[p], ` ${p}`))),
    bundleBox,
    h('div.row', { style: 'margin-top:8px' }, save),
    !isNew && bannerBox(e, reload),
  );
}

// 배너 업로드: PNG 236x55만(아니면 거부), 알파 0/255 아님·16색 넘음은 경고만. 게임과 같은 2배·스무딩 없음 미리보기 + 글자 + 받음 도장.
function bannerBox(e, reload) {
  const canvas = h('canvas', { width: BW * 2, height: BH * 2, style: 'image-rendering:pixelated;display:block;margin:8px 0;background:#0d0a10' });
  const stampOn = h('input', { type: 'checkbox' });
  const file = h('input', { type: 'file', accept: 'image/png' });
  const warn = h('div.red');
  const stamp = new Image();
  stamp.src = stampUrl;
  let img = null, bytes = null;

  const draw = async () => {
    await fontReady;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (img) ctx.drawImage(img, 0, 0, BW * 2, BH * 2);
    const text = (s, x, y, size, color) => {
      ctx.font = `${size}px 'Galmuri11', sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#0d0a10';
      ctx.strokeText(s, x, y);
      ctx.fillStyle = color;
      ctx.fillText(s, x, y);
    };
    text(e.title_ko ?? '', 52, 36, 22, '#f2d264');
    text(eventPeriodText(Date.parse(e.starts_at), Date.parse(e.ends_at), 'ko'), 52, 78, 13, '#a59cb2');
    if (stampOn.checked) {
      ctx.fillStyle = 'rgba(13, 10, 16, 0.55)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (stamp.complete) ctx.drawImage(stamp, 388, 22, stamp.width * 2, stamp.height * 2);
    }
  };
  const load = (src) => new Promise((ok, bad) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = bad;
    i.src = src;
  });
  load(e.banner_url || localBanner(e.banner)).then((i) => ((img = i), draw()), () => draw());
  stamp.onload = draw;
  stampOn.onchange = draw;

  file.onchange = async () => {
    warn.replaceChildren();
    bytes = null;
    const f = file.files[0];
    if (!f) return;
    if (f.type !== 'image/png') return void toast('PNG만 올릴 수 있어요', false);
    const buf = new Uint8Array(await f.arrayBuffer());
    const url = URL.createObjectURL(f);
    const i = await load(url).catch(() => null);
    URL.revokeObjectURL(url);
    if (!i) return void toast('그림을 읽지 못했어요', false);
    if (i.width !== BW || i.height !== BH) return void toast(`${BW}x${BH}만 올릴 수 있어요 (이 파일 ${i.width}x${i.height})`, false);
    const c = Object.assign(document.createElement('canvas'), { width: BW, height: BH }).getContext('2d');
    c.drawImage(i, 0, 0);
    const px = c.getImageData(0, 0, BW, BH).data;
    const colors = new Set();
    let semi = false;
    for (let p = 0; p < px.length; p += 4) {
      if (px[p + 3] !== 0 && px[p + 3] !== 255) semi = true;
      if (px[p + 3]) colors.add((px[p] << 16) | (px[p + 1] << 8) | px[p + 2]);
    }
    const w = [];
    if (semi) w.push('반투명 픽셀이 있어요(알파 0/255가 아님)');
    if (colors.size > 16) w.push(`색이 ${colors.size}개예요(16색 넘음)`);
    warn.replaceChildren(...w.map((s) => h('div', `⚠ ${s} - 올릴 수는 있어요`)));
    img = i;
    bytes = buf;
    draw();
  };

  const upload = writeButton('배너 올리기', {
    cls: 'primary',
    confirm: () => (bytes ? { title: '배너 올리기', lines: [`${e.id} · ${BW}x${BH} PNG ${num(bytes.length)} bytes`] } : void toast('PNG 파일을 골라 주세요', false)),
    send: (reason) => {
      let s = '';
      for (const b of bytes) s += String.fromCharCode(b);
      return write('event.banner', { id: e.id, png: btoa(s) }, reason);
    },
    okText: '배너를 바꿨어요', then: reload,
  });

  return h('fieldset', { style: 'margin-top:12px' }, h('legend', `배너 그림 (PNG ${BW}x${BH}, 게임에서 2배)`),
    h('div.row', file, h('label', stampOn, ' 받음 도장 보기'), upload),
    warn, canvas,
    h('div.muted', '미리보기 = 게임 목록 줄과 같은 위치의 제목·기간. 올릴 때마다 새 파일 이름이라 앱 캐시 문제 없음.'));
}
