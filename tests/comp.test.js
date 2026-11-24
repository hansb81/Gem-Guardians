// 경쟁 모드 무한 웨이브·점수·입력 기록(src/core/comp/endless.js, docs/ranking.md 5장)과 전투 이어 붙이기(battleState nextWave).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BattleState } from '../src/battle/battleState.js';
import { genFloor } from '../src/core/balance/floorGen.js';
import { waveFloor, makeWave, endlessFloor, createScore, killPoints, createInputLog, MAX_INPUTS, compLock } from '../src/core/comp/endless.js';
import { buildLimits } from '../tools/gen_comp_limits.mjs';

const load = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const data = { balance: load('config/balance.json'), enemies: load('config/enemies.json'), obstacles: load('config/obstacles.json') };
const comp = load('config/ranking.json').comp;

test('waveFloor: startFloor부터 웨이브마다 +floorsPerWave, rampFrom부터 x rampMul', () => {
  const cfg = { endless: { startFloor: 15, floorsPerWave: 1, rampFrom: 10, rampMul: 2 } };
  assert.deepEqual([1, 2, 10, 11, 12].map((n) => waveFloor(cfg, n)), [15, 16, 24, 26, 28]);
  assert.equal(waveFloor({ endless: { startFloor: 3, floorsPerWave: 1, rampFrom: null } }, 5), 7); // ramp 없음
});

test('makeWave: 같은 시드 = 같은 웨이브, 시드가 다르면 구성이 달라질 수 있다, seed 0인 genFloor는 그대로', () => {
  assert.deepEqual(makeWave(data, comp, 123, 4).spawns, makeWave(data, comp, 123, 4).spawns);
  const differs = [1, 2, 3, 4, 5].some((s) => JSON.stringify(makeWave(data, comp, s, 4).spawns) !== JSON.stringify(makeWave(data, comp, 999, 4).spawns));
  assert.ok(differs);
  assert.deepEqual(genFloor(data.balance, data.enemies, data.obstacles, 7, 0), genFloor(data.balance, data.enemies, data.obstacles, 7));
});

test('makeWave: 보스 HP x bossHpMul', () => {
  const n = [...Array(40)].map((_, i) => i + 1).find((k) => waveFloor(comp, k) % 10 === 0);
  const full = makeWave(data, { ...comp, endless: { ...comp.endless, bossHpMul: 1 } }, 5, n).spawns.find((s) => s.rank === 'boss');
  const cut = makeWave(data, comp, 5, n).spawns.find((s) => s.rank === 'boss');
  assert.equal(cut.hp, Math.round(full.hp * comp.endless.bossHpMul));
});

const towers = [{ id: 'tower_red', color: 'red', stats: { attack: 10 } }];
const battleConfig = { cascadeBonusPerStep: 0.5, minDamage: 1, attackIntervalSec: 1, effectDurationsMs: {} };
const stat = (hp = 1) => ({ type: 'goblin', rank: 'normal', hp, def: 0, speed: 0.01, wallDmg: 1, gold: 1 });

test('BattleState nextWave: 다 소환하고 waveGapSec 뒤 다음 웨이브를 이어 붙임, 클리어 없음, 성벽 회복 + waveStart(회복 전 비율)', () => {
  const calls = [];
  const bs = new BattleState({
    towersData: towers,
    battleConfig,
    resolvedFloor: { wallHp: 100, interval: 1, spawnAt: [0], spawns: [stat()], waveGapSec: 2, nextWave: (n) => (calls.push(n), { spawns: [stat(), stat()], spawnAt: [0, 1], healPct: 0.1 }) },
  });
  bs.wallHealth = 50;
  bs.update(0.5); // 1웨이브 소환
  assert.equal(bs.enemies.length, 1);
  bs.applyGemClear('red', 3, 1);
  bs.update(0.5);
  assert.equal(bs.status, 'active'); // 다 죽여도 클리어 아님
  assert.equal(calls.length, 0); // 아직 gap 안 지남
  bs.update(1.5);
  assert.deepEqual(calls, [2]);
  assert.equal(bs.wave, 2);
  assert.equal(bs.wallHealth, 60);
  assert.equal(bs.events.find((e) => e.type === 'waveStart').wallRatio, 0.5);
  assert.equal(bs.totalEnemies, 3);
});

