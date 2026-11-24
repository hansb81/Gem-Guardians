#!/usr/bin/env node
// 경쟁 모드 점수 상한 표 -> server/supabase/functions/_shared/comp_limits.json (docs/ranking.md 5장).
// 웨이브 n 상한 = 1000 + 성벽 보너스 만점 + 그 웨이브 적 전부 처치(시드 SEEDS개 중 최대 x MARGIN). cum[n-1] = 1~n 합.
// config/ranking.json comp·balance·enemies를 바꾸면 다시 돌린다(tests/comp.test.js가 표가 최신인지 본다).
import { readFileSync, writeFileSync } from 'node:fs';
import { waveMaxPoints } from '../src/core/comp/endless.js';

const WAVES = 200;
const SEEDS = 100;
const MARGIN = 1.25;

export function buildLimits(waves = WAVES, root = new URL('../', import.meta.url)) {
  const read = (p) => JSON.parse(readFileSync(new URL(p, root), 'utf8'));
  const data = { balance: read('config/balance.json'), enemies: read('config/enemies.json'), obstacles: read('config/obstacles.json') };
  const cfg = read('config/ranking.json').comp;
  const cum = [];
  let sum = 0;
  for (let n = 1; n <= waves; n++) {
    let max = 0;
    for (let s = 1; s <= SEEDS; s++) max = Math.max(max, waveMaxPoints(data, cfg, Math.imul(s, 0x9e3779b1) >>> 0, n));
    sum += Math.ceil(max * MARGIN);
    cum.push(sum);
  }
  return { _doc: 'tools/gen_comp_limits.mjs가 만든다 - 손으로 고치지 말 것. cum[n-1] = 웨이브 n까지 점수 상한. 표보다 긴 판은 마지막 두 칸 차이로 늘린다.', cum };
}

if (process.argv[1]?.endsWith('gen_comp_limits.mjs')) {
  const out = new URL('../server/supabase/functions/_shared/comp_limits.json', import.meta.url);
  writeFileSync(out, JSON.stringify(buildLimits()) + '\n');
  console.log('written', out.pathname);
}
