// 상점 규칙(config/shop.json, mockups/shop/shop.html 시안 2). 브라우저 API 금지 - 시각(now ms)과
// 날짜(today 'YYYY-MM-DD')는 호출부가 넘긴다. 상품은 데이터만(id/kind/가격/상태) 돌려주고 글자는
// render(shopScreen)가 locales로 만든다.
//
// ctx = { cfg(shop.json + cfg.products = config/products.json 현금 상품 가격·지급), itemsConfig(items.json), data({balance, enemies, obstacles, floorsData}),
//         player, now, today, canSell? }
// canSell(productKey) = 이 마켓에서 현금 상품을 팔 수 있는지(없으면 전부 판다 - 테스트·시뮬레이터). 못 파는 현금 상품은
//          목록에서 빠지고 살 수도 없다. 이미 산 패스의 매일 받기는 그대로 남는다.
// player = playerState와 같은 모양: gold, diamonds, bestFloor, shop, inventory(src/game/inventory.js).
//          보유·젬 스킬·4번째 슬롯은 inventory로 읽고, 지급·차감은 inventory.buy()/grant() 한 번으로만 한다
//          (docs/inventory.md 3장 - 주입된 객체 호출이라 core 규칙(브라우저 API 금지)과 무관).
import { itemPrice, normalFloorReward } from '../economy/economy.js';
import { defaultSkillLevels } from '../inventory/inventory.js';
import { addDays, daysBetween } from '../kst.js';

export const RAILS = ['items', 'skills', 'packs', 'dia']; // 정령 도감은 정비 팝업 정령 탭으로 옮김(docs/spirits.md 7장)
const HOUR_MS = 3600 * 1000;
const PASS_HISTORY_MAX = 5;

function passIds(cfg) {
  return cfg.packs.order.filter((id) => cfg.packs[id].pass);
}

// 젬 스킬 레벨은 inventory.perm.skills로 옮겼다. skillLv는 tools/sim(수정 금지)이 기본 레벨표로 읽어서만 남겨 두고,
// 게임 저장에는 normalizeShopSave가 빼고 넣는다.
export function defaultShopSave(cfg) {
  const skillLv = defaultSkillLevels(cfg.skills);
  const passes = {};
  for (const id of passIds(cfg)) passes[id] = { endDay: null, claimedDay: null };
  // day = 마지막으로 날짜 갱신을 한 날, offers = 기간 한정 노출 { starter: 만료ms, boss: { floor, expiresAt } }.
  // passHistory = 다시 살 때 밀려난 이전 패스 [{ pack, boughtDay, endDay, claimedDay }], 최근 PASS_HISTORY_MAX건(환불 문의 확인용).
  return { purchasedOnce: [], firstBuyUsed: [], passes, passHistory: [], skillLv, freeClaimedDate: null, day: null, offers: {} };
}

// 저장 데이터에 없는 키만 기본값으로 채운다(새 스킬/패스가 config에 추가돼도 기존 저장이 깨지지 않게).
export function normalizeShopSave(saved, cfg) {
  const { skillLv: _, ...def } = defaultShopSave(cfg);
  if (!saved || typeof saved !== 'object') return def;
  const { skillLv, ...rest } = saved; // v1 잔여 필드는 마이그레이션(migrateSave)이 inv로 옮긴다.
  const out = { ...def, ...rest };
  out.passes = { ...def.passes };
  for (const id of Object.keys(def.passes)) out.passes[id] = migratePass(saved.passes?.[id], saved.day) ?? { ...def.passes[id] };
  out.offers = { ...saved.offers };
  if (!Array.isArray(out.purchasedOnce)) out.purchasedOnce = [];
  if (!Array.isArray(out.firstBuyUsed)) out.firstBuyUsed = [];
  out.passHistory = Array.isArray(out.passHistory) ? out.passHistory.slice(-PASS_HISTORY_MAX) : [];
  return out;
}

