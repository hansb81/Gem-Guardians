// 개발용(?sfxtest) - assets/sfx/manifest.json의 모든 소리를 눌러보는 DOM 오버레이.
// devPanel.js와 같은 이유로 캔버스가 아니라 평범한 DOM이다(디버그 전용).
import { audio } from '../audio/AudioManager.js';

export function setupSfxTestPanel() {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;bottom:0;left:0;z-index:9999;background:rgba(0,0,0,0.78);color:#fff;' +
    'font:11px monospace;padding:6px;display:flex;gap:4px;flex-wrap:wrap;max-width:100vw;max-height:40vh;overflow:auto;';

  for (const [key, cfg] of Object.entries(audio.manifest.sounds ?? {})) {
    const files = cfg.files ?? [];
    // 파일이 여러 개인 소리(gem_pop_1..8)는 단계마다 버튼을 하나씩 만든다.
    const steps = files.length > 1 ? files.map((_, i) => i + 1) : [1];
    for (const step of steps) {
      const btn = document.createElement('button');
      btn.textContent = files.length > 1 ? `${key} ${step}` : key;
      btn.onclick = () => audio.play(key, { step });
      panel.append(btn);
    }
  }

  document.body.appendChild(panel);
}
