// 지급 내용 입력(보상 지급·전체 발송·쿠폰 공용). 번들 모양 = docs/admin.md §4-1, 서버 admin_bundle_ok가 최종 검사.
// coupon: true = coupon_bundle_ok 범위(골드·다이아·아이템만, 다이아 5000·골드 100만·아이템 99).
// stones: true = 정령석 칸도(이벤트 event_bundle_ok = 쿠폰 범위 + 정령석 1000).
import items from '../../config/items.json';
import shop from '../../config/shop.json';
import balance from '../../config/balance.json';
import { ko } from '../../src/config/locales/ko.js';
import { h, num } from './ui.js';

const ICONS = import.meta.glob('../../assets/items/*.png', { eager: true, query: '?url', import: 'default' });
export const ITEM_IDS = Object.keys(items.items);
export const SKILL_IDS = [...Object.keys(shop.skills.color), ...Object.keys(shop.skills.special)];
const SKILL_MAX = shop.skills.maxLevel;
const TOWER_MAX = balance.tower.maxLevel;
// levels.towers 순서 = balance.json tower.towers (docs/admin.md A단계 메모)
const COLOR_KO = { red: '빨강', blue: '파랑', yellow: '노랑', green: '초록', purple: '보라' };
export const TOWERS = balance.tower.towers.map((t) => `${COLOR_KO[t.color] ?? t.color}(${t.name})`);
export const itemName = (id) => ko.item.name[id] ?? id;
const skillName = (id) => ko.shop.skill[id]?.name ?? id;

export const LIMITS = { admin: { diamonds: 50000, gold: 100000000, item: 999 }, coupon: { diamonds: 5000, gold: 1000000, item: 99, stones: 1000 } };