// 패스 = { endDay, claimedDay } - 종료일은 구매 날짜 기준 고정(산 날 + days일, 뒤로 밀리지 않음).
// 못 받은 날은 다음에 받을 때 합산한다(2026-11-27 결정 - 11-26의 "못 받은 날은 사라진다"를 대체).
// 끝난 뒤에도 cfg.packs.passGraceDays일 동안은 남은 몫을 받을 수 있고, 그 뒤엔 사라진다.
// 산 날은 받은 것으로 친다(매일 받기는 다음 날부터). 날짜는 전부 KST 'YYYY-MM-DD'(ctx.today).
// 예전 저장 { daysLeft, claimedToday }(받을 때만 줄던 방식)은 마지막으로 상점을 연 날(shop.day) 기준으로 옮긴다.
function migratePass(p, lastDay) {
  if (!p || typeof p !== 'object') return null;
  if ('endDay' in p) return { endDay: p.endDay ?? null, claimedDay: p.claimedDay ?? null };
  if (!(p.daysLeft > 0) || !lastDay) return { endDay: null, claimedDay: null };
  return { endDay: addDays(lastDay, p.daysLeft - (p.claimedToday ? 0 : 1)), claimedDay: p.claimedToday ? lastDay : null };
}

// 패스 기간 중인가(오늘 <= 끝나는 날) - 광산 생산 보너스(월간)도 이것.
export const passActive = (pass, today) => !!pass?.endDay && today <= pass.endDay;
// 오늘 포함 남은 받기 횟수(오늘 이미 받았으면 오늘 뺌). 0 = 끝남(다시 살 수 있음).
export const passDaysLeft = (pass, today) =>
  passActive(pass, today) ? daysBetween(today, pass.endDay) + (pass.claimedDay === today ? 0 : 1) : 0;
// 지금 받기를 누르면 받는 일수 = 마지막으로 받은 날 다음 날 ~ 오늘(endDay까지만). 끝난 뒤 graceDays가 지났거나
// 시계가 뒤로 갔으면(오늘 < 마지막으로 받은 날) 0. claimedDay가 없는 옛 저장은 하루치만.
export function passPending(pass, today, graceDays = 0) {
  if (!pass?.endDay || today > addDays(pass.endDay, graceDays)) return 0;
  const last = today < pass.endDay ? today : pass.endDay;
  return Math.max(0, pass.claimedDay ? daysBetween(pass.claimedDay, last) : 1);
}

// 상점을 연 날 기록(예전 저장 마이그레이션 기준일). 바뀌었으면 true(저장 필요).
export function rolloverDay(shop, today) {
  if (shop.day === today) return false;
  shop.day = today;
  return true;
}

// 스타터 팩은 조건을 처음 만족한 순간부터 offerHours 동안. 새로 열었으면 true.
export function refreshOffers(ctx) {
  const { cfg, player, now } = ctx;
  const starter = cfg.packs.starter;
  const shop = player.shop;
  if (player.bestFloor >= starter.minBestFloor && shop.offers.starter == null && !shop.purchasedOnce.includes('pack.starter')) {
    shop.offers.starter = now + starter.offerHours * HOUR_MS;
    return true;
  }
  return false;
}

// 보스층 패배 직후 - 그 보스 팩을 offerHours 동안 노출(보스당 1회: 같은 보스로 다시 지면 기간을 늘리지 않는다).
export function offerBossPack(shop, cfg, floor, now) {
  if (shop.offers.boss?.floor === floor || shop.purchasedOnce.includes(`pack.boss.${floor}`)) return false;
  shop.offers.boss = { floor, expiresAt: now + cfg.packs.boss.offerHours * HOUR_MS };
  return true;
}

// 오늘의 무료 아이템: cfg.free.items를 날짜 순서로 돈다(난수 없음 - 같은 날은 누구나 같은 아이템).
export const freeItemOf = (cfg, today) => cfg.free.items[daysBetween('1970-01-01', today) % cfg.free.items.length];

// 광고 제거 = inventory 영구 플래그 adFree(docs/inventory.md 8장). inventory 없는 호출(tools/sim)은 false.
export function isAdFree(player) {
  return !!player.inventory?.isUnlocked('adFree');
}

