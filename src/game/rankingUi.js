// 랭킹 팝업 상태·입력(docs/ranking.md 2~6장). 그리기는 src/render/ui/rankingPopup.js, 데이터는 RankingService만 부른다.
// 메인 메뉴에서만 열린다: 봉인 원석(crystal) -> open(). 경쟁 주간 보상은 서버 정산이 우편으로 보낸다.
// 닉네임 입력은 캔버스 위에 HTML input을 잠깐 겹친다(모바일 키보드) - 팝업을 닫거나 저장하면 지운다.
import { createRankingService } from '../ranking/rankingService.js';
import { ServerRankingService } from '../ranking/serverRankingService.js';
import { isSettling, splitRemain, isNewSeason } from '../ranking/season.js';
import { crownBand, cardMetal, tierOf, pctOf } from '../ranking/tiers.js';
import { storage } from '../platform/storage.js';
import { isValidNickname } from '../ranking/rankingSave.js';
import { hitRankingPopup, scrollToMeValue, STATUE_PICKS } from '../render/ui/rankingPopup.js';
import { audio } from '../audio/AudioManager.js';
import { t } from '../config/i18n.js';
import { platform } from '../platform/index.js';
import { RANKING_TABS } from '../render/ui/rankingPopup.js';
import { createDomInput, placeDomInput } from '../render/ui/domInput.js';

const DRAG_PX = 8; // 보관함 목록과 같음 - 이만큼 넘게 움직이면 끌기
const DEV_STATES = { 1: 'normal', 2: 'settle', 3: 'locked', 4: 'none' };
const TICK_MS = 1000;

export class RankingUi {
  // player = playerState, canvas = 입력 칸을 겹칠 캔버스, defaultStatue() = 처음 고를 대표 석상(가장 레벨 높은 석상).
  constructor({ player, canvas, defaultStatue = () => 'red' }) {
    this.player = player;
    this.canvas = canvas;
    this.defaultStatue = defaultStatue;
    this.config = null;
    this.service = null;
    this.state = null; // 열려 있으면 그릴 값 묶음(rankingPopup.js 맨 위 주석)
    this.layout = null; // 마지막으로 그린 배치(터치 판정용) - CanvasRenderer.drawRankingPopup이 채운다
    this.devCompState = 0; // 0 = 자동, 1~4 = 개발 패널에서 고정
    this._drag = null;
    this._input = null;
    this._lastTick = 0;
    this._loadSeq = 0;
    this.crown = 'iron'; // 메뉴 왕관 금속(tick이 1초마다 갱신)
    this.swirl = false; // 새 시즌 소용돌이 요청 - main.js가 메뉴가 비어 있을 때 틀고 끈다
    this._crownSave = null; // 기기에 남긴 { seasonId, band } - 서버에서 못 받은 동안 쓰는 값
    this._crownAsked = null; // 내 기록을 물어본 시즌
    this._crownSeen = null; // 마지막으로 반영한 service.compMine
    this.crownSheet = null; // main.js: (metal) => 메뉴 왕관 시트 { img, w, h } - 내 기록 카드
    this.devPlayers = null; // 개발용 ?rankPlayers=N - 가짜 순위표 인원(두 탭 모두)
  }

  // server = 서버 랭킹(일반 모드) 사용 - config/server.json enabled이고 마켓 리더보드(토스)가 없을 때(main.js).
  // compOpen() = 경쟁 모드가 열렸는지(main.js compStatus = core/comp compLock: config.compUnlocked + 본편 comp.unlockBestFloor층 + 서버 랭킹) - 없으면 config.compUnlocked.
  init(config, { floorGold, server = false, compOpen = null }) {
    this.config = config;
    this.compOpen = compOpen ?? (() => !!config.compUnlocked);
    const opts = { player: this.player, config, floorGold };
    this.service = server ? new ServerRankingService(opts) : createRankingService(opts);
  }

