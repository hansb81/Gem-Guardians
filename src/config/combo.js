// "콤보(연속 스트릭)" 설정 - 특수 잼끼리의 "조합"(COMBO_KIND)과는 다른 개념이다. 성공한 스왑이
// 연속될 때마다 올라가고, timerMs 동안 다음 성공 스왑이 없으면 끊긴다. tiers는 표시·연출 구간용이다
// (문구·effectIntensity). damageMultiplier는 데미지에 쓰지 않는다(2026-11-12 결정, reports/sim/v12/9-combo) -
// 시뮬 --combo=data 재현용으로만 남겨 둔다. 콤보 보상은 층 클리어 골드 보너스(balance.json economy.comboGold).
// labelKey는 렌더(콤보 HUD)가 src/config/i18n.js의 t()로 풀어 마일스톤 문구로 띄운다
// (다국어 지원 - 실제 문구는 locales/*.js에 있다).
export const COMBO_CONFIG = {
  timerMs: 3000,
  breakOnNonMatchSwap: false, // true면 매치 없는(무효) 스왑도 즉시 콤보를 끊는다. 기본은 false.
  milestoneDurationMs: 900, // tier 문구(Good!/Great!/...)가 뜬 뒤 사라지기까지.
  tiers: [
    { min: 5, damageMultiplier: 1.2, effectIntensity: 1, labelKey: 'combo.tier.good' },
    { min: 10, damageMultiplier: 1.5, effectIntensity: 2, labelKey: 'combo.tier.great' },
    { min: 20, damageMultiplier: 2, effectIntensity: 3, labelKey: 'combo.tier.amazing' },
    { min: 30, damageMultiplier: 3, effectIntensity: 4, labelKey: 'combo.tier.incredible' },
  ],
};
