// 패배 팝업 "부활(깃털)" / "광고 보고 이어하기" 판정(docs/ads.md 2장). 순수 계산 - 시각(ms)·상태는 호출부가 넘긴다.
import { KST_OFFSET_MS } from '../ranking/season.js';

const DAY = 24 * 3600e3;
export const kstDay = (ms) => Math.floor((ms + KST_OFFSET_MS) / DAY);

// save = { day, count } (저장 키 'adContinue') | null. 날짜(KST)가 바뀌면 0부터.
export const usedToday = (save, ms) => (save?.day === kstDay(ms) ? save.count : 0);
export const recordUse = (save, ms) => ({ day: kstDay(ms), count: usedToday(save, ms) + 1 });

/**
 * @param {object} o
 * @param {object} o.cfg        config/items.json adContinue
 * @param {'normal'|'competitive'} o.mode
 * @param {boolean} o.tutorial  튜토리얼 진행 중
 * @param {boolean} o.featherOk 깃털 사용 가능(보유·층당·failed - ItemController.canUse('revive'))
 * @param {number} o.floorLeft  이번 층 남은 이어하기(ItemController.continueLeft)
 * @param {boolean} o.adReady   보상형 광고 가능(caps.rewarded) 또는 광고 제거 보유
 * @returns {{ revive:boolean, ad:boolean }}
 */
export function continueOptions({ cfg, mode = 'normal', tutorial = false, featherOk, floorLeft, adReady, save, nowMs }) {
  // 경쟁 모드는 깃털·광고 둘 다 없이 바로 종료(랭킹 공정성).
  if (mode === 'competitive' && !cfg?.competitive) return { revive: false, ad: false };
  const ad = !!cfg?.enabled && !tutorial && adReady && floorLeft > 0 && usedToday(save, nowMs) < cfg.dailyCap;
  return { revive: !!featherOk, ad };
}