  get isOpen() {
    return this.state != null;
  }

  // ---------- 열기·닫기 ----------
  open() {
    if (!this.service) return;
    const r = this.player.ranking;
    this.state = this._newState(true, r.lastTab);
    if (!r.profile.nickname) this._openNick(true);
    this.refresh();
  }

  close() {
    this._removeInput();
    this.state = null;
    this.layout = null;
    this._drag = null;
  }

  // 마켓 리더보드가 있으면(토스) 일반 모드 탭 + "토스 랭킹 보기"만, 경쟁 모드 탭은 숨김(docs/platforms.md 3-2).
  _newState(sheet, tab) {
    const market = platform.caps.leaderboard;
    const tabs = market ? ['normal'] : RANKING_TABS;
    if (!tabs.includes(tab)) tab = 'normal';
    return { sheet, tab, tabs, tossBoard: market, scrollBy: { normal: 0, comp: 0 }, sub: null, data: {}, blinkAt: -1, nick: null, loaded: false };
  }

  async refresh() {
    const st = this.state;
    if (!st) return;
    const seq = ++this._loadSeq;
    const seasonId = this.service.currentSeason().id;
    const [nt, nm, ct, cm] = await Promise.all([
      this.service.top('normal', {}),
      this.service.me('normal', {}),
      this.service.top('comp', { seasonId }),
      this.service.me('comp', { seasonId }),
    ]);
    if (seq !== this._loadSeq || this.state !== st) return;
    st.data = this.devPlayers != null ? { normal: this._fakeBoard('normal'), comp: this._fakeBoard('comp') } : { normal: { ...nt, me: nm }, comp: { ...ct, me: cm } };
    st.loaded = true;
    // 서버가 기기 닉네임을 거절해 비웠으면 바로 다시 고르게(이유 한 줄과 함께).
    if (this.service.nickResetReason && st.sub == null) this._openNick(true);
  }

  // 매 프레임(메뉴). 1초마다 시즌 넘김 확인 -> 넘어갔으면 다시 받기. 지난 시즌 보상은 서버가 우편으로 보낸다.
  tick(nowMs) {
    if (!this.service || nowMs - this._lastTick < TICK_MS) return;
    this._lastTick = nowMs;
    const before = this.player.ranking.comp.seasonId;
    this.service.syncSeason();
    if (this.state && before !== this.player.ranking.comp.seasonId) this.refresh();
    this._tickCrown(this.player.ranking.comp.seasonId);
  }

  // 메뉴 왕관 금속 + 새 시즌 소용돌이(config/ranking.json crown). 금속은 서버에서 받은 이번 주 내 기록으로 정해 기기에 남긴다.
  _tickCrown(seasonId) {
    const seen = storage.load('lastSeenSeasonId');
    if (seen !== seasonId) {
      storage.save('lastSeenSeasonId', seasonId);
      this.swirl ||= isNewSeason(seen, seasonId);
    }
    if (!this.compOpen()) {
      this.crown = 'iron';
      return;
    }
    if (this._crownAsked !== seasonId) {
      this._crownAsked = seasonId;
      this.service.me('comp', { seasonId });
    }
    this._crownSave ??= storage.load('crownBand') ?? {};
    const mine = this.service.compMine;
    if (mine && mine !== this._crownSeen && mine.seasonId === seasonId) {
      this._crownSeen = mine;
      const { bands = [], swirlOnBandUp } = this.config.crown ?? {};
      const band = crownBand(bands, mine.me);
      const old = this._crownSave.seasonId === seasonId ? this._crownSave.band : 'iron';
      if (band !== old || this._crownSave.seasonId !== seasonId) {
        const at = (b) => (bands.findIndex((x) => x.id === b) + bands.length + 1) % (bands.length + 1); // 좋은 순, iron이 맨 뒤
        if (swirlOnBandUp && at(band) < at(old)) this.swirl = true;
        this._crownSave = { seasonId, band };
        storage.save('crownBand', this._crownSave);
      }
    }
    this.crown = this._crownSave.seasonId === seasonId ? this._crownSave.band : 'iron';
  }

