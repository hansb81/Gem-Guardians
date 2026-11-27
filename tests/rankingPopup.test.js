// 랭킹 팝업 배치(docs/ranking.md 3장): 보관함과 같은 틀, 팝업 안·안 겹침, 터치 44px, 명예의 전당(1~3위) +
// 참가자 수에 따라 내 기록 카드(cardModeBelow 미만) 또는 4위부터 목록, 판정.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutRankingPopup, hitRankingPopup, scrollToMeValue, stonePixels, isCardMode } from '../src/render/ui/rankingPopup.js';
import { cardMetal } from '../src/ranking/tiers.js';

const CFG = JSON.parse(readFileSync(new URL('../config/ranking.json', import.meta.url), 'utf8'));
const within = (r, o) => r.x >= o.x && r.y >= o.y && r.x + r.width <= o.x + o.width && r.y + r.height <= o.y + o.height;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const tierOf = (rank) => (rank <= 3 ? `r${rank}` : rank <= 10 ? 'r10' : rank <= 50 ? 'r50' : 'p10');
const entries = Array.from({ length: 100 }, (_, i) => ({ rank: i + 1, value: 1000 - i, tierId: tierOf(i + 1), me: i === 41 }));
const board = (n) => ({ entries: entries.slice(0, n), total: n, cardBelow: CFG.cardModeBelow });
const at = (r) => [r.x + r.width / 2, r.y + r.height / 2];

for (const [w, h] of [[540, 960], [540, 1170]]) {
  for (const tab of ['normal', 'comp']) {
    for (const compState of ['normal', 'settle', 'locked', 'none']) {
      if (tab === 'normal' && compState !== 'normal') continue;
      for (const n of [3, 100]) {
        test(`${w}x${h} ${tab}/${compState} ${n}명: 팝업 안, 안 겹침, 터치 44`, () => {
          const L = layoutRankingPopup(w, h, { tab, compState, ...board(n) });
          assert.deepEqual([L.sheet.x, L.sheet.y, L.sheet.width, L.sheet.y + L.sheet.height], [12, 96, 516, h - 48]);
          const parts = [L.title, L.tabs.normal, L.tabs.comp, L.close, L.body];
          parts.forEach((r, i) => {
            assert.ok(within(r, L.sheet), `${i} 밖`);
            parts.slice(i + 1).forEach((o, j) => assert.ok(!overlaps(r, o), `${i}-${i + 1 + j} 겹침`));
          });
          const inner = [L.band, L.settle, L.hall, L.list, L.mine].filter(Boolean);
          inner.forEach((r, i) => {
            assert.ok(within(r, L.body), `inner ${i} 밖`);
            inner.slice(i + 1).forEach((o) => assert.ok(!overlaps(r, o), `inner ${i} 겹침`));
          });
          for (const r of [L.close, L.tabs.normal, L.edit, L.rewardsBtn, L.goComp].filter(Boolean)) assert.ok(r.height >= 44 && r.width >= 44, JSON.stringify(r));
          // 전당은 x3 그대로(450x288) - 세로가 모자라도 줄이지 않고 아래 칸이 스크롤한다.
          assert.deepEqual([L.hall.x, L.hall.width, L.hall.height], [45, 450, 288]);
          assert.equal(L.cardMode, n < 10);
          assert.equal(!!L.mine, n >= 10, '카드 모드엔 고정 내 줄 없음');
          if (L.mine) assert.ok(within(L.edit, L.mine) && within(L.goComp, L.mine));
          assert.ok(L.list.height >= 120, '전당 아래 칸이 너무 작음');
          assert.equal(!!L.settle, tab === 'comp' && compState === 'settle');
          assert.equal(!!L.lockCover, tab === 'comp' && compState === 'locked');
          if (L.lockCover) assert.equal(L.lockCover.y, L.hall.y, '잠김 덮개는 전당부터');
        });
      }
    }
  }
}

test('일반 탭 540x960: 전당 (45,230), 카드·목록은 y 534부터', () => {
  const L = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', ...board(3) });
  assert.deepEqual([L.hall.x, L.hall.y, L.list.y], [45, 230, 534]);
  assert.equal(L.scrollMax, 0, '카드 + 끝 줄이 다 들어감');
});

