// 서버 랭킹(docs/server.md §9, docs/ranking.md 13-3) - 일반 모드 + 경쟁 모드 순위표·내 기록(경쟁 판 제출은 main.js가
// rank-comp-start/finish로 직접). 시즌 정산 표시는 그대로 Local. 내 기록은 계속 save에도 남긴다(Local의 submit) - 오프라인일 때 보여 줄 값.
// 오프라인이면 마지막으로 받은 순위표 + offlineAt(그 시각) -> 화면에 "오프라인 · 마지막 갱신 N분 전".
// 서버가 꺼져 있으면(config/server.json) 이 클래스를 안 쓴다 - rankingUi.init이 Local을 고른다.
import { LocalRankingService } from './rankingService.js';
import { call } from '../net/api.js';
import { CloudSave } from '../net/cloudSave.js';

export class ServerRankingService extends LocalRankingService {
  constructor(opts) {
    super(opts);
    this._last = null; // { entries, total, me, at } 마지막으로 받은 일반 모드
    this._profileSynced = false;
    this.nickResetReason = null; // 'taken' | 'badword' - 서버가 기기 닉네임을 거절해 비웠을 때(rankingUi가 이유를 보여 줌)
    this.compLeft = null; // 오늘 남은 경쟁 입장(rank-me comp·rank-comp-start가 채움, 모르면 null)
    this._lastComp = null; // { entries, total, me, at } 마지막으로 받은 경쟁 순위표
  }

  async submit(mode, run) {
    const res = await super.submit(mode, run);
    // 새 최고 층은 다음 save-put에 실어 보낸다(docs/auth.md §1-E 2번). 클라우드 저장이 꺼졌으면 예전처럼 따로.
    // 실패해도 me()(랭킹 팝업 열 때)가 다시 보냄.
    const n = this._r.normal;
    if (mode === 'normal' && res.updated && !CloudSave.noteRank(n.bestFloor, n.reachedAt)) call('rank-normal', { floor: n.bestFloor });
    return res;
  }

  async top(mode, opts = {}) {
    if (mode === 'comp') return this._compTop(opts);
    if (mode !== 'normal') return super.top(mode, opts);
    await this._syncProfile();
    const res = await call('rank-top', { limit: opts.limit ?? this.config.topLimit ?? 100 });
    if (!res.ok) return this._last ? { entries: this._last.entries, total: this._last.total, offlineAt: this._last.at } : { entries: [], total: null, unavailable: true };
    const mine = this._base();
    const entries = res.entries.map((e) => (e.me ? { ...e, playerId: mine.playerId } : e));
    this._last = { ...this._last, entries, total: res.total, at: Date.now() };
    return { entries, total: res.total };
  }

  async _compTop(opts) {
    await this._syncProfile();
    const res = await call('rank-top', { mode: 'comp', seasonId: opts.seasonId, limit: opts.limit ?? this.config.topLimit ?? 100 });
    const last = this._lastComp;
    if (!res.ok) return last ? { entries: last.entries, total: last.total, offlineAt: last.at } : { entries: [], total: null, unavailable: true };
    const mine = this._base();
    const entries = res.entries.map((e) => (e.me ? { ...e, playerId: mine.playerId } : e));
    this._lastComp = { ...last, entries, total: res.total, at: Date.now() };
    return { entries, total: res.total, settling: res.settling };
  }

  async me(mode, opts = {}) {
    if (mode === 'comp') {
      const res = await call('rank-me', { mode: 'comp', seasonId: opts.seasonId });
      if (!res.ok) return this._lastComp?.me ?? null;
      this.compLeft = res.left ?? this.compLeft;
      const me = res.me && { ...this._base(), ...res.me, frame: null, next: null };
      this._lastComp = { ...this._lastComp, me };
      return me;
    }
    if (mode !== 'normal') return super.me(mode, opts);
    const local = this._myEntry('normal');
    let res = await call('rank-me');
    // 서버 기록이 기기보다 낮으면(오프라인 때 깬 층, 서버 붙기 전 기록) 다시 보낸다 - 서버가 더 높을 때만 갱신.
    if (res.ok && local && !(res.me?.value >= local.value)) {
      await call('rank-normal', { floor: local.value });
      res = await call('rank-me');
    }
    if (!res.ok) return this._last?.me ?? (local && { ...local, rank: null, pct: null, tierId: null, next: null });
    if (!res.me) return null;
    const me = { ...this._base(), value: res.me.value, sub: null, at: res.me.at, rank: res.me.rank, pct: null, tierId: null, frame: null, next: null };
    this._last = { ...this._last, me };
    return me;
  }

  // 서버 먼저(중복 'taken'·금칙어 'badword'), 통과하면 기기에도.
  async saveProfile(profile) {
    const res = await call('rank-profile', profile);
    if (!res.ok) return res;
    this._profileSynced = true;
    return super.saveProfile(profile);
  }

  // 서버 붙기 전에 정한 닉네임을 한 번 올린다. 이미 남이 쓰면 기기 닉네임을 비워 다음에 열 때 다시 고르게 한다.
  async _syncProfile() {
    const p = this._r.profile;
    if (this._profileSynced || !p.nickname) return;
    const res = await call('rank-profile', { nickname: p.nickname, statue: p.statue || 'red' });
    if (res.ok) this._profileSynced = true;
    else if (res.reason === 'taken' || res.reason === 'badword') {
      p.nickname = '';
      this.nickResetReason = res.reason;
      this.player.save();
      this._profileSynced = true;
    }
  }
}
