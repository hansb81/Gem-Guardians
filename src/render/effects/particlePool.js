// 고정 크기 객체 풀 - 매 프레임 새 배열/객체를 만들지 않는다. 슬롯은 생성자에서 미리
// maxParticles개 만들어두고, spawn/update/draw는 그 슬롯들의 필드만 덮어쓴다.
export class ParticlePool {
  constructor(maxParticles) {
    this.particles = new Array(maxParticles);
    for (let i = 0; i < maxParticles; i++) {
      this.particles[i] = {
        active: false,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 0,
        color: '#ffffff',
        size: 4,
        shape: 'rect',
      };
    }
  }

  // 빈 슬롯이 없으면 그냥 스폰을 생략한다(드랍, 에러 없음).
  spawn({ x, y, vx, vy, life, color, size, shape = 'rect' }) {
    for (const p of this.particles) {
      if (p.active) continue;
      p.active = true;
      p.x = x;
      p.y = y;
      p.vx = vx;
      p.vy = vy;
      p.life = life;
      p.maxLife = life;
      p.color = color;
      p.size = size;
      p.shape = shape;
      return p;
    }
    return null;
  }

  update(dtMs) {
    const dt = dtMs / 1000;
    for (const p of this.particles) {
      if (!p.active) continue;
      p.life -= dtMs;
      if (p.life <= 0) {
        p.active = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }

  draw(ctx) {
    for (const p of this.particles) {
      if (!p.active) continue;
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      const half = p.size / 2;
      if (p.shape === 'circle') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, half, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(p.x - half, p.y - half, p.size, p.size);
      }
    }
    ctx.globalAlpha = 1;
  }
}
