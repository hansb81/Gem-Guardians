// 이벤트 팝업(docs/events.md)의 판단만 모은 순수 함수 - 화면·서버 없이 node 테스트한다.

// 이 앱이 아는 이벤트 종류. 모르는 kind(나중에 생길 7일 로그인 등)는 목록에서 숨긴다(옛 앱 보호).
export const EVENT_KINDS = ['claim', 'notice'];
export const knownEvents = (list) => (Array.isArray(list) ? list.filter((e) => EVENT_KINDS.includes(e?.kind)) : []);

// 받을 수 있고 아직 안 받은 claim 이벤트가 있으면 true(메뉴 이벤트 버튼·배너 빨간 점).
export const canClaimEvent = (e) => e?.kind === 'claim' && !e.claimed && !e.expired;
export const hasClaimableEvent = (list) => !!list?.some(canClaimEvent);

// 기간 글자(KST). "12월 1일 ~ 12월 31일" / "Dec 1 – Dec 31". withTime = 끝에 "23:59"(상세 팝업).
const fmtCache = new Map();
function fmt(loc, withTime) {
  const key = `${loc}|${withTime}`;
  if (!fmtCache.has(key)) {
    const opts = { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric' };
    fmtCache.set(key, new Intl.DateTimeFormat(loc, withTime ? { ...opts, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } : opts));
  }
  return fmtCache.get(key);
}
export function eventPeriodText(startsAt, endsAt, loc, withTime = false) {
  if (startsAt == null || endsAt == null) return '';
  const sep = loc === 'ko' ? ' ~ ' : ' – ';
  // Intl은 "12월 31일 23:59" / "Dec 31, 23:59" - 쉼표만 뺀다.
  return `${fmt(loc, false).format(startsAt)}${sep}${fmt(loc, withTime).format(endsAt).replace(',', '')}`;
}

// 상세 팝업 버튼: 'claim' | 'busy' | 'claimed' | 'expired' | 'offline'. notice는 버튼 없음(null).
export function eventButtonState(e, { busy = false, online = true, now = Date.now() } = {}) {
  if (!e || e.kind !== 'claim') return null;
  if (e.claimed) return 'claimed';
  if (busy) return 'busy';
  if (e.expired || (e.endsAt != null && now >= e.endsAt)) return 'expired';
  if (!online) return 'offline';
  return 'claim';
}

// 자동 열기: 튜토리얼 끝 + 메뉴에 다른 팝업 없음 + 출석 자동 팝업 처리 뒤, 안 받은 claim 이벤트 중
// 이 기기에서 자동으로 연 적 없는 첫 번째. 없으면 null.
export function pickAutoOpenEvent(list, openedIds, { tutorialDone, popupOpen, attDone }) {
  if (!tutorialDone || popupOpen || !attDone) return null;
  return list?.find((e) => canClaimEvent(e) && !openedIds.includes(e.id)) ?? null;
}

// 목록 줄 탭: 누른 뒤 거의 안 움직이고 뗐을 때만(드래그 스크롤과 구분). k = basis -> 화면 배율.
export const TAP_SLOP = 8; // 게임 정보 링크 탭과 같은 값(basis px)
export const isTap = (downY, upY, k) => Math.abs(upY - downY) < TAP_SLOP * k;
