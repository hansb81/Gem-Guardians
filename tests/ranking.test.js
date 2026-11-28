// 랭킹(docs/ranking.md 5·7장): 시즌 id, 보상 구간, 다음 구간까지, 동점, 저장 마이그레이션, submit, 시즌 넘김.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { seasonAt, seasonFromId, prevSeason, isSettling, isNewSeason } from '../src/ranking/season.js';
import { tierOf, nextTierGap, compareEntries, rewardBundle, crownBand } from '../src/ranking/tiers.js';
import { normalizeRanking, isValidNickname } from '../src/ranking/rankingSave.js';
import { LocalRankingService } from '../src/ranking/rankingService.js';
import { migrateSave, SAVE_VERSION } from '../src/core/inventory/inventory.js';
import { Inventory } from '../src/game/inventory.js';

const CFG = JSON.parse(readFileSync(new URL('../config/ranking.json', import.meta.url), 'utf8'));
const T = CFG.rankedTiers; // 구간 판정은 출시 뒤 순위 표로 본다(출시 기념 tiers는 아래 따로)
const id = (rank, total) => tierOf(T, rank, total)?.id;

test('seasonId: 일요일 14:59:59 UTC는 그 주, 15:00:00 UTC(월 00:00 KST)는 다음 주', () => {
  const a = seasonAt(Date.parse('2026-11-08T14:59:59Z'), CFG);
  const b = seasonAt(Date.parse('2026-11-08T15:00:00Z'), CFG);
  assert.equal(a.id, '2026-W45');
  assert.equal(b.id, '2026-W46');
  assert.equal(a.end, Date.parse('2026-11-08T15:00:00Z'));
  assert.equal(b.start, a.end);
  assert.equal(a.start, Date.parse('2026-11-01T15:00:00Z'));
});

test('연말 주차: 2026년은 53주(2026-W53 = 12/28~1/3), 2027-01-04 KST는 2027-W01', () => {
  assert.equal(seasonAt(Date.parse('2026-12-31T03:00:00Z'), CFG).id, '2026-W53');
  assert.equal(seasonAt(Date.parse('2027-01-03T14:59:59Z'), CFG).id, '2026-W53');
  assert.equal(seasonAt(Date.parse('2027-01-03T15:00:00Z'), CFG).id, '2027-W01');
  assert.equal(seasonAt(Date.parse('2025-12-29T00:00:00Z'), CFG).id, '2026-W01'); // 2025-12-29 09:00 KST
  for (const s of ['2026-W01', '2026-W45', '2026-W53', '2027-W01']) assert.equal(seasonFromId(s, CFG).id, s);
  assert.equal(prevSeason(seasonFromId('2027-W01', CFG), CFG).id, '2026-W53');
});

test('정산 대기: 종료 10분 전부터', () => {
  const s = seasonAt(Date.parse('2026-11-05T00:00:00Z'), CFG);
  assert.equal(isSettling(s.end - 10 * 60e3 - 1, s, 10), false);
  assert.equal(isSettling(s.end - 10 * 60e3, s, 10), true);
  assert.equal(isSettling(s.end, s, 10), false);
});

test('구간: 1·2·3·10·50위, 상위 1/5/10/30/50%, 참여, 겹치면 좋은 쪽', () => {
  const N = 10000;
  assert.deepEqual([1, 2, 3, 4, 10, 11, 50, 51].map((r) => id(r, N)), ['r1', 'r2', 'r3', 'r10', 'r10', 'r50', 'r50', 'p1']);
  assert.deepEqual([100, 101, 500, 501, 1000, 1001, 3000, 3001, 5000, 5001, 10000].map((r) => id(r, N)), ['p1', 'p5', 'p5', 'p10', 'p10', 'p30', 'p30', 'p50', 'p50', 'part', 'part']);
  // 1000명: 상위 1%(10위)·5%(50위)는 순위 구간이 더 좋아서 묻힌다.
  assert.equal(id(10, 1000), 'r10');
  assert.equal(id(50, 1000), 'r50');
  assert.equal(id(51, 1000), 'p10');
  assert.equal(id(0, 10), undefined);
});

test('다음 구간까지 = 위 구간 마지막 점수 + 10, 1위는 null', () => {
  // 100명: 1,2,3위 / 4~10 / 11~50 / 51~100(상위 50%... 51위는 p50)
  const values = Array.from({ length: 100 }, (_, i) => 10000 - i * 50);
  assert.deepEqual(nextTierGap(T, values, 12, 10), { tierId: 'r10', gap: values[9] - values[11] + 10 });
  assert.deepEqual(nextTierGap(T, values, 4, 10), { tierId: 'r3', gap: values[2] - values[3] + 10 });
  assert.equal(nextTierGap(T, values, 1, 10), null);
});

test('동점: 먼저 낸 쪽이 위', () => {
  const list = [{ value: 100, at: 5 }, { value: 200, at: 9 }, { value: 100, at: 3 }].sort(compareEntries);
  assert.deepEqual(list.map((e) => e.at), [9, 3, 5]);
});

