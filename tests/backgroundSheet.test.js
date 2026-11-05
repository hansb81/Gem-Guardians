// src/config/backgroundSheet.js 테스트. assets/backgrounds/manifest.json과 같은 입력으로
// lookup 규칙(README) 기준 예시 층수들이 맞는 시트 이름으로 변환되는지 확인한다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickBackgroundSheetName } from '../src/config/backgroundSheet.js';

const manifest = {
  themeOrder: ['temple', 'crypt', 'tomb', 'lava', 'abyss'],
  floorsPerTheme: 10,
  laps: 2,
};

test('pickBackgroundSheetName: 예시 층수들이 manifest.json 기준 시트 이름과 일치한다', () => {
  const cases = [
    [1, 'temple_f0_lap0'],
    [10, 'temple_f9_lap0'],
    [11, 'crypt_f0_lap0'],
    [50, 'abyss_f9_lap0'],
    [51, 'temple_f0_lap1'],
    [137, 'lava_f6_lap1'],
  ];
  for (const [floor, expected] of cases) {
    assert.equal(pickBackgroundSheetName(manifest, floor).name, expected, `floor ${floor}`);
  }
});
