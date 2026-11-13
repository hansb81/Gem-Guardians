// 클라우드 저장 크기 측정(docs/auth-precheck.md 4번). 실제 playerState·inventory·shop·tutorial 모듈과 config/*.json으로
// save 블록을 만들고 JSON(UTF-8)·gzip 바이트를 잰다. 실행: node tools/auth-precheck/measure-save.mjs
// playerState.js는 Node에서 그대로 import된다(storage.js가 initStorage 전엔 메모리 캐시만 씀). 경우마다 ?case=N 쿼리로
// playerState 모듈만 새로 평가하고(의존 모듈·storage 캐시는 공유) 저장 키를 비운 뒤 시작한다.
// txId 형식은 src·server 코드 그대로: att:{KST날짜} / free:{날짜} / pass:{팩}:{날짜} / ad:{배치}:{날짜}:{n} / rank:{YYYY-Www}
// / mail:{id} / coupon:{캠페인} / iap:{상품}:{주문} / boss:{층} / unlock:{id} / start:{id} / tutorial_complete.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { storage } from '../../src/platform/storage.js';
import { completeTutorial } from '../../src/tutorial/tutorial.js';
import { createRng } from '../../src/core/rng.js';
import { migrateSave, normalizeInv, pruneGrantedTx } from '../../src/core/inventory/inventory.js';

const KEY = 'gemGuardians.save.v2';
const cfg = (f) => JSON.parse(readFileSync(new URL(`../../config/${f}`, import.meta.url), 'utf8'));
const items = cfg('items.json');
const shop = cfg('shop.json');
const att = cfg('attendance.json');
const tutorialCfg = cfg('tutorial.json');
const bossFloors = cfg('floors.json').floors.filter((f) => f.tag === 'boss').map((f) => f.floor);
const itemIds = Object.keys(items.items);

const DAY = 86400e3;
const END = Date.UTC(2026, 10, 13); // 측정 기준일(오늘)
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
function isoWeek(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const y = d.getUTCFullYear();
  const w = 1 + Math.round((d - Date.UTC(y, 0, 4)) / (7 * DAY) - 3 + ((new Date(Date.UTC(y, 0, 4)).getUTCDay() + 6) % 7) / 7);
  return `${y}-W${String(w).padStart(2, '0')}`;
}

// 날짜가 든 txId 중 90일 지난 것 지우기(기획 §1-E 1번). rank:{주}는 기획대로 남긴다.
const PRUNABLE = /^(att|free|pass:[a-z]+|ad:[a-z]+):(\d{4}-\d{2}-\d{2})/;
export function pruneTx(txs, nowMs, days = 90) {
  const cut = ymd(nowMs - days * DAY);
  return txs.filter((tx) => {
    const m = PRUNABLE.exec(tx);
    return !m || m[2] >= cut;
  });
}

let caseNo = 0;
async function freshPlayer() {
  storage.save(KEY, null);
  const { playerState } = await import(`../../src/game/playerState.js?case=${++caseNo}`);
  playerState.initShop(shop);
  playerState.initItems(items);
  completeTutorial(playerState, tutorialCfg, true);
  return playerState;
}

