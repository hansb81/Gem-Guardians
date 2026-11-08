// 랭킹 서비스(docs/ranking.md 7-3). 화면(src/game/rankingUi.js)은 아래 모양만 안다 - 서버로 바꿀 때는
// createRankingService가 돌려주는 객체 하나만 ServerRankingService(./serverRankingService.js)로 바꾼다.
//
//   submit(mode, { value, floor, at, seasonId })  판이 끝날 때. 더 좋은 기록일 때만 바뀜 -> { ok, updated }
//   top(mode, { seasonId, limit })                -> { entries: Entry[], total, unavailable? }
//   me(mode, { seasonId })                        -> { rank, pct, value, sub, at, tierId, next: { tierId, gap } } | null(기록 없음)
//   settle(seasonId)                              -> { seasonId, rank, pct, tierId, points, rewards } | null
//   saveProfile({ nickname, statue })             -> { ok, reason? }
//   Entry(7-2) = { playerId, nickname, statue, value, sub, at, rank, frame, tierId, me? }
// mode = 'normal'(최고 층, 기간 없음) | 'comp'(이번 주 최고 1판 포인트). 모두 Promise(서버와 같은 모양).
//
// LocalRankingService(지금): 내 기록은 save(playerState.ranking), 다른 사람은 config.fakeBoard일 때만
// 시즌 id(일반 모드는 고정 씨앗)로 만든 가짜 명단 - 같은 시즌이면 항상 같은 명단. fakeBoard가 false면 목록 없이 내 기록만.
import { createRng } from '../core/rng.js';
import { seasonAt, seasonFromId, prevSeason } from './season.js';
import { compareEntries, pctOf, tierOf, nextTierGap, rewardBundle } from './tiers.js';
import { isValidNickname, STATUE_COLORS } from './rankingSave.js';

const DAY = 86400e3;
const NORMAL_SEED = 'normal'; // 일반 모드는 시즌이 없어 고정 씨앗·고정 기준일
const FAKE_NORMAL_EPOCH = Date.UTC(2026, 10, 1);
const KO1 = ['푸른', '붉은', '작은', '용감한', '달빛', '새벽', '은빛', '검은', '황금', '고요한', '번개', '숲속', '졸린', '전설의'];
const KO2 = ['수호자', '기사', '마법사', '늑대', '곰', '여우', '용', '방패', '별', '원석', '탑지기', '고양이', '석상'];
const EN1 = ['Gem', 'Rune', 'Iron', 'Moon', 'Star', 'Frost', 'Ember', 'Nova', 'Pixel', 'Lucky', 'Dark', 'Sky', 'Ruby'];
const EN2 = ['Guard', 'Fox', 'Mage', 'Blade', 'Wolf', 'Lord', 'Cat', 'Bear', 'Owl', 'Rex'];

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

// 경쟁 점수 -> 그 판 층(가짜 명단용, 판 점수 공식의 대략적인 역).
const ptsFloor = (p) => Math.max(1, Math.round(Math.sqrt(p) / 3.3));

// 가짜 명단(정렬 전). 값은 파레토 분포(대부분 낮고 위로 갈수록 드묾). seasonStart = 경쟁 모드 도달 시각 기준.
export function fakeBoard(mode, seed, count, seasonStart = 0) {
  const r = createRng(hash(`${mode}:${seed}`));
  const pick = (a) => a[Math.floor(r() * a.length)];
  const out = [];
  for (let i = 0; i < count; i++) {
    let nickname = r() < 0.55 ? pick(KO1) + pick(KO2) : pick(EN1) + pick(EN2);
    if (r() < 0.35) nickname += Math.floor(r() * 99 + 1);
    nickname = nickname.slice(0, 10);
    const statue = pick(STATUE_COLORS);
    const tail = Math.pow(1 - r(), -1 / 2.2);
    const playerId = `fake:${seed}:${i}`;
    if (mode === 'normal') out.push({ playerId, nickname, statue, value: Math.min(150, Math.floor(8 * tail)), sub: null, at: FAKE_NORMAL_EPOCH - Math.floor(r() * 200 * DAY) });
    else {
      const value = Math.min(38000, Math.round((1800 * tail) / 10) * 10);
      out.push({ playerId, nickname, statue, value, sub: ptsFloor(value), at: seasonStart + Math.floor(r() * 6.9 * DAY) });
    }
  }
  return out;
}