test('save 마이그레이션 v2 -> v3: 랭킹 블록, 일반 기록 = 최고 도달 층 - 1, inv 그대로', () => {
  const v2 = { saveVersion: 2, gold: 5, bestFloor: 13, inv: { items: { hammer: 2 }, grantedTx: ['start:hammer'] } };
  const out = migrateSave(structuredClone(v2), 1000);
  assert.equal(out.saveVersion, SAVE_VERSION);
  assert.equal(SAVE_VERSION, 4);
  assert.deepEqual(out.ranking.normal, { bestFloor: 12, reachedAt: 1000 * 1000 });
  assert.equal(out.ranking.lastTab, 'normal');
  assert.equal(out.inv.items.hammer, 2);
  assert.deepEqual(migrateSave(structuredClone(out)), out, '두 번 돌려도 같음');
  assert.equal(normalizeRanking(null, { bestFloor: 1 }).normal.bestFloor, 0, '1층에서 아직 클리어 없음');
});

test('닉네임: 2~10자 한글·영문·숫자', () => {
  for (const ok of ['가나', 'Pixel123', '열글자열글자열글자열']) assert.ok(isValidNickname(ok), ok);
  for (const bad of ['가', '열한글자열한글자열한글', 'a b', 'ㄱㄴ', 'hi!', '']) assert.ok(!isValidNickname(bad), bad);
});

function makeService(cfg = CFG, nowMs = Date.parse('2026-11-05T00:00:00Z')) {
  const player = { gold: 0, diamonds: 0, ranking: normalizeRanking({}), saves: 0 };
  player.save = () => player.saves++;
  player.inventory = new Inventory(null, { wallet: player });
  const now = { t: nowMs };
  const svc = new LocalRankingService({ player, config: cfg, now: () => now.t, floorGold: () => 100 });
  return { svc, player, now };
}

test('submit: 더 낮은 기록으로 덮어쓰지 않음, 도달 시각 기록', async () => {
  const { svc, player } = makeService();
  assert.equal((await svc.submit('normal', { floor: 10, at: 111 })).updated, true);
  assert.equal((await svc.submit('normal', { floor: 8, at: 222 })).updated, false);
  assert.equal((await svc.submit('normal', { floor: 10, at: 333 })).updated, false);
  assert.deepEqual(player.ranking.normal, { bestFloor: 10, reachedAt: 111 });
  svc.syncSeason();
  const sid = svc.currentSeason().id;
  await svc.submit('comp', { value: 5000, floor: 20, at: 1, seasonId: sid });
  await svc.submit('comp', { value: 4000, floor: 30, at: 2, seasonId: sid });
  assert.deepEqual(player.ranking.comp.best, { points: 5000, floor: 20, at: 1 });
  assert.equal(player.ranking.comp.runs, 2);
});

test('top/me(서버 없음): 순위표 없음, 내 기록만(순위 없음)', async () => {
  const { svc } = makeService();
  assert.equal((await svc.top('normal', {})).unavailable, true);
  assert.equal(await svc.me('normal', {}), null);
  await svc.submit('normal', { floor: 40, at: 1 });
  const me = await svc.me('normal', {});
  assert.deepEqual([me.value, me.rank, me.me], [40, null, true]);
});

test('시즌 넘김: 이번 주 기록만 새로 시작, 기기는 정산·지급 안 함(보상은 서버 우편)', async () => {
  const { svc, player, now } = makeService();
  svc.syncSeason();
  const s = svc.currentSeason();
  await svc.submit('comp', { value: 9000, floor: 30, at: s.start + 1000, seasonId: s.id });
  const dia0 = player.diamonds;
  now.t = s.end + 1000;
  svc.syncSeason();
  assert.notEqual(player.ranking.comp.seasonId, s.id);
  assert.equal(player.ranking.comp.best.points, 0);
  assert.equal(player.diamonds, dia0);
  assert.equal('pending' in player.ranking.comp, false);
});

test('예전 save의 pending·가짜 정산 기록은 버림', () => {
  const r = normalizeRanking({ comp: { pending: { seasonId: '2026-W40' }, history: [{ seasonId: '2026-W40', rank: 3 }] } });
  assert.equal('pending' in r.comp, false);
  assert.deepEqual(r.comp.history, []);
});

test('참여 보상 골드 = 층 기준가 x 3', () => {
  assert.deepEqual(rewardBundle(T.find((t) => t.id === 'part'), 150), { diamonds: 10, gold: 450 });
  assert.deepEqual(rewardBundle(T.find((t) => t.id === 'r1'), 150), { diamonds: 500, items: { rainbow: 5 } });
});

