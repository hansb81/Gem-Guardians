// 인벤토리 순수 계산(docs/inventory.md 2·4장). 브라우저 API 없음 - 상태(inv 묶음)는 호출부가 넘기고,
// 저장·이벤트·지갑은 src/game/inventory.js가 맡는다.
import { normalizeRanking } from '../../ranking/rankingSave.js';

// 2 = 아이템·장착·예약·젬 스킬 inv 묶음, 3 = 랭킹 블록(docs/ranking.md 7-1), 4 = 정령(docs/spirits.md 8장 - totems 키 삭제,
// perm.spirits/spiritStones, loadout.spirits 5칸/pendingSpirits).
export const SAVE_VERSION = 4;
export const ITEM_CAP = 999;
export const SKILL_MAX = 5;
export const HOTBAR_LEN = 4; // 저장되는 hotbar는 항상 길이 4(4번째 칸은 slot4 플래그 없으면 잠김).
export const LOG_MAX = 50;
const SPIRIT_SLOTS = 5; // 수호자 수 = 정령 칸 수(src/core/spirits/spirits.js SPIRIT_SLOTS와 같은 값)

export function defaultInv() {
  return {
    items: {},
    loadout: { hotbar: Array(HOTBAR_LEN).fill(null), pendingHotbar: null, preFloor: {}, spirits: Array(SPIRIT_SLOTS).fill(null), pendingSpirits: null },
    perm: { skills: {}, flags: [], spirits: {}, spiritStones: 0 },
    grantedTx: [],
    log: [],
    seenItems: [], // 보관함을 열었을 때 갖고 있던 아이템 id - 메뉴 빨간 점(docs/inventory.md 5-3).
    pendingSpiritNotice: [], // 소급 지급한 보스 정령 [{ floor, id, kind, stones, stoneReward }] - 화면이 한 번 보여 주고 비운다(docs/spirits.md 10장).
  };
}

function fit(arr, len) {
  const out = Array(len).fill(null);
  if (Array.isArray(arr)) for (let i = 0; i < len; i++) out[i] = arr[i] ?? null;
  return out;
}
const fitHotbar = (arr) => fit(arr, HOTBAR_LEN);

// 없앤 아이템 -> 대신 줄 아이템(2026-11-24): 세로 낫은 낫(scythe_h)으로 합침, 해제 부적은 망치로 바꿔 줌.
// 불러올 때마다 접는다(여러 번 돌려도 같은 결과) - 옛 우편·쿠폰으로 늦게 들어온 옛 id도 다음 불러오기에 접힌다.
export const RETIRED_ITEMS = { scythe_v: 'scythe_h', defuse: 'hammer' };

function foldRetiredItems(items) {
  for (const [from, to] of Object.entries(RETIRED_ITEMS)) {
    if (!(from in items)) continue;
    const n = Number(items[from]);
    delete items[from];
    if (n > 0) addCapped(items, to, n);
  }
  return items;
}

// 장착 칸의 옛 id를 새 id로, 같은 아이템이 두 칸이면 뒤 칸을 비운다.
function foldRetiredHotbar(bar) {
  const out = bar.map((id) => RETIRED_ITEMS[id] ?? id);
  return out.map((id, i) => (id != null && out.indexOf(id) < i ? null : id));
}

// 저장된 inv에서 빠진 칸만 채운다(손상·부분 저장 대비). 값은 그대로 - 모르는 아이템 id도 보존(없앤 아이템만 접는다).
export function normalizeInv(inv) {
  const def = defaultInv();
  if (!inv || typeof inv !== 'object') return def;
  const lo = inv.loadout ?? {};
  const pm = inv.perm ?? {};
  return {
    items: foldRetiredItems({ ...inv.items }),
    loadout: {
      hotbar: foldRetiredHotbar(fitHotbar(lo.hotbar)),
      pendingHotbar: Array.isArray(lo.pendingHotbar) ? foldRetiredHotbar(fitHotbar(lo.pendingHotbar)) : null,
      preFloor: { ...lo.preFloor },
      spirits: fit(lo.spirits, SPIRIT_SLOTS),
      pendingSpirits: Array.isArray(lo.pendingSpirits) ? fit(lo.pendingSpirits, SPIRIT_SLOTS) : null,
    },
    // 옛 totems 키는 여기서 옮기지 않으므로 사라진다(v4).
    perm: { skills: { ...pm.skills }, flags: Array.isArray(pm.flags) ? [...pm.flags] : [], spirits: { ...pm.spirits }, spiritStones: Number.isFinite(pm.spiritStones) ? Math.max(0, pm.spiritStones) : 0 },
    grantedTx: Array.isArray(inv.grantedTx) ? [...inv.grantedTx] : [],
    log: Array.isArray(inv.log) ? inv.log.slice(-LOG_MAX) : [],
    seenItems: Array.isArray(inv.seenItems) ? [...inv.seenItems] : [],
    pendingSpiritNotice: Array.isArray(inv.pendingSpiritNotice) ? [...inv.pendingSpiritNotice] : [],
  };
}

