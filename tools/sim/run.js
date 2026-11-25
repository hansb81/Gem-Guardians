#!/usr/bin/env node
// 밸런스 시뮬레이터 CLI. 사용: node tools/sim/run.js --test=T1|T2|T3|T4|T5|T6|T7|all
// --player=fast|normal|slow|worst|all --seeds=N --floors=1-100 --mod=<sim.json modifiers 키>
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfigs, parseArgs, parseSpirits, applySets } from './config.js';
import { skillsFor, skillArgsAtFor } from './skills.js';
import { writeCsv, todayTag } from './report.js';
import { setupCombo, combo } from './combo.js';
import { simRules } from './floorSim.js';
import { RAINBOW_DEF_DEFAULT } from '../../src/battle/battleState.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPORT_DIR = join(__dirname, '..', '..', 'reports', 'sim');

const TEST_MODULES = {
  t1: () => import('./tests/t1.js'),
  t2: () => import('./tests/t2.js'),
  t2s: () => import('./tests/t2s.js'),
  t3: () => import('./tests/t3.js'),
  t4: () => import('./tests/t4.js'),
  t5: () => import('./tests/t5.js'),
  t6: () => import('./tests/t6.js'),
  t7: () => import('./tests/t7.js'),
  t8: () => import('./tests/t8.js'), // 경쟁 모드 무한 웨이브 - all에는 안 넣음
  t9: () => import('./tests/t9.js'), // v13-6 아이템 하나씩 쓸모 - all에는 안 넣음(--itemset=none,scythe_h,...)
};

