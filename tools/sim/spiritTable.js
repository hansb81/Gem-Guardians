#!/usr/bin/env node
// 정령 효과가 "공격력 몇 % 증가와 같은지" 재는 표(docs/spirits.md 2장 목표: 일반 1마리 +3% 안팎, 최대 1마리 +9% 안팎, 5마리 +25~35%).
// 사용: node tools/sim/spiritTable.js [--seeds=60]  ->  reports/sim/spirits/g-table.md, g-table.csv
// 방법: 같은 층·같은 seed 묶음으로 (1) 정령 없이 공격력만 +x% 올린 기준 곡선, (2) 정령을 낀 판을 돌린다.
//   지표마다 "정령 없음"과의 짝 차이(같은 층·seed)를 구하고, 기준 곡선의 기울기(원점 지나는 회귀)로 나눠 공격력 %로 바꾼다.
//   수호자 레벨 조건 두 가지를 나란히: 빠듯 = 층마다 "정령 없이 80% 이상 깨는 가장 낮은 레벨", 권장 = 그 층에 들어갈 때의 기대 레벨
//   (T2 expTowerLevel: 1층부터 첫 클리어 골드를 가장 싼 수호자부터 쓴 평균 레벨). 권장 쪽은 성벽이 거의 안 깎여 성벽 환산의 오차가 크다.
// 규칙은 전부 게임 코드(runFloorAttempt -> BattleState/GameState). 숫자는 config 그대로, 파일은 고치지 않는다.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfigs } from './config.js';
import { runFloorAttempt, simRules } from './floorSim.js';
import { skillArgsAtFor } from './skills.js';
import { mdTable } from './report.js';
import { expectedTowerLevels } from './tests/t2.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'reports', 'sim', 'spirits');
const SEEDS = Number(process.argv.find((a) => a.startsWith('--seeds='))?.split('=')[1] ?? 60);
const FLOORS = [12, 15, 18, 20, 23, 27, 34, 38, 40, 45]; // 일반·엘리트·보스(20, 40) 섞음
const ATK_GRID = [3, 6, 9, 12, 15, 20, 25, 30, 35, 40, 50]; // 기준 곡선: 공격력 +x%
const PLAYER = 'normal';
const ONLY = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1] ?? null; // 그 줄만 다시 잴 때(결과는 g-table-only.md)

const c = loadConfigs();
// 일반 등급 증폭 정령은 실제로 없어서(희귀 얼음 부엉이부터) 재는 용도로만 하나 만든다 - 파일은 그대로.
const spiritsCfg = { ...c.spirits, spirits: { ...c.spirits.spirits, sim_common_amplify: { element: 'blue', grade: 'common', role: 'amplify' } } };
simRules.spiritsConfig = spiritsCfg;
const skillsAt = skillArgsAtFor('shop', c.skills, c.shop);
const COLORS = c.balance.tower.towers.map((t) => t.color);
const MAXLV = c.spirits.levelMax;
const MAXSTAR = c.spirits.starMax;

// slots = { 수호자 색: [id, lv, star] } -> simRules.spirits(수호자 순서 5칸)
const slots = (bySlot) => COLORS.map((color) => (bySlot[color] ? { id: bySlot[color][0], lv: bySlot[color][1] ?? 1, star: bySlot[color][2] ?? 1 } : null));
const one = (color, id, max = false) => slots({ [color]: max ? [id, MAXLV, MAXSTAR] : [id] });
const el = (id) => spiritsCfg.spirits[id].element;

