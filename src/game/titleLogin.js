// 타이틀 로그인 입구(docs/auth.md §15): 화면 종류 판정 + 서버 준비를 기다린 뒤 Account.link. 그리기는 render/titleScreen.js.
import { isEmptyGuest } from '../net/account.js';

export const TITLE_WAIT_MS = 8000; // 서버 연결(initNet·hello)을 기다리는 최대 시간 - 넘으면 오프라인 문구

// null(기본 "터치하여 시작") | 'first'(버튼 두 개) | 'guest'(글자 버튼) | 'linked'(이메일 한 줄).
// loginOn = 서버 켜짐 + Google 로그인 수단(caps.login). ready = 서버 시작 처리(hello·리다이렉트) 끝.
// 서버가 끝나기 전엔 진행 있는 게스트인지 연결 계정인지 모르므로 기본 화면, 처음 실행만 바로 버튼.
export function titleLoginMode({ loginOn, ready, netOn, state, tutorialDone, bestFloor, purchases }) {
  if (!loginOn) return null;
  if (state.kind === 'linked') return 'linked';
  if (ready && !netOn) return null; // 오프라인으로 시작
  if (!tutorialDone && isEmptyGuest(bestFloor, purchases)) return 'first';
  return ready ? 'guest' : null;
}

// [Google로 계속하기]: started(서버 시작 처리)를 waitMs까지 기다린 뒤 계정 팝업과 같은 Account.link.
export async function linkFromTitle(account, started, waitMs = TITLE_WAIT_MS) {
  let timer;
  const ok = await Promise.race([Promise.resolve(started).then(() => true), new Promise((r) => (timer = setTimeout(r, waitMs, false)))]);
  clearTimeout(timer);
  return ok ? account.link('google') : { ok: false, reason: 'offline' };
}