test('참가자 수 경계: 9명 = 카드, 10명 = 목록, 탭마다 따로 센다, 수를 모르면 목록', () => {
  assert.equal(isCardMode(9, 10), true);
  assert.equal(isCardMode(10, 10), false);
  assert.equal(isCardMode(0, 10), true);
  assert.equal(isCardMode(null, 10), false);
  const k9 = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', ...board(9) });
  assert.deepEqual(k9.items.map((i) => i.kind), ['card', 'foot']);
  const k10 = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', ...board(10) });
  assert.equal(k10.cardMode, false);
  assert.equal(k10.items.filter((i) => i.kind === 'row').length, 7, '4~10위');
  // 탭마다: 그 탭의 total만 본다(rankingUi.view가 탭 데이터에서 넣는다).
  const data = { normal: board(30), comp: board(4) };
  assert.equal(layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', ...data.normal }).cardMode, false);
  assert.equal(layoutRankingPopup(540, 960, { tab: 'comp', compState: 'normal', ...data.comp }).cardMode, true);
  // 순위표를 못 받았으면 전당·카드 없이 안내만, 내 줄은 그대로.
  const off = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', entries: [], total: null, unavailable: true });
  assert.ok(!off.hall && !off.cardMode && off.mine && off.items[0].kind === 'offline');
});

test('1~3위 빈 자리: 사람이 모자라도 전당은 그대로, 목록 줄은 4위부터만', () => {
  for (const n of [0, 1, 2]) {
    const L = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', ...board(n) });
    assert.ok(L.hall && L.cardMode, `${n}명`);
    assert.equal(L.items.filter((i) => i.kind === 'row').length, 0);
  }
});

test('카드 금속: 일반 = 1 금 / 2 은 / 3 청동 / 그 밖·순위 없음 철, 경쟁 = 메뉴 왕관 구간', () => {
  const bands = CFG.crown.bands;
  assert.deepEqual([1, 2, 3, 4, 9].map((rank) => cardMetal('normal', { rank, total: 9 }, bands)), ['gold', 'silver', 'bronze', 'iron', 'iron']);
  assert.equal(cardMetal('normal', null, bands), 'iron');
  assert.equal(cardMetal('normal', { rank: null }, bands), 'iron');
  // 경쟁: 상위 1% 금 / 10% 은 / 50% 동(경계 포함) - 100명 기준 1위 금, 10위 은, 50위 동, 51위 철.
  assert.deepEqual([1, 10, 50, 51].map((rank) => cardMetal('comp', { rank, total: 100 }, bands)), ['gold', 'silver', 'bronze', 'iron']);
  assert.equal(cardMetal('comp', null, bands), 'iron');
});

test('목록: 4~100위 줄, 경쟁 탭은 구간이 바뀔 때만 구분 줄(4~10위부터)', () => {
  const n = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', ...board(100) }).items;
  assert.equal(n[0].kind, 'row');
  assert.equal(n[0].entry.rank, 4);
  assert.equal(n.filter((i) => i.kind === 'row').length, 97);
  assert.equal(n.filter((i) => i.kind === 'divider').length, 0);
  const c = layoutRankingPopup(540, 960, { tab: 'comp', compState: 'normal', ...board(100) }).items;
  assert.deepEqual(c.filter((i) => i.kind === 'divider').map((i) => i.tierId), ['r10', 'r50', 'p10']);
  assert.equal(c[0].kind, 'divider');
  for (let i = 1; i < c.length; i++) assert.ok(c[i].y >= c[i - 1].y + c[i - 1].h, '겹침 없음');
});

test('내 줄로 스크롤: 내 줄이 목록 가운데, 목록에 없으면 맨 아래', () => {
  const L = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', ...board(100) });
  const me = L.items.find((i) => i.entry?.me);
  const s = scrollToMeValue(L);
  assert.ok(Math.abs(me.y + me.h / 2 - s - L.list.height / 2) <= 1);
  const L2 = layoutRankingPopup(540, 960, { tab: 'normal', compState: 'normal', entries: entries.map((e) => ({ ...e, me: false })), total: 100 });
  assert.equal(scrollToMeValue(L2), L2.scrollMax);
});

test('판정: 탭·닫기·잠김 덮개는 목록을 막음·작은 팝업은 바깥 탭', () => {
  const st = { sheet: true, tab: 'comp', compState: 'locked', ...board(100) };
  const L = layoutRankingPopup(540, 960, st);
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
  // 지난 시즌 기록은 보상 보기 안의 한 줄 -> 최근 8주.
  const rw = { ...open, sub: 'rewards', tiers: CFG.tiers, history: [] };
  const Lr = layoutRankingPopup(540, 960, rw);
  assert.ok(Lr.sub.last.height >= 44 && !overlaps(Lr.sub.last, Lr.sub.rows[0]));
  assert.equal(hitRankingPopup(Lr, ...at(Lr.sub.last), rw).type, 'history');
  const n = { ...open, sub: 'nick' };
  const Ln = layoutRankingPopup(540, 960, n);
  assert.equal(hitRankingPopup(Ln, ...at(Ln.sub.picks[3].rect), n).statue, 'green');
  assert.equal(hitRankingPopup(Ln, ...at(Ln.sub.save), n).type, 'saveNick');
});

test('카드 판정: 도전 버튼·이름(닉네임 바꾸기), 스크롤하면 같이 움직임, 잠김이면 덮개가 막음', () => {
  const st = { sheet: true, tab: 'normal', compState: 'normal', scroll: 0, ...board(3) };
  const L = layoutRankingPopup(540, 960, st);
  // 시안 좌표: 카드 (50,534), 버튼 280x48, 이름은 방패 오른쪽.
  assert.equal(hitRankingPopup(L, 340, 534 + 190, st).type, 'challenge');
  assert.equal(hitRankingPopup(L, 260, 534 + 39, st).type, 'edit');
  assert.equal(hitRankingPopup(L, 100, 534 + 80, st).type, 'list', '방패 = 아무 일 없음(끌기)');
  // 경쟁 탭 정산 안내까지 뜨면 넘쳐서 스크롤 - 판정도 스크롤만큼 올라간다.
  const cs = { sheet: true, tab: 'comp', compState: 'settle', ...board(3) };
  const Lc = layoutRankingPopup(540, 960, cs);
  assert.ok(Lc.scrollMax > 0);
  const y0 = Lc.list.y + 190;
  assert.equal(hitRankingPopup(Lc, 340, y0, { ...cs, scroll: 0 }).type, 'challenge');
  assert.equal(hitRankingPopup(Lc, 340, y0 - Lc.scrollMax, { ...cs, scroll: Lc.scrollMax }).type, 'challenge');
  const lk = { sheet: true, tab: 'comp', compState: 'locked', scroll: 0, ...board(3) };
  const Lk = layoutRankingPopup(540, 960, lk);
  assert.equal(hitRankingPopup(Lk, 340, Lk.list.y + 190, lk).type, 'none');
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
