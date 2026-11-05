// AudioManager의 "브라우저가 없어도 되는" 부분만 검증한다 - 연쇄 단계별 파일 선택(gem_pop_n),
// minGapMs/maxInstances 게이트, 볼륨 저장/클램프. 실제 재생(AudioContext)은 Node에 없으므로
// play()는 게이트 판정만 하고 true/false를 돌려준다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AudioManager, pickFile } from '../src/audio/AudioManager.js';

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
