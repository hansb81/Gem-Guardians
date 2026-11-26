// 랭킹 서비스(docs/ranking.md 7-3). 화면(src/game/rankingUi.js)은 아래 모양만 안다 - 서버로 바꿀 때는
// createRankingService가 돌려주는 객체 하나만 ServerRankingService(./serverRankingService.js)로 바꾼다.
//
//   submit(mode, { value, floor, at, seasonId })  판이 끝날 때. 더 좋은 기록일 때만 바뀜 -> { ok, updated }
//   top(mode, { seasonId, limit })                -> { entries: Entry[], total, unavailable? }
//   me(mode, { seasonId })                        -> { rank, pct, value, sub, at, tierId, next: { tierId, gap } } | null(기록 없음)
//   saveProfile({ nickname, statue })             -> { ok, reason? }
//   Entry(7-2) = { playerId, nickname, statue, value, sub, at, rank, frame, tierId, me? }
// mode = 'normal'(최고 층, 기간 없음) | 'comp'(이번 주 최고 1판 포인트). 모두 Promise(서버와 같은 모양).
//
// LocalRankingService(서버 없을 때): 내 기록만 save(playerState.ranking)에 - 순위표·순위 없음.
// 경쟁 주간 보상은 서버 정산이 우편으로 보낸다(cron settle -> mail) - 기기는 정산·지급하지 않는다.
import { seasonAt } from './season.js';
import { isValidNickname, STATUE_COLORS } from './rankingSave.js';

export class LocalRankingService {
  // player = { ranking, save(), inventory } (playerState). floorGold() = 지금 층 기준가(보상표 참여 골드 표시).
  constructor({ player, config, now = () => Date.now(), floorGold = () => 0 }) {
    this.player = player;
    this.config = config;
    this._now = now;
    this.floorGold = floorGold;
    this.devOffsetMs = 0; // 개발 패널 "시각 앞당기기"
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
      // 판을 시작할 때의 시즌에 넣는다. 그 사이 시즌이 넘어갔으면 버림(서버는 13-4의 30분 유예).
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

  async top() {
    return { entries: [], total: null, unavailable: true };
  }

  async me(mode, { seasonId } = {}) {
    const mine = this._myEntry(mode, seasonId);
    return mine && { ...mine, rank: null, pct: null, tierId: null, next: null };
  }

  async saveProfile({ nickname, statue }) {
    if (!isValidNickname(nickname)) return { ok: false, reason: 'nickname' };
    if (!STATUE_COLORS.includes(statue)) return { ok: false, reason: 'statue' };
    Object.assign(this._r.profile, { nickname, statue });
    this.player.save();
    return { ok: true };
  }

  // ---------- 로컬 전용 ----------
  // 메뉴에 들어올 때: 저장된 시즌이 지났으면 이번 시즌 기록으로 새로 시작한다.
  syncSeason() {
    const cur = this.currentSeason();
    const c = this._r.comp;
    if (c.seasonId === cur.id) return;
    c.seasonId = cur.id;
    c.best = { points: 0, floor: 0, at: 0 };
    c.runs = 0;
    this.player.save();
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
}

export function createRankingService(opts) {
  return new LocalRankingService(opts);
}
