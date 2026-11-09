// 광고 입구 - 게임 코드는 platform.ads 대신 이걸 부른다. 광고가 떠 있는 동안 BGM·효과음을 끈다(토스 심사).
import { platform } from '../platform/index.js';
import { audio } from '../audio/AudioManager.js';

async function withAdSound(show) {
  audio.pauseFor('ad');
  try {
    return await show();
  } finally {
    audio.resumeFor('ad');
  }
}

export const showInterstitial = (placement) => withAdSound(() => platform.ads.showInterstitial(placement));
export const showRewarded = (placement) => withAdSound(() => platform.ads.showRewarded(placement));