// v1(items/equipped/preFloor/shop.skillLv가 playerState에 흩어진 형식) -> v2(inv 묶음) -> v3(ranking 블록) -> v4(정령: normalizeInv가
// totems를 버리고 정령 칸을 채운다. 시작 정령 지급은 config가 필요해 playerState.initSpirits -> ensureStartSpirit이 한다).
// 새 객체를 돌려준다. 이미 최신이면 그대로(여러 번 돌려도 같은 결과). 옛 필드는 지운다. v1 단계는 옛 필드가
// 있을 때만 움직이므로 v2 저장은 inv를 그대로 두고 ranking만 채운다.
// now = 마이그레이션 log 시각(초) - core는 시계를 모르므로 호출부가 넘긴다.
export function migrateSave(saved, now = 0) {
  if (!saved || typeof saved !== 'object') return saved;
  if (saved.saveVersion >= SAVE_VERSION) return saved;
  const out = { ...saved };
  const inv = normalizeInv(saved.inv);
  if (saved.items && typeof saved.items === 'object') {
    Object.assign(inv.items, saved.items);
    // 옛 initItems가 이미 임시 지급한 아이템(값 0 포함)은 start:{id}로 기록 - 다시 주지 않게.
    for (const id of Object.keys(saved.items)) if (!inv.grantedTx.includes(`start:${id}`)) inv.grantedTx.push(`start:${id}`);
  }
  if (saved.shop?.purchasedOnce?.includes('pack.adfree') && !inv.perm.flags.includes('adFree')) inv.perm.flags.push('adFree');
  if (Array.isArray(saved.equipped)) {
    inv.loadout.hotbar = fitHotbar(saved.equipped);
    if (saved.equipped.length >= HOTBAR_LEN && !inv.perm.flags.includes('slot4')) inv.perm.flags.push('slot4');
  }
  if (saved.preFloor && typeof saved.preFloor === 'object') Object.assign(inv.loadout.preFloor, saved.preFloor);
  if (saved.shop?.skillLv) {
    Object.assign(inv.perm.skills, saved.shop.skillLv);
    const { skillLv, ...shop } = saved.shop;
    out.shop = shop;
  }
  delete out.items;
  delete out.equipped;
  delete out.preFloor;
  inv.log.push({ t: now, src: 'migrate', d: { from: saved.saveVersion ?? 1, to: SAVE_VERSION } });
  if (inv.log.length > LOG_MAX) inv.log.splice(0, inv.log.length - LOG_MAX);
  out.inv = inv;
  out.ranking = normalizeRanking(saved.ranking, { bestFloor: saved.bestFloor, nowMs: now * 1000 });
  out.saveVersion = SAVE_VERSION;
  return out;
}

// 아이템 더하기(상한 ITEM_CAP). 실제로 들어간 양과 넘친 양을 돌려준다. n < 0도 받는다(0 아래로는 안 감).
export function addCapped(items, id, n) {
  const before = items[id] ?? 0;
  const after = Math.max(0, Math.min(ITEM_CAP, before + n));
  items[id] = after;
  return { added: after - before, over: before + n - after > 0 ? before + n - after : 0 };
}

// 젬 스킬 지급값: 숫자 = 그 레벨로(낮추지는 않음), '+1' = 한 단계. 0~SKILL_MAX.
export function nextSkillLevel(cur, v) {
  const next = v === '+1' ? cur + 1 : Math.max(cur, Number(v) || 0);
  return Math.max(0, Math.min(SKILL_MAX, next));
}

