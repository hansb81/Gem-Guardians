// 몬스터 타격·사망 이펙트(assets/effects/monster/README.md). 렌더 전용 - 게임 로직(골드·처치 수·타깃)은 battleState가 그대로.
//   타격: hit_{석상 색} 스프라이트 + 번쩍 버전(flashMap, 프레임 이미지별 1번 캐시) + 뒤로 밀림(battleRenderer가 오프셋).
//   사망: 번쩍(flashMs) -> 재 흩어짐(dissolveMs, 사망 순간 파티클 1번 생성) + smokeAtMs 연기 + soulAtMs 영혼불, 끝나면 버림.
// 그림은 몬스터와 같은 배율, imageSmoothingEnabled=false, 루프 없음.

// 작업용 캔버스는 CPU 쪽(willReadFrequently) - 보통 캔버스에서 getImageData를 하면 GPU 되읽기로 1번에 30ms 넘게 멈춘다.
const CPU = { willReadFrequently: true };

// ---------- README 코드 그대로(작업 캔버스 옵션만 CPU) ----------
function makeFlash(img, flashMap) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d', CPU);
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, c.width, c.height);
  const p = d.data;
  for (let i = 0; i < p.length; i += 4) {
    if (!p[i + 3]) continue;
    const h = ((p[i] << 16) | (p[i + 1] << 8) | p[i + 2]).toString(16).padStart(6, '0');
    const n = flashMap[h] || 'e8dcc0';
    p[i] = parseInt(n.slice(0, 2), 16);
    p[i + 1] = parseInt(n.slice(2, 4), 16);
    p[i + 2] = parseInt(n.slice(4, 6), 16);
  }
  x.putImageData(d, 0, 0);
  return c;
}

function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// img = 마지막 프레임(좌우 반전해서 그리고 있었다면 반전된 상태로).
function buildDissolve(img, seed) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  const x = c.getContext('2d', CPU);
  x.drawImage(img, 0, 0);
  const p = x.getImageData(0, 0, c.width, c.height).data;
  const w = c.width;
  const h = c.height;
  const r = mulberry32(seed);
  let top = h;
  let bot = 0;
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) if (p[(y * w + i) * 4 + 3]) {
    top = Math.min(top, y);
    bot = Math.max(bot, y);
  }
  const parts = [];
  for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
    const k = (y * w + i) * 4;
    if (!p[k + 3]) continue;
    parts.push({ x: i, y, c: `rgb(${p[k]},${p[k + 1]},${p[k + 2]})`, delay: ((y - top) / Math.max(1, bot - top)) * 0.45 + r() * 0.15,
      dx: (r() - 0.35) * 7, dy: -(3 + r() * 9), keep: r() });
  }
  return parts;
}

// t = 0..1 (경과 / dissolveMs), (sx,sy) = 스프라이트 왼쪽 위 화면 좌표, s = 배율
function drawDissolve(ctx, parts, t, sx, sy, s, ash) {
  for (const q of parts) {
    if (t < q.delay) {
      ctx.fillStyle = q.c;
      ctx.fillRect(sx + q.x * s, sy + q.y * s, s, s);
      continue;
    }
    const p = Math.min(1, (t - q.delay) / 0.45);
    if (q.keep < p) continue;
    ctx.fillStyle = p > 0.08 ? ash[Math.min(2, Math.floor(p * 3))] : '#e8dcc0';
    ctx.fillRect(sx + Math.round(q.x + q.dx * p) * s, sy + Math.round(q.y + q.dy * p) * s, s, s);
  }
}
// ---------- 끝 ----------

const ASH = ['#655a74', '#3b3347', '#221c2b'];
const SMALL_MAX_PX = 32; // 이 크기 이하 = death_smoke_s, 넘거나 보스 = _l

function flipped(img) {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth || img.width;
  c.height = img.naturalHeight || img.height;
  const x = c.getContext('2d', CPU);
  x.translate(c.width, 0);
  x.scale(-1, 1);
  x.drawImage(img, 0, 0);
  return c;
}

function seedOf(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}

export class MonsterFx {
  constructor() {
    this._flash = new WeakMap(); // 프레임 이미지 -> 번쩍 캔버스
    this._sprites = []; // { anim, x, y, startMs } - x,y = 기준점(anim.anchor) 화면 좌표
    this._dying = []; // 사망 연출 중인 그림
    this._started = new WeakSet(); // 사망 연출을 시작한 적(객체)
  }

