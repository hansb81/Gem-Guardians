// Web Audio API 기반 사운드 재생기(외부 라이브러리 없음 - Capacitor WebView에서도 그대로
// 동작한다). 채널: sfx -> master, 곡별 gain -> bgm -> bgmDuck(팝업 덕킹) -> master -> destination.
// BGM은 assets/audio/bgm/manifest.json(README.md) - AudioBufferSourceNode 루프, <audio> 태그는 안 쓴다.
// 설정은 storage(src/platform/storage.js - 마켓 어댑터 저장소)에 sfxVolume/bgmVolume/muted로 저장.
// 에셋 로드/디코드가 실패해도 throw하지 않는다 - 소리만 없고 게임은 그대로 진행한다.
import { storage } from '../platform/storage.js';
import { platform } from '../platform/index.js';

const DEFAULTS = { sfxVolume: 0.8, bgmVolume: 0.6 };
const SFX_DIR = 'assets/sfx';
const BGM_DIR = 'assets/audio/bgm';

// 씬 -> 곡 key. floor는 controller.currentFloor(floorGen 결과) - 보스 층 판정은 floor.tag 그대로.
// 상점·설정 같은 메뉴 안 화면은 null(지금 곡을 이어서 튼다).
export function bgmForScene(scene, floor) {
  if (scene === 'title') return 'bgm_title';
  if (scene === 'menu') return 'bgm_menu';
  if (scene === 'game') return floor?.tag === 'boss' ? 'bgm_boss' : 'bgm_battle';
  return null;
}

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

    this._bgmTracks = null; // Promise<manifest.tracks> - 효과음 로딩과 따로 받는다.
    this._bgmTrackMap = {}; // 받아진 manifest.tracks
    this._bgmBuffers = new Map(); // key -> Promise<AudioBuffer|null>(캐시)
    this._bgmDecoded = new Map(); // key -> AudioBuffer(받아진 것만)
    this._bgmKey = null; // 들려야 할 곡. suspended거나 아직 받는 중이면 "예약" 상태.
    this._bgmOpts = { fadeInMs: undefined, crossfadeMs: 800 };
    this._bgmCur = null; // { key, src, gain, startedAt } - 실제로 울리고 있는 곡.
    this._bgmDuck = 1;
    this._holds = new Map(); // pauseFor 사유 -> 겹친 횟수. 하나라도 있으면 BGM 0, 'ad'면 AudioContext suspend.
    this._held = false; // _applySuspend가 suspend해 둔 상태인지.
    this._background = false; // 앱이 백그라운드(lifecycle.onPause) - suspend. 이벤트가 겹쳐 와도 되게 횟수가 아닌 플래그.
  }

  // 테스트/외부 주입용. 없으면 첫 playBgm/preloadBgm 때 manifest.json을 받는다.
  setBgmManifest(manifest) {
    this._bgmTrackMap = manifest?.tracks ?? {};
    this._bgmTracks = Promise.resolve(this._bgmTrackMap);
  }

  bgmTracks() {
    this._bgmTracks ??= fetch(`${BGM_DIR}/manifest.json`)
      .then((r) => r.json())
      .then((m) => (this._bgmTrackMap = m.tracks ?? {}))
      .catch(() => ({}));
    return this._bgmTracks;
  }

  // 받아서 디코드(캐시). ogg 먼저, 못 열면 mp3. 실패하면 null(그 곡만 무음).
  preloadBgm(key) {
    if (!this._bgmBuffers.has(key)) {
      this._bgmBuffers.set(
        key,
        this.bgmTracks().then(async (tracks) => {
          const cfg = tracks[key];
          const ctx = this._context();
          if (!cfg || !ctx) return null;
          for (const ext of this._ext === 'mp3' ? ['mp3'] : ['ogg', 'mp3']) {
            const file = cfg.files?.[ext];
            if (!file) continue;
            try {
              const res = await fetch(`${BGM_DIR}/${file}`);
              if (!res.ok) continue;
              const buf = await ctx.decodeAudioData(await res.arrayBuffer());
              this._bgmDecoded.set(key, buf);
              return buf;
            } catch {
              // 이 브라우저가 ogg를 못 연다 - mp3로.
            }
          }
          return null;
        })
      );
    }
    return this._bgmBuffers.get(key);
  }

  // 같은 key가 이미 재생(또는 예약) 중이면 아무것도 안 한다. 아니면 지금 곡에서 crossfadeMs로
  // 넘어가고, 울리는 곡이 없으면 fadeInMs(없으면 crossfadeMs)로 페이드인. suspended면 예약만 하고
  // unlock()의 resume() 직후, 아직 받는 중이면 받아지는 순간 시작한다.
  playBgm(key, { fadeInMs, crossfadeMs = 800 } = {}) {
    if (key === this._bgmKey) return false;
    this._bgmKey = key;
    this._bgmOpts = { fadeInMs, crossfadeMs };
    this.preloadBgm(key).then(() => this._syncBgm());
    this._syncBgm();
    return true;
  }

  stopBgm({ fadeOutMs = 800 } = {}) {
    this._bgmKey = null;
    this._bgmOpts = { fadeInMs: undefined, crossfadeMs: fadeOutMs };
    this._syncBgm();
  }

  // 팝업 덕킹 - bgm 채널 배율(설정 볼륨과 따로 곱해진다).
  setBgmDuck(mul, rampMs = 350) {
    if (mul === this._bgmDuck) return;
    this._bgmDuck = mul;
    if (this._ctx) this._ramp(this.bgmDuck.gain, mul, rampMs);
  }

  // 개발용(?sfxtest) - 루프 이음새 확인: 지금 곡을 loopEnd - sec 지점부터 다시 튼다.
  seekBgmFromEnd(sec = 6) {
    const cur = this._bgmCur;
    if (!cur) return;
    const { src, gain } = cur;
    const next = this._ctx.createBufferSource();
    next.buffer = src.buffer;
    next.loop = true;
    next.loopStart = src.loopStart;
    next.loopEnd = src.loopEnd;
    next.connect(gain);
    src.stop();
    next.start(0, Math.max(0, src.loopEnd - sec));
    cur.src = next;
  }

  // 들려야 할 곡(_bgmKey)과 울리는 곡(_bgmCur)을 맞춘다. running이 아니거나 아직 못 받았으면 기다린다.
  _syncBgm() {
    const ctx = this._ctx;
    const key = this._bgmKey;
    if (!ctx || ctx.state !== 'running' || this._bgmCur?.key === key) return;
    const buffer = key ? this._bgmDecoded.get(key) : null;
    if (key && !buffer) return; // 받아지면 preloadBgm().then이 다시 부른다(그동안 지금 곡 유지).
    const { fadeInMs, crossfadeMs } = this._bgmOpts;
    const old = this._bgmCur;
    const ms = old ? crossfadeMs : fadeInMs ?? crossfadeMs;
    if (old) {
      this._ramp(old.gain.gain, 0, ms);
      old.src.stop(ctx.currentTime + ms / 1000);
      old.src.onended = () => old.gain.disconnect();
    }
    this._bgmCur = null;
    if (!key) return;
    const cfg = this._bgmTrackMap[key] ?? {};
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.loopStart = cfg.loopStartSec ?? 0;
    src.loopEnd = cfg.loopEndSec ?? buffer.duration; // mp3는 인코더 여백으로 더 길다 - 지정 필수.
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain).connect(this.bgm);
    this._ramp(gain.gain, cfg.volume ?? 1, ms);
    src.start();
    this._bgmCur = { key, src, gain };
  }

  _ramp(param, value, ms) {
    const t = this._ctx.currentTime;
    param.cancelScheduledValues(t);
    param.setValueAtTime(param.value, t);
    param.linearRampToValueAtTime(value, t + Math.max(0, ms) / 1000);
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

  // 광고/결제처럼 소리를 멈춰야 하는 동안(토스 심사 - 결제·광고 중 BGM 정지). 사유별로 세므로 겹쳐도 안전하다.
  // 반드시 같은 사유로 resumeFor를 짝지어 부른다. 'ad'는 AudioContext를 통째로 suspend(효과음 포함 - 광고 자체 소리),
  // 그 밖(결제 등)은 BGM만 0.
  pauseFor(reason) {
    this._holds.set(reason, (this._holds.get(reason) ?? 0) + 1);
    this._applyGains();
    this._applySuspend();
  }

  resumeFor(reason) {
    const n = (this._holds.get(reason) ?? 0) - 1;
    if (n > 0) this._holds.set(reason, n);
    else this._holds.delete(reason);
    this._applyGains();
    this._applySuspend();
  }

  _mustSuspend() {
    return this._background || this._holds.has('ad');
  }

  // 백그라운드·광고가 하나라도 있으면 suspend, 둘 다 끝나면 resume(+ 그동안 바뀐 곡 맞추기).
  // 음소거·볼륨은 gain에 남아 있어 resume만 하면 설정대로 다시 들린다.
  _applySuspend() {
    const ctx = this._ctx;
    const must = this._mustSuspend();
    if (!ctx || must === this._held) return; // 상태가 바뀔 때만(결제처럼 BGM만 끄는 사유는 건드리지 않는다).
    this._held = must;
    if (must) ctx.suspend();
    else ctx.resume().then(() => this._syncBgm());
  }

  // 모바일/브라우저 자동재생 정책: 첫 사용자 입력에서 resume, 앱이 백그라운드로 가면(platform.lifecycle) suspend.
  install(target = document) {
    // 리스너를 떼지 않는다 - resume()이 거부되는 입력(사용자 제스처로 인정되지 않는 경우)이
    // 한 번이라도 섞이면 영원히 잠긴 채로 남는다. 이미 running이면 resume()은 no-op.
    // 터치에서 사용자 제스처로 인정되는 것은 pointerup/touchend뿐이다(pointerdown은
    // pointerType이 'mouse'일 때만) - 게다가 보드 드래그가 setPointerCapture()를 걸면
    // touch 시퀀스가 touchcancel로 끝나 touchend가 아예 안 올 수 있다. 그래서 pointerup까지 듣는다.
    const unlock = () => this.unlock();
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'keydown']) target.addEventListener(type, unlock);
    platform.lifecycle.onPause(() => {
      this._background = true;
      this._applySuspend();
    });
    platform.lifecycle.onResume(() => {
      this._background = false;
      this._applySuspend();
    });
  }

  // 사용자 입력 안에서 부른다. 첫 터치로 바로 소리를 내는 곳(타이틀 문 열림)은 play() 전에
  // 직접 불러야 한다 - document 리스너는 캔버스 리스너보다 늦게 돈다.
  unlock() {
    const ctx = this._context();
    if (!ctx || this._mustSuspend()) return; // 광고 중 탭이 소리를 되살리면 안 된다.
    // 예약된 BGM은 resume()이 끝난 직후 시작한다(호출한 쪽이 이어서 내는 효과음보다 뒤).
    ctx.resume?.()?.then(() => this._syncBgm());
    // iOS는 resume()만으로는 오디오 세션이 안 열린다 - 제스처 안에서 빈 버퍼를 한 번
    // 재생해 하드웨어를 깨운다(한 번만).
    if (this._kicked) return;
    this._kicked = true;
    const src = ctx.createBufferSource();
    src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    src.connect(ctx.destination);
    src.start(0);
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
    this.bgmDuck = ctx.createGain();
    this.bgmDuck.gain.value = this._bgmDuck;
    this.sfx.connect(this.master);
    this.bgm.connect(this.bgmDuck).connect(this.master);
    this.master.connect(ctx.destination);
    this._ctx = ctx;
    this._applyGains();
    return ctx;
  }

  _applyGains() {
    if (!this._ctx) return;
    this.master.gain.value = this.muted ? 0 : 1;
    this.sfx.gain.value = this.sfxVolume;
    this.bgm.gain.value = this._holds.size ? 0 : this.bgmVolume;
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