const CASES = [
  // 역할 5종: 일반·1레벨·별 1·비공명(번개 수호자에 다른 속성 정령)
  ['일반 1마리 (1레벨·별 1·비공명)', '공격 fire_wisp', one('yellow', 'fire_wisp')],
  ['일반 1마리 (1레벨·별 1·비공명)', '속성 snow_fairy', one('yellow', 'snow_fairy')],
  ['일반 1마리 (1레벨·별 1·비공명)', '증폭 (재는 용 일반 등급)', one('yellow', 'sim_common_amplify')],
  ['일반 1마리 (1레벨·별 1·비공명)', '수호 seedling', one('yellow', 'seedling')],
  ['일반 1마리 (1레벨·별 1·비공명)', '재물 ember_rat', one('yellow', 'ember_rat')],
  // 최대로 키운 한 마리: 영웅 30레벨 별 5 공명
  ['최대 1마리 (영웅 30레벨·별 5·공명)', '공격 glacier_wolf', one('blue', 'glacier_wolf', true)],
  ['최대 1마리 (영웅 30레벨·별 5·공명)', '증폭 stag', one('green', 'stag', true)],
  ['최대 1마리 (영웅 30레벨·별 5·공명)', '증폭 storm_cat', one('yellow', 'storm_cat', true)],
  ['최대 1마리 (영웅 30레벨·별 5·공명)', '수호 lava_turtle', one('red', 'lava_turtle', true)],
  // 5마리 조합(전부 30레벨·별 5·공명)
  ['5마리 (전부 30레벨·별 5·공명)', '영웅 5 (거북·늑대·뇌운고양이·사슴·두꺼비)', slots({ red: ['lava_turtle', MAXLV, MAXSTAR], blue: ['glacier_wolf', MAXLV, MAXSTAR], yellow: ['storm_cat', MAXLV, MAXSTAR], green: ['stag', MAXLV, MAXSTAR], purple: ['toxic_toad', MAXLV, MAXSTAR] })],
  ['5마리 (전부 30레벨·별 5·공명)', '공격 위주 (여우·늑대·전기구슬·사슴·까마귀)', slots({ red: ['flame_fox', MAXLV, MAXSTAR], blue: ['glacier_wolf', MAXLV, MAXSTAR], yellow: ['spark_fly', MAXLV, MAXSTAR], green: ['stag', MAXLV, MAXSTAR], purple: ['bone_crow', MAXLV, MAXSTAR] })],
  ['5마리 (전부 30레벨·별 5·공명)', '전설 5', slots(Object.fromEntries(['phoenix', 'frost_whale', 'storm_kirin', 'elder_treant', 'wraith_queen'].map((id) => [el(id), [id, MAXLV, MAXSTAR]])))],
  // 전설 5종 각각(공명 자리)
  ...['phoenix', 'frost_whale', 'elder_treant', 'wraith_queen', 'storm_kirin'].flatMap((id) => [
    ['전설 1마리 (1레벨·별 1·공명)', id, one(el(id), id)],
    ['전설 1마리 (30레벨·별 5·공명)', id, one(el(id), id, true)],
  ]),
  // 보조(참고): 봇은 아이템을 안 써서 망치 정령은 0, 물감·시계태엽·해체는 퍼즐 쪽 효과만 잡힌다.
  ...['sup_cascade', 'sup_clock', 'sup_breaker', 'sup_paint', 'sup_tinker'].map((id) => ['보조 1마리 (30레벨·별 5·공명, 참고)', id, one(el(id), id, true)]),
];

if (ONLY) CASES.splice(0, CASES.length, ...CASES.filter(([, label]) => label.includes(ONLY)));

function runSet(levels, spirits, attackMul) {
  simRules.spirits = spirits;
  const out = [];
  for (const floor of FLOORS) {
    for (let seed = 1; seed <= SEEDS; seed++) {
      const r = runFloorAttempt({
        balance: c.balance, enemies: c.enemies, obstacles: c.obstacles, obstaclesEnabled: true, floorsData: c.floorsData, floorNumber: floor,
        towerLevels: Array(COLORS.length).fill(levels[floor]), playerCfg: c.sim.players[PLAYER], modifierHooks: null, ...skillsAt(floor),
        attackMul, seed, dt: c.sim.dt, maxFloorSeconds: c.sim.maxFloorSeconds, summon: c.summon, battleEffects: c.battleEffects,
      });
      out.push({ cleared: r.status === 'cleared', time: r.timeSec, wall: r.wallHealthPct * 100, gold: r.killGoldTotal + r.spiritGold });
    }
  }
  simRules.spirits = null;
  return out;
}

