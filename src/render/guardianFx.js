// 수호자 레벨 구간 이펙트(assets/guardians/fx/manifest.json). 구간은 config/balance.json towerFxTiers,
// tier = 레벨 이하인 구간 값의 개수. 시트 크기·프레임·offsetY는 전부 manifest 값.
import { storage } from '../platform/storage.js';
import { drawImageSnapped, snapPx } from './screenFit.js';

export const FX_SLOT_STAGGER_MS = 170; // 다섯이 똑같이 움직이지 않게 슬롯마다 어긋남
const MIN_BLOB = 12; // 이보다 작은 8방향 덩어리(떠다니는 점)는 윤곽 계산에서 뺀다

export function fxTier(level, tiers) {
  let n = 0;
  for (const v of tiers) if (level >= v) n++;
  return n;
}

// 설정 팝업의 "수호자 이펙트" 토글(저장 키 'guardianFx', 기본 켜짐). 매 프레임 읽으므로 메모리에 둔다.
let fxOn = null;
export const guardianFxSetting = {
  enabled: () => (fxOn ??= storage.load('guardianFx') !== false),
  setEnabled(on) {
    fxOn = !!on;
    storage.save('guardianFx', fxOn);
  },
};

// alpha(w*h, 0이면 투명) -> (w+2)*(h+2) 윤곽 마스크(1 = 윤곽). 원본 (x,y)는 마스크 (x+1,y+1).
export function outlineMask(alpha, w, h) {
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = alpha[i] > 0 ? 1 : 0;
  // 작은 덩어리 제거(8방향 연결)
  const seen = new Uint8Array(w * h);
  const stack = [];
  const blob = [];
  for (let s = 0; s < w * h; s++) {
    if (!solid[s] || seen[s]) continue;
    blob.length = 0;
    stack.push(s);
    seen[s] = 1;
    while (stack.length) {
      const p = stack.pop();
      blob.push(p);
      const px = p % w;
      const py = (p - px) / w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (solid[q] && !seen[q]) {
            seen[q] = 1;
            stack.push(q);
          }
        }
      }
    }
    if (blob.length < MIN_BLOB) for (const p of blob) solid[p] = 0;
  }
  const W = w + 2;
  const H = h + 2;
  const at = (x, y) => (x >= 0 && y >= 0 && x < w && y < h ? solid[y * w + x] : 0);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ox = x - 1;
      const oy = y - 1;
      if (at(ox, oy)) continue;
      if (at(ox - 1, oy) || at(ox + 1, oy) || at(ox, oy - 1) || at(ox, oy + 1)) mask[y * W + x] = 1;
    }
  }
  return mask;
}

// 시트(프레임 가로 스트립) 전 프레임의 윤곽을 { bright, dim } 캔버스 스트립((fw+2)*frames x (fh+2))으로. 로드 때 한 번.
export function buildOutlineSheets(img, frameW, frameH, frames, colors) {
  const src = document.createElement('canvas');
  src.width = frameW * frames;
  src.height = frameH;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const W = frameW + 2;
  const H = frameH + 2;
  const out = {};
  const masks = [];
  for (let f = 0; f < frames; f++) {
    const d = sctx.getImageData(f * frameW, 0, frameW, frameH).data;
    const alpha = new Uint8Array(frameW * frameH);
    for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
    masks.push(outlineMask(alpha, frameW, frameH));
  }
  for (const variant of ['bright', 'dim']) {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(colors[variant].slice(i, i + 2), 16));
    const c = document.createElement('canvas');
    c.width = W * frames;
    c.height = H;
    const cctx = c.getContext('2d');
    const id = cctx.createImageData(c.width, H);
    masks.forEach((mask, f) => {
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          if (!mask[y * W + x]) continue;
          const i = (y * c.width + f * W + x) * 4;
          id.data[i] = r;
          id.data[i + 1] = g;
          id.data[i + 2] = b;
          id.data[i + 3] = 255;
        }
      }
    });
    cctx.putImageData(id, 0, 0);
    out[variant] = c;
  }
  return out;
}

