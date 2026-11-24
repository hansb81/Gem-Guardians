// T8. 경쟁 모드 무한 웨이브(docs/ranking.md 5장). 석상 전부 comp.towerLevel, 특수 기술 전부 해금 Lv 1,
// 키트(comp.kit)만 들고 성벽이 무너질 때까지. 후보 ramp(startFloor/floorsPerWave/rampFrom/rampMul/heal)별로
// 판 길이(분)·도달 웨이브·점수를 본다. 후보 = 환경 변수 T8_GRID(JSON 배열, comp.endless 덮어쓰기) 또는 config 값 하나.
import { readFileSync } from 'node:fs';
import { runFloorAttempt } from '../floorSim.js';
import { mdTable } from '../report.js';
import { waveFloor } from '../../../src/core/comp/endless.js';

const ranking = JSON.parse(readFileSync(new URL('../../../config/ranking.json', import.meta.url), 'utf8'));
const MAX_SEC = 3600;

const q = (arr, p) => {
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor(p * (a.length - 1) + 0.5))];
};

export async function run(env) {
  const { balance, enemies, obstacles, floorsData, sim, battleEffects, summon, items } = env.configs;
  const base = ranking.comp;
  const grid = process.env.T8_GRID ? JSON.parse(process.env.T8_GRID) : [{}];
  const lv = base.towerLevel;
  const csvRows = [];
  const table = [];
  for (const over of grid) {
    const cfg = { ...base, endless: { ...base.endless, ...over } };
    const tag = Object.entries(over).map(([k, v]) => `${k}=${v}`).join(' ') || 'config';
    for (const player of env.players) {
      const res = [];
      for (let s = 0; s < env.seeds; s++) {
        const r = runFloorAttempt({
          balance, enemies, obstacles, obstaclesEnabled: true, floorsData, floorNumber: 1,
          towerLevels: [lv, lv, lv, lv, lv], playerCfg: sim.players[player], modifierHooks: null,
          ...env.skillArgsAt(9999), // 특수 기술 전부 해금 Lv 1(comp.skillLevel = 1)
          seed: s + 1, dt: sim.dt, maxFloorSeconds: MAX_SEC, summon, battleEffects,
          itemBot: { config: items, inventory: { ...cfg.kit }, equipped: Object.keys(cfg.kit) },
          endless: { cfg, seed: 0x5eed0000 + s },
        });
        res.push(r);
        csvRows.push({ grid: tag, player, seed: s + 1, status: r.status, minutes: (r.timeSec / 60).toFixed(2), wave: r.wave, waveFloor: waveFloor(cfg, r.wave), score: r.score, kills: r.scoreParts.kills, wallBonus: r.scoreParts.wallBonus });
      }
      const min = res.map((r) => r.timeSec / 60);
      const waves = res.map((r) => r.wave);
      const scores = res.map((r) => r.score);
      table.push([tag, player, `${q(min, 0.5).toFixed(1)} (${q(min, 0.1).toFixed(1)}~${q(min, 0.9).toFixed(1)})`, `${q(waves, 0.5)} (${q(waves, 0.1)}~${q(waves, 0.9)})`, waveFloor(cfg, q(waves, 0.5)), `${q(scores, 0.5)} (${q(scores, 0.1)}~${q(scores, 0.9)})`, res.filter((r) => r.status === 'timeout').length]);
      console.log(table[table.length - 1].join(' | '));
    }
  }
  const summaryMd = `## T8 경쟁 모드 무한 웨이브 (석상 Lv${lv}, 키트 ${JSON.stringify(base.kit)}, 시드 ${env.seeds}, 상한 ${MAX_SEC / 60}분)\n` +
    mdTable(['후보', '플레이어', '판 길이 분 중앙 (P10~P90)', '도달 웨이브', '그때 난이도 층', '점수', `${MAX_SEC / 60}분 버팀`], table);
  return { csvRows, summaryMd, outOfRange: [] };
}