  // 경쟁 판 점수가 서버에 들어간 뒤(main.js) - 다음 tick에 내 기록을 다시 받는다.
  crownDirty() {
    this._crownAsked = null;
  }

  // ---------- 그리기 값 ----------
  // CanvasRenderer.drawRankingPopup에 넘길 묶음(매 프레임 같은 객체를 고쳐 쓴다).
  view(nowMs, itemIcon) {
    const st = this.state;
    if (!st) return null;
    const r = this.player.ranking;
    const now = this.service.now();
    const season = this.service.currentSeason();
    const d = st.data[st.tab] ?? {};
    st.nowMs = nowMs;
    st.season = season;
    st.compState = this.compState(now, season);
    st.compLocked = !this.compOpen() || this.devCompState === 3;
    st.entries = d.entries ?? [];
    st.total = d.total ?? 0;
    st.unavailable = !!d.unavailable;
    // 서버 랭킹 오프라인 - 마지막으로 받은 순위표 + 몇 분 전인지.
    st.offlineText = d.offlineAt ? t('ranking.offlineAgo', { n: Math.max(0, Math.floor((Date.now() - d.offlineAt) / 60e3)) }) : null;
    st.me = d.me ?? null;
    // 전당 아래 = 참가자가 cardBelow 미만이면 내 기록 카드(탭마다 따로 센다). 카드 금속·왕관.
    st.cardBelow = this.config.cardModeBelow ?? 10;
    st.myMetal = cardMetal(st.tab, st.compState === 'none' ? null : st.me, this.config.crown?.bands ?? []);
    st.crown = this.crownSheet?.(st.myMetal) ?? null;
    st.history = r.comp.history;
    st.tiers = this.config.tiers;
    st.launch = this.config.launch ?? null;
    st.floorGold = this.service.floorGold();
    st.myName = r.profile.nickname;
    st.myStatue = r.profile.statue || this.defaultStatue();
    st.scroll = st.scrollBy[st.tab];
    st.itemIcon = itemIcon;
    const rem = splitRemain(season.end - now);
    const p2 = (n) => String(n).padStart(2, '0');
    st.timerText = (rem.days ? t('ranking.days', { d: rem.days }) : '') + `${p2(rem.h)}:${p2(rem.m)}:${p2(rem.s)}`;
    return st;
  }

  // 경쟁 탭 상태: 잠김 > 정산 대기 > 기록 없음 > 평소. 개발 패널 1~4가 있으면 그것.
  compState(now, season) {
    if (DEV_STATES[this.devCompState]) return DEV_STATES[this.devCompState];
    if (!this.compOpen()) return 'locked';
    if (isSettling(now, season, this.config.settleWarnMin)) return 'settle';
    if (!this.state?.data.comp?.me) return 'none';
    return 'normal';
  }

  // 그린 직후 - 스크롤 한계 맞추기 + 닉네임 입력 칸 위치 맞추기.
  afterDraw(layout) {
    this.layout = layout;
    const st = this.state;
    if (!st) return;
    st.scrollBy[st.tab] = Math.max(0, Math.min(layout.scrollMax, st.scrollBy[st.tab]));
    if (st.sub === 'nick' && layout.sub?.input) this._placeInput(layout.sub.input, layout.scale);
  }