const FRAME_OF = { r1: 'crown_gold', r2: 'crown_silver', r3: 'crown_bronze' };

export class LocalRankingService {
  // player = { ranking, save(), inventory } (playerState). floorGold() = 지금 층 기준가(참여 보상 골드).
  constructor({ player, config, now = () => Date.now(), floorGold = () => 0 }) {
    this.player = player;
    this.config = config;
    this._now = now;
    this.floorGold = floorGold;
    this.devOffsetMs = 0; // 개발 패널 "시각 앞당기기"
    this._fakeCache = new Map();
  }

  now() {
    return this._now() + this.devOffsetMs;
  }

  get _r() {
    return this.player.ranking;
  }

  currentSeason() {
    return seasonAt(this.now(), this.config);
  }

  // ---------- 인터페이스 ----------
  async submit(mode, { value, floor, at = this.now(), seasonId } = {}) {
    const r = this._r;
    if (mode === 'normal') {
      const v = Math.floor(floor ?? value ?? 0);
      if (!(v > r.normal.bestFloor)) return { ok: true, updated: false };
      r.normal = { bestFloor: v, reachedAt: at };
    } else {
      // 판을 시작할 때의 시즌에 넣는다. 그 사이 시즌이 넘어가 이미 정산됐으면 버림(로컬 단계, 서버는 13-4의 30분 유예).
      if (seasonId && seasonId !== r.comp.seasonId) return { ok: false, updated: false, reason: 'seasonClosed' };
      r.comp.runs += 1;
      if (!(value > r.comp.best.points)) {
        this.player.save();
        return { ok: true, updated: false };
      }
      r.comp.best = { points: value, floor: floor ?? 0, at };
    }
    this.player.save();
    return { ok: true, updated: true };
  }

  async top(mode, { seasonId, limit = this.config.topLimit ?? 100 } = {}) {
    if (!this.config.fakeBoard) return { entries: [], total: null, unavailable: true };
    const { list } = this._board(mode, seasonId);
    return { entries: list.slice(0, limit), total: list.length };
  }

  async me(mode, { seasonId } = {}) {
    const mine = this._myEntry(mode, seasonId);
    if (!mine) return null;
    if (!this.config.fakeBoard) return { ...mine, rank: null, pct: null, tierId: null, next: null };
    const { list } = this._board(mode, seasonId);
    const me = list.find((e) => e.me);
    const next = mode === 'comp' ? nextTierGap(this.config.tiers, list.map((e) => e.value), me.rank, this.config.nextTierStep ?? 10) : null;
    return { ...me, pct: pctOf(me.rank, list.length), next };
  }

  async settle(seasonId) {
    return this._settle(seasonId);
  }

  async saveProfile({ nickname, statue }) {
    if (!isValidNickname(nickname)) return { ok: false, reason: 'nickname' };
    if (!STATUE_COLORS.includes(statue)) return { ok: false, reason: 'statue' };
    Object.assign(this._r.profile, { nickname, statue });
    this.player.save();
    return { ok: true };
  }

  // ---------- 로컬 전용 ----------
  // 메뉴에 들어올 때: 저장된 시즌이 지났으면 그 시즌을 정산해 pending·history에 넣고 이번 시즌으로 넘긴다.
  // 정산 결과(새 pending)를 돌려준다 - 참여 안 했으면 null.
  syncSeason() {
    const cur = this.currentSeason();
    const c = this._r.comp;
    if (c.seasonId === cur.id) return null;
    let res = null;
    if (c.seasonId && c.best.points > 0) {
      res = this._settle(c.seasonId);
      if (res) this._addResult(res);
    }
    c.seasonId = cur.id;
    c.best = { points: 0, floor: 0, at: 0 };
    c.runs = 0;
    this.player.save();
    return res;
  }

  // 받기 = inventory.grant(txId rank:{seasonId}) 한 번만. rewardsEnabled가 false면 지급 안 함.
  claim() {
    const p = this._r.comp.pending;
    if (!p) return { ok: false, reason: 'none' };
    if (!this.config.rewardsEnabled) return { ok: false, reason: 'disabled' };
    const res = this.player.inventory.grant(p.rewards, { src: 'rank', txId: `rank:${p.seasonId}` });
    if (res.ok || res.reason === 'duplicate') {
      this._r.comp.pending = null;
      this.player.save();
    }
    return res;
  }