// 아래쪽 가운데 기준 스트립 한 장(x0 = 발 x, footY = 발 y, s = 수호자 drawScale). 반전 없음.
function drawStrip(ctx, sheets, kind, color, manifest, x0, footY, s, t) {
  const cfg = manifest[kind];
  const state = sheets.get(`${kind}_${color}`);
  if (!cfg || !state?.loaded || state.failed) return;
  const f = Math.floor(t / cfg.frameMs) % cfg.frames;
  drawImageSnapped(ctx, state.img, f * cfg.w, 0, cfg.w, cfg.h, x0 - (cfg.w / 2) * s, footY + ((cfg.offsetY ?? 0) - cfg.h) * s, cfg.w * s, cfg.h * s);
}

// 도는 조각 - front=false면 sin a <= 0(뒤), true면 sin a > 0(앞).
function drawShards(ctx, sheets, color, manifest, x0, footY, s, t, front) {
  const cfg = manifest.shard;
  const state = sheets.get(`shard_${color}`);
  if (!cfg?.orbit || !state?.loaded || state.failed) return;
  const { count, rx, ry, centerY, periodMs } = cfg.orbit;
  const base = Math.floor(t / cfg.frameMs);
  for (let k = 0; k < count; k++) {
    const a = 2 * Math.PI * (t / periodMs + k / count);
    const sin = Math.sin(a);
    if (sin > 0 !== front) continue;
    const ox = Math.round(rx * Math.cos(a) - cfg.w / 2);
    const oy = Math.round(centerY + ry * sin - cfg.h / 2);
    const f = (base + 2 * k) % cfg.frames;
    drawImageSnapped(ctx, state.img, f * cfg.w, 0, cfg.w, cfg.h, x0 + ox * s, footY + oy * s, cfg.w * s, cfg.h * s);
  }
}

// fx_back(5) - 다른 수호자의 Lv 글자를 가리지 않게 _drawTowers가 수호자들보다 먼저 따로 그린다.
export function drawGuardianFxBack(ctx, assets, color, tier, x0, footY, s, t) {
  const m = assets.guardianFxManifest;
  if (tier >= m.back?.fromTier) drawStrip(ctx, assets.guardianFxSheets, 'back', color, m, x0, footY, s, t);
}

// 수호자 스프라이트 뒤: fx_ground(1+) → 뒤쪽 조각(4+).
export function drawGuardianFxBehind(ctx, assets, color, tier, x0, footY, s, t) {
  const m = assets.guardianFxManifest;
  const sheets = assets.guardianFxSheets;
  if (tier >= m.ground?.fromTier) drawStrip(ctx, sheets, 'ground', color, m, x0, footY, s, t);
  if (tier >= m.shard?.fromTier) drawShards(ctx, sheets, color, m, x0, footY, s, t, false);
}

// 수호자 스프라이트 앞: fx_motes(2+) → 앞쪽 조각(4+).
export function drawGuardianFxFront(ctx, assets, color, tier, x0, footY, s, t) {
  const m = assets.guardianFxManifest;
  const sheets = assets.guardianFxSheets;
  if (tier >= m.motes?.fromTier) drawStrip(ctx, sheets, 'motes', color, m, x0, footY, s, t);
  if (tier >= m.shard?.fromTier) drawShards(ctx, sheets, color, m, x0, footY, s, t, true);
}

// 윤곽(3+) - 수호자와 같은 반전 변환 안에서 호출. drawX0/drawY0 = 수호자 프레임 왼쪽 위.
export function drawGuardianOutline(ctx, assets, animData, tier, frame, drawX0, drawY0, s, t) {
  const m = assets.guardianFxManifest;
  const sheets = animData.outline;
  if (!sheets || !m.outline || tier < m.outline.fromTier) return;
  const img = Math.floor(t / m.outline.pulseMs) % 2 === 0 ? sheets.bright : sheets.dim;
  const W = animData.frameW + 2;
  const H = animData.frameH + 2;
  drawImageSnapped(ctx, img, frame * W, 0, W, H, drawX0 - s, drawY0 - s, W * s, H * s);
}