// 폼을 만든다 -> { el, get(): bundle|{error}, set(bundle) }
export function bundleForm({ coupon = false, stones = false } = {}) {
  const lim = coupon ? LIMITS.coupon : LIMITS.admin;
  const n = (max, ph = '') => h('input', { type: 'number', min: 0, max, step: 1, placeholder: ph });
  const gold = n(lim.gold, '0');
  const dia = n(lim.diamonds, '0');
  const stone = n(lim.stones ?? 0, '0');
  const itemIn = Object.fromEntries(ITEM_IDS.map((id) => [id, n(lim.item, '0')]));
  const skillIn = Object.fromEntries(SKILL_IDS.map((id) => [id, h('select',
    h('option', { value: '' }, '-'), h('option', { value: '+1' }, '+1'),
    Array.from({ length: SKILL_MAX + 1 }, (_, i) => h('option', { value: String(i) }, `Lv ${i}`)))]));
  const flagIn = { slot4: h('input', { type: 'checkbox' }), adFree: h('input', { type: 'checkbox' }) };
  const towerIn = TOWERS.map(() => n(TOWER_MAX, '-'));
  const floorIn = n(300, '-');

  const el = h('div',
    h('fieldset', h('legend', '재화'), h('div.row',
      h('label', '골드 ', gold), h('label', '다이아 ', dia), stones && h('label', '정령석 ', stone),
      h('span.muted', `상한 골드 ${num(lim.gold)} · 다이아 ${num(lim.diamonds)} · 아이템 개당 ${lim.item}`))),
    h('fieldset', h('legend', '아이템'), h('div.items', ITEM_IDS.map((id) => h('label',
      ICONS[`../../assets/items/${id}.png`] && h('img', { src: ICONS[`../../assets/items/${id}.png`], alt: '' }),
      h('span', { style: 'flex:1' }, itemName(id)), itemIn[id])))),
    !coupon && [
      h('fieldset', h('legend', '젬 스킬 (+1 = 한 단계, Lv = 그 레벨 이상으로)'),
        h('div.items', SKILL_IDS.map((id) => h('label', h('span', { style: 'flex:1' }, skillName(id)), skillIn[id])))),
      h('fieldset', h('legend', '영구 플래그'), h('div.row',
        h('label', flagIn.slot4, ' 4번째 슬롯(slot4)'), h('label', flagIn.adFree, ' 광고 제거(adFree)'))),
      h('fieldset', h('legend', `레벨 (최소 보장 - 낮으면 올리고 높으면 그대로, 타워 최대 Lv ${TOWER_MAX})`),
        h('div.row', TOWERS.map((t, i) => h('label', `${t} 최소 Lv `, towerIn[i]))),
        h('div.row', { style: 'margin-top:6px' }, h('label', '층 최소 ', floorIn, ' 층 (최고 층도 같이, 랭킹 기록은 안 바뀜)')),
        h('div.muted', '레벨 지급은 C단계 앱 버전부터 적용돼요. 옛 앱은 받지 못해요.')),
    ]);

  const int = (input) => (input.value === '' ? null : Number(input.value));
  function get() {
    const b = {};
    const g = int(gold), d = int(dia);
    if (g) b.gold = g;
    if (d) b.diamonds = d;
    if (stones && int(stone)) b.spiritStones = int(stone);
    const it = {};
    for (const id of ITEM_IDS) if (int(itemIn[id])) it[id] = int(itemIn[id]);
    if (Object.keys(it).length) b.items = it;
    if (!coupon) {
      const sk = {};
      for (const id of SKILL_IDS) if (skillIn[id].value !== '') sk[id] = skillIn[id].value === '+1' ? '+1' : Number(skillIn[id].value);
      if (Object.keys(sk).length) b.skills = sk;
      const fl = Object.keys(flagIn).filter((k) => flagIn[k].checked);
      if (fl.length) b.flags = fl;
      const towers = towerIn.map((x) => int(x) || null);
      const lv = {};
      if (towers.some((x) => x)) lv.towers = towers;
      if (int(floorIn)) lv.floor = int(floorIn);
      if (Object.keys(lv).length) b.levels = lv;
    }
    const bad = [...el.querySelectorAll('input[type=number]')].find((x) => x.value !== '' && !x.checkValidity());
    if (bad) return { error: `범위를 넘은 칸이 있어요 (${bad.min}~${bad.max} 정수)` };
    if (!Object.keys(b).length) return { error: '지급 내용이 비었어요' };
    return b;
  }
  function set(b = {}) {
    gold.value = b.gold ?? '';
    dia.value = b.diamonds ?? '';
    stone.value = b.spiritStones ?? '';
    for (const id of ITEM_IDS) itemIn[id].value = b.items?.[id] ?? '';
  }
  return { el, get, set };
}

// "다이아 500, 망치 5, ..." 한 줄
export function bundleText(b) {
  if (!b || typeof b !== 'object') return '';
  const out = [];
  if (b.gold) out.push(`골드 ${num(b.gold)}`);
  if (b.diamonds) out.push(`다이아 ${num(b.diamonds)}`);
  if (b.spiritStones) out.push(`정령석 ${num(b.spiritStones)}`);
  for (const [id, c] of Object.entries(b.items ?? {})) out.push(`${itemName(id)} ${c}`);
  for (const [id, v] of Object.entries(b.skills ?? {})) out.push(`${skillName(id)} ${v === '+1' ? '+1' : `Lv ${v}`}`);
  for (const f of b.flags ?? []) out.push(f === 'slot4' ? '4번째 슬롯' : f === 'adFree' ? '광고 제거' : f);
  (b.levels?.towers ?? []).forEach((v, i) => v && out.push(`${TOWERS[i]} 최소 Lv ${v}`));
  if (b.levels?.floor) out.push(`최소 ${b.levels.floor}층`);
  return out.join(', ');
}

// 확인창 빨간 줄(§4-1): 다이아 10,000 이상·플래그·레벨.
export function bundleDanger(b) {
  const d = [];
  if (b?.diamonds >= 10000) d.push(`다이아 ${num(b.diamonds)} - 1만 개 이상`);
  if (b?.flags?.length) d.push(`영구 플래그 지급: ${b.flags.join(', ')} (회수 불가)`);
  if (b?.levels) d.push('레벨 지급 - 내릴 수 없고, 옛 앱 버전은 받지 못함');
  return d;
}
