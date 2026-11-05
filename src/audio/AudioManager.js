// Web Audio API 기반 사운드 재생기(외부 라이브러리 없음 - Capacitor WebView에서도 그대로
// 동작한다). 채널 3개: sfx/bgm -> master -> destination. BGM은 이 단계에서는 채널(GainNode)과
// 볼륨 저장만 두고 재생 기능은 비워둔다.
// 설정은 storage(localStorage -> 나중에 Capacitor Preferences)에 sfxVolume/bgmVolume/muted로 저장.
// 에셋 로드/디코드가 실패해도 throw하지 않는다 - 소리만 없고 게임은 그대로 진행한다.
import { storage } from '../platform/storage.js';

const DEFAULTS = { sfxVolume: 0.8, bgmVolume: 0.6 };
const SFX_DIR = 'assets/sfx';

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

// files가 여러 개인 소리(gem_pop_1..8)는 연쇄 단계 step(1부터)으로 고른다. 파일 수를 넘으면
// 마지막 것을 재사용한다(assets/sfx/README.md "9단계 이상은 8 재사용").
export function pickFile(files, step = 1) {
  if (!files || files.length === 0) return null;
  const n = Math.floor(Number(step)) || 1;
  return files[Math.min(files.length, Math.max(1, n)) - 1];
}

export class AudioManager {
  // now: 테스트에서 minGapMs를 검증할 수 있게 주입 가능(기본은 performance.now).
  constructor({ now } = {}) {
    this.now = now ?? (() => (typeof performance === 'undefined' ? Date.now() : performance.now()));
    this.manifest = { sounds: {} };
    this.sfxVolume = clamp01(storage.load('sfxVolume') ?? DEFAULTS.sfxVolume);
    this.bgmVolume = clamp01(storage.load('bgmVolume') ?? DEFAULTS.bgmVolume);
    this.muted = storage.load('muted') === true;

    this._ctx = null;
    this._buffers = new Map(); // 파일 이름(확장자 없음) -> AudioBuffer
    this._lastPlayMs = new Map(); // key -> 마지막 재생 시각(minGapMs 판정)
    this._playing = new Map(); // key -> 지금 울리고 있는 수(maxInstances 판정)
    // ogg 우선, 브라우저가 못 열면 mp3. canPlayType이 빈 문자열이면 아예 ogg를 건너뛴다.
    this._ext = 'ogg';
    this._kicked = false; // install()의 무음 버퍼 재생 여부(iOS 오디오 세션 깨우기).
  }

  setManifest(manifest) {
    this.manifest = manifest && manifest.sounds ? manifest : { sounds: {} };
    if (typeof Audio !== 'undefined') {
      try {
        if (!new Audio().canPlayType('audio/ogg; codecs=vorbis')) this._ext = 'mp3';
      } catch {
        this._ext = 'mp3';
      }
    }
  }

  // manifest.sounds의 모든 파일 이름(중복 없음) - 프리로더가 진행률 단위로 쓴다.
  fileNames() {
    const names = [];
    for (const cfg of Object.values(this.manifest.sounds ?? {})) {
      for (const f of cfg.files ?? []) if (!names.includes(f)) names.push(f);
    }
    return names;
  }

  // 파일 하나를 fetch + decode한다. 실패하면 false(그 소리만 무음).
  async loadFile(file) {
    const ctx = this._context();
    if (!ctx) return false;
    if (this._buffers.has(file)) return true;
    for (const ext of this._ext === 'mp3' ? ['mp3'] : ['ogg', 'mp3']) {
      try {
        const res = await fetch(`${SFX_DIR}/${ext}/${file}.${ext}`);
        if (!res.ok) continue;
        this._buffers.set(file, await ctx.decodeAudioData(await res.arrayBuffer()));
        return true;
      } catch {
        if (ext === 'ogg') this._ext = 'mp3'; // 이 브라우저는 ogg를 못 연다 - 남은 파일은 바로 mp3로.
      }
    }
    return false;
  }

