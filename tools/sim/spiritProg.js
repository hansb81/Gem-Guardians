// --spirits=prog(기본): 실제 플레이어처럼 정령을 얻고 끼우고 키운다(v13-3). 규칙은 게임 코드 그대로 -
// 지급·별·정령석·레벨업 = src/game/inventory.js Inventory(initSpirits / grant / levelUpSpirit), 보스 보상 = core/spirits bossSpiritBundle,
// 배율 = core/spirits effectMul. 여기서 정하는 것은 "플레이어가 무엇을 끼우고 언제 키우나"(봇 정책)뿐이다.
// - 장착: 층 시작마다 가진 정령 중 effectMul(공명 포함) 합이 가장 큰 조합으로 5칸. 같으면 공격 환산이 큰 쪽. 빈 칸은 둔다.
// - 레벨업: 탑·스킬 구매 뒤 남은 골드로, 정령 레벨 누적 지출 <= 누적 수입 x spiritBuy%. 장착한 정령부터, 가장 싼 레벨부터.
//   골드·정령석이 모자라거나 상한에 닿으면 멈춘다.
import { Inventory } from '../../src/game/inventory.js';
import { bossSpiritBundle, bossSpiritTx, effectMul, levelUpCost } from '../../src/core/spirits/spirits.js';

// 봇이 효과를 못 쓰는 보조(망치 = 아이템 쿨다운, 시계태엽 = 폭탄 타이머, 해체 = 방해요소)는 장착 후보에서 뺀다.
export const SIM_EXCLUDED = ['sup_tinker', 'sup_clock', 'sup_breaker'];

// 공격 환산(배율 1.0당 공격력 %): reports/sim/spirits/g-table.md "빠듯 평균"을 그 줄의 배율로 나눈 값(선형 근사, 표 보고용 + 장착 동점 깨기).
// 역할: 일반 1레벨(배율 1.0) 줄. 전설: 1레벨·별 1·공명(배율 2.0) 줄. 보조: 30레벨·별 5·공명(배율 2.322) 줄. 재물은 전력 0(골드는 따로).
const ATK_PER_MUL = { attack: 2.7, element: 3.6, amplify: 4.1, guard: 1.6, wealth: 0, phoenix: 1.95, frost_whale: 0.6, elder_treant: 4.1, wraith_queen: 4.05, storm_kirin: 1.95, cascade: 1.55, paint: 2.33 };
export const atkPerMul = (cfg, id) => {
  const sp = cfg.spirits[id];
  return ATK_PER_MUL[sp.unique ?? sp.support ?? sp.role] ?? 0;
};

export function newSpiritProg(cfg) {
  const wallet = { gold: 0, diamonds: 0 };
  const inv = new Inventory(null, { wallet, clock: () => 0 });
  inv.initSpirits(cfg); // 시작 정령(도깨비불) 지급 + 첫 칸 장착
  // stops(v13-8 측정) = 레벨업이 멈춘 이유별 횟수: cap(spiritBuy 상한), gold(지갑), stones(정령석만), both(골드와 정령석 둘 다), max(올릴 정령 없음).
  return { cfg, inv, wallet, goldSpent: 0, stonesGot: 0, stonesSpent: 0, levels: 0, stops: { cap: 0, gold: 0, stones: 0, both: 0, max: 0 } };
}

// 보스 첫 클리어(게임 BattleController._grantBossSpirit과 같은 묶음·txId).
export function spiritBossClear(sp, floor) {
  const bundle = bossSpiritBundle(sp.cfg, floor);
  const res = sp.inv.grant(bundle, { src: 'bossSpirit', txId: bossSpiritTx(floor) });
  if (res.ok) sp.stonesGot += bundle.spiritStones + (res.delta.spirits?.[0]?.stones ?? 0);
}