// ---------- 수호자 일반 공격 연출(assets/guardians/fx/attack_manifest.json) ----------
// 보이는 모습만 - 피해·발사 주기·투사체 속도·명중 판정은 battleRenderer/battleState 그대로.
// 시트는 오른쪽으로 쏘는 방향. 왼쪽이면 좌우 반전 + anchor x -> w-1-x. 그릴 위치 = 기준점 - anchor * s.
// 투사체만 진행 방향으로 회전(15도 단위, 원본 해상도에서 돌려 캐시). 시전·명중·잔상은 회전 없음.
export const ATK_FX_MAX = 40; // 동시에 떠 있는 hit + residue 합계

// kind = 'proj'|'cast'|'hit'|'residue'. 시트 키 = "{kind}{tier}_{색}", residue는 "residue_{색}".
export const atkKey = (kind, tier, color) => (kind === 'residue' ? `residue_${color}` : `${kind}${tier}_${color}`);
export function atkCfg(m, kind, tier, color) {
  return kind === 'residue' ? m?.residue?.[color] : m?.[kind]?.[tier]?.[color];
}

// el = 시작 후 경과 ms. 루프가 아니면 끝난 뒤 -1.
export function atkFrame(cfg, el) {
  const f = Math.floor(el / cfg.frameMs);
  if (cfg.loop) return f % cfg.frames;
  return f < cfg.frames ? f : -1;
}

// 그렸으면 true(시트 없음/로드 실패면 false - 호출 쪽이 예전 그림으로 대체).
// 투사체 회전: 진행 방향을 ROT_STEP 단위로 끊고 ±ROT_MAX에서 자른다(오른쪽 기준 각도, y 아래가 +).
export const ROT_STEP = 15;
export const ROT_MAX = 60;
export function quantizeAngle(dx, dy) {
  const deg = (Math.atan2(dy, Math.abs(dx)) * 180) / Math.PI; // 왼쪽으로 쏘면 반전해서 그리므로 dx를 뒤집은 각도
  return Math.max(-ROT_MAX, Math.min(ROT_MAX, Math.round(deg / ROT_STEP) * ROT_STEP)) || 0;
}

// 원본 해상도에서 회전한 프레임 스트립(픽셀 격자 유지 - 화면에서 3배로 키우기 전에 돌린다).
// 소스 이미지(밝은 시트 포함)마다 각도별로 1번 만들어 둔다.
const rotCache = new WeakMap(); // img -> Map(deg -> { img, w, h, anchor })
export function rotatedSheet(img, cfg, deg) {
  let byDeg = rotCache.get(img);
  if (!byDeg) rotCache.set(img, (byDeg = new Map()));
  let r = byDeg.get(deg);
  if (r) return r;
  const [ax, ay] = cfg.anchor;
  // anchor 픽셀 가운데를 축으로 돌린다 - 축에서 가장 먼 모서리까지가 반지름.
  const R = Math.ceil(Math.max(Math.hypot(ax + 0.5, ay + 0.5), Math.hypot(cfg.w - ax - 0.5, ay + 0.5), Math.hypot(ax + 0.5, cfg.h - ay - 0.5), Math.hypot(cfg.w - ax - 0.5, cfg.h - ay - 0.5)));
  const S = 2 * R + 1;
  const c = document.createElement('canvas');
  c.width = S * cfg.frames;
  c.height = S;
  const x = c.getContext('2d');
  x.imageSmoothingEnabled = false;
  const rad = (deg * Math.PI) / 180;
  for (let f = 0; f < cfg.frames; f++) {
    x.setTransform(1, 0, 0, 1, f * S + R + 0.5, R + 0.5);
    x.rotate(rad);
    x.drawImage(img, f * cfg.w, 0, cfg.w, cfg.h, -ax - 0.5, -ay - 0.5, cfg.w, cfg.h);
  }
  r = { img: c, w: S, h: S, anchor: [R, R] };
  byDeg.set(deg, r);
  return r;
}