test('출시 기념 tiers: 1~3위 다이아 100, 나머지 전원 50 (둘 다 참여 골드)', () => {
  assert.equal(CFG.launch.on, true);
  const L = CFG.tiers;
  assert.deepEqual([1, 2, 3, 4, 50, 1000].map((r) => tierOf(L, r, 1000).id), ['r1', 'r2', 'r3', 'part', 'part', 'part']);
  assert.deepEqual(rewardBundle(tierOf(L, 3, 5), 150), { diamonds: 100, gold: 450 });
  assert.deepEqual(rewardBundle(tierOf(L, 4, 5), 150), { diamonds: 50, gold: 450 });
});

test('닉네임 팝업을 X로 닫고 다음에 랭킹을 열면 다시 뜬다(저장하면 안 뜸)', async () => {
  const { RankingUi } = await import('../src/game/rankingUi.js');
  const { player } = makeService();
  const ui = new RankingUi({ player, canvas: null });
  ui.init(CFG, { floorGold: () => 0 });
  ui.open();
  assert.equal(ui.state.sub, 'nick');
  ui._closeSub(); // X
  assert.equal(ui.state.sub, null);
  ui.close();
  ui.open();
  assert.equal(ui.state.sub, 'nick', '닉네임이 없으니 다시');
  ui._setDraft('가디언');
  await ui._saveNick();
  assert.equal(player.ranking.profile.nickname, '가디언');
  ui.close();
  ui.open();
  assert.equal(ui.state.sub, null);
});

// ---------- 메뉴 왕관(config crown) ----------
globalThis.Image ??= class {};
const { RankingUi } = await import('../src/game/rankingUi.js');

test('왕관 금속: 상위 1%/10%/50% 경계는 포함, 기록 없음·잠김·그 밖은 iron', () => {
  const B = CFG.crown.bands;
  const band = (rank, total = 200) => crownBand(B, { rank, total });
  assert.deepEqual([1, 2, 3, 20, 21, 100, 101, 200].map((r) => band(r)), ['gold', 'gold', 'silver', 'silver', 'bronze', 'bronze', 'iron', 'iron']);
  assert.equal(band(1, 1), 'gold');
  assert.equal(crownBand(B, null), 'iron', '이번 주 기록 없음');
  assert.equal(crownBand(B, { rank: null, total: null }), 'iron', '순위를 모름(오프라인 기기 기록)');
  assert.equal(crownBand(B, { rank: 1, total: 200 }, true), 'iron', '경쟁 모드 잠김');
  // 보상 구간(tiers)과 같은 식 - p1 보상을 받는 사람은 금, p10은 은 이상, p50은 동 이상.
  for (const [rank, total] of [[55, 6000], [60, 1000], [400, 1000]]) {
    const t = tierOf(T, rank, total).id;
    assert.equal(band(rank, total), { p1: 'gold', p5: 'silver', p10: 'silver', p30: 'bronze', p50: 'bronze' }[t]);
  }
});

test('lastSeenSeasonId: 첫 설치는 재생 없음, 같은 시즌 없음, 새 시즌이면 재생', () => {
  assert.equal(isNewSeason(null, '2026-W48'), false);
  assert.equal(isNewSeason('2026-W48', '2026-W48'), false);
  assert.equal(isNewSeason('2026-W47', '2026-W48'), true);
});

test('메뉴 tick: 금속은 받은 값을 기기에 남겨 못 받은 동안 쓰고, 시즌이 바뀌면 iron + 소용돌이 한 번', () => {
  const player = { ranking: { comp: { seasonId: '2026-W47' } } };
  let open = true;
  const make = () => {
    const ui = new RankingUi({ player, canvas: null });
    ui.config = CFG;
    ui.compOpen = () => open;
    ui.service = { syncSeason() {}, me: async () => null, compMine: undefined };
    return ui;
  };
  let ui = make();
  ui.tick(1000);
  assert.equal(ui.crown, 'iron', '처음 = iron');
  assert.equal(ui.swirl, false, '첫 설치는 저장만');
  ui.service.compMine = { seasonId: '2026-W47', me: { rank: 15, total: 200 } };
  ui.tick(2000);
  assert.equal(ui.crown, 'silver');
  ui = make(); // 다시 실행 - 서버 응답 전
  ui.tick(1000);
  assert.equal(ui.crown, 'silver', '마지막으로 받은 값');
  assert.equal(ui.swirl, false, '같은 시즌');
  open = false;
  ui.tick(2000);
  assert.equal(ui.crown, 'iron', '잠김');
  open = true;
  ui.service.compMine = { seasonId: '2026-W47', me: null };
  ui.tick(3000);
  assert.equal(ui.crown, 'iron', '기록 없음을 받음');
  ui.service.compMine = { seasonId: '2026-W47', me: { rank: 1, total: 200 } };
  ui.tick(4000);
  assert.equal(ui.crown, 'gold');
  player.ranking.comp.seasonId = '2026-W48';
  ui.tick(5000);
  assert.equal(ui.crown, 'iron', '새 시즌 - 지난 시즌 값은 안 씀');
  assert.equal(ui.swirl, true);
  ui.swirl = false;
  ui.tick(6000);
  assert.equal(ui.swirl, false, '한 번만');
});