  // ---------- 입력 ----------
  // 메뉴 scene pointerdown. 돌려주는 값: 'openMode'(경쟁 모드 하러 가기) | 'startNormal'(일반 모드 바로 시작) | null.
  pointerDown(x, y) {
    const st = this.state;
    const L = this.layout;
    if (!st || !L) return null;
    const hit = hitRankingPopup(L, x, y, st);
    const r = this.player.ranking;
    switch (hit.type) {
      case 'close':
        audio.play('ui_cancel');
        this.close();
        return null;
      case 'tab':
        if (hit.tab === st.tab) return null;
        audio.play('ui_click');
        st.tab = hit.tab;
        r.lastTab = hit.tab;
        this.player.save();
        return null;
      case 'history':
      case 'rewards':
        audio.play('ui_click');
        st.sub = hit.type;
        return null;
      case 'edit':
        audio.play('ui_click');
        this._openNick(false);
        return null;
      case 'mine':
        audio.play('ui_click');
        st.scrollBy[st.tab] = scrollToMeValue(L);
        st.blinkAt = st.nowMs;
        return null;
      case 'tossBoard':
        audio.play('ui_click');
        // 리더보드가 열리면 게임은 백그라운드로 간다 - 소리 정지·저장은 lifecycle.onPause가 맡는다.
        platform.leaderboard.open().catch(() => {});
        return null;
      case 'challenge': // 내 기록 카드 "도전하러 가기" - 일반 = 바로 시작, 경쟁 = 모드 팝업(남은 입장을 보고 고르게)
        audio.play('ui_click');
        this.close();
        return st.tab === 'comp' ? 'openMode' : 'startNormal';
      case 'goComp':
        audio.play('ui_click');
        this.close();
        return 'openMode';
      case 'list':
        this._drag = { y: hit.by, start: st.scrollBy[st.tab], moved: false };
        return null;
      case 'subClose':
        audio.play('ui_cancel');
        this._closeSub();
        return null;
      case 'subOutside':
        if (st.sub === 'rewards' || st.sub === 'history') {
          audio.play('ui_cancel');
          this._closeSub();
        }
        return null;
      case 'pick':
        audio.play('ui_click');
        st.nick.statue = hit.statue;
        return null;
      case 'saveNick':
        this._saveNick();
        return null;
      case 'input':
        this._input?.focus();
        return null;
      default:
        return null;
    }
  }

  pointerMove(y) {
    if (!this._drag || !this.state || !this.layout) return false;
    const dy = y / this.layout.scale - this._drag.y;
    if (Math.abs(dy) > DRAG_PX) this._drag.moved = true;
    if (this._drag.moved) this.state.scrollBy[this.state.tab] = Math.max(0, Math.min(this.layout.scrollMax, this._drag.start - dy));
    return true;
  }

  pointerUp() {
    this._drag = null;
  }

  wheel(dy) {
    if (!this.state?.sheet || this.state.sub || !this.layout) return;
    const st = this.state;
    st.scrollBy[st.tab] = Math.max(0, Math.min(this.layout.scrollMax, st.scrollBy[st.tab] + dy * 0.5));
  }

  _closeSub() {
    const st = this.state;
    this._removeInput();
    st.sub = null;
    if (!st.sheet) this.close();
  }

  // ---------- 닉네임 ----------
  _openNick(first) {
    const p = this.player.ranking.profile;
    this.state.sub = 'nick';
    const reset = { taken: 'errTaken', badword: 'errBad' }[this.service.nickResetReason] ?? null;
    if (this.service.nickResetReason) this.service.nickResetReason = null;
    this.state.nick = { first, draft: p.nickname, statue: p.statue || this.defaultStatue(), err: reset, valid: isValidNickname(p.nickname), domInput: false };
    this._createInput();
  }

  async _saveNick() {
    const n = this.state?.nick;
    if (!n) return;
    if (!n.valid) {
      audio.play('gem_swap_fail');
      return;
    }
    const res = await this.service.saveProfile({ nickname: n.draft, statue: n.statue });
    if (!res.ok || !this.state) {
      audio.play('gem_swap_fail');
      // 서버 판정(중복·금칙어·연결 없음)은 입력 칸 아래 빨간 줄로.
      const err = { taken: 'errTaken', badword: 'errBad', offline: 'errOffline' }[res.reason];
      if (err && this.state?.nick === n) n.err = err;
      return;
    }
    audio.play('ui_click');
    this._closeSub();
    this.refresh(); // 내 줄 이름·석상
  }

