// 게임 서버(docs/server.md S1)를 메뉴에 잇는 곳: 시작 시 hello -> 미지급 복구, 출석·우편 팝업 동작,
// 플레이어 코드 복사, 데이터 삭제 요청. 서버가 꺼져 있으면(config/server.json enabled:false) 아무것도 안 한다.
import { initNet, net, feature, syncClaims, call } from '../net/api.js';
import { AttendanceService, MailService, CouponService, EventService } from '../net/services.js';
import { pickAutoOpenEvent } from './eventRules.js';
import { CloudSave } from '../net/cloudSave.js';
import { platform } from '../platform/index.js';
import { rewardFromDelta } from '../render/rewardPopup.js';
import { storage } from '../platform/storage.js';
import { audio } from '../audio/AudioManager.js';
import { GAME_INFO } from '../config/gameInfo.js';
import { t, getLocale } from '../config/i18n.js';

const ATT_AUTO_KEY = 'attAutoDate'; // 출석 팝업을 마지막으로 자동으로 연 KST 날짜(서버 today)
let attAutoDate; // 위 값 캐시(매 프레임 storage를 읽지 않게)
const EVENT_AUTO_KEY = 'eventAutoOpened'; // 이 기기에서 상세 팝업을 자동으로 연 이벤트 id 목록
let eventAutoOpened; // 위 값 캐시
const HOLD_MS = 500; // 플레이어 코드 길게 누르기
const NOTICE_MS = 2000;

