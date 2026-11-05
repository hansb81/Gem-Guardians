// src/render/layeredBg.js의 순수 계산부 테스트. 타이틀과 메뉴의 실제 manifest.json을 읽어
// README v2의 규칙(200ms/프레임, 32프레임=6.4초 끊김 없는 반복, 입자 공식)대로 나오는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pieceSrcPos, dustMote, waterDropY, spark } from '../src/render/layeredBg.js';

const load = (name) => JSON.parse(readFileSync(new URL(`../assets/${name}/manifest.json`, import.meta.url))).background;
const bg = load('title');
const menuBg = load('menu');
const piece = (file) => bg.pieces.find((p) => p.file === file);
const at = (p, now) => pieceSrcPos(p, now, bg.frameMs, bg.loopFrames);

test('pieceSrcPos: 시트 좌표가 열 수대로 감기고 loopMs마다 처음으로 돌아온다', () => {
  const p00 = piece('title_p00.png'); // 83x147, 6열 32프레임
  assert.deepEqual(at(p00, 0), { sx: 0, sy: 0 });
  assert.deepEqual(at(p00, 1400), { sx: 83, sy: 147 }); // f=7 -> (1행, 1열)
  assert.deepEqual(at(p00, bg.loopMs), at(p00, 0));
  assert.deepEqual(at(p00, bg.loopMs * 3 + 1400), at(p00, 1400));

  // 조각마다 프레임 수가 달라도(p03은 2프레임) 32프레임 루프 안에서 seq를 되풀이한다.
  const p03 = piece('title_p03.png');
  assert.deepEqual(at(p03, 200), { sx: 2, sy: 0 });
  assert.deepEqual(at(p03, 400), at(p03, 0));
});

// 메뉴 조각은 frames(18, 31)와 periodFrames(32)가 달라 seq가 프레임을 되쓴다 - 둘 다 확인한다.
test('pieceSrcPos: 타이틀/메뉴 모든 조각의 모든 프레임이 시트 안에 들어온다', () => {
  for (const b of [bg, menuBg]) {
    for (const p of b.pieces) {
      const rows = Math.ceil(p.frames / p.cols);
      for (let now = 0; now < b.loopMs; now += b.frameMs) {
        const { sx, sy } = pieceSrcPos(p, now, b.frameMs, b.loopFrames);
        assert.ok(sx >= 0 && sx + p.w <= p.cols * p.w, `${p.file} sx=${sx}`);
        assert.ok(sy >= 0 && sy + p.h <= rows * p.h, `${p.file} sy=${sy}`);
      }
      assert.deepEqual(pieceSrcPos(p, b.loopMs, b.frameMs, b.loopFrames), pieceSrcPos(p, 0, b.frameMs, b.loopFrames), p.file);
    }
  }
});

test('spark: 원석 균열 위에서 올라가고 6.4초마다 같은 상태로 돌아온다', () => {
  const sparks = menuBg.particles.find((g) => g.name === 'sparks').rule.items;
  for (const item of sparks) {
    assert.deepEqual(spark(item, menuBg.loopMs), spark(item, 0), 'loop');
    for (let t = 0; t < menuBg.loopMs; t += 40) {
      const { x, y } = spark(item, t);
      assert.ok(x >= 81 && x <= 99, `x=${x}`); // 90 +- amp(최대 8.818)
      assert.ok(y >= 82 && y <= 146, `y=${y}`); // cy(134+-2) + 10에서 60px 위까지
    }
  }
});

test('dustMote: 문빛 안에서 올라가고 6.4초마다 같은 상태로 돌아온다', () => {
  const motes = bg.particles.find((g) => g.name === 'dust_motes').rule.items;
  for (const m of motes) {
    assert.deepEqual(dustMote(m, bg.loopMs), dustMote(m, 0), 'loop');
    for (let t = 0; t < bg.loopMs; t += 40) {
      const { x, y } = dustMote(m, t);
      assert.ok(x >= 74 && x <= 106, `x=${x}`); // 90 +- amp(최대 15.772)
      assert.ok(y >= 140 && y <= 236, `y=${y}`); // 236에서 96px 위까지
    }
  }
  // 깜빡임은 4칸 중 1칸만 꺼진다(160ms 단위).
  const first = motes[0];
  const off = [0, 1, 2, 3].filter((i) => !dustMote(first, i * 160).visible);
  assert.deepEqual(off, [0]);
});

test('waterDropY: 천장 틈에서 1.6초 주기로 떨어진다', () => {
  for (const d of bg.particles.find((g) => g.name === 'water_drops').rule.items) {
    assert.equal(waterDropY(d, 1600), waterDropY(d, 0));
    for (let t = 0; t < 1600; t += 20) {
      const y = waterDropY(d, t);
      assert.ok(y >= 100 && y <= 269, `y=${y}`);
    }
    assert.ok(waterDropY(d, 0) < waterDropY(d, 800) || waterDropY(d, 800) < waterDropY(d, 1500));
  }
});
