// 정비 팝업(docs/upgrade-popup.md): 상황 5종 x 그 상황의 탭(신단 2개, 상자는 탭 줄 없이 보관함만) 레이아웃(팝업 안·안 겹침·터치 크기), 석상 버튼 상태, 정령 잠김, 처음 탭.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { layoutPrepPopup, hitPrepPopup, statueRowInfo, openPrepState, rememberTab, PREP_TABS, prepTabs, stageFxOnUpgrade } from '../src/render/ui/prepPopup.js';
import { towerLevelCost } from '../src/core/economy/economy.js';

const BALANCE = JSON.parse(readFileSync(new URL('../config/balance.json', import.meta.url), 'utf8'));
const CONTEXTS = ['floorClear', 'defeat', 'village', 'vault', 'towerTap'];
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
    const keys = prepTabs(context);
    for (const tab of context === 'vault' ? ['vault'] : keys) {
      test(`${w}x${h} ${context}/${tab}: 모든 사각형이 팝업 안, 서로 안 겹침, 터치 크기`, () => {
        const L = layoutPrepPopup(w, h, context, tab);
        assert.deepEqual(Object.keys(L.tabs), keys);
        const top = [L.title, L.status, L.goldChip, ...keys.map((k) => L.tabs[k]), L.body, ...L.actions.map((a) => a.rect)].filter(Boolean);
        if (L.close) top.push(L.close);
        checkGroup(top, L.sheet, 'top');
        assert.ok(L.sheet.x === 12 && L.sheet.y === 96 && L.sheet.x + L.sheet.width === 528 && L.sheet.y + L.sheet.height === h - 48);
        assert.ok(within(L.content, L.body));

        for (const k of keys) assert.ok(L.tabs[k].height >= 36, '탭 터치 36 이상');
        for (const a of L.actions) assert.ok(a.rect.height >= 44, '아래 버튼 44 이상');
        if (L.close) assert.ok(L.close.width >= 44 && L.close.height >= 44);

        if (tab === 'statue') {
          checkGroup([...L.statue.rows.map((r) => r.card), L.statue.hint, L.statue.total, L.statue.all], L.content, 'statue');
          L.statue.rows.forEach((r, i) => {
            checkGroup([r.statueBox, r.name, r.badge, r.plus, r.attack, r.upgrade, r.max], r.card, `row${i}`);
            assert.ok(r.upgrade.height >= 44, '강화 = 주 버튼 44');
            assert.ok(r.max.height >= 36, 'MAX 36');
          });
        } else if (tab === 'spirit') {
          // 본문은 그릴 때 정해진다(spiritTab.js) - 무대 5칸 + 정보 카드 + 필터 + 목록 한 줄(92)이 들어갈 높이인지만(나머지는 스크롤).
          assert.equal(L.spirit.content, L.content);
          assert.ok(L.content.height >= 28 + 6 + 102 + 6 + 58 + 68 + 92, `정령 탭 본문 높이 ${L.content.height}`);
        } else {
          const v = L.vault;
          checkGroup([v.equip, v.reserve, v.own, v.detail], L.content, 'vault');
          assert.ok(v.own.height >= 66 + 24 + 20, '보유 칸 한 줄 이상');
        }
      });
    }
  }
}

test('상자(vault): 탭 줄·상황 줄·골드 없음, 본문 윗변 = 시트 위 + 84, 격자가 층 클리어보다 길다', () => {
  const L = layoutPrepPopup(540, 960, 'vault', 'vault');
  assert.deepEqual(L.tabs, {});
  assert.equal(L.status, null);
  assert.equal(L.goldChip, null);
  assert.equal(L.body.y, L.sheet.y + 84);
  assert.ok(L.title.y + L.title.height <= L.body.y);
  assert.ok(L.close);
  assert.equal(L.actions.length, 0);
  const tabbed = layoutPrepPopup(540, 960, 'towerTap', 'vault'); // 탭 줄이 있고 아래 버튼이 없는 같은 본문
  assert.equal(L.vault.own.height - tabbed.vault.own.height, 62, '탭 줄·상황 줄이 빠진 만큼(146 - 84) 격자가 길어진다');
  // 탭 줄이 있던 자리를 눌러도 탭으로 판정하지 않는다.
  for (const k of PREP_TABS) assert.equal(hitPrepPopup(L, tabbed.tabs[k].x + 4, tabbed.tabs[k].y + 4), null);
});

test('신단(village): 탭 2개(수호자·정령), 폭 = (안쪽 폭 - 6) / 2, 보관함 탭을 누를 수 없다', () => {
  const L = layoutPrepPopup(540, 960, 'village', 'statue');
  assert.deepEqual(Object.keys(L.tabs), ['statue', 'spirit']);
  const iw = L.sheet.width - 52;
  assert.equal(L.tabs.statue.width, (iw - 6) / 2);
  assert.equal(L.tabs.spirit.x + L.tabs.spirit.width, L.sheet.x + 26 + iw, '오른쪽 끝까지');
  const y = L.tabs.statue.y + 4;
  for (let x = 0; x < 540; x += 2) assert.notEqual(hitPrepPopup(L, x, y)?.tab, 'vault');
  assert.deepEqual(hitPrepPopup(L, L.tabs.spirit.x + L.tabs.spirit.width - 2, y), { type: 'tab', tab: 'spirit' });
  // 다른 상황은 3탭 그대로.
  for (const c of ['floorClear', 'defeat', 'towerTap']) assert.deepEqual(Object.keys(layoutPrepPopup(540, 960, c, 'statue').tabs), PREP_TABS);
});