function reward(ctx) {
  ctx._reward ??= normalFloorReward(ctx.data, ctx.player.bestFloor);
  return ctx._reward;
}

function goldOf(ctx, mul) {
  return Math.round(mul * reward(ctx));
}

function itemLocked(ctx, id) {
  return ctx.player.bestFloor < (ctx.itemsConfig.items[id]?.unlockFloor ?? 1);
}

function chapterOf(ctx) {
  return Math.ceil(ctx.player.bestFloor / ctx.data.balance.floorShape.bossEvery);
}

const hdr = (key, params) => ({ hdr: key, params });

function railItems(ctx) {
  const { cfg, player, today } = ctx;
  const out = [{
    id: 'free', kind: 'free', cur: 'free', item: freeItemOf(cfg, today), count: cfg.free.count, adFree: isAdFree(player),
    state: player.shop.freeClaimedDate === today ? 'sold' : '',
  }];
  for (const group of cfg.goldItems) {
    out.push(hdr(group.group, group.group === 'board' ? { gold: goldOf(ctx, 1) } : null));
    for (const id of group.items) {
      const lockFloor = ctx.itemsConfig.items[id].unlockFloor ?? 1;
      out.push({
        id: `item.${id}`, kind: 'item', item: id, cur: 'gold', price: itemPrice(ctx.data, ctx.itemsConfig, id, player.bestFloor), qty: true,
        state: itemLocked(ctx, id) ? 'locked' : '', lockFloor,
      });
    }
  }
  return out;
}

// 층 단계 레벨 상한(maxLevelByFloor): base + floor(최고 층 / every), maxLevel을 넘지 않음. every 없으면 maxLevel. tools/sim도 이걸 쓴다.
export function skillLevelCap(skillsCfg, bestFloor, every = skillsCfg.maxLevelByFloor?.every) {
  const { maxLevel } = skillsCfg;
  if (!every) return maxLevel;
  return Math.min(maxLevel, (skillsCfg.maxLevelByFloor?.base ?? 1) + Math.floor(bestFloor / every));
}

function railSkills(ctx) {
  const { cfg, player } = ctx;
  const { maxLevel, levelCost } = cfg.skills;
  const cap = skillLevelCap(cfg.skills, player.bestFloor);
  const every = cfg.skills.maxLevelByFloor?.every;
  // tools/sim은 inventory 없이 { shop: { skillLv } }만 넘긴다(수정 금지 구역).
  const lvOf = (id) => (player.inventory ? player.inventory.skillLevel(id) : player.shop.skillLv?.[id] ?? 0);
  const levelCard = (id, special) => {
    const lv = lvOf(id);
    const max = lv >= maxLevel;
    // 상한에 닿으면 잠근다(상한보다 높은 세이브도 낮추지 않고 잠금만). lockFloor = 다음 레벨이 열리는 층.
    const capped = !max && lv >= cap;
    const lockFloor = capped ? (lv + 1 - (cfg.skills.maxLevelByFloor?.base ?? 1)) * every : undefined;
    return { id: `skill.${id}`, kind: 'skill', skill: id, special, lv, maxLevel, cur: 'gold', price: max ? 0 : goldOf(ctx, levelCost[lv - 1]), state: max ? 'sold' : capped ? 'locked' : '', capLock: capped, lockFloor, lockLv: capped ? lv + 1 : undefined };
  };
  const out = [hdr('color')];
  for (const id of Object.keys(cfg.skills.color)) out.push(levelCard(id, false));
  out.push(hdr('special'));
  for (const [id, s] of Object.entries(cfg.skills.special)) {
    if (lvOf(id) > 0) {
      out.push(levelCard(id, true));
      continue;
    }
    // A안: 그 보스를 처음 잡았으면(최고 층이 보스층을 넘음) 골드로 해금, 아니면 잠김.
    const cleared = player.bestFloor > s.unlockBossFloor;
    out.push({ id: `skill.${id}`, kind: 'skillUnlock', skill: id, special: true, lv: 0, maxLevel, cur: 'gold', price: goldOf(ctx, s.unlockGold), state: cleared ? '' : 'locked', lockBoss: s.unlockBossFloor });
  }
  return out;
}