// 조건 1(빠듯): 정령 없이 80% 이상 깨는 가장 낮은 레벨.
const tight = {};
for (const floor of FLOORS) {
  for (let lv = 1; lv <= c.balance.tower.maxLevel; lv++) {
    tight[floor] = lv;
    let ok = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const r = runFloorAttempt({
        balance: c.balance, enemies: c.enemies, obstacles: c.obstacles, obstaclesEnabled: true, floorsData: c.floorsData, floorNumber: floor,
        towerLevels: Array(COLORS.length).fill(lv), playerCfg: c.sim.players[PLAYER], modifierHooks: null, ...skillsAt(floor),
        seed, dt: c.sim.dt, maxFloorSeconds: c.sim.maxFloorSeconds, summon: c.summon, battleEffects: c.battleEffects,
      });
      if (r.status === 'cleared') ok++;
    }
    if (ok >= 16) break;
  }
}
// 조건 2(권장): 그 층에 들어갈 때의 기대 레벨.
const rec = Object.fromEntries(expectedTowerLevels(c, FLOORS).map((e) => [e.floor, e.expTowerLevel]));

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const sd = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const clearPct = (runs) => (runs.filter((r) => r.cleared).length / runs.length) * 100;
const f1 = (v) => (Number.isFinite(v) ? (v >= 0 ? '+' : '') + v.toFixed(1) : '-');

// 한 조건을 통째로 잰다: 기준, 기준 곡선(기울기), 정령 설정마다 환산값.
function measure(name, levels) {
  console.log(`[${name}] 층별 수호자 레벨`, JSON.stringify(levels));
  const base = runSet(levels, null, 1);
  // 짝 차이: time·gold는 둘 다 깬 판만, wall은 전부(실패 = 0%).
  const diffs = (runs, key) => runs.map((r, i) => (key === 'wall' || (r.cleared && base[i].cleared) ? r[key] - base[i][key] : null)).filter((d) => d != null);
  const curve = ATK_GRID.map((x) => ({ x, runs: runSet(levels, null, 1 + x / 100) }));
  // 기준 곡선 기울기(공격력 1%당 변화, 원점 지나는 회귀).
  const slope = (key) => {
    const pts = curve.map((p) => ({ x: p.x, d: mean(diffs(p.runs, key)) }));
    return pts.reduce((s, p) => s + p.x * p.d, 0) / pts.reduce((s, p) => s + p.x * p.x, 0);
  };
  const S = { time: slope('time'), wall: slope('wall') };
  const cases = CASES.map(([group, label, spirits]) => {
    const runs = runSet(levels, spirits, 1);
    const dt = diffs(runs, 'time');
    const dw = diffs(runs, 'wall');
    const both = runs.map((r, i) => (r.cleared && base[i].cleared ? [r.gold, base[i].gold] : null)).filter(Boolean);
    const out = {
      group, label, clear: clearPct(runs), dTime: mean(dt), dWall: mean(dw),
      eqT: mean(dt) / S.time, eqW: mean(dw) / S.wall, seT: sd(dt) / Math.sqrt(dt.length) / Math.abs(S.time), seW: sd(dw) / Math.sqrt(dw.length) / Math.abs(S.wall),
      gold: (mean(both.map((b) => b[0])) / mean(both.map((b) => b[1])) - 1) * 100,
    };
    out.avg = (out.eqT + out.eqW) / 2;
    console.log(`[${name}]`, group, '|', label, '| 시간', f1(out.eqT), '| 성벽', f1(out.eqW), '| 골드', f1(out.gold));
    return out;
  });
  return {
    name, levels, S, cases,
    baseClear: clearPct(base), baseTime: mean(base.filter((r) => r.cleared).map((r) => r.time)), baseWall: mean(base.map((r) => r.wall)),
    curveRows: curve.map((p) => [`+${p.x}%`, clearPct(p.runs).toFixed(0), f1(mean(diffs(p.runs, 'time'))), f1(mean(diffs(p.runs, 'wall')))]),
  };
}

