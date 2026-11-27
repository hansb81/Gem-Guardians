// 수호자 강화 소리 고르기(순수 로직 - 실제 재생은 play(key, { step, delayMs }) 콜백).
// 소리 정의: assets/sfx/manifest.json guardian_upgrade(1~8) / guardian_tier_up.
export const STREAK_MS = 1200; // 같은 수호자를 이 안에 또 강화하면 다음 단계
export const BULK_STAGGER_MS = 80; // 일괄 강화 줄 연출 간격(main.js bumpStageFx와 같이 쓴다)
const MAX_STEP = 8;

export class UpgradeSfx {
  constructor(play) {
    this._play = play;
    this._index = -1;
    this._lastMs = -Infinity;
    this._step = 0;
  }

  // 한 수호자 강화 성공 1회. tierUp = 이 강화로 모습 등급이 바뀜, max = MAX +N(소리는 한 번).
  one(index, nowMs, tierUp, max = false) {
    if (tierUp) {
      this._step = 0; // 다음 강화는 1부터
      this._play('guardian_tier_up');
    } else {
      const chained = index === this._index && nowMs - this._lastMs <= STREAK_MS;
      this._step = max ? MAX_STEP : chained ? Math.min(MAX_STEP, this._step + 1) : 1;
      this._play('guardian_upgrade', { step: this._step });
    }
    this._index = index;
    this._lastMs = nowMs;
  }

  // 일괄 강화. upped = 오른 줄 번호(위에서 아래로), tierUp = 그중 모습 등급이 바뀐 줄이 있음.
  all(upped, tierUp) {
    upped.forEach((row, k) => this._play('guardian_upgrade', { step: k + 1, delayMs: row * BULK_STAGGER_MS }));
    if (tierUp) this._play('guardian_tier_up', { delayMs: (upped.at(-1) + 1) * BULK_STAGGER_MS });
    this._step = 0;
  }
}