function railPacks(ctx) {
  const { cfg, player, now } = ctx;
  const shop = player.shop;
  const bought = (key) => shop.purchasedOnce.includes(key);
  const out = [];
  for (const id of cfg.packs.order) {
    const p = cfg.packs[id];
    const base = { id: `pack.${id}`, kind: 'pack', pack: id, cur: 'krw', price: cfg.products[`pack.${id}`].priceKRW, state: '' };
    const daysLeft = p.pass ? passDaysLeft(shop.passes[id], ctx.today) : 0;
    const pending = p.pass ? passPending(shop.passes[id], ctx.today, cfg.packs.passGraceDays) : 0;
    if (ctx.canSell && !ctx.canSell(base.id) && !(daysLeft > 0 || pending > 0)) continue;
    if (id === 'starter') {
      const exp = shop.offers.starter;
      if (player.bestFloor >= p.minBestFloor && !bought('pack.starter') && exp != null && now < exp) out.push({ ...base, expiresAt: exp, onceKey: 'pack.starter' });
    } else if (id === 'boss') {
      const offer = shop.offers.boss;
      if (offer && now < offer.expiresAt && !bought(`pack.boss.${offer.floor}`)) out.push({ ...base, expiresAt: offer.expiresAt, bossFloor: offer.floor, onceKey: `pack.boss.${offer.floor}` });
    } else if (p.pass) {
      // 끝난 뒤에도 받을 몫이 남아 있으면 받기 카드가 먼저(다시 사면 남은 몫이 덮어써지므로, 받은 뒤에 다시 살 수 있다).
      if (daysLeft > 0 || pending > 0) out.push({ id: `pass.${id}`, kind: 'passClaim', pack: id, cur: 'claim', daysLeft, pending, state: pending > 0 ? '' : 'sold' });
      else out.push(base);
    } else if (id === 'slot4') {
      if (player.bestFloor <= p.maxBestFloor && !player.inventory.isUnlocked('slot4') && !bought('pack.slot4')) out.push({ ...base, onceKey: 'pack.slot4' });
    } else if (p.perChapter) {
      const ch = chapterOf(ctx);
      if (!bought(`pack.${id}.${ch}`)) out.push({ ...base, chapter: ch, onceKey: `pack.${id}.${ch}` });
    } else if (!p.once || !bought(`pack.${id}`)) {
      out.push({ ...base, onceKey: p.once ? `pack.${id}` : null });
    }
  }
  // 맨 위 큰 배너는 starter, 없으면 boss.
  if (out[0] && (out[0].pack === 'starter' || out[0].pack === 'boss')) out[0].banner = true;
  out.push({ legal: true });
  return out;
}

