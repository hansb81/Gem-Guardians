// 측정 전용: 콤보 스트릭(src/core/gameState.js comboStreak - 게임 규칙 그대로)을 피해 배율로 연결해 보는 옵션.
// 게임은 아직 콤보를 전투에 연결하지 않는다(src/config/combo.js 주석). --combo=off(기본)면 아무것도 안 건드린다.
// --combo=data: COMBO_CONFIG.tiers 그대로 / rec: 제안 값. --combowindow=<초>: COMBO_CONFIG.timerMs를 메모리에서만 덮어쓴다.
// --combostats=on: 시도마다 콤보 분포(시간·피해·최대·끊김)를 모아 combo_<날짜>.csv로 쓴다(수치 영향 없음).
import { COMBO_CONFIG } from '../../src/config/combo.js';
import { getComboTier } from '../../src/core/gameState.js';
import { comboGoldBonus } from '../../src/core/economy/economy.js';

export const REC_TIERS = [
  { min: 5, damageMultiplier: 1.05 },
  { min: 10, damageMultiplier: 1.1 },
  { min: 15, damageMultiplier: 1.15 },
  { min: 20, damageMultiplier: 1.25 },
];
export const BINS = [0, 5, 10, 15, 20, 30]; // 0~4 / 5~9 / 10~14 / 15~19 / 20~29 / 30+
export const binOf = (n) => BINS.findLastIndex((b) => n >= b);
export const mulOf = (n, tiers) => getComboTier(n, tiers)?.damageMultiplier ?? 1;

export const combo = { mode: 'off', tiers: null, rows: null, goldPct: null };

// 콤보 골드 보너스(v12-10 게임 규칙): 기본 = balance.economy.comboGold(게임과 같은 core 함수, --set도 반영).
// --combogold=off는 비교용(0), --combogold=<최대%>는 maxPct만 덮어쓴다(측정용).
export const comboGold = (balance, clearGold, maxCombo) => {
  if (combo.goldPct === 'off') return 0;
  const b = combo.goldPct == null ? balance : { economy: { comboGold: { ...balance.economy.comboGold, maxPct: combo.goldPct / 100 } } };
  return comboGoldBonus(b, clearGold, maxCombo);
};

export function setupCombo(args, balance) {
  const mode = args.combo ?? 'off';
  if (!['off', 'data', 'rec'].includes(mode)) throw new Error(`--combo는 off|data|rec: ${mode}`);
  combo.mode = mode;
  combo.tiers = mode === 'data' ? COMBO_CONFIG.tiers : mode === 'rec' ? REC_TIERS : null;
  if (args.combowindow != null) COMBO_CONFIG.timerMs = Number(args.combowindow) * 1000;
  combo.rows = args.combostats === 'on' ? [] : null;
  const g = args.combogold; // 없으면 config(balance.economy.comboGold) 그대로
  if (g != null && g !== 'off' && !(Number(g) >= 0)) throw new Error(`--combogold는 off|<최대%>: ${g}`);
  combo.goldPct = g == null ? null : g === 'off' ? 'off' : Number(g);
  combo.configPct = Math.round((balance.economy.comboGold?.maxPct ?? 0) * 10000) / 100; // 표시용(t4combo csv)
  return `combo=${mode} window=${COMBO_CONFIG.timerMs / 1000}s${combo.rows ? ' stats=on' : ''} gold=${combo.goldPct == null ? `config ${combo.configPct}%` : combo.goldPct === 'off' ? 'off' : `${combo.goldPct}%`}`;
}

// floorSim에서 한 시도마다 부른다. 콤보 배율(on)과 계측(stats)이 모두 꺼져 있으면 null - 기존과 완전히 같은 경로.
export function attachCombo(gameState, battleState, floor) {
  if (combo.mode === 'off' && !combo.rows) return null;
  const st = { time: BINS.map(() => 0), dmg: BINS.map(() => 0), wData: 0, wRec: 0, max: 0, brTimeout: 0, brFail: 0 };
  const orig = battleState.applyGemClear.bind(battleState);
  // 퍼즐 기본 사격과 특수 잼 기술은 모두 applyGemClear를 거친다(기술은 그 안의 _castSkill). 쏘는 순간의 콤보로
  // atkMul을 곱했다 되돌린다 - 독·범위는 쏠 때 확정된 피해에서 나오므로 그 배율을 그대로 쓴다.
  battleState.applyGemClear = (...a) => {
    const n = gameState.comboStreak;
    const save = battleState.atkMul;
    const from = battleState.events.length;
    if (combo.tiers) battleState.atkMul = save * mulOf(n, combo.tiers);
    try {
      return orig(...a);
    } finally {
      battleState.atkMul = save;
      if (combo.rows) {
        let d = 0;
        for (let i = from; i < battleState.events.length; i++) {
          const e = battleState.events[i];
          if (e.type === 'towerAttack') d += e.damage;
          else if (e.type === 'skillCast') for (const x of e.damages) d += x;
        }
        st.dmg[binOf(n)] += d;
        st.wData += d * mulOf(n, COMBO_CONFIG.tiers);
        st.wRec += d * mulOf(n, REC_TIERS);
      }
    }
  };
  return {
    // gameState.update 직후 - 시간은 그 틱의 콤보 구간에, 끊김은 그 틱에 생긴 comboBreak(유지 시간 초과)로.
    tick(dt) {
      if (!combo.rows) return;
      const n = gameState.comboStreak;
      st.time[binOf(n)] += dt;
      if (n > st.max) st.max = n;
      for (const e of gameState.effects) if (e.type === 'comboBreak' && e.elapsedMs === 0) st.brTimeout++;
    },
    finish(result) {
      if (!combo.rows) return;
      const row = { floor: floor.floor, tag: floor.tag, status: result.status, timeSec: result.timeSec.toFixed(2), maxCombo: st.max };
      BINS.forEach((b, i) => (row[`t${b}`] = st.time[i].toFixed(2)));
      BINS.forEach((b, i) => (row[`d${b}`] = Math.round(st.dmg[i])));
      Object.assign(row, { wData: Math.round(st.wData), wRec: Math.round(st.wRec), brTimeout: st.brTimeout, brFail: st.brFail, brEnd: gameState.comboStreak > 0 ? 1 : 0 });
      combo.rows.push(row);
    },
  };
}
