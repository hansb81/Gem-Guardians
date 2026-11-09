// 서버용 층별 골드 기준표: floor_gold[i] = normalFloorReward(밸런스, i+1) (1~MAX층).
// 경쟁 정산(참여 보상 goldFloorMul)이 쓴다(docs/server.md §22 C3-5). 밸런스 config를 바꾸면 다시 돌린다:
//   node tools/gen_floor_gold.mjs   (tests/server-copies.test.js가 다르면 실패)
import { readFileSync, writeFileSync } from 'node:fs';
import { normalFloorReward } from '../src/core/economy/economy.js';

export const MAX_FLOOR = 300; // 넘는 층은 서버가 300층 값으로
const load = (n) => JSON.parse(readFileSync(new URL(`../config/${n}`, import.meta.url), 'utf8'));

export function floorGoldTable() {
  const data = { balance: load('balance.json'), enemies: load('enemies.json'), obstacles: load('obstacles.json'), floorsData: load('floors.json') };
  return Array.from({ length: MAX_FLOOR }, (_, i) => normalFloorReward(data, i + 1));
}

export const OUT = new URL('../server/supabase/functions/_shared/floor_gold.json', import.meta.url);

if (process.argv[1]?.endsWith('gen_floor_gold.mjs')) {
  const gold = floorGoldTable();
  writeFileSync(OUT, JSON.stringify({ _doc: 'tools/gen_floor_gold.mjs가 생성. 직접 고치지 말 것. gold[i] = (i+1)층 일반 층 골드 기준가.', gold }) + '\n');
  console.log(`floor_gold.json: ${gold.length}층, 1층 ${gold[0]}, ${gold.length}층 ${gold.at(-1)}`);
}