async function main() {
  const configs = loadConfigs();
  const args = parseArgs(process.argv.slice(2), configs.sim);
  const sets = applySets(configs, args.set);
  // --rainbowdef=sum|pershot|split: 무지개 1발의 방어력 처리(없으면 게임 기본값 battleState RAINBOW_DEF_DEFAULT).
  if (args.rainbowdef != null && !['sum', 'pershot', 'split'].includes(args.rainbowdef)) throw new Error(`--rainbowdef는 sum|pershot|split: ${args.rainbowdef}`);
  simRules.rainbowDef = args.rainbowdef ?? null;
  simRules.spiritsConfig = configs.spirits;
  // --spirits=off|prog|<고정 목록>, 기본 prog(v13-3, tools/sim/spiritProg.js: 진행 테스트가 얻고·끼우고·키운다). off = 정령 커밋 전 동작.
  const spiritMode = args.spirits ?? 'prog';
  simRules.spirits = spiritMode === 'off' || spiritMode === 'prog' ? null : parseSpirits(spiritMode, configs.spirits);
  const spiritBuy = Number(args.spiritbuy ?? 10); // --spiritbuy=X: 정령 레벨 누적 지출 상한 = 누적 수입의 X%(0 = 레벨업 안 함)
  const spiritEquip = args.spiritequip ?? 'sum'; // --spiritequip=sum(기본, effectMul 합 최대)|atk(공격 환산 최대, 비교용)
  if (!['sum', 'atk'].includes(spiritEquip)) throw new Error(`--spiritequip는 sum|atk: ${spiritEquip}`);
  if (!(spiritBuy >= 0 && spiritBuy <= 100)) throw new Error(`--spiritbuy는 0에서 100: ${args.spiritbuy}`);
  if (args.idleRMul != null) configs.mine.gold.rMul = args.idleRMul; // 메모리에서만(파일은 그대로)
  const comboTag = setupCombo(args, configs.balance); // tools/sim/combo.js. 콤보 골드 기본 = config(게임 그대로), 데미지 배율 기본 off
  // skillArgs = runFloorAttempt에 그대로 펼쳐 넣는 { skills, bossRules } (T2s는 모드별로 따로 만든다).
  const env = {
    configs,
    players: args.players,
    seeds: args.seeds,
    floorsRange: args.floors,
    mods: args.mods,
    skillsMode: args.skills,
    skillArgs: skillsFor(args.skills, configs.skills),
    // skillArgsAt(bestFloor) - shop 모드는 최고 도달 층에 따라 특수 기술 해금이 달라진다(그 층을 처음 도전 = bestFloor).
    skillArgsAt: skillArgsAtFor(args.skills, configs.skills, configs.shop),
    itemPolicies: args.itemPolicies,
    skillBuy: args.skillBuy,
    towerBuy: args.towerBuy,
    skillGate: args.skillGate ?? configs.shop.skills.maxLevelByFloor?.every ?? 'off',
    skillShare: args.skillShare,
    dia: args.dia,
    ads: args.ads,
    minutesPerDay: args.minutesPerDay,
    strategies: args.strategies,
    skillLvAll: args.skillLvAll,
    flight: args.flight, // --flight=on: 측정 전용 탄 비행 시간 근사(T4·T7·T2/T2s, floorSim shotFlight)
    t7base: args.t7base, // --t7base=<t7 csv>: T7 기준 Lv·스킬 Lv를 그 파일(기준 열) 값으로 고정(다시 잡지 않음)
    spiritsProg: spiritMode === 'prog', // T1·T3·T4(·T5·T6)·T7이 정령 진행을 쓴다
    spiritBuy: spiritBuy / 100,
    spiritEquip,
    itemSets: args.itemset ? args.itemset.split(',').map((s) => s.trim()).filter(Boolean) : null, // T9 세트 고르기(병렬 실행용)
    idle: args.idle, // --idle: 방치 광산 하루 접속 횟수(0 = 없음). T4 진행과 그 진행을 쓰는 테스트(T7 기준 레벨 등)에 반영
    idleDayHours: args.idleDayHours,
    emptySpawn: args.emptySpawn ?? configs.balance.floorShape.emptySpawn ?? 'off', // 빈 전장 즉시 등장: 기본 = balance.json floorShape.emptySpawn(게임 그대로), --emptySpawn=off|on|predict로 덮어쓰기
  };
  const dateTag = todayTag();
  // --out=<dir>: 단계별 비교 실행 결과를 reports/sim/summary.md와 섞지 않으려고 따로 저장.
  const REPORT_DIR = args.out ?? DEFAULT_REPORT_DIR;

  console.log(`tests=${args.tests.join(',')} players=${env.players.join(',')} seeds=${env.seeds} floors=${env.floorsRange.from}-${env.floorsRange.to} skills=${env.skillsMode} skillbuy=${env.skillBuy} towerbuy=${env.towerBuy} gate=${env.skillGate} dia=${env.dia} ads=${env.ads} flight=${env.flight ? 'on' : 'off'} emptySpawn=${env.emptySpawn} rainbowdef=${simRules.rainbowDef ?? `${RAINBOW_DEF_DEFAULT}(기본)`} spirits=${spiritMode}${spiritMode === 'prog' ? ` spiritbuy=${spiritBuy}${spiritEquip !== 'sum' ? ` spiritequip=${spiritEquip}` : ''}` : ''}`);

  const { execSync } = await import('node:child_process');
  let commit = 'unknown';
  try {
    commit = execSync('git rev-parse --short HEAD', { cwd: join(__dirname, '..', '..') }).toString().trim();
  } catch {
    /* git 없이도 돌아가야 한다 */
  }
  const summaryParts = [
    `# 밸런스 시뮬레이션 결과 (${dateTag})

` +
      `- 커밋: ${commit} (워킹 트리에 미커밋 변경 있음 - config/balance.json, src/core 참고)
` +
      `- 시드 수: ${env.seeds} (seed = 1..${env.seeds} 고정)
` +
      `- 층 범위: ${env.floorsRange.from}-${env.floorsRange.to}
` +
      `- 플레이어: ${env.players.join(', ')}
` +
      `- 테스트: ${args.tests.join(', ')}
` +
      `- 기술: ${env.skillsMode} (T2s는 모드별 비교) / enemyHpMul ${configs.balance.scaling.enemyHpMul ?? 1}` +
      `
- 스킬 구매: ${env.skillBuy} (잠금 ${env.skillGate === 'off' ? 'off' : `${env.skillGate}층마다 +1`}, balanced 상한 ${env.skillShare}) / 탑 구매 ${env.towerBuy === 'always' ? 'always(층이 끝날 때마다)' : 'onfail(실패했을 때만)'} / 다이아 ${env.dia} / 광고 ${env.ads} (하루 ${env.minutesPerDay}분) / 탄 비행 ${env.flight ? 'on(측정 전용 근사)' : 'off(즉시 명중)'} / 빈 전장 즉시 등장 ${env.emptySpawn}${args.emptySpawn ? '(--emptySpawn 덮어쓰기)' : '(balance.json)'} / 무지개 방어 ${simRules.rainbowDef ?? `${RAINBOW_DEF_DEFAULT}(기본)`}` +
      (sets.length ? `
- 메모리 덮어쓰기(--set, 파일은 그대로): ${sets.join(', ')}` : ''),
  ];
  if (env.spiritsProg) summaryParts.push(`- 정령(tools/sim/spiritProg.js): prog - 시작 도깨비불, 보스 첫 클리어 보상(config bossReward), 층 시작마다 배율 합 최대 장착(망치·시계태엽·해체 제외), 정령 레벨 지출 <= 누적 수입의 ${spiritBuy}%${spiritEquip !== 'sum' ? `, 장착 = 공격 환산 최대(--spiritequip=atk)` : ''}`);
  const allOutOfRange = [];
  if (env.idle > 0) {
    const idleTag = `광산(측정 전용, tools/sim/idle.js): 하루 접속 ${env.idle}회 x 8시간 분량, 하루 = 플레이 ${env.idleDayHours}시간, rMul ${configs.mine.gold.rMul}${args.idleRMul != null ? '(--idleRMul 덮어쓰기)' : '(mine.json)'}`;
    console.log(idleTag);
    summaryParts.push(`- ${idleTag}`);
  }
  if (comboTag !== 'combo=off window=3s') {
    console.log(comboTag);
    summaryParts.push(`- 콤보(측정 전용, tools/sim/combo.js): ${comboTag}${env.t7base ? ` / T7 기준 Lv 고정: ${env.t7base}` : ''}`);
  }

  for (const testId of args.tests) {
    const mod = TEST_MODULES[testId];
    if (!mod) {
      console.warn(`알 수 없는 테스트: ${testId}`);
      continue;
    }
    const t0 = Date.now();
    const { run } = await mod();
    const { csvRows, summaryMd, outOfRange, extraCsv } = await run(env);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${testId} 완료 (${elapsed}s, ${csvRows.length}행)`);

    const csvPath = join(REPORT_DIR, `${testId}_${dateTag}.csv`);
    writeCsv(csvPath, csvRows);
    // 테스트가 따로 내는 표(기존 csv 모양을 안 바꾸려고 파일을 나눈다): { 이름: 행[] }
    for (const [name, rows] of Object.entries(extraCsv ?? {})) writeCsv(join(REPORT_DIR, `${name}_${dateTag}.csv`), rows);
    summaryParts.push(summaryMd);
    allOutOfRange.push(...outOfRange);
  }

  if (allOutOfRange.length > 0) {
    summaryParts.push(`## 기준 벗어남\n${allOutOfRange.map((s) => `- ${s}`).join('\n')}`);
  }

  if (combo.rows) writeCsv(join(REPORT_DIR, `combo_${dateTag}.csv`), combo.rows);
  const summaryPath = join(REPORT_DIR, 'summary.md');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(summaryPath, summaryParts.join('\n\n') + '\n', 'utf8');
  console.log(`summary.md 작성: ${summaryPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
