// config/sounds.json 기반 간단 사운드 재생기. 파일이 없거나 디코드에 실패해도 조용히
// 무음 처리한다(throw 금지) - 리소스 없는 상태가 기본값이기 때문.
export class AudioPlayer {
  constructor(soundsConfig) {
    this.setConfig(soundsConfig);
    this._cache = new Map(); // key -> HTMLAudioElement
  }

  setConfig(soundsConfig) {
    this.config = soundsConfig ?? {};
  }

  play(key, { comboStreak = 0 } = {}) {
    const settings = this.config.settings ?? {};
    if (!settings.enabled) return;
    const eventCfg = this.config.events?.[key];
    if (!eventCfg?.file) return;

    let audio = this._cache.get(key);
    if (!audio) {
      audio = new Audio(`${settings.basePath ?? ''}${eventCfg.file}`);
      this._cache.set(key, audio);
    }

    audio.playbackRate = eventCfg.pitchByCombo
      ? Math.min(eventCfg.maxPitch ?? 4, 1 + comboStreak * (eventCfg.pitchStep ?? 0))
      : 1;
    audio.currentTime = 0;
    audio.play()?.catch(() => {});
  }
}

export default AudioPlayer;
