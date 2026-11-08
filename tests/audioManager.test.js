// AudioManager의 "브라우저가 없어도 되는" 부분만 검증한다 - 연쇄 단계별 파일 선택(gem_pop_n),
// minGapMs/maxInstances 게이트, 볼륨 저장/클램프. 실제 재생(AudioContext)은 Node에 없으므로
// play()는 게이트 판정만 하고 true/false를 돌려준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AudioManager, pickFile, bgmForScene } from '../src/audio/AudioManager.js';
import { getFloor } from '../src/core/balance/floorGen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(__dirname, '..', 'assets', 'sfx', 'manifest.json'), 'utf8'));

// 테스트 사이에 값이 새지 않도록 매번 새 저장소를 끼운다(storage.js는 localStorage만 본다).
function stubStorage(initial = {}) {
  const data = { ...initial };
  globalThis.localStorage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
    },
  };
  return data;
}

test('gem_pop은 연쇄 단계로 파일을 고르고 8을 넘으면 8을 재사용한다', () => {
  const files = manifest.sounds.gem_pop.files;
  assert.equal(pickFile(files, 1), 'gem_pop_1');
  assert.equal(pickFile(files, 5), 'gem_pop_5');
  assert.equal(pickFile(files, 8), 'gem_pop_8');
  assert.equal(pickFile(files, 9), 'gem_pop_8');
  assert.equal(pickFile(files, 99), 'gem_pop_8');
  // 단계가 없거나 이상한 값이면 1단계.
  assert.equal(pickFile(files), 'gem_pop_1');
  assert.equal(pickFile(files, 0), 'gem_pop_1');
  // 파일이 하나인 소리는 단계와 무관하다.
  assert.equal(pickFile(manifest.sounds.gem_land.files, 4), 'gem_land');
});

test('minGapMs 안에 같은 소리를 다시 재생하지 않는다', () => {
  stubStorage();
  let nowMs = 0;
  const audio = new AudioManager({ now: () => nowMs });
  audio.setManifest(manifest);
  const gap = manifest.sounds.gem_pop.minGapMs; // 25
  assert.ok(gap > 0);

  assert.equal(audio.play('gem_pop'), true);
  nowMs += gap - 1;
  assert.equal(audio.play('gem_pop'), false);
  nowMs += 1;
  assert.equal(audio.play('gem_pop'), true);

  // 다른 키는 서로의 간격에 영향을 주지 않는다.
  assert.equal(audio.play('gem_land'), true);
  // manifest에 없는 키는 조용히 무시.
  assert.equal(audio.play('nope'), false);
});

test('maxInstances를 넘으면 새 재생을 무시하고, 음소거면 아무것도 재생하지 않는다', () => {
  stubStorage();
  const audio = new AudioManager({ now: () => 0 });
  audio.setManifest(manifest);
  audio._playing.set('gem_land', manifest.sounds.gem_land.maxInstances);
  assert.equal(audio.play('gem_land'), false);

  audio.setMuted(true);
  assert.equal(audio.play('gem_pop'), false);
});

test('볼륨은 0~1로 자르고 storage에 저장한다(기본 sfx 0.8 / bgm 0.6)', () => {
  const data = stubStorage();
  const audio = new AudioManager();
  assert.equal(audio.sfxVolume, 0.8);
  assert.equal(audio.bgmVolume, 0.6);
  assert.equal(audio.muted, false);

  assert.equal(audio.setVolume('sfx', 0.25), 0.25);
  assert.equal(audio.setVolume('bgm', 1.5), 1);
  assert.equal(audio.setVolume('sfx', -3), 0);
  audio.setMuted(true);
  assert.equal(data.sfxVolume, '0');
  assert.equal(data.bgmVolume, '1');
  assert.equal(data.muted, 'true');

  // 저장된 값으로 다시 시작한다.
  stubStorage({ sfxVolume: '0.3', bgmVolume: '0.9', muted: 'true' });
  const restored = new AudioManager();
  assert.equal(restored.sfxVolume, 0.3);
  assert.equal(restored.bgmVolume, 0.9);
  assert.equal(restored.muted, true);
});

