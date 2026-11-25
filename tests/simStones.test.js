// tools/sim --stonesPerDay(docs/spirit-stones.md 5장): 0이면 옵션 추가 전과 결과가 완전히 같고, N이면 하루마다 정령석 N개(10층 보스 전 0).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfigs, parseArgs } from '../tools/sim/config.js';
import { simRules } from '../tools/sim/floorSim.js';
import { skillArgsAtFor } from '../tools/sim/skills.js';
import { runOneProgression } from '../tools/sim/tests/t4.js';

const c = loadConfigs();
simRules.spiritsConfig = c.spirits;
const env = {
  configs: c, floorsRange: { from: 1, to: 15 }, skillsMode: 'shop', skillArgsAt: skillArgsAtFor('shop', c.skills, c.shop),
  skillBuy: 'balanced', skillGate: 'off', skillShare: 0.15, dia: 'none', ads: 'off', minutesPerDay: 30,
  spiritsProg: true, spiritBuy: 0.1, spiritEquip: 'sum', idle: 0, idleDayHours: 0.1,
};
const run = (over) => runOneProgression({ ...env, ...over }, 'normal', 'even', 1);

test('--stonesPerDay: 기본 0, 음수·소수는 거부', () => {
  assert.equal(parseArgs([], c.sim).stonesPerDay, 0);
  assert.equal(parseArgs(['--stonesPerDay=4'], c.sim).stonesPerDay, 4);
  assert.throws(() => parseArgs(['--stonesPerDay=-1'], c.sim));
});

test('--stonesPerDay=0이면 옵션이 없을 때와 결과가 완전히 같고, N이면 10층 보스 뒤 하루마다 N개', () => {
  const base = run({});
  assert.deepEqual(run({ stonesPerDay: 0 }), base);
  const more = run({ stonesPerDay: 4 });
  const extra = more.spirit.stonesGot - base.spirit.stonesGot;
  assert.ok(extra > 0 && extra % 4 === 0, `정령석 +${extra}`);
  const to10 = { floorsRange: { from: 1, to: 10 } }; // 10층 보스를 깨기 전까지는 광산이 없다
  assert.equal(run({ ...to10, stonesPerDay: 4 }).spirit.stonesGot, run(to10).spirit.stonesGot);
});
