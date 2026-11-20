// 저주받은 수정 광산 순수 로직(docs/mine.md, 15장 우선). 브라우저 API·시계 없음 - 시각(now ms)·날짜·R·패스 여부는
// 호출부가 ctx로 넘긴다. 상태(mine 블록)는 playerState.mine, 수치는 config/mine.json(cfg).
// ctx = { now, pass?, bestFloor?, today?, R?, inventory? }
//   now = 지금(ms) | pass = 월간 패스 보유 | bestFloor = 최고 층 | today = 서버 날짜 'YYYY-MM-DD'(있으면 우선)
//   R = 기준 층 보상(economy.normalFloorReward) | inventory = src/game/inventory.js(지급·다이아 차감)
import { ITEM_CAP } from '../inventory/inventory.js';

const HOUR_MS = 3600e3;
const KST_OFFSET_MS = 9 * HOUR_MS;
const OK = Object.freeze({ ok: true, reason: null });
const fail = (reason) => ({ ok: false, reason });
const num = (v, d = 0) => (Number.isFinite(v) && v >= 0 ? v : d);

// 하루 제한의 날짜 키(KST). 서버 날짜를 받았으면 그것이 우선.
export const kstDate = (ms) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
const dayOf = (ctx) => ctx.today ?? kstDate(ctx.now);

const newDaily = () => ({ gold: 0, items: 0, ads: 0, diaBoost: 0 });

export function defaultMine(veinCount = 5) {
  return {
    unlocked: false, veins: Array(veinCount).fill(0), storageLv: 1, bigStorage: false, ore: 0, cart: 0, anchorAt: 0,
    day: null, daily: newDaily(), tutorialDone: false, stats: { totalOre: 0, totalGold: 0 },
  };
}

// 저장된 블록에서 빠지거나 깨진 칸만 기본값으로(마이그레이션: 블록이 없으면 전부 기본값). 새 객체를 돌려준다.
export function normalizeMine(saved, cfg = null) {
  const n = cfg?.veins.length ?? (Array.isArray(saved?.veins) ? saved.veins.length : 5);
  const def = defaultMine(n);
  if (!saved || typeof saved !== 'object') return def;
  const maxStore = cfg?.storage.hours.length ?? 5;
  return {
    unlocked: saved.unlocked === true,
    veins: def.veins.map((_, i) => Math.floor(num(saved.veins?.[i]))),
    storageLv: Math.min(maxStore, Math.max(1, Math.floor(num(saved.storageLv, 1)))),
    bigStorage: saved.bigStorage === true,
    ore: Math.floor(num(saved.ore)),
    cart: num(saved.cart),
    anchorAt: num(saved.anchorAt),
    day: typeof saved.day === 'string' ? saved.day : null,
    daily: { ...def.daily, ...Object.fromEntries(Object.keys(def.daily).map((k) => [k, Math.floor(num(saved.daily?.[k]))])) },
    tutorialDone: saved.tutorialDone === true,
    stats: { totalOre: num(saved.stats?.totalOre), totalGold: num(saved.stats?.totalGold) },
  };
}

// ---------- 수치(5장) ----------
export const veinRate = (cfg, lv) => cfg.prod.base * cfg.prod.growth ** (lv - 1); // 시간당, 광맥 1개
export const veinCost = (cfg, lv) => Math.round(cfg.cost.base * cfg.cost.growth ** (lv - 1)); // lv -> lv+1
export const maxVeinLevel = (cfg, bestFloor) => cfg.maxLv.base + Math.floor(bestFloor / cfg.maxLv.perFloors);
// 보관 상한(시간) = 원석 창고 단계 + 큰 창고(다이아)면 bigBonusHours.
export const capHours = (cfg, mine) => cfg.storage.hours[mine.storageLv - 1] + (mine.bigStorage ? cfg.storage.bigBonusHours : 0);

// 시간당 생산 합(월간 패스면 x1.25).
export function ratePerHour(cfg, mine, pass = false) {
  let sum = 0;
  for (let i = 0; i < mine.veins.length; i++) if (mine.veins[i] > 0) sum += veinRate(cfg, mine.veins[i]);
  return pass ? sum * (1 + cfg.passBonus.monthly) : sum;
}

export const capacity = (cfg, mine, pass = false) => capHours(cfg, mine) * ratePerHour(cfg, mine, pass);

