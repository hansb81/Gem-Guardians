// 정령 순수 계산(docs/spirits.md). 브라우저 API 없음. cfg = config/spirits.json, 숫자는 전부 거기서 읽는다.
// inv = 인벤토리 저장 묶음(src/core/inventory/inventory.js defaultInv) - 보유는 inv.perm.spirits { id: { lv, star } },
// 정령석은 inv.perm.spiritStones, 장착은 inv.loadout.spirits(길이 SPIRIT_SLOTS, 수호자 순서).

import { createRng } from '../rng.js';

export const SPIRIT_SLOTS = 5;
export const START_SPIRIT_TX = 'start:spirit';

// 효과 배율 = 등급 x 레벨 x 별 x 공명(정령 속성 = 수호자 색).
export function effectMul(cfg, spiritId, owned, guardianColor) {
  const sp = cfg.spirits[spiritId];
  return cfg.gradeMul[sp.grade]
    * (1 + cfg.levelStep * (owned.lv - 1))
    * (1 + cfg.starStep * (owned.star - 1))
    * (sp.element === guardianColor ? cfg.resonanceMul : 1);
}

// "N발마다"의 N: everyStepStars에 든 별에 닿을 때마다 1씩 줄고 최소 2.
export function everyN(cfg, base, star) {
  return Math.max(2, base - cfg.everyStepStars.filter((s) => star >= s).length);
}

// lv -> lv+1 비용. floorReward = economy.normalFloorReward(data, bestFloor) - itemPrice와 같은 기준 층 보상.
export function levelUpCost(cfg, lv, floorReward) {
  const { goldFloors, goldGrowth, stonesPer } = cfg.levelCost;
  return { gold: Math.round(floorReward * goldFloors * goldGrowth ** (lv - 1)), stones: Math.ceil(lv / stonesPer) };
}

// 정령 1마리 지급: 없으면 새로, 있으면 별 +1, 별이 최대면 정령석으로. inv를 직접 고친다.
export function grantSpirit(cfg, inv, id) {
  const owned = inv.perm.spirits[id];
  if (!owned) {
    inv.perm.spirits[id] = { lv: 1, star: 1 };
    return { id, kind: 'new', stones: 0 };
  }
  if (owned.star < cfg.starMax) {
    owned.star += 1;
    return { id, kind: 'star', stones: 0 };
  }
  const stones = cfg.dupeStones[cfg.spirits[id].grade];
  inv.perm.spiritStones = (inv.perm.spiritStones ?? 0) + stones;
  return { id, kind: 'stones', stones };
}

// 처음 시작(또는 정령이 없던 저장): startSpirit 1마리 + 장착이 전부 비었으면 첫 수호자 칸. 한 번만(START_SPIRIT_TX).
// 지급했으면 grantSpirit 결과, 아니면 null.
export function ensureStartSpirit(cfg, inv) {
  if (inv.grantedTx.includes(START_SPIRIT_TX)) return null;
  inv.grantedTx.push(START_SPIRIT_TX);
  if (Object.keys(inv.perm.spirits).length > 0) return null;
  const res = grantSpirit(cfg, inv, cfg.startSpirit);
  if (inv.loadout.spirits.every((s) => s == null)) inv.loadout.spirits[0] = cfg.startSpirit;
  return res;
}

// 보스 첫 클리어 정령: fixed에 그 층이 있으면 그 등급, 없으면 weights 가중 무작위 -> 그 등급 안에서 1종(보조·전설 포함).
// rng = seed RNG(같은 층·같은 seed면 같은 결과).
export function rollBossSpirit(cfg, floor, rng) {
  const { fixed, weights } = cfg.bossReward;
  let grade = fixed[floor];
  if (!grade) {
    const total = Object.values(weights).reduce((a, w) => a + w, 0);
    let roll = rng() * total;
    for (const [g, w] of Object.entries(weights)) {
      grade = g;
      roll -= w;
      if (roll < 0) break;
    }
  }
  const pool = Object.keys(cfg.spirits).filter((id) => cfg.spirits[id].grade === grade);
  return pool[Math.floor(rng() * pool.length)];
}

// 보스층 첫 클리어 보상 묶음(inventory.grant용, txId는 bossSpiritTx). 층 번호 seed라 같은 층이면 언제 받아도 같은 정령(소급 지급 포함).
export function bossSpiritBundle(cfg, floor) {
  const { stones, stonesFrom50 } = cfg.bossReward;
  return { spirits: [rollBossSpirit(cfg, floor, createRng(floor * 7919 + 29))], spiritStones: floor >= 50 ? stonesFrom50 : stones };
}
export const bossSpiritTx = (floor) => `boss-spirit:${floor}`;