  // key: manifest.sounds의 키. step은 gem_pop 같은 다중 파일 소리의 연쇄 단계(1부터),
  // delayMs는 이펙트 지연(stepMs/hitMs/wisp 도착)과 소리를 맞추기 위한 재생 지연.
  // 반환값: 실제로 재생을 시작했는지(minGapMs/maxInstances/음소거로 걸러지면 false).
  play(key, { step = 1, delayMs = 0, volume = 1 } = {}) {
    if (this.muted) return false;
    const cfg = this.manifest.sounds?.[key];
    if (!cfg) return false;
    const nowMs = this.now();
    const last = this._lastPlayMs.get(key);
    if (last != null && nowMs - last < (cfg.minGapMs ?? 0)) return false;
    if ((this._playing.get(key) ?? 0) >= (cfg.maxInstances ?? 1)) return false;
    this._lastPlayMs.set(key, nowMs);
    this._start(key, cfg, step, delayMs, volume);
    return true;
  }

  setVolume(channel, value) {
    const v = clamp01(value);
    if (channel === 'bgm') {
      this.bgmVolume = v;
      storage.save('bgmVolume', v);
    } else {
      this.sfxVolume = v;
      storage.save('sfxVolume', v);
    }
    this._applyGains();
    return v;
  }

  setMuted(muted) {
    this.muted = !!muted;
    storage.save('muted', this.muted);
    this._applyGains();
    return this.muted;
  }

  toggleMute() {
    return this.setMuted(!this.muted);
  }

  // 모바일/브라우저 자동재생 정책: 첫 사용자 입력에서 resume, 탭이 숨으면 suspend.
  install(target = document) {
    // 리스너를 떼지 않는다 - resume()이 거부되는 입력(사용자 제스처로 인정되지 않는 경우)이
    // 한 번이라도 섞이면 영원히 잠긴 채로 남는다. 이미 running이면 resume()은 no-op.
    // 터치에서 사용자 제스처로 인정되는 것은 pointerup/touchend뿐이다(pointerdown은
    // pointerType이 'mouse'일 때만) - 게다가 보드 드래그가 setPointerCapture()를 걸면
    // touch 시퀀스가 touchcancel로 끝나 touchend가 아예 안 올 수 있다. 그래서 pointerup까지 듣는다.
    const unlock = () => {
      const ctx = this._context();
      if (!ctx) return;
      ctx.resume?.();
      // iOS는 resume()만으로는 오디오 세션이 안 열린다 - 제스처 안에서 빈 버퍼를 한 번
      // 재생해 하드웨어를 깨운다(한 번만).
      if (this._kicked) return;
      this._kicked = true;
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(ctx.destination);
      src.start(0);
    };
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) target.addEventListener(type, unlock);
    document.addEventListener('visibilitychange', () => {
      if (!this._ctx) return;
      if (document.hidden) this._ctx.suspend();
      else this._ctx.resume();
    });
  }

  // AudioContext는 처음 필요할 때(로딩 또는 첫 입력) 만든다. Node(테스트)에는 없으므로
  // null을 돌려주고, 그 경우 play()는 게이트 판정만 하고 소리를 내지 않는다.
  _context() {
    if (this._ctx) return this._ctx;
    const Ctor = typeof AudioContext !== 'undefined' ? AudioContext : typeof webkitAudioContext !== 'undefined' ? webkitAudioContext : null;
    if (!Ctor) return null;
    const ctx = new Ctor();
    this.master = ctx.createGain();
    this.sfx = ctx.createGain();
    this.bgm = ctx.createGain();
    this.sfx.connect(this.master);
    this.bgm.connect(this.master);
    this.master.connect(ctx.destination);
    this._ctx = ctx;
    this._applyGains();
    return ctx;
  }

  _applyGains() {
    if (!this._ctx) return;
    this.master.gain.value = this.muted ? 0 : 1;
    this.sfx.gain.value = this.sfxVolume;
    this.bgm.gain.value = this.bgmVolume;
  }

  _start(key, cfg, step, delayMs, volume) {
    const ctx = this._ctx;
    const file = pickFile(cfg.files, step);
    const buffer = file ? this._buffers.get(file) : null;
    if (!ctx || !buffer) return;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = (cfg.volume ?? 1) * clamp01(volume);
    src.connect(gain).connect(this.sfx);
    this._playing.set(key, (this._playing.get(key) ?? 0) + 1);
    src.onended = () => {
      this._playing.set(key, Math.max(0, (this._playing.get(key) ?? 1) - 1));
      gain.disconnect();
    };
    src.start(ctx.currentTime + Math.max(0, delayMs) / 1000);
  }
}

// 게임 전체가 공유하는 인스턴스(storage/haptics와 같은 관례).
export const audio = new AudioManager();
export default audio;
