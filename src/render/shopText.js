// 상점 상품(src/core/shop/shop.js의 데이터) -> 화면 글자. 카드: name/sub/desc(줄 배열)/tag,
// 가격 버튼: lockText/soldText/label, 팝업: long/info([[라벨, 값]]). 글자는 모두 locales의 shop.* 키.
import { t } from '../config/i18n.js';

export const fmt = (n) => Math.round(n).toLocaleString('en-US');
const itemName = (id) => t(`item.name.${id}`);

// config/shop.json skills.*.format
export function fmtSkill(format, v) {
  if (format === 'pct') return `${Math.round(v * 100)}%`;
  if (format === 'slowPct') return `${Math.round((1 - v) * 100)}%`;
  if (format === 'plusPct') return `+${Math.round(v * 100)}%`;
  if (format === 'sec') return t('shop.skill.sec', { v: String(+v.toFixed(2)) });
  return `×${v.toFixed(1)}`;
}

function grantParts(grant) {
  const parts = [];
  if (grant.slot4) parts.push(t('shop.grant.slot4'));
  if (grant.adFree) parts.push(t('shop.grant.adFree'));
  if (grant.diamonds) parts.push(t('shop.grant.dia', { n: fmt(grant.diamonds) }));
  for (const [id, n] of Object.entries(grant.items ?? {})) parts.push(t('shop.grant.item', { name: itemName(id), n }));
  return parts;
}

// 받은 것(buyProduct 결과 got) -> 한 줄.
export function gotText(got) {
  const parts = [];
  if (got.diamonds) parts.push(t('shop.grant.dia', { n: fmt(got.diamonds) }));
  if (got.gold) parts.push(`+${fmt(got.gold)}`);
  for (const [id, n] of Object.entries(got.items ?? {})) parts.push(t('shop.grant.item', { name: itemName(id), n }));
  if (got.slot4) parts.push(t('shop.grant.slot4'));
  return parts.join(', ');
}