  hasClaimableReward() {
    return !!(this.config.rewardsEnabled && this._r.comp.pending);
  }

  markPendingSeen() {
    const p = this._r.comp.pending;
    if (!p || p.seen) return;
    p.seen = true;
    this.player.save();
  }

  // 개발용: 지난 시즌 결과를 가짜로 만든다(가짜 명단 상위 약 7% 점수).
  devFakePending() {
    const prev = prevSeason(this.currentSeason(), this.config);
    const fakes = fakeBoard('comp', prev.id, this.config.fakeCount, prev.start).sort(compareEntries);
    const points = fakes[Math.floor(fakes.length * 0.07)]?.value ?? 1000;
    const res = this._settle(prev.id, { points, at: prev.start + DAY });
    if (!res) return null;
    this._r.comp.history = this._r.comp.history.filter((h) => h.seasonId !== prev.id);
    this._addResult(res);
    this.player.save();
    return res;
  }

  _addResult(res) {
    const c = this._r.comp;
    c.pending = { ...res, seen: false };
    c.history.unshift({ seasonId: res.seasonId, points: res.points, rank: res.rank, pct: res.pct, tierId: res.tierId });
    c.history.length = Math.min(c.history.length, this.config.historyMax ?? 8);
  }

  _settle(seasonId, given = null) {
    const c = this._r.comp;
    const mine = given ?? (c.seasonId === seasonId ? { points: c.best.points, at: c.best.at } : null);
    if (!mine || !(mine.points > 0) || !this.config.fakeBoard) return null;
    const { list } = this._board('comp', seasonId, { value: mine.points, at: mine.at });
    const me = list.find((e) => e.me);
    const tier = tierOf(this.config.tiers, me.rank, list.length);
    return { seasonId, rank: me.rank, pct: pctOf(me.rank, list.length), tierId: tier.id, points: mine.points, rewards: rewardBundle(tier, this.floorGold()) };
  }

  _base() {
    const p = this._r.profile;
    return { playerId: p.playerId, nickname: p.nickname, statue: p.statue || 'red', me: true };
  }

  _myEntry(mode, seasonId) {
    const r = this._r;
    const base = this._base();
    if (mode === 'normal') return r.normal.bestFloor > 0 ? { ...base, value: r.normal.bestFloor, sub: null, at: r.normal.reachedAt } : null;
    if (seasonId && seasonId !== r.comp.seasonId) return null;
    return r.comp.best.points > 0 ? { ...base, value: r.comp.best.points, sub: r.comp.best.floor, at: r.comp.best.at } : null;
  }

  _fakes(mode, seasonId) {
    const seed = mode === 'normal' ? NORMAL_SEED : seasonId;
    const key = `${mode}|${seed}|${this.config.fakeCount}`;
    let list = this._fakeCache.get(key);
    if (!list) {
      const start = mode === 'comp' ? seasonFromId(seed, this.config)?.start ?? 0 : 0;
      list = fakeBoard(mode, seed, this.config.fakeCount ?? 1000, start);
      this._fakeCache.clear(); // 한 번에 하나만 들고 있으면 충분(탭 전환 때 다시 만들어도 1000명은 금방)
      this._fakeCache.set(key, list);
    }
    return list;
  }

  // 정렬된 명단(가짜 + 나). override = 정산용 내 점수.
  _board(mode, seasonId, override = null) {
    seasonId ??= this.currentSeason().id;
    const list = this._fakes(mode, seasonId).map((e) => ({ ...e }));
    const mine = override ? { ...this._base(), value: override.value, sub: null, at: override.at } : this._myEntry(mode, seasonId);
    if (mine) list.push(mine);
    list.sort(compareEntries);
    list.forEach((e, i) => {
      e.rank = i + 1;
      if (mode === 'comp') {
        e.tierId = tierOf(this.config.tiers, e.rank, list.length)?.id ?? null;
        e.frame = FRAME_OF[e.tierId] ?? (e.tierId === 'r10' ? 'gold' : null);
      } else e.frame = null;
    });
    return { list };
  }
}

// 지금은 항상 로컬. 서버 단계에서 여기만 바꾼다(13-6).
export function createRankingService(opts) {
  return new LocalRankingService(opts);
}
