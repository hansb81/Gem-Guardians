// 랭킹 팝업 상태·입력(docs/ranking.md 2~6장). 그리기는 src/render/ui/rankingPopup.js, 데이터는 RankingService만 부른다.
// 메인 메뉴에서만 열린다: 봉인 원석(crystal) -> open(), 메뉴에 들어올 때 tick()이 지난 시즌 정산 -> 결과 팝업.
// 닉네임 입력은 캔버스 위에 HTML input을 잠깐 겹친다(모바일 키보드) - 팝업을 닫거나 저장하면 지운다.
import { createRankingService } from '../ranking/rankingService.js';
import { isSettling, splitRemain } from '../ranking/season.js';
import { isValidNickname } from '../ranking/rankingSave.js';
import { hitRankingPopup, scrollToMeValue } from '../render/ui/rankingPopup.js';
import { audio } from '../audio/AudioManager.js';
import { t } from '../config/i18n.js';
import { platform } from '../platform/index.js';
import { RANKING_TABS } from '../render/ui/rankingPopup.js';

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
  }

  init(config, { floorGold }) {
    this.config = config;
    this.service = createRankingService({ player: this.player, config, floorGold });
  }

  get isOpen() {
    return this.state != null;
  }

  // 메뉴 이름판 빨간 점 = 받기 전 시즌 보상이 있을 때만.
  hasRewardBadge() {
    return !!this.service?.hasClaimableReward();
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
    st.data = { normal: { ...nt, me: nm }, comp: { ...ct, me: cm } };
    st.loaded = true;
  }

  // 매 프레임(메뉴). 1초마다 시즌 넘김 확인 -> 새 결과가 있으면 결과 팝업(아직 안 본 것만).
  tick(nowMs, menuIdle) {
    if (!this.service || nowMs - this._lastTick < TICK_MS) return;
    this._lastTick = nowMs;
    const before = this.player.ranking.comp.seasonId;
    this.service.syncSeason();
    if (this.state && before !== this.player.ranking.comp.seasonId) this.refresh();
    const p = this.player.ranking.comp.pending;
    if (p && !p.seen && (menuIdle || this.state) && this.state?.sub == null) this.showResult();
  }

  showResult() {
    if (!this.player.ranking.comp.pending) return;
    if (!this.state) this.state = this._newState(false, this.player.ranking.lastTab);
    this._removeInput();
    this.state.sub = 'result';
    this.service.markPendingSeen();
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
    st.compLocked = !this.config.compUnlocked || this.devCompState === 3;
    st.entries = d.entries ?? [];
    st.total = d.total ?? 0;
    st.unavailable = !!d.unavailable;
    st.me = d.me ?? null;
    st.history = r.comp.history;
    st.pending = r.comp.pending;
    st.rewardsEnabled = !!this.config.rewardsEnabled;
    st.tiers = this.config.tiers;
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
    if (!this.config.compUnlocked) return 'locked';
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
  // 메뉴 scene pointerdown. 돌려주는 값: 'openMode'(경쟁 모드 하러 가기) | null.
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
      case 'claim': {
        if (!this.config.rewardsEnabled) {
          audio.play('gem_swap_fail');
          return null;
        }
        // 지금은 지급만. rewardsEnabled를 켤 때 res.delta를 공통 획득 팝업(main.js rewardPopup, rewardFromDelta)에 넘긴다.
        const res = this.service.claim();
        audio.play(res.ok ? 'ui_click' : 'gem_swap_fail');
        if (!this.player.ranking.comp.pending) this._closeSub();
        return null;
      }
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
    this.state.nick = { first, draft: p.nickname, statue: p.statue || this.defaultStatue(), err: null, valid: isValidNickname(p.nickname), domInput: false };
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
    if (this._input || typeof document === 'undefined') return;
    const el = document.createElement('input');
    el.type = 'text';
    el.maxLength = 12; // 10자를 넘겨 쳐도 잘리지 않고 "10자까지" 안내가 보이게
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.placeholder = t('ranking.nick.placeholder');
    el.setAttribute('aria-label', t('ranking.nick.label'));
    el.value = this.state.nick.draft;
    el.style.cssText = 'position:fixed;z-index:50;margin:0;padding:0 4px;border:0;outline:0;background:transparent;color:#e8dcc0;caret-color:#f2d264;box-sizing:border-box;';
    el.addEventListener('input', () => this._setDraft(el.value));
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this._saveNick();
    });
    document.body.appendChild(el);
    this._input = el;
    this.state.nick.domInput = true;
    el.focus(); // 탭에서 열렸으면(사용자 동작 안) 모바일 키보드도 같이 뜬다
  }

  // 입력 칸 basis 사각형 -> 캔버스 위 CSS 위치.
  _placeInput(r, scale) {
    const el = this._input;
    if (!el) return;
    const c = this.canvas.getBoundingClientRect();
    const css = `${Math.round(c.left + r.x * scale)}px|${Math.round(c.top + r.y * scale)}px|${Math.round(r.width * scale)}px|${Math.round(r.height * scale)}px`;
    if (el.dataset.pos === css) return;
    el.dataset.pos = css;
    const [l, tp, w, h] = css.split('|');
    Object.assign(el.style, { left: l, top: tp, width: w, height: h, font: `${Math.round(22 * scale)}px 'Galmuri11', monospace` });
  }

  _removeInput() {
    this._input?.remove();
    this._input = null;
    if (this.state?.nick) this.state.nick.domInput = false;
  }

  // ---------- 개발 패널 ----------
  dev() {
    const ui = this;
    return {
      toggleFake() {
        ui.config.fakeBoard = !ui.config.fakeBoard;
        ui.refresh();
        return ui.config.fakeBoard;
      },
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
      showLastResult() {
        ui.service.syncSeason();
        if (!ui.service.devFakePending()) return;
        ui.showResult();
      },
      resetNickname() {
        Object.assign(ui.player.ranking.profile, { nickname: '', statue: '' });
        ui.player.save();
        ui.close();
      },
    };
  }
}