// ---- BGM: 가짜 AudioContext/fetch로 재생 시작 시점만 본다(소리는 안 난다). ----
const bgmManifest = JSON.parse(readFileSync(join(__dirname, '..', 'assets', 'audio', 'bgm', 'manifest.json'), 'utf8'));
const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeAudio(state) {
  const param = () => ({ value: 1, cancelScheduledValues() {}, setValueAtTime(v) { this.value = v; }, linearRampToValueAtTime(v) { this.value = v; } });
  const node = () => ({ connect: (n) => n, disconnect() {} });
  class FakeCtx {
    constructor() {
      this.state = state;
      this.currentTime = 0;
      this.sampleRate = 44100;
      this.destination = node();
      this.loops = []; // 시작된 BGM 소스(loop=true)
    }
    createGain() { return { ...node(), gain: param() }; }
    createBuffer() { return {}; }
    createBufferSource() {
      const ctx = this;
      return { ...node(), start() { if (this.loop) ctx.loops.push(this); }, stop() { this.stopped = true; } };
    }
    async decodeAudioData() { return { duration: 99 }; }
    async resume() { this.state = 'running'; }
    async suspend() { this.state = 'suspended'; }
  }
  globalThis.AudioContext = FakeCtx;
  globalThis.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
  const audio = new AudioManager();
  audio.setBgmManifest(bgmManifest);
  return audio;
}

test('playBgm: 같은 key를 다시 부르면 무시하고, 다른 곡이면 크로스페이드로 바꾼다', async () => {
  stubStorage();
  const audio = fakeAudio('running');
  assert.equal(audio.playBgm('bgm_title', { fadeInMs: 1500 }), true);
  await flush();
  const ctx = audio._ctx;
  assert.equal(ctx.loops.length, 1);
  assert.equal(ctx.loops[0].loopEnd, bgmManifest.tracks.bgm_title.loopEndSec);
  assert.equal(audio.playBgm('bgm_title'), false);
  await flush();
  assert.equal(ctx.loops.length, 1);

  audio.playBgm('bgm_menu', { crossfadeMs: 1800 });
  await flush();
  assert.equal(ctx.loops.length, 2);
  assert.equal(ctx.loops[0].stopped, true); // 이전 곡은 페이드아웃 끝에 멈춘다.
  delete globalThis.AudioContext;
});

test('playBgm: suspended면 예약만 하고, unlock()의 resume 직후 마지막 예약 곡으로 시작한다', async () => {
  stubStorage();
  const audio = fakeAudio('suspended');
  audio.playBgm('bgm_title', { fadeInMs: 1500 });
  audio.playBgm('bgm_menu', { crossfadeMs: 1800 }); // 첫 터치 전 타이틀 -> 메뉴: 예약만 바뀐다.
  await flush();
  const ctx = audio._ctx;
  assert.equal(ctx.loops.length, 0);
  audio.unlock();
  await flush();
  assert.equal(ctx.loops.length, 1);
  assert.equal(ctx.loops[0].loopEnd, bgmManifest.tracks.bgm_menu.loopEndSec);
  delete globalThis.AudioContext;
});

test('bgmForScene: 타이틀/메뉴, 10·20층은 보스 곡, 나머지 층은 일반 곡', () => {
  const load = (name) => JSON.parse(readFileSync(join(__dirname, '..', 'config', name), 'utf8'));
  const [B, E, O, F] = ['balance.json', 'enemies.json', 'obstacles.json', 'floors.json'].map(load);
  const floor = (f) => getFloor(B, E, O, F, f);
  assert.equal(bgmForScene('title'), 'bgm_title');
  assert.equal(bgmForScene('menu', floor(10)), 'bgm_menu');
  assert.equal(bgmForScene('game', floor(10)), 'bgm_boss');
  assert.equal(bgmForScene('game', floor(20)), 'bgm_boss');
  for (const f of [1, 9, 11, 19, 21]) assert.equal(bgmForScene('game', floor(f)), 'bgm_battle', `floor ${f}`);
  assert.equal(bgmForScene('shop'), null); // 메뉴 안 화면은 지금 곡을 잇는다.
});