// perDay: { pass: ['monthly'], ads: 0 } - 매일 접속 플레이어가 하루에 받는 날짜 든 지급.
async function build({ days, payments, best, perDay }) {
  const ps = await freshPlayer();
  const inv = ps.inventory;
  const rng = createRng(days + payments);
  ps.bestFloor = best;
  ps.floor = best;
  ps.towerLevels = ps.towerLevels.map(() => Math.max(1, Math.round(best * 4 + rng() * 20)));
  ps.gold = Math.round(best * 25000 * (1 + rng()));
  ps.diamonds = Math.round(300 + rng() * 2000);
  inv._clock = () => Math.floor(END / 1000);
  ps.initItems(items); // unlock:{id} (21층 해제 부적)
  for (const f of bossFloors.filter((f) => f < best)) {
    inv.grant({ items: { [itemIds[f % itemIds.length]]: 1 }, ...(f === items.slots.unlock4BossFirstClear ? { flags: ['slot4'] } : {}) }, { src: 'bossReward', txId: `boss:${f}` });
  }
  let mailId = 1000;
  for (let d = days - 1; d >= 0; d--) {
    const ms = END - d * DAY;
    const date = ymd(ms);
    const dayIdx = days - 1 - d;
    inv.grant(att.days[dayIdx % att.days.length], { src: 'att', txId: `att:${date}` });
    inv.grant({ items: { [shop.free.item]: shop.free.count } }, { src: 'freeDaily', txId: `free:${date}` });
    for (const p of perDay.pass) inv.grant({ diamonds: shop.packs[p].pass.daily }, { src: 'pass', txId: `pass:${p}:${date}` });
    for (let n = 1; n <= perDay.ads; n++) inv.grant({ diamonds: 5 }, { src: 'ad', txId: `ad:chest:${date}:${n}` });
    if (dayIdx % 7 === 6) {
      inv.grant({ diamonds: 50 }, { src: 'rank', txId: `rank:${isoWeek(ms)}` });
      inv.grant({ diamonds: 30 }, { src: 'mail', txId: `mail:${mailId++}` });
    }
    if (dayIdx % 30 === 15) inv.grant({ diamonds: 100 }, { src: 'coupon', txId: `coupon:event${Math.floor(dayIdx / 30) + 1}` });
  }
  const keys = ['dia.1', 'dia.3', 'pack.monthly', 'pack.weekly', 'dia.5'];
  for (let i = 0; i < payments; i++) {
    const order = `GPA.33${String(10 + i).padStart(2, '0')}-${String(Math.floor(rng() * 1e4)).padStart(4, '0')}-${String(Math.floor(rng() * 1e4)).padStart(4, '0')}-${String(Math.floor(rng() * 1e5)).padStart(5, '0')}`;
    inv.grant({ diamonds: 500 }, { src: 'iap', txId: `iap:${keys[i % keys.length]}:${order}` });
  }
  // 아이템 전 종류·현실적인 개수, 젬 스킬, 장착·예약, 본 아이템.
  for (const id of itemIds) inv.data.items[id] = Math.floor(rng() * 80);
  for (const k of Object.keys(inv.data.perm.skills)) inv.data.perm.skills[k] = 1 + Math.floor(rng() * 5);
  for (const id of itemIds) if (!inv.data.seenItems.includes(id)) inv.data.seenItems.push(id);
  inv.data.loadout.preFloor = { booster_line: true, booster_bomb: false, gold_coin: true };
  ps.shop.purchasedOnce = ['pack.starter', 'pack.adfree', 'pack.slot4'];
  ps.shop.firstBuyUsed = [0, 1, 2, 3, 4, 5];
  ps.shop.offers = { starter: END + 3 * DAY, boss: { floor: 40, expiresAt: END + DAY } };
  ps.shop.passes.monthly = { daysLeft: 17, claimedToday: true };
  ps.shop.freeClaimedDate = ymd(END);
  ps.shop.day = ymd(END);
  Object.assign(ps.ranking.profile, { nickname: '보석지기123', statue: 'purple' });
  ps.ranking.normal = { bestFloor: best - 1, reachedAt: END };
  ps.ranking.comp = {
    seasonId: isoWeek(END), best: { points: 123456, floor: 42, at: END }, runs: 17,
    pending: { seasonId: isoWeek(END - 7 * DAY), rank: 321, pct: 12.3, tierId: 'gold', points: 98765, rewards: { diamonds: 50 }, seen: false },
    history: Array.from({ length: 8 }, (_, i) => ({ seasonId: isoWeek(END - (i + 1) * 7 * DAY), points: 90000 + i * 1234, rank: 100 + i * 37, pct: 10.5 + i, tierId: 'gold' })),
  };
  ps.save();
  return storage.load(KEY);
}

async function newPlayer() {
  const ps = await freshPlayer();
  ps.inventory.grant(att.days[0], { src: 'att', txId: `att:${ymd(END)}` });
  ps.save();
  return storage.load(KEY);
}

// 기획 §1-B: adContinue를 save 안으로 옮김 -> 업로드될 모양.
const uploadShape = (save) => ({ ...save, adContinue: { day: Math.floor(END / DAY), count: 3 } });
const bytes = (obj) => {
  const s = JSON.stringify(obj);
  return { json: Buffer.byteLength(s, 'utf8'), gz: gzipSync(Buffer.from(s, 'utf8')).length };
};
function measure(label, save) {
  const raw = bytes(uploadShape(save));
  const pruned = { ...save, inv: { ...save.inv, grantedTx: pruneGrantedTx(save.inv.grantedTx, ymd(END)) } }; // 게임 코드의 실제 정리(rank:{주} 포함, L1)
  const pr = bytes(uploadShape(pruned));
  // 자체 확인: 실제 로더(migrateSave·normalizeInv)를 통과해도 모양이 같고, 정리는 날짜 든 것만 뺀다.
  assert.deepEqual(normalizeInv(migrateSave(save).inv).grantedTx, save.inv.grantedTx);
  assert.ok(pruned.inv.grantedTx.every((t) => !PRUNABLE.test(t) || PRUNABLE.exec(t)[2] >= ymd(END - 90 * DAY)));
  return { label, tx: save.inv.grantedTx.length, log: save.inv.log.length, ...raw, txPruned: pruned.inv.grantedTx.length, jsonPruned: pr.json, gzPruned: pr.gz };
}

const SCEN = {
  main: { pass: ['monthly'], ads: 0 }, // 출석+무료+월간 패스 매일 + 주 1회 시즌·우편 + 월 1회 쿠폰
  f2p: { pass: [], ads: 0 },
  ads3: { pass: ['monthly'], ads: 3 }, // 광고 상자 하루 3회(AD_PLACEMENTS가 채워지면)
};
const CASES = [['1개월', 30, 3, 30], ['6개월', 182, 10, 80], ['1년', 365, 30, 100], ['2년', 730, 60, 100]];

const rows = [measure('① 새 플레이어', await newPlayer())];
for (const [label, days, payments, best] of CASES) rows.push(measure(`${label} (main)`, await build({ days, payments, best, perDay: SCEN.main })));
for (const s of ['f2p', 'ads3']) for (const [label, days, payments, best] of CASES.slice(2)) rows.push(measure(`${label} (${s})`, await build({ days, payments, best, perDay: SCEN[s] })));

const kb = (n) => (n / 1024).toFixed(1);
console.log('경우 | grantedTx | log | JSON KB | gzip KB | 90일 정리 후 tx | 정리 후 JSON KB | 정리 후 gzip KB');
for (const r of rows) console.log([r.label, r.tx, r.log, kb(r.json), kb(r.gz), r.txPruned, kb(r.jsonPruned), kb(r.gzPruned)].join(' | '));
if (process.argv.includes('--json')) console.log(JSON.stringify(rows));