// 장착 규칙(4장 1~2). hotbar를 직접 고친다. slotCount = 지금 쓸 수 있는 칸 수.
// 같은 아이템이 다른 칸에 있으면 두 칸이 자리를 바꾼다.
// owned = 보유 개수(1개 이상이어야 새로 장착 가능 - 이미 꽂힌 게 0개가 되는 건 상관없음).
export function equipInto(hotbar, slotCount, slot, id, itemsConfig, owned) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= slotCount) return { ok: false, reason: 'locked' };
  if (itemsConfig?.items[id]?.group !== 'hotbar') return { ok: false, reason: 'notEquipable' };
  if (!(owned >= 1)) return { ok: false, reason: 'noStock' };
  if (hotbar[slot] === id) return { ok: false, reason: 'alreadyEquipped' };
  const other = hotbar.indexOf(id);
  if (other >= 0) hotbar[other] = hotbar[slot];
  hotbar[slot] = id;
  return { ok: true, reason: null };
}

export function swapInto(hotbar, slotCount, a, b) {
  const bad = (s) => !Number.isInteger(s) || s < 0 || s >= slotCount;
  if (bad(a) || bad(b)) return { ok: false, reason: 'locked' };
  [hotbar[a], hotbar[b]] = [hotbar[b], hotbar[a]];
  return { ok: true, reason: null };
}

// 기본 젬 스킬 레벨(config/shop.json skills): 색 효과 1, 특수 기술은 unlockBossFloor가 있으면 0(잠김).
export function defaultSkillLevels(shopSkills) {
  const out = {};
  for (const id of Object.keys(shopSkills?.color ?? {})) out[id] = 1;
  for (const [id, s] of Object.entries(shopSkills?.special ?? {})) out[id] = s.unlockBossFloor ? 0 : 1;
  return out;
}

// grantedTx 90일 정리(docs/auth.md §1-E): 날짜가 든 하루짜리 txId 중 keepDays보다 오래된 것만 뺀 새 배열.
// att:{날짜} free:{날짜} pass:{팩}:{날짜} ad:{배치}:{날짜}:{n} mine:gold|item|stone:{날짜}:{n} shop:stones:{날짜} rank:{YYYY-Www}(그 주 월요일). 형식이 안 맞거나 날짜를 못 읽으면 남긴다 -
// 평생 한 번짜리(start: unlock: boss: iap: refund: coupon: mail: tutorial_complete)는 아래 형식에 안 걸려서 절대 안 지운다.
// todayKst = 'YYYY-MM-DD'(core는 시계를 모른다 - 호출부가 넘긴다).
const DAY_MS = 86400e3;
const TX_DATED = [/^(?:att|free):(\d{4}-\d{2}-\d{2})$/, /^pass:[^:]+:(\d{4}-\d{2}-\d{2})$/, /^ad:[^:]+:(\d{4}-\d{2}-\d{2}):\d+$/, /^mine:(?:gold|item|stone):(\d{4}-\d{2}-\d{2}):\d+$/, /^shop:stones:(\d{4}-\d{2}-\d{2})$/];
const TX_WEEK = /^rank:(\d{4})-W(\d{2})$/;

function dayMs(ymd) {
  const ms = Date.parse(`${ymd}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === ymd ? ms : null; // 2026-02-31 같은 날짜는 못 읽음
}

// ISO 주(월요일 시작, 1월 4일이 든 주가 1주) -> 그 주 월요일(UTC ms).
function isoWeekMondayMs(year, week) {
  if (week < 1 || week > 53) return null;
  const jan4 = Date.UTC(year, 0, 4);
  const monday1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  return monday1 + (week - 1) * 7 * DAY_MS;
}

function txDayMs(tx) {
  for (const re of TX_DATED) {
    const m = re.exec(tx);
    if (m) return dayMs(m[1]);
  }
  const w = TX_WEEK.exec(tx);
  return w ? isoWeekMondayMs(Number(w[1]), Number(w[2])) : null;
}

export function pruneGrantedTx(list, todayKst, keepDays = 90) {
  const today = dayMs(todayKst);
  if (!Array.isArray(list) || today == null) return list;
  return list.filter((tx) => {
    const ms = typeof tx === 'string' ? txDayMs(tx) : null;
    return ms == null || (today - ms) / DAY_MS <= keepDays;
  });
}