// recolor(key, img) = 다른 시트로 바꿔 그릴 때(분노의 북 - 밝은 투사체). rot = quantizeAngle 결과(투사체만).
export function drawAtkSprite(ctx, assets, kind, tier, color, f, x, y, s, flip, recolor = null, rot = 0) {
  const cfg = atkCfg(assets?.guardianAtkManifest, kind, tier, color);
  const key = atkKey(kind, tier, color);
  const st = cfg && assets.guardianAtkSheets?.get(key);
  if (!st?.loaded || st.failed) return false;
  let img = recolor ? recolor(key, st.img) : st.img;
  let { w, h, anchor } = cfg;
  if (rot) ({ img, w, h, anchor } = rotatedSheet(img, cfg, rot));
  const ax = flip ? w - 1 - anchor[0] : anchor[0];
  const dx = snapPx(x - ax * s);
  const dy = snapPx(y - anchor[1] * s);
  if (!flip) {
    drawImageSnapped(ctx, img, f * w, 0, w, h, dx, dy, w * s, h * s);
    return true;
  }
  ctx.save();
  ctx.translate(dx + w * s, dy);
  ctx.scale(-1, 1);
  drawImageSnapped(ctx, img, f * w, 0, w, h, 0, 0, w * s, h * s);
  ctx.restore();
  return true;
}

// 시전(cast)·명중(hit)·바닥 잔상(residue) 1회 재생 목록. 객체는 풀에서 재사용.
export class GuardianAttackFx {
  constructor() {
    this._casts = [];
    this._fx = []; // hit + residue, 오래된 것부터
    this._pool = [];
  }

  reset() {
    for (const o of this._casts) this._pool.push(o);
    for (const o of this._fx) this._pool.push(o);
    this._casts.length = 0;
    this._fx.length = 0;
  }

  _make(kind, tier, color, x, y, s, flip, now, enemyId = null) {
    const o = this._pool.pop() ?? {};
    o.kind = kind;
    o.tier = tier;
    o.color = color;
    o.x = x;
    o.y = y;
    o.s = s;
    o.flip = flip;
    o.startMs = now;
    o.enemyId = enemyId;
    return o;
  }

  _pushFx(o) {
    if (this._fx.length >= ATK_FX_MAX) this._pool.push(this._fx.shift());
    this._fx.push(o);
  }

  cast(tier, color, x, y, s, flip, now) {
    this._casts.push(this._make('cast', tier, color, x, y, s, flip, now));
  }

  hit(tier, color, x, y, s, flip, now) {
    this._pushFx(this._make('hit', tier, color, x, y, s, flip, now));
  }

  // 같은 몬스터의 잔상이 재생 중이면 새로 만들지 않고 그 자리(지금 발밑)에서 처음부터.
  residue(enemyId, color, x, y, s, flip, now) {
    const i = this._fx.findIndex((o) => o.kind === 'residue' && o.enemyId === enemyId);
    const o = i >= 0 ? this._fx.splice(i, 1)[0] : null;
    if (o) {
      Object.assign(o, { color, x, y, s, flip, startMs: now });
      this._fx.push(o);
    } else this._pushFx(this._make('residue', 0, color, x, y, s, flip, now, enemyId));
  }

  drawCasts(ctx, assets, now) {
    this._drawList(ctx, assets, now, this._casts, null);
  }

  drawResidues(ctx, assets, now) {
    this._drawList(ctx, assets, now, this._fx, 'residue');
  }

  // 각 draw가 자기 종류의 끝난 것만 풀로 돌려준다.
  drawHits(ctx, assets, now) {
    this._drawList(ctx, assets, now, this._fx, 'hit');
  }

  _drawList(ctx, assets, now, list, only) {
    if (list.length === 0) return;
    const m = assets?.guardianAtkManifest;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    let n = 0;
    for (const o of list) {
      const cfg = atkCfg(m, o.kind, o.tier, o.color);
      const f = cfg ? atkFrame(cfg, now - o.startMs) : -1;
      if (only && o.kind !== only) {
        list[n++] = o; // 다른 종류는 그 종류를 그릴 때 정리
        continue;
      }
      if (f < 0) {
        this._pool.push(o);
        continue;
      }
      list[n++] = o;
      drawAtkSprite(ctx, assets, o.kind, o.tier, o.color, f, o.x, o.y, o.s, o.flip);
    }
    list.length = n;
    ctx.restore();
  }
}