test('endlessFloor: 1웨이브 + 생성기, 성벽 = 1웨이브 난이도 층 성벽', () => {
  const { floor, resolved } = endlessFloor(data, comp, 77, { emptySpawn: 'off' });
  assert.equal(floor.floor, comp.endless.startFloor);
  assert.equal(resolved.wallHp, floor.wallHp);
  assert.equal(resolved.emptySpawn, 'off');
  assert.equal(resolved.nextWave(2).spawns.length > 0, true);
});

test('점수 = 웨이브 x 1000 + 처치 점수 + 웨이브마다 남은 성벽 비율 x 100', () => {
  const s = createScore(comp, data.enemies);
  const grunt = Object.keys(data.enemies.monsters).find((m) => data.enemies.monsters[m].role === 'grunt');
  s.onKill(grunt, 'normal');
  s.onKill(grunt, 'elite');
  s.onKill('anything', 'boss');
  s.onWave(2, 0.5);
  s.onWave(3, 1.2); // 1로 자름
  const k = comp.score.killPoints;
  assert.equal(s.total, 3 * 1000 + k.grunt + k.grunt * comp.score.eliteMul + k.boss + 50 + 100);
  assert.equal(killPoints(comp, data.enemies, 'nope', 'normal'), 0);
});

test('입력 기록: ms 시각, MAX_INPUTS에서 자르고 truncated', () => {
  const l = createInputLog(9);
  l.add('s', 1.2345, [0, 1, 0, 2]);
  l.add('i', 2, ['hammer', { row: 1, col: 2 }]);
  assert.deepEqual(l.log.s[0], [1235, 0, 1, 0, 2]);
  assert.deepEqual(l.log.i[0], [2000, 'hammer', { row: 1, col: 2 }]);
  for (let i = 0; i < MAX_INPUTS + 5; i++) l.add('s', i, [0, 0, 0, 1]);
  assert.equal(l.log.s.length + l.log.i.length, MAX_INPUTS);
  assert.equal(l.log.truncated, true);
  assert.ok(JSON.stringify(l.log).length < 64 * 1024); // 서버 LOG_MAX
});

test('서버 점수 상한 표(comp_limits.json)가 지금 config로 만든 표와 같다 - 다르면 node tools/gen_comp_limits.mjs', () => {
  const file = load('server/supabase/functions/_shared/comp_limits.json').cum;
  assert.deepEqual(file.slice(0, 15), buildLimits(15).cum);
  assert.equal(file.length, 200);
});

test('compLock: compUnlocked가 false면 층·연결과 상관없이 잠김, true면 층 -> 연결 순으로 본다(메뉴 버튼·랭킹 탭 공통)', () => {
  const cfg = load('config/ranking.json');
  assert.equal(cfg.compUnlocked, false, '출시 전 - 지금 설정은 잠김');
  const floor = cfg.comp.unlockBestFloor;
  assert.deepEqual(compLock(cfg, 999, true), { hint: 'comp.soon', params: null });
  assert.deepEqual(compLock(null, 999, true), { hint: 'comp.soon', params: null });
  const on = { ...cfg, compUnlocked: true };
  assert.deepEqual(compLock(on, floor - 1, true), { hint: 'comp.lockedFloor', params: { floor } });
  assert.deepEqual(compLock(on, floor, false), { hint: 'comp.offline', params: null });
  assert.equal(compLock(on, floor, true), null);
  // 문구 키는 ko/en에 다 있다.
  return Promise.all([import('../src/config/locales/ko.js'), import('../src/config/locales/en.js')]).then(([{ ko }, { en }]) => {
    for (const d of [ko, en]) for (const k of ['soon', 'lockedFloor', 'offline']) assert.ok(d.comp[k], k);
  });
});
