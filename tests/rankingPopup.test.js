// 랭킹 팝업 배치(docs/ranking.md 3장, 목업 시안 1): 보관함과 같은 틀, 팝업 안·안 겹침, 터치 44px, 목록(단상·구분 줄·스크롤), 판정.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutRankingPopup, hitRankingPopup, scrollToMeValue, stonePixels } from '../src/render/ui/rankingPopup.js';

const CFG = JSON.parse(readFileSync(new URL('../config/ranking.json', import.meta.url), 'utf8'));
const within = (r, o) => r.x >= o.x && r.y >= o.y && r.x + r.width <= o.x + o.width && r.y + r.height <= o.y + o.height;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const tierOf = (rank) => (rank <= 3 ? `r${rank}` : rank <= 10 ? 'r10' : rank <= 50 ? 'r50' : 'p10');
const entries = Array.from({ length: 100 }, (_, i) => ({ rank: i + 1, value: 1000 - i, tierId: tierOf(i + 1), me: i === 41 }));

for (const [w, h] of [[540, 960], [540, 1170]]) {
  for (const tab of ['normal', 'comp']) {
    for (const compState of ['normal', 'settle', 'locked', 'none']) {
      if (tab === 'normal' && compState !== 'normal') continue;
      test(`${w}x${h} ${tab}/${compState}: 팝업 안, 안 겹침, 터치 44`, () => {
        const L = layoutRankingPopup(w, h, { tab, compState, entries });
        assert.deepEqual([L.sheet.x, L.sheet.y, L.sheet.width, L.sheet.y + L.sheet.height], [12, 96, 516, h - 48]);
        const parts = [L.title, L.tabs.normal, L.tabs.comp, L.close, L.body];
        parts.forEach((r, i) => {
          assert.ok(within(r, L.sheet), `${i} 밖`);
          parts.slice(i + 1).forEach((o, j) => assert.ok(!overlaps(r, o), `${i}-${i + 1 + j} 겹침`));
        });
        const inner = [L.last, L.season, L.tierRow, L.settle, L.list, L.mine].filter(Boolean);
        inner.forEach((r, i) => {
          assert.ok(within(r, L.content), `inner ${i} 밖`);
          inner.slice(i + 1).forEach((o) => assert.ok(!overlaps(r, o), `inner ${i} 겹침`));
        });
        for (const r of [L.close, L.tabs.normal, L.edit, L.rewardsBtn, L.last, L.goComp].filter(Boolean)) assert.ok(r.height >= 44 && r.width >= 44, JSON.stringify(r));
        assert.ok(within(L.edit, L.mine) && within(L.goComp, L.mine));
        assert.ok(L.list.height >= 120, '목록이 너무 작음');
        assert.equal(!!L.settle, tab === 'comp' && compState === 'settle');
        assert.equal(!!L.lockCover, tab === 'comp' && compState === 'locked');
      });
    }
  }
}

test('목록: 단상 1개 + 4~100위 줄, 경쟁 탭은 구간이 바뀔 때만 구분 줄(4~10위부터)', () => {
  const n = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', entries }).items;
  assert.equal(n[0].kind, 'podium');
  assert.equal(n.filter((i) => i.kind === 'row').length, 97);
  assert.equal(n.filter((i) => i.kind === 'divider').length, 0);
  const c = layoutRankingPopup(540, 960, { tab: 'comp', compState: 'normal', entries }).items;
  assert.deepEqual(c.filter((i) => i.kind === 'divider').map((i) => i.tierId), ['r10', 'r50', 'p10']);
  assert.equal(c[1].kind, 'divider');
  for (let i = 1; i < c.length; i++) assert.ok(c[i].y >= c[i - 1].y + c[i - 1].h, '겹침 없음');
});

test('내 줄로 스크롤: 내 줄이 목록 가운데, 목록에 없으면 맨 아래', () => {
  const L = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', entries });
  const me = L.items.find((i) => i.entry?.me);
  const s = scrollToMeValue(L);
  assert.ok(Math.abs(me.y + me.h / 2 - s - L.list.height / 2) <= 1);
  const L2 = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', entries: entries.map((e) => ({ ...e, me: false })) });
  assert.equal(scrollToMeValue(L2), L2.scrollMax);
});

test('판정: 탭·닫기·잠김 덮개는 목록을 막음·작은 팝업은 바깥 탭', () => {
  const st = { sheet: true, tab: 'comp', compState: 'locked', entries };
  const L = layoutRankingPopup(540, 960, st);
  const at = (r) => [r.x + r.width / 2, r.y + r.height / 2];
  assert.equal(hitRankingPopup(L, ...at(L.tabs.normal), st).tab, 'normal');
  assert.equal(hitRankingPopup(L, ...at(L.close), st).type, 'close');
  assert.equal(hitRankingPopup(L, ...at(L.rewardsBtn), st).type, 'rewards');
  assert.equal(hitRankingPopup(L, ...at(L.list), st).type, 'none');
  const open = { ...st, compState: 'normal' };
  const L1 = layoutRankingPopup(540, 960, open);
  assert.equal(hitRankingPopup(L1, ...at(L1.list), open).type, 'list');
  assert.equal(hitRankingPopup(L1, ...at(L1.edit), open).type, 'edit');
  assert.equal(hitRankingPopup(L1, L1.mine.x + 20, L1.mine.y + 20, open).type, 'mine');
  for (const sub of ['rewards', 'history', 'nick']) {
    const s2 = { ...open, sub, tiers: CFG.tiers, history: [] };
    const L2 = layoutRankingPopup(540, 960, s2);
    assert.ok(within(L2.sub.card, { x: 0, y: 0, width: 540, height: 960 }), sub);
    assert.equal(hitRankingPopup(L2, 5, 5, s2).type, 'subOutside');
    if (L2.sub.close) assert.equal(hitRankingPopup(L2, ...at(L2.sub.close), s2).type, 'subClose');
  }
  const n = { ...open, sub: 'nick' };
  const Ln = layoutRankingPopup(540, 960, n);
  assert.equal(hitRankingPopup(Ln, ...at(Ln.sub.picks[3].rect), n).statue, 'green');
  assert.equal(hitRankingPopup(Ln, ...at(Ln.sub.save), n).type, 'saveNick');
});

test('석상 색 변환: 외곽선·네온은 그대로, 나머지는 밝기로 3단 돌색, 투명은 안 건드림', () => {
  const NEON = Object.values(JSON.parse(readFileSync(new URL('../assets/statues/manifest.json', import.meta.url), 'utf8')).neon).flat();
  assert.equal(NEON.length, 10);
  const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  const keep = new Set(['#0d0a10', ...NEON].map((h) => parseInt(h.slice(1), 16)));
  const src = ['#0d0a10', ...NEON, '#200000', '#741426', '#ec6a6a', '#f2d264'];
  const d = new Uint8ClampedArray([...src.flatMap((h) => [...rgb(h), 255]), 9, 9, 9, 0]);
  stonePixels(d, keep);
  const out = [];
  for (let i = 0; i < d.length; i += 4) out.push('#' + [d[i], d[i + 1], d[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join(''));
  // 밝기: #200000 = 9.6(<40), #741426 = 50.8(<110), #ec6a6a = 145, #f2d264 = 207
  assert.deepEqual(out.slice(0, 15), ['#0d0a10', ...NEON, '#3b3347', '#655a74', '#e8dcc0', '#e8dcc0']);
  assert.deepEqual([...d.slice(-4)], [9, 9, 9, 0]);
});