const A = measure('빠듯', tight);
const B = measure('권장', rec);
const conds = [A, B];

const eq = (r, k, se) => `${f1(r[k])} ±${r[se].toFixed(1)}`;
const rows = CASES.map(([group, label], i) => {
  const [a, b] = [A.cases[i], B.cases[i]];
  return [group, label, a.clear.toFixed(0), eq(a, 'eqT', 'seT'), eq(a, 'eqW', 'seW'), f1(a.avg), b.clear.toFixed(0), eq(b, 'eqT', 'seT'), eq(b, 'eqW', 'seW'), f1(b.avg), f1(a.gold)];
});
const csv = ['cond,group,case,clearPct,timeDiffSec,timeEqAtkPct,timeSe,wallDiffPt,wallEqAtkPct,wallSe,goldDiffPct,avgEqAtkPct'];
for (const cond of conds) {
  for (const r of cond.cases) csv.push([cond.name, r.group, r.label, r.clear.toFixed(1), r.dTime.toFixed(3), r.eqT.toFixed(2), r.seT.toFixed(2), r.dWall.toFixed(3), r.eqW.toFixed(2), r.seW.toFixed(2), r.gold.toFixed(2), r.avg.toFixed(2)].join(','));
}
const condLine = (m) => `- **${m.name}**: ${FLOORS.map((f) => `${f}층 Lv${m.levels[f]}`).join(', ')} / 기준 클리어율 ${m.baseClear.toFixed(0)}%, 클리어 시간 ${m.baseTime.toFixed(1)}초, 남은 성벽 ${m.baseWall.toFixed(1)}% / 공격력 1%당 시간 ${m.S.time.toFixed(3)}초, 성벽 ${m.S.wall >= 0 ? '+' : ''}${m.S.wall.toFixed(3)}%p`;

const md = `# 정령 효과 = 공격력 몇 %인가

- 만든 방법: \`node tools/sim/spiritTable.js --seeds=${SEEDS}\` (봇 ${PLAYER}, 기술 = 상점 해금 일정, 층 ${FLOORS.join('·')} x seed 1..${SEEDS} = 설정마다 ${FLOORS.length * SEEDS}판)
- 기준 = 정령 없음. 수호자 레벨 조건 두 가지:
${conds.map(condLine).join('\n')}
- 빠듯 = 정령 없이 80% 이상 깨는 가장 낮은 레벨. 권장 = 그 층에 들어갈 때의 기대 레벨(T2 expTowerLevel).
- "시간"·"성벽" = 같은 층·seed끼리 정령 없음과의 차이를 그 조건의 기울기(기준 곡선의 원점 지나는 회귀)로 나눈 값(공격력 +몇 %와 같은가). ± = 표준오차. "평균" = 두 값의 평균.
- 시간은 두 쪽 다 깬 판만, 성벽은 전부(실패 = 0%). 골드 = 처치 골드(재물 정령 추가분 포함) 변화율(빠듯 조건) - 공격력을 올려도 골드는 안 변해서 환산하지 않는다.
- 권장 조건은 성벽이 거의 안 깎여(기울기가 작다) 성벽 환산의 오차가 크다. 그쪽은 시간 환산을 먼저 본다.

## 정령

${mdTable(['묶음', '정령', '빠듯 클리어 %', '빠듯 시간', '빠듯 성벽', '빠듯 평균', '권장 클리어 %', '권장 시간', '권장 성벽', '권장 평균', '골드 %'], rows)}

${conds.map((m) => `## 기준 곡선 - ${m.name} (정령 없이 공격력만)\n\n${mdTable(['공격력', '클리어 %', '시간 차(초)', '남은 성벽 차(%p)'], m.curveRows)}`).join('\n\n')}
`;
mkdirSync(OUT, { recursive: true });
const name = ONLY ? 'g-table-only' : 'g-table';
writeFileSync(join(OUT, `${name}.md`), md, 'utf8');
writeFileSync(join(OUT, `${name}.csv`), csv.join('\n') + '\n', 'utf8');
console.log('작성:', join(OUT, `${name}.md`));