  _setDraft(value) {
    const n = this.state?.nick;
    if (!n) return;
    n.draft = value.trim();
    n.valid = isValidNickname(n.draft);
    const len = [...n.draft].length;
    n.err = !n.draft ? null : len > 10 ? 'errLong' : len < 2 ? 'errShort' : !n.valid ? 'errChar' : null;
  }

  _createInput() {
    if (this._input) return;
    const el = createDomInput({
      maxLength: 12, // 10자를 넘겨 쳐도 잘리지 않고 "10자까지" 안내가 보이게
      placeholder: t('ranking.nick.placeholder'),
      ariaLabel: t('ranking.nick.label'),
      value: this.state.nick.draft,
      onInput: (e) => this._setDraft(e.value),
      onEnter: () => this._saveNick(),
    });
    if (!el) return;
    this._input = el;
    this.state.nick.domInput = true;
  }

  // 입력 칸 basis 사각형 -> 캔버스 위 CSS 위치.
  _placeInput(r, scale) {
    placeDomInput(this._input, this.canvas, r, scale);
  }

  _removeInput() {
    this._input?.remove();
    this._input = null;
    if (this.state?.nick) this.state.nick.domInput = false;
  }

  // 개발용 가짜 순위표(?rankPlayers=N): N명, 나는 3위(3명 미만이면 꼴찌)·10명 이상이면 뒤쪽. 값은 전부 임시.
  _fakeBoard(tab) {
    const n = Math.max(0, this.devPlayers);
    const names = ['크히하', '봉식이', '졸린원석', '황금별', '번개여우', 'FrostBear4', 'PixelKnight', '달빛토끼', '무쇠망치', '별사탕'];
    const p = this.player.ranking.profile;
    const meAt = n >= 10 ? Math.floor(n * 0.7) : Math.min(2, n - 1);
    const all = Array.from({ length: n }, (_, i) => {
      const me = i === meAt;
      const floor = Math.max(1, Math.round(105 * (1 - i / n) ** 2));
      return {
        playerId: `dev${i}`, nickname: me ? p.nickname || '봉식이아빠' : names[i % names.length] + (i >= names.length ? i : ''), statue: me ? p.statue || this.defaultStatue() : STATUE_PICKS[i % STATUE_PICKS.length],
        value: tab === 'comp' ? floor * 310 : floor, sub: tab === 'comp' ? floor : null, at: Date.UTC(2026, 10, 26 - (i % 20)), rank: i + 1, frame: null, tierId: tierOf(this.config.tiers, i + 1, n)?.id ?? null, me,
      };
    });
    const mine = all[meAt];
    return { entries: all.slice(0, this.config.topLimit ?? 100), total: n, me: mine ? { ...mine, total: n, pct: pctOf(mine.rank, n), next: null } : null };
  }

  // ---------- 개발 패널 ----------
  dev() {
    const ui = this;
    return {
      setCompState(n) {
        ui.devCompState = Number(n) || 0;
        ui.refresh();
      },
      // 시각 앞당기기: ms만큼, 또는 'settle'(종료 10분 전), 'reset'(종료 5초 전).
      advance(what) {
        const s = ui.service.currentSeason();
        const now = ui.service.now();
        const target = what === 'settle' ? s.end - ui.config.settleWarnMin * 60e3 : what === 'reset' ? s.end - 5000 : now + what;
        ui.service.devOffsetMs += Math.max(0, target - now);
        ui._lastTick = 0;
        ui.refresh();
      },
      resetNickname() {
        Object.assign(ui.player.ranking.profile, { nickname: '', statue: '' });
        ui.player.save();
        ui.close();
      },
    };
  }
}