// 지금 정산하면 수레가 얼마일지(상태는 안 바꾼다 - 배지·화면 표시용).
export function cartAt(cfg, mine, now, pass = false) {
  const cap = capacity(cfg, mine, pass);
  const dt = now - mine.anchorAt;
  if (mine.cart >= cap || !(dt > 0)) return mine.cart; // 가속으로 상한을 넘긴 분량은 줄지도 늘지도 않는다(15-2 #5)
  return Math.min(mine.cart + (dt / HOUR_MS) * ratePerHour(cfg, mine, pass), cap);
}

// ---------- 시간(6장 + 15-2 #5) ----------
// 수레 정산. 시계를 뒤로 돌렸으면(now < anchorAt) 경과 0, anchorAt만 now로.
// 레벨업·창고 강화·수확·가속·광맥 해금 직전에 항상 먼저 부른다(과거 시간이 새 생산량으로 계산되지 않게).
export function settle(cfg, mine, now, pass = false) {
  if (!mine.unlocked) return;
  mine.cart = cartAt(cfg, mine, now, pass);
  mine.anchorAt = now;
}

// 날짜 키가 바뀌면 하루 제한 초기화. 바뀌었으면 true.
export function rolloverDay(mine, day) {
  if (mine.day === day) return false;
  mine.day = day;
  mine.daily = newDaily();
  return true;
}

// ---------- 해금(4장) ----------
// clearedFloor = 지금까지 깬 가장 높은 층. 조건을 만족한 잠긴 광맥을 전부 Lv1로 열고, 광산이 처음 열리면 선물 원석을
// 수레에 넣는다. 보스 첫 클리어 때와 저장을 불러올 때(기존 저장) 같은 함수. 새로 열린 광맥 id 배열을 돌려준다.
export function syncUnlocks(cfg, mine, clearedFloor, now, pass = false) {
  const opened = [];
  for (let i = 0; i < cfg.veins.length; i++) {
    if (mine.veins[i] > 0 || clearedFloor < cfg.veins[i].unlockBossFloor) continue;
    if (opened.length === 0) settle(cfg, mine, now, pass); // 새 광맥이 과거 시간을 캐지 않게
    mine.veins[i] = 1;
    opened.push(cfg.veins[i].id);
  }
  if (!mine.unlocked && clearedFloor >= cfg.unlockFloor) {
    mine.unlocked = true;
    mine.anchorAt = now;
    mine.cart += cfg.unlockGift;
  }
  return opened;
}

// ---------- 행동 ----------
export function harvest(cfg, mine, ctx) {
  if (!mine.unlocked) return fail('locked');
  settle(cfg, mine, ctx.now, ctx.pass);
  const amount = Math.floor(mine.cart);
  if (amount < 1) return fail('empty');
  mine.cart -= amount;
  mine.ore += amount;
  mine.stats.totalOre += amount;
  return { ...OK, amount };
}

export function upgradeVein(cfg, mine, index, ctx) {
  const lv = mine.veins[index];
  if (!mine.unlocked || !(lv > 0)) return fail('locked');
  if (lv >= maxVeinLevel(cfg, ctx.bestFloor)) return fail('max');
  const cost = veinCost(cfg, lv);
  if (mine.ore < cost) return fail('noOre');
  settle(cfg, mine, ctx.now, ctx.pass);
  mine.ore -= cost;
  mine.veins[index] = lv + 1;
  return { ...OK, cost, level: lv + 1 };
}

export function upgradeStorage(cfg, mine, ctx) {
  if (!mine.unlocked) return fail('locked');
  if (mine.storageLv >= cfg.storage.hours.length) return fail('max');
  const cost = cfg.storage.cost[mine.storageLv];
  if (mine.ore < cost) return fail('noOre');
  settle(cfg, mine, ctx.now, ctx.pass);
  mine.ore -= cost;
  mine.storageLv += 1;
  return { ...OK, cost, level: mine.storageLv };
}

// 큰 창고(다이아, 1회). 다이아 차감은 inventory.buy(지갑·log·txId 중복 방지 재사용).
export function buyBigStorage(cfg, mine, ctx) {
  if (!mine.unlocked) return fail('locked');
  if (mine.bigStorage) return fail('owned');
  settle(cfg, mine, ctx.now, ctx.pass);
  const res = ctx.inventory.buy({ cost: { diamonds: cfg.storage.bigDia }, bundle: {}, src: 'mine', txId: 'mine:bigStorage' });
  if (!res.ok && res.reason !== 'duplicate') return res; // duplicate = 이미 값을 치렀다 - 플래그만 맞춘다
  mine.bigStorage = true;
  return OK;
}

