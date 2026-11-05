// 박스 잼 체인 라이트닝 픽셀 번개 - assets/effects/README.md #4 그대로 포팅.
// 대상이 보드 어디든(거리/각도 제각각) 될 수 있어 번개 줄기는 이미지가 아니라 코드로
// 픽셀을 찍어 그린다. seed 기반 RNG만 사용(Math.random 금지, CLAUDE.md 규칙).
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function linePx(x0, y0, x1, y1) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  const out = [];
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) return out;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

// source -> target 사이의 지그재그 핵심 경로(core) + 가끔 옆으로 뻗는 가지(branches)를
// seed로 고정 계산한다. reshapeMs마다 seed를 바꿔 다시 부르면 모양이 꿈틀거린다.
export function boltPath(sx, sy, tx, ty, seed) {
  const r = mulberry32(seed);
  const dx = tx - sx;
  const dy = ty - sy;
  const L = Math.hypot(dx, dy) || 1;
  const nx = -dy / L;
  const ny = dx / L;
  const n = Math.max(2, Math.round(L / 10));
  const pts = [[sx, sy]];
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const j = (r() * 2 - 1) * Math.min(5, 1 + L / 20);
    pts.push([sx + dx * t + nx * j, sy + dy * t + ny * j]);
  }
  pts.push([tx, ty]);

  let core = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const s = linePx(...pts[i], ...pts[i + 1]);
    core = core.concat(i ? s.slice(1) : s);
  }

  const branches = [];
  for (let i = 1; i < pts.length - 1; i++) {
    if (r() < 0.45) {
      const side = r() < 0.5 ? 1 : -1;
      const bl = 3 + r() * 4;
      branches.push([
        i / n,
        linePx(...pts[i], pts[i][0] + ((dx / L) * 0.6 + nx * side) * bl, pts[i][1] + ((dy / L) * 0.6 + ny * side) * bl).slice(1),
      ]);
    }
  }

  return { core, branches };
}

// put(x,y,'#rrggbb')로 한 칸씩 찍어 번개를 그린다. t=0..1(진행도), col=manifest.box.colors[색].
// 반환값 = 뻗는 중일 때(t<0.3) 머리 위치(box_soul을 그 자리에 그리기 위함), 다 뻗었으면 null.
export function drawPixelBolt(put, { core, branches }, t, col) {
  const grow = Math.min(1, t / 0.3);
  const body = core.slice(0, Math.max(1, Math.round(core.length * grow)));
  const [cc, gc] = t < 0.5 ? [col.core, col.glow] : t < 0.75 ? [col.glow, col.glowDark] : [col.glowDark, null];
  const K = (x, y) => x + ',' + y;
  const all = new Set(body.map((p) => K(...p)));
  const br = [];
  if (t < 0.75) {
    for (const [f, b] of branches) {
      if (f <= grow) {
        for (const p of b) {
          br.push(p);
          all.add(K(...p));
        }
      }
    }
  }
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  if (gc) {
    const glow = new Map();
    for (const k of all) {
      const [x, y] = k.split(',').map(Number);
      for (const [a, b] of N4) {
        const q = K(x + a, y + b);
        if (!all.has(q)) glow.set(q, [x + a, y + b]);
      }
    }
    for (const [x, y] of glow.values()) {
      for (const [a, b] of N4) {
        const q = K(x + a, y + b);
        if (!all.has(q) && !glow.has(q)) put(x + a, y + b, col.outline);
      }
    }
    for (const [x, y] of glow.values()) put(x, y, gc);
  }
  body.forEach(([x, y], i) => {
    if (!(t >= 0.75 && i % 3 === 0)) put(x, y, cc);
  });
  for (const [x, y] of br) put(x, y, gc || cc);
  return grow < 1 ? body[body.length - 1] : null;
}
