// src/core/balance/floorGen.js 테스트. tools/gen_floors.py의 JS 포트이므로 1~100층은
// config/floors.json과 완전히 같아야 한다(둘 다 같은 balance/enemies/obstacles.json을
// 입력으로 함). 101층 이후는 getFloor()가 genFloor()로 즉석 생성하는지만 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { genFloor, getFloor, unitStats, resolveFloorSpawns } from '../src/core/balance/floorGen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CFG = join(__dirname, '..', 'config');
const load = (name) => JSON.parse(readFileSync(join(CFG, name), 'utf8'));

const B = load('balance.json');
const E = load('enemies.json');
const O = load('obstacles.json');
const floorsData = load('floors.json');

test('genFloor: 1~100층이 config/floors.json과 완전히 같다(deep equal)', () => {
  for (let f = 1; f <= 100; f++) {
    assert.deepEqual(genFloor(B, E, O, f), floorsData.floors[f - 1], `floor ${f} mismatch`);
  }
});

test('getFloor: 1~100층은 floors.json 캐시를, 101층 이후는 genFloor로 즉석 생성한 값을 돌려준다', () => {
  assert.deepEqual(getFloor(B, E, O, floorsData, 42), floorsData.floors[41]);
  assert.deepEqual(getFloor(B, E, O, floorsData, 101), genFloor(B, E, O, 101));
  assert.equal(getFloor(B, E, O, floorsData, 150).floor, 150);
});

test('unitStats: 1층 민달팽이(grunt 역할, 배율 전부 1)', () => {
  const floor = getFloor(B, E, O, floorsData, 1);
  assert.deepEqual(unitStats(B, E, floor, 'slug'), {
    type: 'slug',
    rank: 'normal',
    hp: 30,
    def: 0,
    speed: 1 / 20,
    wallDmg: 8,
    gold: 2,
  });
});

test('unitStats: 10층 보스(거대 버섯) - 종류와 무관하게 bossMul 기준', () => {
  const floor = getFloor(B, E, O, floorsData, 10);
  const boss = unitStats(B, E, floor, 'large_mushroom@boss');
  assert.equal(boss.rank, 'boss');
  assert.equal(boss.hp, 783); // 600 * hpMul(1.3048) 반올림
  assert.equal(boss.def, 1); // defAdd(0) + bossMul.def(1)
  assert.equal(boss.wallDmg, 50); // 40 * wallDmgMul(1.2489) 반올림
  assert.equal(boss.gold, 85); // 60 * goldMul(1.4233) 반올림
});

test('unitStats: 엘리트(brute 역할) - HP x4, 성벽공격 x2, 방어 +1, 속도 x0.9, 골드 x5', () => {
  const floor = getFloor(B, E, O, floorsData, 1); // 배율 전부 1이라 역할 스탯을 그대로 검증
  const elite = unitStats(B, E, floor, 'muddy@elite');
  assert.equal(elite.rank, 'elite');
  assert.equal(elite.hp, 300); // 75 * 4
  assert.equal(elite.def, 2); // brute.def(1) + defAdd(0) + eliteMul.def(1)
  assert.equal(elite.wallDmg, 30); // 15 * 2
  assert.equal(elite.speed, (1 / 19) * 0.9);
  assert.equal(elite.gold, 25); // 5 * 5
});

test('resolveFloorSpawns: 소환 문자열을 이름/애니메이션이 붙은 스탯 객체로 바꾼다', () => {
  const floor = getFloor(B, E, O, floorsData, 10); // 보스층, 마지막 소환이 보스로 끝난다.
  const resolved = resolveFloorSpawns(B, E, floor);
  assert.equal(resolved.length, floor.spawns.length);
  const boss = resolved[resolved.length - 1];
  assert.equal(boss.rank, 'boss');
  assert.equal(boss.name, E.monsters.large_mushroom.name);
  assert.deepEqual(boss.anim, E.monsters.large_mushroom.anim);
});