export async function loadServerConfig() {
  try {
    const res = await fetch('config/server.json');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

// 하루 첫 메뉴 진입 때 출석 팝업 자동 1회: 서버 상태를 받았고, 오늘 안 받았고, 튜토리얼이 끝났고, 다른 메뉴 팝업이 없을 때.
// 그 밖의 겹침(정비·랭킹·획득 팝업·전환 중)은 부르는 쪽(main.js)이 거른다. 열었으면 true.
export function autoOpenAttendance(att, menu, tutorialDone) {
  const s = att?.status;
  if (!s?.ok || s.claimedToday || !tutorialDone || menu.popup) return false;
  attAutoDate ??= storage.load(ATT_AUTO_KEY);
  if (attAutoDate === s.today) return false;
  storage.save(ATT_AUTO_KEY, (attAutoDate = s.today));
  menu.popup = 'attendance';
  return true;
}

// 출석 자동 팝업이 처리됐는지(이벤트 자동 열기는 그다음 차례): 출석 기능 없음·상태 실패·오늘 받음·오늘 이미 자동으로 엶.
// 상태를 아직 모르면(null) false - 출석이 먼저 뜰 수 있게 기다린다.
function attAutoDone(att) {
  if (!att) return true;
  const s = att.status;
  if (!s) return false;
  attAutoDate ??= storage.load(ATT_AUTO_KEY);
  return !s.ok || s.claimedToday || attAutoDate === s.today;
}

// 이벤트 상세 자동 열기(docs/events.md): 튜토리얼 끝 + 메뉴 팝업 없음 + 출석 자동 팝업 처리 뒤, 안 받은 claim 이벤트 중
// 이 기기에서 자동으로 연 적 없는 것 하나. 연 순간 기록(닫으면 다시 자동으로 안 엶). 겹침 거르기는 autoOpenAttendance와 같다.
export function autoOpenEvent(ui, menu, tutorialDone) {
  if (!ui?.events?.list) return false;
  eventAutoOpened ??= storage.load(EVENT_AUTO_KEY) ?? [];
  const e = pickAutoOpenEvent(ui.events.list, eventAutoOpened, { tutorialDone, popupOpen: !!menu.popup, attDone: attAutoDone(ui.att) });
  if (!e) return false;
  eventAutoOpened = [...eventAutoOpened, e.id];
  storage.save(EVENT_AUTO_KEY, eventAutoOpened);
  menu.openEventDetail(e);
  return true;
}

// dev = ?dev=1 (개발 패널의 서버 켜기/끄기가 storage 'devServer'에 남긴 값을 쓴다).
// 반환값의 enabled는 바로(동기) 정해진다 - 랭킹 서비스 선택에 쓴다. 로그인·hello는 뒤에서 이어진다.
// beforeStart = hello 뒤, 미지급 복구·출석·우편 전에 한 번(main.js: 웹 Google 리다이렉트 처리). { skipStart:true }면 그 셋을 건너뛴다
// (다른 계정으로 전환 중 - 그 계정 보상을 이 기기 save에 주지 않게). ui.started는 그 결과로 resolve.
export function setupServer(config, { menu, rewardPopup, player, dev = false, beforeStart = null }) {
  const override = dev ? storage.load('devServer') : null;
  const ready = initNet(config, { override, legacyId: player.ranking.profile.playerId, appVersion: GAME_INFO.version });
  const ui = {
    enabled: net.enabled,
    ready, // 로그인 + hello 끝(실패해도 resolve)
    started: null, // + 미지급 복구·출석·우편 상태 채움 끝(main.js가 이어서 클라우드 저장 시작 판정)
    att: null,
    mail: null,
    coupon: null,
    events: null,
    _holdTimer: null,
    devToggle: {
      label: () => `서버 ${net.enabled ? '끄기' : '켜기'} (새로고침)`,
      toggle: () => {
        storage.save('devServer', !net.enabled);
        storage.flush().then(() => location.reload());
      },
    },
  };
  if (!net.enabled) {
    ui.started = ready;
    return ui;
  }

  const inv = player.inventory;
  ui.att = feature('attendance') ? new AttendanceService(inv) : null;
  ui.mail = feature('mail') ? new MailService(inv) : null;
  const couponOn = () => feature('coupon') && platform.caps.coupon !== false;
  ui.coupon = couponOn() ? new CouponService(inv) : null;
  ui.events = feature('events') ? new EventService(inv) : null;
  const code = () => (net.playerId ? net.playerId.slice(0, 8) : null);
  // event = 이벤트 팝업(메뉴가 'open:event'로 새로고침을 부른다), online = 상세 버튼 "인터넷 연결이 필요해요".
  menu.server = { att: ui.att, mail: ui.mail, coupon: ui.coupon, event: ui.events, playerCode: code, online: () => net.on };
  menu.eventBadge = () => !!ui.events?.canClaim();
  // 서버 꺼짐·실패면 빈 목록 = "새 이벤트를 준비하고 있어요".
  const showEvents = () => (menu.events = ui.events?.list ?? []);
  menu.attendanceBadge = () => !!ui.att?.canClaim();
  menu.mailBadge = () => (ui.mail?.unread() ?? 0) > 0;

  menu.server.cloud = () => CloudSave.status();

  ui.started = ready.then(async () => {
    const pre = (await beforeStart?.()) ?? null;
    if (pre?.skipStart) return pre;
    // /hello의 features가 끈 기능은 팝업도 예전 자리로.
    if (!feature('attendance')) ui.att = menu.server.att = null;
    if (!feature('mail')) ui.mail = menu.server.mail = null;
    if (!couponOn()) ui.coupon = menu.server.coupon = null;
    // 이벤트는 config 기본이 꺼짐 - hello FEATURES가 켜야 생긴다(이벤트 함수가 없는 옛 서버면 그대로 꺼짐).
    ui.events = menu.server.event = feature('events') ? (ui.events ?? new EventService(inv)) : null;
    // 시작 정보는 hello 한 번에(docs/auth.md §1-E 1번). 옛 서버(hello에 없음)면 예전처럼 따로 부른다.
    const h = net.hello;
    // 지난번에 지급 못 한 것 복구(팝업 없이 지급·저장) - 다이아가 왜 늘었는지 알게 토스트 한 줄.
    if ((await syncClaims(inv, h?.claims?.ok ? h.claims : null)).length) menu.showToast(t('net.recovered'));
    if (ui.att) {
      if (h?.att?.ok) ui.att.status = h.att;
      else ui.att.refresh();
    }
    if (ui.mail) {
      if (h?.mail?.ok) ui.mail.setList(h.mail.mail);
      else ui.mail.refresh();
    }
    if (ui.events) {
      if (h?.events?.ok) ui.events.setList(h.events.events);
      else ui.events.refresh().then(showEvents);
      showEvents();
    }
    return pre;
  });

  const notice = (key) => {
    menu.aboutNotice = { key, until: performance.now() + NOTICE_MS };
  };
  const showGrant = (res, title = null) => {
    const reward = res.ok ? rewardFromDelta(res.delta) : null;
    if (reward && title) reward.title = title;
    if (res.ok) rewardPopup.show(reward);
    else audio.play('gem_swap_fail');
  };

  // 메뉴 handlePointerDown 결과 처리. 처리했으면 true.
  ui.handleMenuAction = (action) => {
    if (action === 'open:attendance') ui.att?.refresh();
    else if (action === 'open:mail') ui.mail?.refresh();
    else if (action === 'open:event') ui.events?.refresh().then(showEvents);
    else if (typeof action === 'string' && action.startsWith('eventClaim:')) {
      ui.events?.claim(action.slice(11)).then((res) => {
        menu.eventResult(res);
        showGrant(res, res.title?.[getLocale()] || res.title?.ko || null);
      });
    }
    else if (action === 'attClaim') ui.att?.claim().then((res) => showGrant(res, res.streakBonus ? t('net.att.streakBonusTitle') : null));
    else if (typeof action === 'string' && action.startsWith('mailClaim:')) ui.mail?.claim(Number(action.slice(10))).then(showGrant);
    else if (typeof action === 'string' && action.startsWith('mailDelete:')) ui.mail?.remove(Number(action.slice(11)));
    else if (typeof action === 'string' && action.startsWith('couponRedeem:')) {
      // 결과는 메뉴 한 곳(couponResult)으로 - 성공이면 메뉴가 설정으로 돌아가고 여기서 획득 팝업.
      ui.coupon?.redeem(action.slice(13)).then((res) => {
        menu.couponResult(res);
        showGrant(res);
      });
    }
    else if (action === 'playerCodeDown' || action === 'playerCodeCopy') {
      clearTimeout(ui._holdTimer);
      const copy = () => {
        const c = net.playerId; // 화면엔 앞 8자리, 복사는 전체 uid - 문의 때 운영(우편·제재·삭제)에서 한 사람을 정확히 집도록.
        if (!c) return;
        navigator.clipboard?.writeText(c).then(() => notice('net.about.copied'), () => {});
      };
      if (action === 'playerCodeCopy') copy(); // [복사] 버튼(누름 소리는 pressButton이 냈다)
      else {
        ui._holdTimer = setTimeout(() => {
          copy();
          audio.play('ui_click');
        }, HOLD_MS); // 코드 칸 길게 누르기
      }
    } else if (action === 'cloudUseServer') {
      CloudSave.applyConflictServer().then((ok) => ok || menu.showToast(t('net.error')));
    } else if (action === 'cloudUseDevice') {
      CloudSave.forceUpload().then((res) => res?.ok || menu.showToast(t('net.error')));
    } else return false;
    return true;
  };
  menu.dispatch = (action) => ui.handleMenuAction(action); // 쿠폰 입력 칸 Enter = 받기
  ui.pointerUp = () => clearTimeout(ui._holdTimer);
  return ui;
}