test('마을·상자에선 아래 버튼 없음(X 있음), 층 클리어/패배에선 X 없음(아래 버튼만), 상자 본문이 더 길다', () => {
  const v = layoutPrepPopup(540, 960, 'vault', 'vault');
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

test('처음 탭: 마을(신단) = 수호자, 상자 = 보관함, 층 클리어/패배 = 같은 판 마지막 탭(없으면 석상), 석상 탭 = 석상', () => {
  assert.equal(openPrepState('village').tab, 'statue');
  assert.equal(openPrepState('village', 'vault').tab, 'statue', '기억한 탭이 보관함이어도 신단은 수호자');
  assert.equal(openPrepState('vault', 'statue').tab, 'vault');
  assert.equal(openPrepState('floorClear', null).tab, 'statue');
  assert.equal(openPrepState('defeat', 'vault').tab, 'vault');
  assert.equal(openPrepState('towerTap', 'vault', 3).tab, 'statue');
  assert.equal(openPrepState('towerTap', null, 3).selectedTower, 3);
});

test('정령 탭: 잠가 두면 기억 탭이 안 바뀐다, 그리기 전 본문에는 누를 것이 없다', () => {
  assert.equal(rememberTab('vault', 'spirit', true), 'vault');
  assert.equal(rememberTab(null, 'spirit', true), null);
  assert.equal(rememberTab('vault', 'spirit', false), 'spirit');
  assert.equal(rememberTab('statue', 'vault', true), 'vault');
  const L = layoutPrepPopup(540, 960, 'floorClear', 'spirit');
  assert.equal(hitPrepPopup(L, L.content.x + 4, L.content.y + 40), null);
  L.spiritHits = [{ r: { x: L.content.x, y: L.content.y + 34, width: 100, height: 44 }, hit: { type: 'spiritSlot', index: 0 } }];
  assert.deepEqual(hitPrepPopup(L, L.content.x + 4, L.content.y + 40), { type: 'spiritSlot', index: 0 });
  assert.equal(L.statue, undefined);
  assert.equal(L.vault, undefined);
});

test('수호자 무대: rowH 112/100/96에서 81x93, 글자 시작 = 카드 + 103, 줄 안에 들어감', () => {
  // [화면 높이, 상황, 기대 rowH] - 96 = 층 클리어(아래 버튼)에서 간격 6 -> 4로 줄인 결과(6이면 93).
  for (const [h, context, rowH] of [[1170, 'village', 112], [936, 'village', 100], [960, 'floorClear', 96]]) {
    const L = layoutPrepPopup(540, h, context, 'statue');
    L.statue.rows.forEach((r) => {
      assert.equal(r.card.height, rowH, `${h} ${context}`);
      assert.deepEqual([r.statueBox.x, r.statueBox.width, r.statueBox.height], [r.card.x + 8, 81, 93]);
      assert.ok(r.statueBox.y >= r.card.y && r.statueBox.y + 93 <= r.card.y + rowH, '무대가 잘리지 않음');
      assert.ok(Math.abs(r.statueBox.y + 46.5 - (r.card.y + rowH / 2)) <= 0.5, '세로 가운데');
      for (const k of ['name', 'badge', 'attack']) assert.equal(r[k].x, r.card.x + 103);
      assert.equal(r.plus.x, r.card.x + 173);
      assert.equal(r.upgrade.x + r.upgrade.width, r.card.x + r.card.width - 8, '버튼 위치 그대로');
    });
    assert.ok(L.statue.all.y + L.statue.all.height <= L.content.y + L.content.height);
  }
});

test('강화 연출: 연속 강화 중 공격은 재시작 안 함, 번쩍임은 240ms 간격, "+1"은 매번', () => {
  const ATK = 560; // 7프레임 x 80ms
  let fx = stageFxOnUpgrade(null, 1000, ATK);
  assert.deepEqual(fx, { atk: 1000, flash: 1000, spark: 1000, plus: 1000, grade: 1000 });
  fx = stageFxOnUpgrade(fx, 1150, ATK);
  assert.deepEqual(fx, { atk: 1000, flash: 1000, spark: 1000, plus: 1150, grade: 1000 }, '재생 중 = 이어서, 번쩍임 없음');
  fx = stageFxOnUpgrade(fx, 1239, ATK);
  assert.equal(fx.flash, 1000, '239ms = 아직');
  fx = stageFxOnUpgrade(fx, 1240, ATK);
  assert.deepEqual(fx, { atk: 1000, flash: 1240, spark: 1000, plus: 1240, grade: 1000 }, '240ms 지나면 번쩍임만 다시');
  fx = stageFxOnUpgrade(fx, 1470, ATK);
  assert.deepEqual([fx.atk, fx.flash], [1000, 1240], '공격 끝나기 전 = 이어서');
  fx = stageFxOnUpgrade(fx, 1600, ATK);
  assert.deepEqual(fx, { atk: 1600, flash: 1600, spark: 1600, plus: 1600, grade: 1000 }, '공격·반짝이가 끝난 뒤엔 처음부터, 레벨 이펙트(1.2초)는 이어서');
  assert.equal(stageFxOnUpgrade(fx, 2800, ATK).grade, 2800, '마지막 강화 1.2초 뒤엔 레벨 이펙트도 처음부터');
  // 일괄 강화로 늦춰 둔(미래) 시작이 있으면 그것도 이어서.
  assert.equal(stageFxOnUpgrade({ atk: 2080, flash: 2080, spark: 2080, plus: 2080 }, 2000, ATK).atk, 2080);
});
