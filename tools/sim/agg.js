// runFloorAttempt 결과의 기술·상태효과 계측을 여러 시도에 걸쳐 합치는 도우미(T2s/T4/T6 공용).
import { mdTable } from './report.js';

export function newAgg() {
  return {
    runs: 0,
    damage: { basic: 0, skill: 0, splash: 0, poison: 0 },
    effects: {},
    immune: 0,
    casts: {},
    blocked: { stun: 0, slow: 0, freeze: 0 },
    wallDamage: 0,
    bombDamage: 0,
    itemsUsed: {},
  };
}

export function addResult(agg, r) {
  agg.runs++;
  for (const k of Object.keys(agg.damage)) agg.damage[k] += r.damageBySource[k];
  for (const [c, n] of Object.entries(r.effectCounts)) agg.effects[c] = (agg.effects[c] ?? 0) + n;
  agg.immune += r.immuneCount;
  for (const [k, n] of Object.entries(r.skillCasts)) agg.casts[k] = (agg.casts[k] ?? 0) + n;
  for (const k of Object.keys(agg.blocked)) agg.blocked[k] += r.blockedWall[k];
  agg.wallDamage += Object.values(r.wallDamageByRank).reduce((s, v) => s + v, 0);
  agg.bombDamage += r.bombWallDamageTotal;
  for (const [k, n] of Object.entries(r.itemsUsed)) agg.itemsUsed[k] = (agg.itemsUsed[k] ?? 0) + n;
}

export const AGG_HEADERS = ['구간', '기술+효과 피해 몫', '특수 잼 기술', '레드 범위', '퍼플 독', '색 효과 발동(층당)', '면역 막힘(층당)', '기술 발동(층당)', '막은 성벽 피해(층당, 실제 피해 대비)'];

// 한 줄 요약(AGG_HEADERS 순서).
export function aggRow(label, agg) {
  const d = agg.damage;
  const total = d.basic + d.skill + d.splash + d.poison;
  const runs = Math.max(1, agg.runs);
  const pct = (v) => (total > 0 ? `${((v / total) * 100).toFixed(1)}%` : '-');
  const per = (obj) => Object.entries(obj).map(([k, v]) => `${k} ${(v / runs).toFixed(1)}`).join(', ') || '-';
  const blocked = agg.blocked.stun + agg.blocked.slow + agg.blocked.freeze;
  const blockedPct = agg.wallDamage + blocked > 0 ? `${((blocked / (agg.wallDamage + blocked)) * 100).toFixed(1)}%` : '-';
  return [
    label,
    pct(d.skill + d.splash + d.poison),
    pct(d.skill),
    pct(d.splash),
    pct(d.poison),
    per(agg.effects),
    (agg.immune / runs).toFixed(1),
    per(agg.casts),
    `경직 ${Math.round(agg.blocked.stun / runs)} / 감속 ${Math.round(agg.blocked.slow / runs)} / 정지 ${Math.round(agg.blocked.freeze / runs)} (${blockedPct})`,
  ];
}

export function aggTable(rows) {
  return mdTable(AGG_HEADERS, rows);
}