function railDia(ctx) {
  const { cfg, player, itemsConfig } = ctx;
  const shop = player.shop;
  const out = [];
  cfg.diaBundles.forEach((b, i) => {
    if (ctx.canSell && !ctx.canSell(`dia.${i}`)) return;
    if (out.length === 0) out.push(hdr('diaBuy'));
    const prod = cfg.products[`dia.${i}`]; // grant = 기본 + 보너스 다이아
    out.push({ id: `dia.${i}`, kind: 'diaBundle', index: i, cur: 'krw', price: prod.priceKRW, dia: prod.grant.diamonds - b.bonus, bonus: b.bonus, stack: b.stack, first: !shop.firstBuyUsed.includes(i), state: '' });
  });
  out.push(hdr('diaOnly'));
  for (const e of cfg.diaItems) {
    if (typeof e === 'string') out.push({ id: `dg.${e}`, kind: 'diaItem', item: e, cur: 'dia', price: itemsConfig.items[e].diamond, state: '' });
    else { // 정령석 묶음: 하루 1번 - 오늘 txId를 이미 받았으면 'sold'(내일 다시)
      const tx = `shop:${e.id}:${ctx.today}`;
      out.push({ id: `dg.${e.id}`, kind: 'diaStones', stones: e.spiritStones, cur: 'dia', price: e.dia, tx, state: player.inventory.data.grantedTx.includes(tx) ? 'sold' : '' });
    }
  }
  out.push({ id: 'dg.slot4', kind: 'slot4', cur: 'dia', price: cfg.slot4Dia, state: player.inventory.isUnlocked('slot4') ? 'sold' : '' });
  out.push(hdr('goldex'));
  for (const g of cfg.goldExchange) out.push({ id: `goldex.${g.id}`, kind: 'goldEx', exId: g.id, cur: 'dia', price: g.dia, gold: goldOf(ctx, g.floors), floors: g.floors, stack: g.stack, state: '' });
  out.push({ legal: true }); // 현금 상품이 없는 마켓·빌드(웹)는 render가 이용약관 링크만 그린다.
  return out;
}

const RAIL_BUILDERS = { items: railItems, skills: railSkills, packs: railPacks, dia: railDia };

// 레일 하나의 목록(머리글 { hdr }, 법적 고지 { legal }, 상품). 상품 state: '' | 'locked' | 'sold'.
export function buildRail(ctx, rail) {
  return RAIL_BUILDERS[rail](ctx);
}

// 새 상품 배지(패키지 레일) - 기간 한정 팩(starter/boss)이 지금 떠 있으면.
export function hasNewPack(ctx) {
  return railPacks(ctx).some((p) => p.banner);
}

function findProduct(ctx, id) {
  for (const rail of RAILS) {
    const p = buildRail(ctx, rail).find((e) => e.id === id);
    if (p) return p;
  }
  return null;
}

export function walletOf(player, cur) {
  return cur === 'gold' ? player.gold : cur === 'dia' ? player.diamonds : Infinity;
}