// 효과 설명에 끼워 넣을 숫자(문구 틀 spirit.effect.{role}). pct·cap = % 값(소수 1자리), every = N발마다, element = 정령 속성.
// support·unique는 아직 효과가 없어 role만 돌려준다(화면은 '곧 추가').
export function effectInfo(cfg, id, owned, guardianColor) {
  const sp = cfg.spirits[id];
  const r = cfg.roles[sp.role];
  const mul = effectMul(cfg, id, owned, guardianColor);
  const pct = (v) => Math.round(v * 1000) / 10;
  const out = { role: sp.role, element: sp.element, resonance: sp.element === guardianColor };
  if (sp.role === 'attack') return { ...out, every: everyN(cfg, r.every, owned.star), pct: pct(r.mul * mul) };
  if (sp.role === 'element') return { ...out, pct: pct(Math.min(r.chanceCap, r.chance * mul)), dmg: pct(r.procDmg ?? 0) };
  if (sp.role === 'amplify') return { ...out, pct: pct(r.skillDmg * mul) };
  if (sp.role === 'guard') return { ...out, pct: pct(r.healPct * mul), cap: pct(r.floorCapPct) };
  if (sp.role === 'wealth') return { ...out, pct: pct(r.killGold * mul) };
  // 전설 고유(cfg.uniques)·보조(spirits[id].value) - 문구 틀은 spirit.effect.{key}.
  const key = sp.unique ?? sp.support;
  const u = cfg.uniques?.[sp.unique] ?? {};
  const one = (v) => Math.round(v * 10) / 10;
  switch (key) {
    case 'phoenix': return { ...out, key, th: pct(u.wallPct), pct: pct(Math.min(u.healCap, u.healPct * mul)) };
    case 'frost_whale': return { ...out, key, every: everyN(cfg, u.every, owned.star), sec: one(u.sec * mul) };
    case 'elder_treant': return { ...out, key, pct: pct(u.perShot * mul), cap: pct(u.cap * mul) };
    case 'wraith_queen': return { ...out, key, pct: pct((u.shotPoisonMul ?? 1) * mul) };
    case 'storm_kirin': return { ...out, key, every: everyN(cfg, u.every, owned.star), n: u.targets, pct: pct(u.mul * mul) };
    case 'cascade': case 'breaker': case 'paint': return { ...out, key, pct: pct(supportValue(sp, mul)) };
    case 'clock': return { ...out, key, n: sp.value };
    case 'tinker': return { ...out, key, every: everyN(cfg, sp.value, owned.star) };
    default: return out;
  }
}

// 장착(slots를 직접 고친다): 같은 정령은 한 칸에만 - 다른 칸에 이미 있으면 두 칸이 자리를 바꾼다. id null = 해제.
export function equipSpiritInto(slots, slot, id, owned) {
  if (!Number.isInteger(slot) || slot < 0 || slot >= SPIRIT_SLOTS) return { ok: false, reason: 'locked' };
  if (id != null && !owned[id]) return { ok: false, reason: 'notOwned' };
  if (slots[slot] === id) return { ok: false, reason: 'alreadyEquipped' };
  const other = id == null ? -1 : slots.indexOf(id);
  if (other >= 0) slots[other] = slots[slot];
  slots[slot] = id;
  return { ok: true, reason: null };
}

// 보조 정령의 실제 값: 배율을 곱하고 cap이 있으면 거기서 멈춘다. clock(타이머)·tinker(N발)는 배율 없이 고정.
function supportValue(sp, mul) {
  if (sp.support === 'clock' || sp.support === 'tinker') return sp.value;
  return Math.min(sp.cap ?? Infinity, sp.value * mul);
}

// 퍼즐 쪽 보조 효과 묶음(GameState.setSpiritMods): 같은 보조는 겹치지 않고 가장 높은 값만.
// list = battleSpirits 결과, towerColors = 수호자 순서의 색. 반환 { clock, breaker, paint: { color, bonus } | null }.
export function supportMods(list, towerColors) {
  const out = { clock: 0, breaker: 0, paint: null };
  list?.forEach((sp, i) => {
    if (sp?.role !== 'support') return;
    if (sp.key === 'clock' || sp.key === 'breaker') out[sp.key] = Math.max(out[sp.key], sp.value);
    else if (sp.key === 'paint' && sp.value > (out.paint?.bonus ?? 0)) out.paint = { color: towerColors[i], bonus: sp.value };
  });
  return out;
}

// 전투에 넘길 값(BattleState.setSpirits): 칸마다 null 또는 { id, role, element, mul, every }.
// 전설·보조는 거기에 { key(고유·보조 이름), u(cfg.uniques[key]), value(보조 값) }가 더 붙는다.
// slots = 장착 id 5칸, owned = { id: { lv, star } }, towerColors = 수호자 순서의 색. 없는 정령·모르는 id는 null.
export function battleSpirits(cfg, slots, owned, towerColors) {
  return towerColors.map((color, i) => {
    const id = slots[i];
    const sp = cfg.spirits[id];
    const own = owned[id];
    if (!sp || !own) return null;
    const key = sp.unique ?? sp.support;
    const u = cfg.uniques?.[sp.unique];
    const base = cfg.roles[sp.role]?.every ?? u?.every ?? (key === 'tinker' ? sp.value : null);
    const mul = effectMul(cfg, id, own, color);
    const out = { id, role: sp.role, element: sp.element, mul, every: base ? everyN(cfg, base, own.star) : null };
    return key ? { ...out, key, u: u ?? null, value: sp.support ? supportValue(sp, mul) : null } : out;
  });
}
