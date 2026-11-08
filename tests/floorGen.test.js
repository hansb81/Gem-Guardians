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

// 아래 세 테스트는 수치를 박지 않고 balance/enemies.json에서 계산한다(밸런스를 바꿀 때마다 깨지지 않게).
// 검증 대상은 공식(역할 스탯 x 층 배율 x 엘리트/보스 배율 x enemyHpMul)이다.
const hpMulAll = B.scaling.enemyHpMul ?? 1;

test('unitStats: 1층 민달팽이(grunt 역할, 층 배율 전부 1)', () => {
  const floor = getFloor(B, E, O, floorsData, 1);
  const role = E.roles[E.monsters.slug.role];
  assert.deepEqual(unitStats(B, E, floor, 'slug'), {
    type: 'slug',
    rank: 'normal',
    hp: Math.round(role.hp * hpMulAll),
    def: role.def,
    speed: 1 / role.travelTime,
    wallDmg: role.wallDmg,
    gold: role.gold,
  });
});

test('unitStats: 10층 보스(거대 버섯) - 종류와 무관하게 bossMul 기준', () => {
  const floor = getFloor(B, E, O, floorsData, 10);
  const boss = unitStats(B, E, floor, 'large_mushroom@boss');
  const mul = B.floorShape.bossMul;
  assert.equal(boss.rank, 'boss');
  assert.equal(boss.hp, Math.round(mul.hpBase * floor.scaling.hpMul * (mul.hpMulByFloor?.['10'] ?? 1) * hpMulAll));
  assert.equal(boss.def, floor.scaling.defAdd + mul.def);
  assert.equal(boss.wallDmg, Math.round(mul.wallDmgBase * floor.scaling.wallDmgMul));
  assert.equal(boss.gold, Math.round(mul.goldBase * floor.scaling.goldMul));
});

test('unitStats: 엘리트(brute 역할) - eliteMul(HP x4, 성벽공격 x2, 방어 +1, 속도 x0.9, 골드 x5)', () => {
  const floor = getFloor(B, E, O, floorsData, 1); // 층 배율 전부 1이라 역할 스탯 x eliteMul을 그대로 검증
  const elite = unitStats(B, E, floor, 'muddy@elite');
  const role = E.roles[E.monsters.muddy.role];
  const mul = B.floorShape.eliteMul;
  assert.equal(elite.rank, 'elite');
  assert.equal(elite.hp, Math.round(role.hp * mul.hp * hpMulAll));
  assert.equal(elite.def, role.def + mul.def);
  assert.equal(elite.wallDmg, Math.round(role.wallDmg * mul.wallDmg));
  assert.equal(elite.speed, (1 / role.travelTime) * mul.speed);
  assert.equal(elite.gold, Math.round(role.gold * mul.gold));
});

test('resolveFloorSpawns: 소환 문자열을 이름/애니메이션이 붙은 스탯 객체로 바꾼다', () => {
  const floor = getFloor(B, E, O, floorsData, 10); // 보스층, 마지막 소환이 보스로 끝난다.
  const resolved = resolveFloorSpawns(B, E, floor);
  assert.equal(resolved.length, floor.spawns.length);
  const boss = resolved[resolved.length - 1];
  assert.equal(boss.rank, 'boss');
  assert.equal(boss.name, E.monsters.large_mushroom.name);
  assert.deepEqual(boss.anim, E.monsters.large_mushroom.anim);
  // docs/skills.md 3장 거대 버섯: 면역 없음, 약점 레드. 일반 적은 기본값(빈 배열).
  assert.deepEqual([boss.immune, boss.weak, boss.knockbackImmune], [[], ['red'], false]);
  assert.deepEqual(resolved[0].immune, []);
});