// 구매. krw 상품은 결제(src/shop/iap.js)가 끝난 뒤에 부르고 txId('iap:상품:영수증')를 넘긴다(여기서는 돈을 받지 않는다).
// 상품 -> 번들을 만들고 골드/다이아 상품은 inventory.buy(), 그 밖(현금·무료·패스)은 inventory.grant()로 한 번에 지급한다.
// 상점 자체 상태(1회 구매·첫 구매 2배·패스 일수·무료 날짜)는 지급이 성공한 뒤에만 바꾼다.
// 결과 { ok, reason?: 'missing'|'locked'|'sold'|'poor'|'cap', product, qty, total, got: { diamonds, gold, items{}, skillLv, slot4 } }.
export function buyProduct(ctx, id, qty = 1, txId = null) {
  const { cfg, player, today } = ctx;
  const shop = player.shop;
  const p = findProduct(ctx, id);
  if (!p) return { ok: false, reason: 'missing' };
  if (p.state === 'locked') return { ok: false, reason: 'locked', product: p };
  if (p.state === 'sold') return { ok: false, reason: 'sold', product: p };
  const n = p.qty ? Math.max(1, Math.min(cfg.qtyMax, Math.floor(qty) || 1)) : 1;
  const total = (p.price ?? 0) * n;
  if ((p.cur === 'gold' || p.cur === 'dia') && walletOf(player, p.cur) < total) return { ok: false, reason: 'poor', product: p, qty: n, total };

  const bundle = { items: {} };
  const giveItem = (item, count) => {
    bundle.items[item] = (bundle.items[item] ?? 0) + count;
  };
  const giveDia = (amount) => {
    bundle.diamonds = (bundle.diamonds ?? 0) + amount;
  };
  const giveFlag = (flag) => (bundle.flags ??= []).push(flag);
  const giveBundle = (grant) => {
    if (grant.diamonds) giveDia(grant.diamonds);
    for (const [item, count] of Object.entries(grant.items ?? {})) giveItem(item, count);
    if (grant.slot4) giveFlag('slot4');
    if (grant.adFree) giveFlag('adFree');
  };
  let after = null; // 지급 성공 뒤 상점 상태 변경.
  let src = p.cur === 'gold' ? 'shopGold' : p.cur === 'dia' ? 'shopDia' : 'iap';
  let tx = p.cur === 'krw' ? txId : null;

  switch (p.kind) {
    case 'item': giveItem(p.item, n); break;
    case 'free':
      giveItem(p.item, p.count);
      src = 'freeDaily';
      tx = `free:${today}`;
      after = () => { shop.freeClaimedDate = today; };
      break;
    case 'skill':
    case 'skillUnlock': bundle.skills = { [p.skill]: '+1' }; break;
    case 'pack': {
      const pk = cfg.packs[p.pack];
      giveBundle(cfg.products[p.id].grant);
      after = () => {
        if (pk.pass) {
          const prev = shop.passes[p.pack];
          // 다시 살 때 이전 패스를 남긴다. 구매일은 따로 저장하지 않아 종료일 - days로 되짚는다(옛 저장에서 옮긴 패스는 어긋날 수 있다).
          if (prev?.endDay) {
            const old = { pack: p.pack, boughtDay: addDays(prev.endDay, -pk.pass.days), endDay: prev.endDay, claimedDay: prev.claimedDay };
            shop.passHistory = [...(shop.passHistory ?? []), old].slice(-PASS_HISTORY_MAX);
          }
          shop.passes[p.pack] = { endDay: addDays(today, pk.pass.days), claimedDay: today }; // 매일 받기는 다음 날부터.
        }
        if (p.onceKey) shop.purchasedOnce.push(p.onceKey);
      };
      break;
    }
    case 'passClaim': {
      const pass = cfg.packs[p.pack].pass;
      giveDia(pass.daily * p.pending); // 밀린 날 합산(p.pending일치)
      for (const [item, count] of Object.entries(pass.dailyItems ?? {})) giveItem(item, count * p.pending);
      src = 'pass';
      tx = `pass:${p.pack}:${today}`;
      after = () => {
        shop.passes[p.pack].claimedDay = today;
      };
      break;
    }
    case 'diaBundle':
      giveBundle(cfg.products[p.id].grant);
      if (p.first) giveDia(p.dia); // 첫 구매 2배 = 기본 다이아만큼 더.
      after = () => shop.firstBuyUsed.push(p.index);
      break;
    case 'diaItem': giveItem(p.item, 1); break;
    case 'diaStones':
      bundle.spiritStones = p.stones;
      tx = p.tx;
      break;
    case 'slot4': giveFlag('slot4'); break;
    case 'goldEx': bundle.gold = p.gold; break;
    default: return { ok: false, reason: 'locked', product: p };
  }

  const cost = p.cur === 'gold' ? { gold: total } : p.cur === 'dia' ? { diamonds: total } : null;
  const res = cost
    ? player.inventory.buy({ cost, bundle, src, txId: tx })
    : player.inventory.grant(bundle, { src, txId: tx });
  if (!res.ok) {
    const reason = res.reason === 'noMoney' ? 'poor' : res.reason === 'duplicate' ? 'sold' : res.reason;
    return { ok: false, reason, product: p, qty: n, total };
  }
  after?.();
  const got = { diamonds: bundle.diamonds ?? 0, gold: bundle.gold ?? 0, items: bundle.items };
  if (bundle.spiritStones) got.spiritStones = bundle.spiritStones;
  if (bundle.skills) got.skillLv = player.inventory.skillLevel(p.skill);
  if (bundle.flags?.includes('slot4')) got.slot4 = true;
  return { ok: true, product: p, qty: n, total, got, delta: res.delta };
}

