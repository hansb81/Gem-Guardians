// 정령 탭(src/render/ui/spiritTab.js) - 목록 스크롤·끌기, 공명 무대 빛, 초상 가운데 정렬.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newSpiritSel, cycleFilter, resetFilter, listMaxScroll, scrollList, dragList, stageGlowName, portraitOffset, CELL_W, CELL_H, DRAG_PX } from '../src/render/ui/spiritTab.js';
import { alphaBBox } from '../src/render/spiritSprite.js';

test('스크롤 범위 = 0 ~ (내용 높이 - 보이는 높이)', () => {
  assert.equal(listMaxScroll(30, 300), 6 * 92 + 5 * 6 - 300); // 30칸 = 6줄
  assert.equal(listMaxScroll(5, 300), 0, '한 줄은 안 넘친다');
  assert.equal(listMaxScroll(6, 150), 2 * 92 + 6 - 150);
  assert.equal(listMaxScroll(0, 300), 0);
  const sel = newSpiritSel();
  sel.maxScroll = 282;
  scrollList(sel, 9999);
  assert.equal(sel.scroll, 282);
  scrollList(sel, -50);
  assert.equal(sel.scroll, 0);
});

test('필터를 바꾸면 스크롤 0', () => {
  const sel = newSpiritSel();
  sel.maxScroll = 282;
  sel.scroll = 120;
  cycleFilter(sel, 'element');
  assert.equal(sel.scroll, 0);
  sel.scroll = 80;
  resetFilter(sel, 'element');
  assert.equal(sel.scroll, 0);
});

test('끌기: 8px 미만 = 터치 그대로, 8px 이상 = 스크롤(터치 취소)', () => {
  assert.equal(DRAG_PX, 8);
  const sel = newSpiritSel();
  sel.maxScroll = 282;
  sel.scroll = 100;
  const drag = { y: 400, startScroll: 100, moved: false, id: 'fire_wisp' };
  dragList(sel, drag, 393);
  assert.equal(drag.moved, false);
  assert.equal(sel.scroll, 100, '7px는 안 움직인다');
  dragList(sel, drag, 392);
  assert.equal(drag.moved, true);
  assert.equal(sel.scroll, 108);
  dragList(sel, drag, 399); // 되돌아와도 터치로 안 돌아간다
  assert.equal(drag.moved, true);
  assert.equal(sel.scroll, 101);
  dragList(sel, drag, 900);
  assert.equal(sel.scroll, 0, '범위 안에서만');
});

test('무대 빛: 정령 속성 = 수호자 색이면 _res 시트', () => {
  assert.equal(stageGlowName('red', 'red'), 'spirit_stage_glow_red_res');
  assert.equal(stageGlowName('red', 'blue'), 'spirit_stage_glow_red');
  assert.equal(stageGlowName('blue', undefined), 'spirit_stage_glow_blue', '빈 칸');
});

test('초상은 그려진 픽셀의 경계 상자가 칸 한가운데(x2)', () => {
  assert.deepEqual([CELL_W, CELL_H], [86, 92]);
  // 24x24 칸을 꽉 채운 초상 = 칸 가운데 그대로.
  assert.deepEqual(portraitOffset({ x: 0, y: 0, w: 24, h: 24 }), { x: 19, y: 22 });
  // 왼쪽 위에 치우친 10x12 그림: 경계 상자 왼쪽 위 = (33, 34) -> 양쪽 여백 33/33, 34/34.
  const off = portraitOffset({ x: 2, y: 3, w: 10, h: 12 });
  assert.deepEqual(off, { x: 29, y: 28 });
  assert.equal(off.x + 2 * 2, (86 - 10 * 2) / 2);
  assert.equal(off.y + 3 * 2, (92 - 12 * 2) / 2);
});

test('alphaBBox: 시트 안 한 칸의 투명 아닌 픽셀 경계', () => {
  const W = 8;
  const data = new Uint8ClampedArray(W * 4 * 4);
  const put = (x, y) => (data[(y * W + x) * 4 + 3] = 255);
  put(1, 0); // 왼쪽 칸(0~3) - 무시돼야 한다
  put(5, 1);
  put(6, 3);
  assert.deepEqual(alphaBBox(data, W, 4, 0, 4, 4), { x: 1, y: 1, w: 2, h: 3 });
  assert.deepEqual(alphaBBox(new Uint8ClampedArray(W * 4 * 4), W, 4, 0, 4, 4), { x: 0, y: 0, w: 4, h: 4 }, '빈 칸 = 칸 전체');
});