// 오늘 다음 골드 주머니 비용(다 썼으면 null). 날짜가 바뀌었으면 0번째부터로 본다(상태는 안 바꾼다).
export function nextGoldCost(cfg, mine, ctx) {
  const used = mine.day === dayOf(ctx) ? mine.daily.gold : 0;
  return used < cfg.gold.perDay ? cfg.gold.costs[used] : null;
}

// 골드 주머니: 하루 perDay회, 비용 costs[n], 골드 R x rMul. txId mine:gold:{날짜}:{n}.
export function refineGold(cfg, mine, ctx) {
  if (!mine.unlocked) return fail('locked');
  const day = dayOf(ctx);
  rolloverDay(mine, day);
  const n = mine.daily.gold;
  if (n >= cfg.gold.perDay) return fail('limit');
  const cost = cfg.gold.costs[n];
  if (mine.ore < cost) return fail('noOre');
  const gold = Math.round(ctx.R * cfg.gold.rMul);
  const res = ctx.inventory.grant({ gold }, { src: 'mine', txId: `mine:gold:${day}:${n + 1}` });
  // duplicate = 이 날짜의 n번째는 이미 받았다(시계를 돌려 날짜 키가 되돌아온 경우) - 원석은 안 빼고 횟수만 맞춘다.
  if (res.ok || res.reason === 'duplicate') mine.daily.gold = n + 1;
  if (!res.ok) return res;
  mine.ore -= cost;
  mine.stats.totalGold += gold;
  return { ...OK, cost, gold, delta: res.delta };
}

// 보드 아이템: 하루 합계 perDay개. txId mine:item:{날짜}:{n}.
export function refineItem(cfg, mine, id, ctx) {
  if (!mine.unlocked) return fail('locked');
  const cost = cfg.items.costs[id];
  if (cost == null) return fail('unknown');
  const day = dayOf(ctx);
  rolloverDay(mine, day);
  const n = mine.daily.items;
  if (n >= cfg.items.perDay) return fail('limit');
  if (mine.ore < cost) return fail('noOre');
  if (ctx.inventory.count(id) >= ITEM_CAP) return fail('cap'); // 상한이면 원석만 버리게 된다
  const res = ctx.inventory.grant({ items: { [id]: 1 } }, { src: 'mine', txId: `mine:item:${day}:${n + 1}` });
  if (res.ok || res.reason === 'duplicate') mine.daily.items = n + 1;
  if (!res.ok) return res;
  mine.ore -= cost;
  return { ...OK, cost, id, delta: res.delta };
}

// 가속: kind 'ad'(하루 ads.perDay회, 광고 재생·광고 제거 판정은 호출부) | 'dia'(diaBoost.costs 순서대로).
// 둘 다 "N시간 분량"을 상한과 무관하게 수레에 더한다.
export function boost(cfg, mine, kind, ctx) {
  if (!mine.unlocked) return fail('locked');
  rolloverDay(mine, dayOf(ctx));
  settle(cfg, mine, ctx.now, ctx.pass);
  const rate = ratePerHour(cfg, mine, ctx.pass);
  let amount;
  if (kind === 'ad') {
    if (mine.daily.ads >= cfg.ads.perDay) return fail('limit');
    mine.daily.ads += 1;
    amount = cfg.ads.hours * rate;
  } else {
    const cost = cfg.diaBoost.costs[mine.daily.diaBoost];
    if (cost == null) return fail('limit');
    const res = ctx.inventory.buy({ cost: { diamonds: cost }, bundle: {}, src: 'mineBoost' });
    if (!res.ok) return res;
    mine.daily.diaBoost += 1;
    amount = cfg.diaBoost.hours * rate;
  }
  mine.cart += amount;
  return { ...OK, amount };
}

// 메뉴 빨간 점(7-1): 수레가 상한의 badgeFill(80%) 이상이거나, 오늘 골드 주머니가 남았고 원석이 다음 비용 이상.
// 매 프레임 불려도 되게 상태를 바꾸지 않고 객체도 만들지 않는다(ctx는 호출부가 재사용).
export function hasBadge(cfg, mine, ctx) {
  if (!mine.unlocked) return false;
  if (cartAt(cfg, mine, ctx.now, ctx.pass) >= cfg.badgeFill * capacity(cfg, mine, ctx.pass)) return true;
  const cost = nextGoldCost(cfg, mine, ctx);
  return cost != null && mine.ore >= cost;
}