// 장착: 칸마다 값 = effectMul(그 수호자 색). 칸별 상위 5개만 보면 최적 배정이 그 안에 있다(다른 칸은 4개뿐).
// mode = 'sum'(기본, effectMul 합 최대) | 'atk'(공격 환산 합 최대, 비교용 --spiritequip=atk).
export function spiritEquipBest(sp, colors, mode = 'sum') {
  const { cfg, inv } = sp;
  const owned = inv.data.perm.spirits;
  const ids = Object.keys(owned).filter((id) => cfg.spirits[id] && !SIM_EXCLUDED.includes(id));
  const val = colors.map((c) => ids.map((id) => {
    const m = effectMul(cfg, id, owned[id], c);
    return { id, m, a: m * atkPerMul(cfg, id) };
  }).sort(mode === 'atk' ? (x, y) => y.a - x.a || y.m - x.m : (x, y) => y.m - x.m || y.a - x.a).slice(0, colors.length));
  let best = null;
  const pick = [];
  const walk = (i, m, a) => {
    if (i === colors.length) {
      const [k, k2, b, b2] = mode === 'atk' ? [a, m, best?.a, best?.m] : [m, a, best?.m, best?.a];
      if (!best || k > b + 1e-9 || (Math.abs(k - b) <= 1e-9 && k2 > b2 + 1e-9)) best = { m, a, slots: pick.slice() };
      return;
    }
    pick[i] = null;
    walk(i + 1, m, a); // 빈 칸(가진 게 칸보다 적을 때)
    for (const v of val[i]) {
      if (pick.includes(v.id)) continue;
      pick[i] = v.id;
      walk(i + 1, m + v.m, a + v.a);
      pick[i] = null;
    }
  };
  walk(0, 0, 0);
  inv.data.loadout.spirits.splice(0, colors.length, ...best.slots);
  return spiritSlotsNow(sp);
}

// floorSim이 받는 모양(수호자 순서 5칸: null 또는 { id, lv, star }) - 그 순간의 복사본.
export function spiritSlotsNow(sp) {
  const owned = sp.inv.data.perm.spirits;
  return sp.inv.data.loadout.spirits.map((id) => (id && owned[id] ? { id, lv: owned[id].lv, star: owned[id].star } : null));
}

// 레벨업. gold = 쓸 수 있는 골드, cap = 이번까지 정령 레벨에 쓸 수 있는 누적 상한(누적 수입 x X%), floorReward = normalFloorReward(최고 층).
// 반환 = 쓴 골드.
export function spiritLevelUp(sp, gold, cap, floorReward) {
  const { cfg, inv, wallet } = sp;
  const owned = inv.data.perm.spirits;
  const equipped = inv.data.loadout.spirits.filter(Boolean);
  wallet.gold = gold;
  for (;;) {
    const cand = (list) => list.filter((id) => owned[id].lv < cfg.levelMax).sort((a, b) => owned[a].lv - owned[b].lv)[0];
    const id = cand(equipped) ?? cand(Object.keys(owned).filter((x) => !equipped.includes(x) && !SIM_EXCLUDED.includes(x)));
    if (!id) { sp.stops.max++; break; }
    const cost = levelUpCost(cfg, owned[id].lv, floorReward);
    // 멈춤 판정은 예전과 같다(상한 넘음 또는 levelUpSpirit의 골드·정령석 부족). 이유만 나눠 센다.
    const goldShort = sp.goldSpent + cost.gold > cap ? 'cap' : wallet.gold < cost.gold ? 'gold' : null;
    const stoneShort = inv.spiritStones < cost.stones;
    if (goldShort || stoneShort) { sp.stops[goldShort && stoneShort ? 'both' : stoneShort ? 'stones' : goldShort]++; break; }
    if (!inv.levelUpSpirit(id, floorReward).ok) break;
    sp.goldSpent += cost.gold;
    sp.stonesSpent += cost.stones;
    sp.levels++;
  }
  return gold - wallet.gold;
}

// 표용 요약(장착 5칸 기준): 장착 수, 평균 레벨, 평균 별, 공명 칸 수, 공격 환산(%), 재물 배율 합.
export function spiritStats(cfg, slots, colors) {
  const on = slots.map((s, i) => (s ? { ...s, color: colors[i] } : null)).filter(Boolean);
  const mean = (k) => (on.length ? on.reduce((t, s) => t + s[k], 0) / on.length : 0);
  let atk = 0;
  let wealth = 0;
  let res = 0;
  for (const s of on) {
    const m = effectMul(cfg, s.id, s, s.color);
    atk += m * atkPerMul(cfg, s.id);
    if (cfg.spirits[s.id].role === 'wealth') wealth += m;
    if (cfg.spirits[s.id].element === s.color) res++;
  }
  return { n: on.length, lv: mean('lv'), star: mean('star'), res, atk, wealth };
}