// env = { cfg(shop.json), itemsConfig, player }
export function productText(p, env) {
  const { cfg, itemsConfig, player } = env;
  const owned = (id) => t('shop.owned', { n: player.inventory?.count(id) ?? 0 });
  switch (p.kind) {
    case 'free':
      return {
        name: t('shop.free.name'), sub: t('shop.free.sub'), tag: ['shop.tag.free', 'gold'],
        desc: [p.adFree ? t('shop.free.descAdFree') : t('shop.free.desc', { item: itemName(p.item), n: p.count })],
        label: t(p.adFree ? 'shop.free.btnAdFree' : 'shop.free.btn'), soldText: t('shop.sold.tomorrow'),
        long: t('shop.free.long'), info: [[t('shop.info.today'), t('shop.grant.item', { name: itemName(p.item), n: p.count })]],
        note: p.adFree ? null : [t('shop.free.adNote')],
      };
    case 'item':
    case 'diaItem': {
      const it = itemsConfig.items[p.item];
      const info = p.kind === 'item' ? [
        [t('shop.info.cooldown'), it.cooldownMoves ? t('shop.info.swaps', { n: it.cooldownMoves }) : '-'],
        [t('shop.info.perFloor'), it.group === 'preFloor' ? '1' : it.perFloor == null ? t('shop.info.unlimited') : String(it.perFloor)],
        [t('shop.info.basePrice'), t('shop.info.baseVal', { n: it.goldBase })],
      ] : null;
      return {
        name: itemName(p.item), sub: owned(p.item), subKey: p.item, desc: [t(`item.desc.${p.item}`)], long: t(`shop.long.${p.item}`), info,
        lockText: t('shop.lock.floor', { floor: p.lockFloor }), lockMsg: t('shop.lockMsg.item', { name: itemName(p.item), floor: p.lockFloor }),
      };
    }
    case 'itemBundle':
      return {
        name: `${itemName(p.item)} ×${p.count}`, sub: owned(p.item), subKey: p.item, desc: [t(`item.desc.${p.item}`)], long: t(`shop.long.${p.item}`),
        info: [[t('shop.info.bundle'), t('shop.info.bundleVal', { n: p.count })], [t('shop.info.each'), t('shop.info.eachVal', { n: Math.round(p.price / p.count) })]],
        lockText: t('shop.lock.floor', { floor: p.lockFloor }), lockMsg: t('shop.lockMsg.item', { name: itemName(p.item), floor: p.lockFloor }),
      };
    case 'skill':
    case 'skillUnlock': {
      const s = p.special ? cfg.skills.special[p.skill] : cfg.skills.color[p.skill];
      const v = s.values;
      const f = (x) => fmtSkill(s.format, x);
      const effect = p.special ? t('shop.skill.special', { gem: t(`shop.skill.${p.skill}.gem`), desc: t(`shop.skill.${p.skill}.desc`) }) : t(`shop.skill.${p.skill}.desc`);
      const extra = p.skill === 'ult' ? t('shop.skill.ult.extra') : null;
      const name = t(`shop.skill.${p.skill}.name`);
      if (p.kind === 'skillUnlock') {
        const locked = p.state === 'locked';
        return {
          name, sub: locked ? t('shop.locked') : t('shop.notUnlocked'), desc: [effect, t('shop.skill.unlockAt', { v: f(v[0]) })], emSecond: true, prefix: t('shop.popup.unlock'),
          long: t('shop.skill.longUnlock', { gem: t(`shop.skill.${p.skill}.gem`), desc: t(`shop.skill.${p.skill}.desc`) }),
          info: [[t('shop.info.unlockCond'), p.lockBoss ? t('shop.info.bossKill', { floor: p.lockBoss }) : t('shop.info.fromStart')], ['Lv 1', f(v[0])], [`Lv ${p.maxLevel}`, f(v[p.maxLevel - 1])]].concat(extra ? [[t('shop.info.together'), extra]] : []),
          lockText: t('shop.lock.boss', { floor: p.lockBoss }), lockMsg: t('shop.lockMsg.boss', { floor: p.lockBoss }),
        };
      }
      const max = p.lv >= p.maxLevel;
      return {
        name, sub: t('shop.lv', { lv: p.lv, max: p.maxLevel }), emSecond: true,
        desc: [effect, max ? t('shop.skill.max', { v: f(v[p.maxLevel - 1]) }) : t('shop.skill.next', { a: f(v[p.lv - 1]), b: f(v[p.lv]) })],
        soldText: t('shop.sold.max'), long: t('shop.skill.longLevel', { desc: effect }),
        info: v.map((x, i) => [`Lv ${i + 1}`, f(x) + (i + 1 === p.lv ? t('shop.info.now') : '')]).concat(extra ? [[t('shop.info.together'), extra]] : []),
      };
    }
    case 'totem':
      return { name: t('shop.totem.name'), sub: t('shop.totem.sub'), desc: [t('shop.totem.desc'), t('shop.totem.desc2')], tag: ['shop.tag.soon', 'gray'], lockText: t('shop.lock.soon'), lockMsg: t('shop.lockMsg.totem') };
    case 'pack': {
      const pk = cfg.packs[p.pack];
      const name = t(`shop.pack.${p.pack}.name`, { ch: p.chapter });
      const info = [[t('shop.info.expose'), t(`shop.pack.${p.pack}.expose`, { ch: p.chapter })]];
      if (pk.pass) {
        const pass = { ...pk.pass, now: cfg.products[p.id].grant.diamonds };
        const plus = Object.entries(pass.dailyItems ?? {}).map(([id, n]) => t('shop.pass.plusItem', { name: itemName(id), n })).join('');
        return {
          name, desc: [t('shop.pass.desc', { now: pass.now, days: pass.days, daily: pass.daily }) + plus, t('shop.pass.total', { n: fmt(pass.now + pass.daily * pass.days) })],
          tag: ['shop.tag.repeat', 'blue'], long: t('shop.pass.desc', { now: pass.now, days: pass.days, daily: pass.daily }) + plus,
          info: [[t('shop.info.instant'), t('shop.grant.dia', { n: pass.now })], [t('shop.info.daily'), t('shop.grant.dia', { n: pass.daily }) + plus], [t('shop.info.period'), t('shop.info.days', { n: pass.days })]],
        };
      }
      const parts = grantParts(cfg.products[p.id].grant);
      if (pk.offerHours) info.push([t('shop.info.left'), t('shop.info.hours', { n: pk.offerHours })]);
      const TAGS = { boss: ['shop.tag.h24', ''], slot4: ['shop.tag.until20', 'blue'], chapter: ['shop.tag.perChapter', ''], adfree: ['shop.tag.one', ''] };
      const bannerTags = p.pack === 'starter' ? [['shop.tag.once', ''], ['shop.tag.value', 'gold', pk.value]] : [['shop.tag.perBoss', ''], ['shop.tag.value', 'gold', pk.value]];
      return { name, parts, desc: parts, tag: TAGS[p.pack] ?? null, bannerTags, long: parts.join(' · '), info, reward: parts.join(', ') };
    }
    case 'passClaim': {
      const pass = cfg.packs[p.pack].pass;
      const plus = Object.entries(pass.dailyItems ?? {}).map(([id, n]) => t('shop.pass.plusItem', { name: itemName(id), n })).join('');
      return {
        name: t(`shop.pack.${p.pack}.name`), sub: t('shop.pass.left', { n: p.daysLeft }), desc: [t('shop.pass.today', { n: pass.daily }) + plus],
        label: t('shop.pass.claim', { n: pass.daily }), soldText: t('shop.sold.tomorrow'), tag: p.state === 'sold' ? null : ['shop.tag.claim', ''],
      };
    }
    case 'diaBundle': {
      const got = p.dia * (p.first ? 2 : 1) + p.bonus;
      return {
        name: t('shop.dia.name', { n: fmt(p.dia) }), sub: p.bonus ? t('shop.dia.bonus', { n: fmt(p.bonus) }) : '', wide: true,
        desc: [p.first ? t('shop.dia.first', { n: fmt(got) }) : t('shop.dia.amount', { n: fmt(got) })], descEm: p.first,
        tag: p.first ? ['shop.tag.first2', ''] : null, long: t(p.first ? 'shop.dia.longFirst' : 'shop.dia.long', { n: fmt(got) }), reward: t('shop.grant.dia', { n: fmt(got) }),
      };
    }
    case 'slot4':
      return {
        name: t('shop.slot4.name'), sub: p.state === 'sold' ? t('shop.sold.opened') : t('shop.locked'), desc: [t('shop.slot4.desc'), t('shop.slot4.desc2')],
        soldText: t('shop.sold.opened'), long: t('shop.slot4.long'),
      };
    case 'goldEx':
      return {
        name: t(`shop.goldex.${p.exId}`), sub: `+${fmt(p.gold)}`, wide: true, desc: [t('shop.goldex.desc', { n: p.floors }), t('shop.goldex.desc2')],
        long: t('shop.goldex.long', { dia: p.price, gold: fmt(p.gold), n: p.floors }), info: [[t('shop.info.got'), fmt(p.gold)]],
      };
    default:
      return { name: p.id, desc: [] };
  }
}
