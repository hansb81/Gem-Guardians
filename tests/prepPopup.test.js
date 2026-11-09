// 정비 팝업(docs/upgrade-popup.md): 상황 4종 x 탭 3종 레이아웃(팝업 안·안 겹침·터치 크기), 석상 버튼 상태, 토템 잠김, 처음 탭.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutPrepPopup, hitPrepPopup, statueRowInfo, openPrepState, rememberTab, PREP_TABS } from '../src/render/ui/prepPopup.js';
import { towerLevelCost } from '../src/core/economy/economy.js';

const BALANCE = JSON.parse(readFileSync(new URL('../config/balance.json', import.meta.url), 'utf8'));
const CONTEXTS = ['floorClear', 'defeat', 'village', 'towerTap'];
const SCREENS = [
  [540, 960],
  [540, 1170],
];

const within = (r, outer) => r.x >= outer.x && r.y >= outer.y && r.x + r.width <= outer.x + outer.width && r.y + r.height <= outer.y + outer.height;
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

function checkGroup(rects, outer, label) {
  rects.forEach((r, i) => {
    assert.ok(within(r, outer), `${label}[${i}] 밖으로 나감 ${JSON.stringify(r)}`);
    assert.ok(r.width > 0 && r.height >= 0, `${label}[${i}] 크기 0`);
    for (let j = i + 1; j < rects.length; j++) assert.ok(!overlaps(r, rects[j]), `${label}[${i}]와 [${j}] 겹침`);
  });
}

for (const [w, h] of SCREENS) {
  for (const context of CONTEXTS) {
    for (const tab of PREP_TABS) {
      test(`${w}x${h} ${context}/${tab}: 모든 사각형이 팝업 안, 서로 안 겹침, 터치 크기`, () => {
        const L = layoutPrepPopup(w, h, context, tab);
        const top = [L.title, L.status, L.goldChip, ...PREP_TABS.map((k) => L.tabs[k]), L.body, ...L.actions.map((a) => a.rect)];
        if (L.close) top.push(L.close);
        checkGroup(top, L.sheet, 'top');
        assert.ok(L.sheet.x === 12 && L.sheet.y === 96 && L.sheet.x + L.sheet.width === 528 && L.sheet.y + L.sheet.height === h - 48);
        assert.ok(within(L.content, L.body));

        for (const k of PREP_TABS) assert.ok(L.tabs[k].height >= 36, '탭 터치 36 이상');
        for (const a of L.actions) assert.ok(a.rect.height >= 44, '아래 버튼 44 이상');
        if (L.close) assert.ok(L.close.width >= 44 && L.close.height >= 44);

        if (tab === 'statue') {
          checkGroup([...L.statue.rows.map((r) => r.card), L.statue.hint, L.statue.total, L.statue.all], L.content, 'statue');
          L.statue.rows.forEach((r, i) => {
            checkGroup([r.statueBox, r.name, r.badge, r.plus, r.attack, r.upgrade, r.max], r.card, `row${i}`);
            assert.ok(r.upgrade.height >= 44, '강화 = 주 버튼 44');
            assert.ok(r.max.height >= 36, 'MAX 36');
          });
        } else if (tab === 'totem') {
          checkGroup([...L.totem.rows.map((r) => r.card), L.totem.notice], L.content, 'totem');
          L.totem.rows.forEach((r, i) => checkGroup([r.statue, r.name, ...r.slots], r.card, `totem${i}`));
          assert.ok(L.totem.notice.height >= 120, '안내판 자리');
        } else {
          const v = L.vault;
          checkGroup([v.equip, v.reserve, v.own, v.detail], L.content, 'vault');
          assert.ok(v.own.height >= 66 + 24 + 20, '보유 칸 한 줄 이상');
        }
      });
    }
  }
}

