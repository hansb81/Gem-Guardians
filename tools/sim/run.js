#!/usr/bin/env node
// 밸런스 시뮬레이터 CLI. 사용: node tools/sim/run.js --test=T1|T2|T3|T4|T5|T6|T7|all
// --player=fast|normal|slow|worst|all --seeds=N --floors=1-100 --mod=<sim.json modifiers 키>
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadConfigs, parseArgs, applySets } from './config.js';
import { skillsFor, skillArgsAtFor } from './skills.js';
import { writeCsv, todayTag } from './report.js';

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
};

async function main() {
  const configs = loadConfigs();
  const args = parseArgs(process.argv.slice(2), configs.sim);
  const sets = applySets(configs.balance, args.set);
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
  };
  const dateTag = todayTag();
  // --out=<dir>: 단계별 비교 실행 결과를 reports/sim/summary.md와 섞지 않으려고 따로 저장.
  const REPORT_DIR = args.out ?? DEFAULT_REPORT_DIR;

  console.log(`tests=${args.tests.join(',')} players=${env.players.join(',')} seeds=${env.seeds} floors=${env.floorsRange.from}-${env.floorsRange.to} skills=${env.skillsMode}`);

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
      (sets.length ? `
- 메모리 덮어쓰기(--set, balance.json 파일은 그대로): ${sets.join(', ')}` : ''),
  ];
  const allOutOfRange = [];

  for (const testId of args.tests) {
    const mod = TEST_MODULES[testId];
    if (!mod) {
      console.warn(`알 수 없는 테스트: ${testId}`);
      continue;
    }
    const t0 = Date.now();
    const { run } = await mod();
    const { csvRows, summaryMd, outOfRange } = await run(env);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    console.log(`${testId} 완료 (${elapsed}s, ${csvRows.length}행)`);

    const csvPath = join(REPORT_DIR, `${testId}_${dateTag}.csv`);
    writeCsv(csvPath, csvRows);
    summaryParts.push(summaryMd);
    allOutOfRange.push(...outOfRange);
  }

  if (allOutOfRange.length > 0) {
    summaryParts.push(`## 기준 벗어남\n${allOutOfRange.map((s) => `- ${s}`).join('\n')}`);
  }

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