// 결제가 끝난 현금 상품 지급(시작 시 미지급 복구·구매 복원). 지금 목록에 있으면 buyProduct 그대로(1회 구매·패스 등 상점 상태 포함),
// 이미 같은 txId로 받았으면 성공(스토어에 지급 완료를 알려도 됨), 목록에 없으면(기간 끝난 팩 등) 산 것은 줘야 하므로
// products.json grant만 그대로 준다(상점 상태는 안 바뀜). 결과 { ok, duplicate?, reason? }.
export function grantPaidProduct(ctx, key, txId) {
  const res = buyProduct(ctx, key, 1, txId);
  if (res.ok) return res;
  const inv = ctx.player.inventory;
  if (inv.data.grantedTx.includes(txId)) return { ok: true, duplicate: true };
  const grant = ctx.cfg.products[key]?.grant;
  if (!grant) return { ok: false, reason: 'unknownProduct' };
  const out = inv.grant(bundleOfGrant(grant), { src: 'iap', txId });
  // 1회 팩 기록도 되살린다(재설치·기기 변경 복원 - 다시 상점에 뜨지 않게).
  const pack = key.startsWith('pack.') ? ctx.cfg.packs[key.slice(5)] : null;
  const shop = ctx.player.shop;
  if (out.ok && pack?.once && shop && !shop.purchasedOnce.includes(key)) shop.purchasedOnce.push(key);
  return out;
}

function bundleOfGrant(grant) {
  const bundle = { diamonds: grant.diamonds ?? 0, items: { ...grant.items }, flags: [] };
  if (grant.slot4) bundle.flags.push('slot4');
  if (grant.adFree) bundle.flags.push('adFree');
  return bundle;
}

// 결제로만 얻는 플래그 - 환불 때 회수한다. slot4는 다이아·보스 보상으로도 얻으므로 회수하지 않는다(정당하게 얻은 것까지 뺏을 수 있음).
const IAP_ONLY_FLAGS = ['adFree'];

// 환불된 비소모성 주문: 결제로만 얻는 플래그를 회수(같은 주문은 한 번만). 결과 { ok, removed? }.
export function revokePaidProduct(ctx, key, orderId) {
  const grant = ctx.cfg.products[key]?.grant;
  if (!grant) return { ok: false, reason: 'unknownProduct' };
  const flags = bundleOfGrant(grant).flags.filter((f) => IAP_ONLY_FLAGS.includes(f));
  if (flags.length === 0) return { ok: true, removed: [] };
  return ctx.player.inventory.revokeFlags(flags, { src: 'refund', txId: `refund:iap:${key}:${orderId}` });
}

// 전투 기술에 상점 레벨을 반영한 skills 설정(새 객체). config/skills.json 값 x values[lv-1]/values[0]만 곱하므로
// Lv 1이면 원래 값 그대로(시뮬레이터 기준값 유지). 특수 기술 Lv 0 = 잠김(unlocked false).
// levels = 레벨을 돌려주는 함수(게임: inventory.skillLevel) 또는 { key: 레벨 } 객체(tools/sim).
export function applySkillLevels(skills, shopSkills, levels) {
  if (!skills || !shopSkills || !levels) return skills;
  const lvOf = typeof levels === 'function' ? levels : (key) => levels[key];
  const out = JSON.parse(JSON.stringify(skills));
  const ratio = (s, lv) => s.values[Math.min(lv, s.values.length) - 1] / s.values[0];
  for (const [id, s] of Object.entries(shopSkills.color)) {
    const lv = lvOf(id) ?? 1;
    if (out.colorEffects[id] && lv > 1) out.colorEffects[id][s.field] = skills.colorEffects[id][s.field] * ratio(s, lv);
  }
  for (const [id, s] of Object.entries(shopSkills.special)) {
    const lv = lvOf(id) ?? 0;
    for (const key of [s.skill, ...(s.alsoUnlocks ?? [])]) {
      if (out.unlocked?.specialSkills && key in out.unlocked.specialSkills) out.unlocked.specialSkills[key] = out.unlocked.specialSkills[key] && lv > 0;
    }
    if (out.specialSkills[s.skill] && lv > 1) out.specialSkills[s.skill][s.field] = skills.specialSkills[s.skill][s.field] * ratio(s, lv);
  }
  return out;
}