test('마을에선 아래 버튼 없음(X 있음), 층 클리어/패배에선 X 없음(아래 버튼만), 마을 본문이 더 길다', () => {
  const v = layoutPrepPopup(540, 960, 'village', 'vault');
  assert.equal(v.actions.length, 0);
  assert.ok(v.close);
  const fc = layoutPrepPopup(540, 960, 'floorClear', 'vault');
  assert.equal(fc.close, null);
  assert.deepEqual(fc.actions.map((a) => a.kind), ['next']);
  const df = layoutPrepPopup(540, 960, 'defeat', 'statue');
  assert.equal(df.close, null);
  assert.deepEqual(df.actions.map((a) => a.kind), ['village', 'retry']);
  assert.ok(v.body.height > fc.body.height);
  // 층 클리어/패배는 카드 바깥을 눌러도 닫히지 않는다, 마을은 닫힌다.
  assert.equal(hitPrepPopup(fc, 5, 5), null);
  assert.deepEqual(hitPrepPopup(v, 5, 5), { type: 'close' });
});

test('판정은 화면 좌표 -> 540 기준으로 나눈다(360 폭 캔버스)', () => {
  const L = layoutPrepPopup(360, 640, 'floorClear', 'statue');
  const r = L.statue.rows[2].upgrade;
  assert.deepEqual(hitPrepPopup(L, (r.x + 4) * L.scale, (r.y + 4) * L.scale), { type: 'upgrade', index: 2 });
  const m = L.statue.rows[4].max;
  assert.deepEqual(hitPrepPopup(L, (m.x + 4) * L.scale, (m.y + 4) * L.scale), { type: 'max', index: 4 });
  const t = L.tabs.vault;
  assert.deepEqual(hitPrepPopup(L, (t.x + 4) * L.scale, (t.y + 4) * L.scale), { type: 'tab', tab: 'vault' });
});

test('석상: 골드 부족 / 최대 레벨 / MAX +N', () => {
  const c1 = towerLevelCost(BALANCE, 1);
  const c2 = towerLevelCost(BALANCE, 2);
  assert.deepEqual(statueRowInfo(BALANCE, 1, c1 - 1), { maxed: false, cost: c1, affordable: false, maxUps: 0 });
  assert.equal(statueRowInfo(BALANCE, 1, c1).maxUps, 1);
  assert.equal(statueRowInfo(BALANCE, 1, c1 + c2).maxUps, 2);
  assert.equal(statueRowInfo(BALANCE, 1, c1 + c2 - 1).maxUps, 1);
  const top = BALANCE.tower.maxLevel;
  assert.deepEqual(statueRowInfo(BALANCE, top, 1e12), { maxed: true, cost: 0, affordable: false, maxUps: 0 });
  // 상한 직전이면 골드가 넘쳐도 +1까지만.
  assert.equal(statueRowInfo(BALANCE, top - 1, 1e12).maxUps, 1);
});

test('처음 탭: 마을 = 보관함, 층 클리어/패배 = 같은 판 마지막 탭(없으면 석상), 석상 탭 = 석상', () => {
  assert.equal(openPrepState('village', 'statue').tab, 'vault');
  assert.equal(openPrepState('floorClear', null).tab, 'statue');
  assert.equal(openPrepState('defeat', 'vault').tab, 'vault');
  assert.equal(openPrepState('towerTap', 'vault', 3).tab, 'statue');
  assert.equal(openPrepState('towerTap', null, 3).selectedTower, 3);
});

test('토템 잠김: 탭은 눌려도(본문 안내만) 기억 탭·저장값은 안 바뀐다', () => {
  assert.equal(rememberTab('vault', 'totem', true), 'vault');
  assert.equal(rememberTab(null, 'totem', true), null);
  assert.equal(rememberTab('vault', 'totem', false), 'totem');
  assert.equal(rememberTab('statue', 'vault', true), 'vault');
  // 잠긴 토템 본문에는 누를 수 있는 것이 없다(탭·아래 버튼만).
  const L = layoutPrepPopup(540, 960, 'floorClear', 'totem');
  const s = L.totem.rows[0].slots[0];
  assert.equal(hitPrepPopup(L, s.x + 4, s.y + 4), null);
  assert.equal(L.statue, undefined);
  assert.equal(L.vault, undefined);
});
