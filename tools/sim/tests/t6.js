// T6. 아이템 봇(docs/items.md 4장, docs/balance.md 10-1). T4 진행(even)을 구매 정책 none / boss / always로
// 돌려 비교한다. 목표: boss 정책이 보스 재도전을 0.5~1.5회 줄이고, 아이템에 쓴 골드 <= 전체 골드의 20%,
// 100층 시간 단축 <= 15%. 넘으면 items.json goldBase/perFloor를 조정(쿨다운은 그대로).
import { runOneProgression, mergeAggs } from './t4.js';
import { mdTable } from '../report.js';
import { aggRow, aggTable } from '../agg.js';

const STRATEGY = 'even';

function avg(arr) {
  return arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : null;
}

export async function run(env) {
  const { sim } = env.configs;
  const policies = env.itemPolicies.includes('none') ? env.itemPolicies : ['none', ...env.itemPolicies];
  const csvRows = [];
  const rows = [];
  const aggRows = [];
  const outOfRange = [];

  for (const player of env.players) {
    if (sim.players[player]?.referenceOnly) continue;
    const base = {};
    for (const policy of policies) {
      const runs = [];
      for (let s = 0; s < env.seeds; s++) runs.push(runOneProgression(env, player, STRATEGY, s + 1, { itemPolicy: policy }));
      const allRetries = runs.flatMap((r) => r.retriesByFloor);
      const bossRetries = avg(allRetries.filter((r) => r.tag === 'boss').map((r) => r.retries));
      const normalRetries = avg(allRetries.filter((r) => r.tag === 'normal').map((r) => r.retries));
      const minutes = avg(runs.map((r) => r.cumulativeTimeMin));
      const reached = avg(runs.map((r) => r.reachedFloor));
      const earned = runs.reduce((s, r) => s + r.goldEarned, 0);
      const spentItems = runs.reduce((s, r) => s + r.goldSpentItems, 0);
      const itemGoldPct = earned > 0 ? spentItems / earned : 0;
      const merged = mergeAggs(runs);
      const used = Object.entries(merged.itemsUsed)
        .map(([k, n]) => `${k} ${(n / env.seeds).toFixed(0)}`)
        .join(', ') || '-';
      if (policy === 'none') base[player] = { bossRetries, minutes };
      const b = base[player];
      const dRetries = b && bossRetries != null && b.bossRetries != null ? b.bossRetries - bossRetries : null;
      const dTime = b && minutes != null && b.minutes ? 1 - minutes / b.minutes : null;

      rows.push([
        `${player}:${policy}`,
        reached?.toFixed(1) ?? '-',
        normalRetries?.toFixed(2) ?? '-',
        bossRetries?.toFixed(2) ?? '-',
        dRetries != null ? dRetries.toFixed(2) : '-',
        minutes?.toFixed(1) ?? '-',
        dTime != null ? `${(dTime * 100).toFixed(1)}%` : '-',
        `${(itemGoldPct * 100).toFixed(1)}%`,
        used,
      ]);
      aggRows.push(aggRow(`${player}:${policy}`, merged));
      csvRows.push({
        player,
        policy,
        avgReachedFloor: reached?.toFixed(1) ?? '',
        avgRetriesNormal: normalRetries?.toFixed(2) ?? '',
        avgRetriesBoss: bossRetries?.toFixed(2) ?? '',
        bossRetriesSaved: dRetries?.toFixed(2) ?? '',
        minutesTo100: minutes?.toFixed(1) ?? '',
        timeSavedPct: dTime != null ? (dTime * 100).toFixed(1) : '',
        itemGoldPct: (itemGoldPct * 100).toFixed(1),
        goldEarned: Math.round(earned / env.seeds),
        goldSpentItems: Math.round(spentItems / env.seeds),
        itemsUsed: used,
      });

      const t = sim.targets.items ?? { bossRetriesSaved: [0.5, 1.5], goldShareMax: 0.2, timeSavedMax: 0.15 };
      const saved = Array.isArray(t.bossRetriesSaved) ? t.bossRetriesSaved : t.bossRetriesSaved[player]; // v12-8: 플레이어별
      if (policy === 'boss' && saved && dRetries != null && (dRetries < saved[0] || dRetries > saved[1])) {
        outOfRange.push(`${dRetries < saved[0] ? '아이템 효과 약함' : '아이템 효과 과함'}: T6 ${player}:boss 보스 재도전 ${dRetries.toFixed(2)}회 감소 (목표 ${saved[0]}~${saved[1]})`);
      }
      if (policy !== 'none' && itemGoldPct > t.goldShareMax) outOfRange.push(`과함: T6 ${player}:${policy} 아이템 골드 비율 ${(itemGoldPct * 100).toFixed(1)}% (기준 ${t.goldShareMax * 100}% 이하)`);
      if (policy !== 'none' && dTime != null && dTime > t.timeSavedMax) outOfRange.push(`과함: T6 ${player}:${policy} 100층 시간 단축 ${(dTime * 100).toFixed(1)}% (기준 ${t.timeSavedMax * 100}% 이하)`);
    }
  }

  const summaryMd =
    `## T6 아이템 정책별 비교 (even, 기술 ${env.skillsMode}, enemyHpMul ${env.configs.balance.scaling.enemyHpMul ?? 1})\n` +
    mdTable(['플레이어:정책', '도달 층', '일반 재도전', '보스 재도전', '보스 재도전 감소', '100층 시간(분)', '시간 단축', '아이템 골드 비율', '아이템 사용(시드당)'], rows) +
    `\n\n### T6 기술·상태효과·정지 계측\n${aggTable(aggRows)}`;
  return { csvRows, summaryMd, outOfRange };
}