  reset() {
    this._sprites.length = 0;
    this._dying.length = 0;
  }

  flashImage(img, assets) {
    const map = assets?.monsterFxManifest?.flashMap;
    if (!map) return img;
    let c = this._flash.get(img);
    if (!c) {
      c = makeFlash(img, map);
      this._flash.set(img, c);
    }
    return c;
  }

  // 석상 투사체가 닿은 순간(battleRenderer._drawTowerProjectiles).
  hit(color, x, y, now) {
    this._sprites.push({ key: `hit_${color}`, x, y, startMs: now });
  }

  // HP 0 순간 1번. g = { id, img(그리던 프레임 원본), flip, scale, sx, sy(왼쪽 위), footX, footY, bodyY, big }.
  // img가 없으면(스프라이트 로드 실패) 연기·영혼만.
  die(enemy, g, now, assets) {
    if (this._started.has(enemy)) return;
    this._started.add(enemy);
    const death = assets?.monsterFxManifest?.death ?? {};
    this._sprites.push({ key: g.big ? 'death_smoke_l' : 'death_smoke_s', x: g.footX, y: g.footY, startMs: now + (death.smokeAtMs ?? 60) });
    this._sprites.push({ key: 'death_soul', x: g.footX, y: g.bodyY, startMs: now + (death.soulAtMs ?? 200) });
    if (!g.img) return;
    const src = g.flip ? flipped(g.img) : g.img;
    this._dying.push({ ...g, src, flash: this.flashImage(src, assets), parts: buildDissolve(src, seedOf(g.id)), startMs: now });
  }

  // 죽어 가는 몸(번쩍 -> 재 흩어짐). 살아 있는 몬스터보다 먼저(뒤에) 그린다.
  drawDying(ctx, assets, now) {
    if (this._dying.length === 0) return;
    const m = assets?.monsterFxManifest ?? {};
    const flashMs = m.death?.flashMs ?? 70;
    const dissolveMs = m.death?.dissolveMs ?? 700;
    const knockPx = m.hit?.knockbackPx ?? 1;
    const knockMs = m.hit?.knockbackMs ?? 80;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    let n = 0;
    for (const d of this._dying) {
      const el = now - d.startMs;
      if (el >= flashMs + dissolveMs) continue; // 끝 - 파티클 배열째 버린다
      this._dying[n++] = d;
      const w = d.src.width * d.scale;
      const h = d.src.height * d.scale;
      if (el < flashMs) {
        const knock = Math.round(knockPx * d.scale * Math.max(0, 1 - el / knockMs));
        ctx.drawImage(d.flash, d.sx + knock, d.sy, w, h);
      } else {
        drawDissolve(ctx, d.parts, (el - flashMs) / dissolveMs, d.sx, d.sy, d.scale, m.death?.ash ?? ASH);
      }
    }
    this._dying.length = n;
    ctx.restore();
  }

  // hit·연기·영혼 스프라이트(맨 위). scale = 몬스터 기본 정수 배율.
  drawSprites(ctx, assets, now, scale) {
    if (this._sprites.length === 0) return;
    const anims = assets?.monsterFxAnims;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    let n = 0;
    for (const s of this._sprites) {
      const a = anims?.get(s.key);
      const el = now - s.startMs;
      if (!a || el >= a.durationMs) continue;
      this._sprites[n++] = s;
      if (el < 0 || !a.state?.loaded || a.state.failed) continue; // 아직(연기·영혼 예약) / 로드 실패
      const f = frameAt(a, el);
      const w = a.frameW * scale;
      const h = a.frameH * scale;
      const x = Math.round(s.x - w / 2);
      const y = Math.round(a.anchor === 'center' ? s.y - h / 2 : s.y - h); // bottom-center
      ctx.drawImage(a.state.img, f * a.frameW, 0, a.frameW, a.frameH, x, y, w, h);
    }
    this._sprites.length = n;
    ctx.restore();
  }
}

// frameMs = 숫자(고정) 또는 프레임별 배열.
function frameAt(a, el) {
  if (!Array.isArray(a.frameMs)) return Math.min(a.frames - 1, Math.floor(el / a.frameMs));
  let acc = 0;
  for (let i = 0; i < a.frames; i++) {
    acc += a.frameMs[i];
    if (el < acc) return i;
  }
  return a.frames - 1;
}

export const isBigMonster = (frameW, frameH, rank) => rank === 'boss' || Math.max(frameW, frameH) > SMALL_MAX_PX;
