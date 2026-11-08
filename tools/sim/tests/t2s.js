// T2-실제. 가상 효과(T2) 대신 실제 젬 기술(config/skills.json, docs/skills.md)을 모드별로 켜고
// 고정 보스층(10~100)의 needPower를 잰다. 등가 전력 = needPower(none) / needPower(모드).
// 모드: none / color(색 효과만) / special(특수 잼 기술만) / all(둘 다, 보스 면역·약점 없음) /
// all+boss(게임 그대로). 색 하나씩(color:red 등)·기술 하나씩도 같이 재서 "혼자 너무 센 기술"을 찾는다.
import { mdTable } from '../report.js';
import { skillsFor } from '../skills.js';
import { needPower, expectedTowerLevels, PROBE_FLOOR_NUMBERS } from './t2.js';
import { newAgg, aggRow, aggTable } from '../agg.js';

const MODES = ['none', 'color', 'special', 'all', 'all+boss'];

// 색 효과 1개씩 / 특수 잼 기술 1개씩만 켠 변형.
function singleModes(skillsConfig) {
  const out = [];
  const colors = Object.keys(skillsConfig.unlocked.colorEffects);
  const specials = Object.keys(skillsConfig.specialSkills);
  const off = (keys) => Object.fromEntries(keys.map((k) => [k, false]));
  for (const c of colors) {
    const unlocked = { colorEffects: { ...off(colors), [c]: true }, specialSkills: off(specials) };
    out.push({ name: `color:${c}`, skillArgs: { skills: { ...skillsConfig, unlocked }, bossRules: false } });
  }
  for (const sk of specials) {
    if (sk === 'color_color') continue; // 무지개+무지개는 드물어 따로 재지 않는다.
    const unlocked = { colorEffects: off(colors), specialSkills: { ...off(specials), [sk]: true } };
    out.push({ name: `special:${sk}`, skillArgs: { skills: { ...skillsConfig, unlocked }, bossRules: false } });
  }
  return out;
}

export async function run(env) {
  const { sim, skills: skillsConfig } = env.configs;
  const probes = expectedTowerLevels(env.configs, PROBE_FLOOR_NUMBERS).filter(
    (p) => p.floor >= env.floorsRange.from && p.floor <= env.floorsRange.to
  );
  // --mod=none,all+boss 처럼 주면 그 변형만 잰다(보정 반복용). none은 등가 계산 기준이라 항상 포함.
  let variants = [...MODES.map((name) => ({ name, skillArgs: skillsFor(name, skillsConfig) })), ...singleModes(skillsConfig)];
  if (env.mods) variants = variants.filter((v) => v.name === 'none' || env.mods.includes(v.name));
  const csvRows = [];
  const outOfRange = [];
  const need = new Map(); // `${variant}|${player}|${floor}` -> needPower
  const aggs = new Map(); // `${variant}|${player}` -> agg

  for (const player of env.players) {
    for (const v of variants) {
      const agg = newAgg();
      aggs.set(`${v.name}|${player}`, agg);
      for (const { floor, expTowerLevel } of probes) {
        const np = needPower(env, player, floor, expTowerLevel, [], { onShot: 0, onHit: 0, extraDamage: 0, agg }, v.skillArgs);
        need.set(`${v.name}|${player}|${floor}`, np);
        const base = need.get(`none|${player}|${floor}`);
        const equiv = base != null && np != null ? Math.round((base / np) * 100) / 100 : null;
        csvRows.push({ player, floor, expTowerLevel, skills: v.name, needPower: np ?? '>3', equivalentPowerMul: equiv ?? '' });
      }
    }
  }

  const fmt = (v) => (v == null ? '>3' : String(v));
  const sections = [];
  const equivSummary = []; // { player, variant, geo } - run.js/보고용
  for (const player of env.players) {
    const rows = [];
    for (const v of variants) {
      const nps = probes.map((p) => need.get(`${v.name}|${player}|${p.floor}`));
      const equivs = probes.map((p) => {
        const base = need.get(`none|${player}|${p.floor}`);
        const np = need.get(`${v.name}|${player}|${p.floor}`);
        return base != null && np != null ? base / np : null;
      });
      const valid = equivs.filter((e) => e != null);
      const geo = valid.length ? Math.exp(valid.reduce((s, e) => s + Math.log(e), 0) / valid.length) : null;
      equivSummary.push({ player, variant: v.name, geo });
      rows.push([v.name, ...nps.map(fmt), geo != null ? `x${geo.toFixed(2)}` : '-']);
      if (v.name !== 'none' && geo != null) {
        const single = v.name.startsWith('color:') || v.name.startsWith('special:');
        const lim = sim.targets.skillEquiv ?? { singleMax: 1.6, redSplashMax: 2.0 };
        if (single && geo >= lim.singleMax) outOfRange.push(`너무 셈: T2s ${player} ${v.name} 혼자 등가 x${geo.toFixed(2)} (기준 ${lim.singleMax} 미만)`);
        if (v.name === 'color:red' && geo >= lim.redSplashMax) outOfRange.push(`너무 셈: T2s ${player} 레드 범위 등가 x${geo.toFixed(2)} (기준 ${lim.redSplashMax} 미만)`);
      }
    }
    sections.push(
      `### ${player} (needPower, 마지막 열 = none 대비 등가 전력 기하평균)\n${mdTable(['기술', ...probes.map((p) => `${p.floor}층`), '등가'], rows)}`
    );

    // all+boss 보스별 표 + 1.0 초과 표시
    const range = sim.targets.bossNeedPower?.[player];
    const bossRows = probes.map((p) => {
      const np = need.get(`all+boss|${player}|${p.floor}`);
      const npAll = need.get(`all|${player}|${p.floor}`);
      let flag = '';
      if (np == null || np > 1.0) flag = '1.0 초과';
      else if (range && (np < range[0] || np > range[1])) flag = np < range[0] ? '쉬움' : '어려움';
      if (range) {
        if (np == null || np > range[1]) outOfRange.push(`너무 어려움: T2s ${player} ${p.floor}층 보스(면역·약점 켬) needPower ${fmt(np)} (기준 ${range[0]}~${range[1]})`);
        else if (np < range[0]) outOfRange.push(`너무 쉬움: T2s ${player} ${p.floor}층 보스(면역·약점 켬) needPower ${fmt(np)} (기준 ${range[0]}~${range[1]})`);
      }
      const measuredAll = need.has(`all|${player}|${p.floor}`);
      return [`${p.floor}층`, p.expTowerLevel, measuredAll ? fmt(npAll) : '-', fmt(np), npAll != null && np != null ? `x${(np / npAll).toFixed(2)}` : '-', flag];
    });
    sections.push(
      `### ${player} 보스별 needPower (all = 면역·약점 없음, all+boss = 게임 그대로)\n${mdTable(['보스층', '기대 Lv', 'all', 'all+boss', '면역 비용', '표시'], bossRows)}`
    );

    const aggRows = variants.filter((v) => v.name !== 'none').map((v) => aggRow(v.name, aggs.get(`${v.name}|${player}`)));
    sections.push(`### ${player} 기술 몫·발동 횟수 (needPower 탐색 전체 시도 평균)\n${aggTable(aggRows)}`);
  }

  const summaryMd =
    `## T2s 실제 기술별 등가 전력 (고정 보스층, 탑 레벨 = expTowerLevel, enemyHpMul ${env.configs.balance.scaling.enemyHpMul ?? 1})\n` +
    sections.join('\n\n');
  return { csvRows, summaryMd, outOfRange, equivSummary };
}
