// 정령 그림(docs/spirits.md 7장). 전투용 = assets/spirits/spirits.png(정령마다 한 줄 10x10 4프레임, manifest.spirits[id] = 줄 번호),
// 초상 = portraits.png(24x24, manifest.portraits[id] = 칸 번호). manifest에 없는 id(또는 시트 로드 실패)만 코드로 그린다:
// 속성 색 마름모 + 눈 2픽셀. PNG와 manifest만 넣으면 그대로 바뀐다. 색은 기존 팔레트만, 반투명 없음.
import { uiReady, brightCopy } from './uiKit.js';
import { drawImageSnapped } from './screenFit.js';

export const SPIRIT_SIZE = 10;
export const PORTRAIT_SIZE = 24;
// 등급 테두리(목록·상세·도감에서만, 전투에서는 안 그림).
export const SPIRIT_GRADE_COLOR = { common: '#655a74', rare: '#386cbc', epic: '#7a3cae', legend: '#f2d264' };
// 속성 색(팔레트 4단계 중 2·3·4번째) - 필터 칩·임시 마름모.
export const SPIRIT_ELEMENT_COLOR = {
  red: ['#741426', '#b82a3c', '#ec6a6a'],
  blue: ['#1c3a76', '#386cbc', '#8cc4ee'],
  yellow: ['#7a5212', '#c28a20', '#f2d264'],
  green: ['#1c5228', '#3a8a3c', '#9cd872'],
  purple: ['#48206e', '#7a3cae', '#c48ce6'],
};
const OUTLINE = '#0d0a10';
const EYE = '#e8dcc0';
const SILHOUETTE = '#221c2b';
// o 외곽선, d 안쪽 어두운 색, l 밝은 색 1줄, e 눈
const DIAMOND = [
  '....oo....',
  '...ollo...',
  '..olddlo..',
  '.olddddlo.',
  'oldeddeddo',
  'oddddddddo',
  '.oddddddo.',
  '..oddddo..',
  '...oddo...',
  '....oo....',
];

const cache = new Map(); // 'fallback:red' | 'bright' | 'sil' | 'psil' ... -> canvas

function cached(key, w, h, paint) {
  let c = cache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    paint(c.getContext('2d'), c);
    cache.set(key, c);
  }
  return c;
}

function fallbackCanvas(element) {
  const [, dark, light] = SPIRIT_ELEMENT_COLOR[element] ?? SPIRIT_ELEMENT_COLOR.purple;
  const colors = { o: OUTLINE, d: dark, l: light, e: EYE };
  return cached(`fallback:${element}`, SPIRIT_SIZE, SPIRIT_SIZE, (g) => {
    DIAMOND.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        if (row[x] === '.') continue;
        g.fillStyle = colors[row[x]];
        g.fillRect(x, y, 1, 1);
      }
    });
  });
}

// 단색 실루엣(없는 정령) - 시트 전체를 한 번만 칠해 둔다.
function silhouetteOf(key, img) {
  return cached(key, img.width, img.height, (g, c) => {
    g.drawImage(img, 0, 0);
    g.globalCompositeOperation = 'source-in';
    g.fillStyle = SILHOUETTE;
    g.fillRect(0, 0, c.width, c.height);
  });
}

// tint: null | 'bright'(발동 번쩍 - 팔레트 한 단계 밝게) | 'silhouette'(도감의 없는 정령)
function tinted(key, img, tint) {
  if (tint === 'bright') return cache.get(`b:${key}`) ?? (cache.set(`b:${key}`, brightCopy(img)), cache.get(`b:${key}`));
  if (tint === 'silhouette') return silhouetteOf(`s:${key}`, img);
  return img;
}

// 전투용 10x10. (x, y) = 왼쪽 위, scale = 화면 px / 원본 px. element = 임시 그림용 속성(config/spirits.json).
export function drawSpirit(ctx, assets, id, element, x, y, scale, nowMs = 0, tint = null) {
  const m = assets?.spiritManifest;
  const row = m?.spirits?.[id];
  const size = SPIRIT_SIZE * scale;
  if (row != null && uiReady(assets.spiritSheet)) {
    const fw = m.frameW ?? SPIRIT_SIZE;
    const fh = m.frameH ?? SPIRIT_SIZE;
    const frame = Math.floor(nowMs / (m.frameMs ?? 200)) % (m.frames ?? 1);
    drawImageSnapped(ctx, tinted('sheet', assets.spiritSheet.img, tint), frame * fw, row * fh, fw, fh, x, y, fw * scale, fh * scale);
    return;
  }
  const fb = fallbackCanvas(element);
  drawImageSnapped(ctx, tinted(`fallback:${element}`, fb, tint), 0, 0, SPIRIT_SIZE, SPIRIT_SIZE, x, y, size, size);
}

// 큰 초상 - (x, y, size) 정사각형 칸에. 초상 시트가 없으면 10x10을 정수배로 가운데에.
export function drawSpiritPortrait(ctx, assets, id, element, x, y, size, nowMs = 0, tint = null) {
  const m = assets?.spiritManifest;
  const cell = m?.portraits?.[id];
  if (cell != null && uiReady(assets.spiritPortraitSheet)) {
    const pw = m.portraitW ?? PORTRAIT_SIZE;
    const ph = m.portraitH ?? PORTRAIT_SIZE;
    const cols = m.portraitCols ?? 6;
    const k = Math.max(1, Math.floor(size / pw));
    const img = tinted('portrait', assets.spiritPortraitSheet.img, tint);
    drawImageSnapped(ctx, img, (cell % cols) * pw, Math.floor(cell / cols) * ph, pw, ph, Math.round(x + (size - pw * k) / 2), Math.round(y + (size - ph * k) / 2), pw * k, ph * k);
    return;
  }
  const k = Math.max(1, Math.floor(size / SPIRIT_SIZE));
  drawSpirit(ctx, assets, id, element, Math.round(x + (size - SPIRIT_SIZE * k) / 2), Math.round(y + (size - SPIRIT_SIZE * k) / 2), k, nowMs, tint);
}

// 정령석 아이콘(16x16 x k, 가운데 기준). 재화 아이콘 폴더 그림이 없으면 코드로 그린 마름모.
export function drawSpiritStone(ctx, assets, cx, cy, k = 2) {
  const st = assets?.uiImages?.get('icons/spirit_stone.png');
  if (uiReady(st)) {
    drawImageSnapped(ctx, st.img, Math.round(cx - 8 * k), Math.round(cy - 8 * k), 16 * k, 16 * k);
    return;
  }
  const fb = fallbackCanvas('purple');
  drawImageSnapped(ctx, fb, 0, 0, SPIRIT_SIZE, SPIRIT_SIZE, Math.round(cx - 5 * k), Math.round(cy - 5 * k), SPIRIT_SIZE * k, SPIRIT_SIZE * k);
}
