// 젬 기술 v3 전투 이펙트(assets/skills/README.md). battleState의 skillCast / effectImmune 이벤트와
// 적의 effects 상태를 그림으로 바꾸고, 명중 시점에 battleState.resolveSkillHit을 부른다.
// 규칙: 석상 위·석상→적 연출 없음 - 모든 기술은 전투 길(track) 위 적 쪽에서만 나타난다.
// 이펙트 애니 상태는 _fx(castId 등 id 기반 리스트)에 두고 끝나면 제거한다. 파티클은
// CanvasRenderer의 ParticlePool 하나를 같이 쓴다(battleRenderer.particles).
import { drawText } from './uiKit.js';
import { getFontString } from '../config/fonts.js';
import { t } from '../config/i18n.js';
import { drawImageSnapped } from './screenFit.js';

const COLORS = ['red', 'blue', 'yellow', 'green', 'purple'];
const BONE = '#e8dcc0';
const TRAIL_STEP_MS = 24;
const IMMUNE_RISE_PX = 26;

// 프레임 인덱스(끝났으면 -1). frameMs는 숫자 또는 프레임별 배열.
function frameAt(anim, ageMs) {
  if (ageMs < 0) return -1;
  let acc = 0;
  for (let i = 0; i < anim.frames; i++) {
    acc += Array.isArray(anim.frameMs) ? anim.frameMs[i] : anim.frameMs;
    if (ageMs < acc) return i;
  }
  return -1;
}

function frameStart(anim, frame) {
  let acc = 0;
  for (let i = 0; i < frame; i++) acc += Array.isArray(anim.frameMs) ? anim.frameMs[i] : anim.frameMs;
  return acc;
}

const totalMs = (anim) => frameStart(anim, anim.frames);

// 결정적 0~1 해시(Math.random 금지).
function hash01(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export class SkillFx {
  constructor() {
    this._fx = []; // { id, kind, ... } - 끝나면 제거.
    this._seen = new WeakSet(); // 처리한 이벤트(객체 참조).
    this._enemy = new WeakMap(); // enemy 객체 -> 렌더 전용 상태(위치·넉백·파티클 누적).
    this._lastNow = null;
    this._seq = 0;
    this.trackWidth = 0;
  }

  // 적마다 한 번만 만드는 렌더 상태. _drawEnemies가 위치를 매 프레임 덮어쓴다.
  enemyState(enemy) {
    let s = this._enemy.get(enemy);
    if (!s) {
      s = { bodyX: 0, bodyY: 0, footX: 0, footY: 0, headY: 0, kbPx: 0, kbStartMs: 0, slowAcc: 0, poisonAcc: 0, lastMark: 0, stunNow: null };
      this._enemy.set(enemy, s);
    }
    return s;
  }

  // 넉백 렌더 오프셋: core progress는 명중 순간 이미 뒤로 갔으므로 -kbPx에서 0으로 보간(오른쪽으로 밀림).
  knockOffset(st, now, ms) {
    if (st.kbPx === 0) return 0;
    const k = (now - st.kbStartMs) / ms;
    if (k >= 1) {
      st.kbPx = 0;
      return 0;
    }
    return -st.kbPx * (1 - k);
  }

  // 탑 직격이 레드면 fx_splash(직격 적 중심). resolveTowerAttack 직전에 부른다.
  // 기본 사격에 색 효과가 붙는 설정(appliesTo 'all')일 때만.
  onTowerHit(bs, hitEvent, now) {
    if (hitEvent.color !== 'red' || hitEvent.fromModifier || bs.skills?.colorEffects.appliesTo !== 'all') return;
    const e = bs.enemies.find((x) => x.id === hitEvent.targetEnemyId);
    if (e?.state === 'alive') this._redSplash(bs, e, now);
  }

  _redSplash(bs, e, now) {
    if (!bs.skills?.unlocked?.colorEffects?.red || e.immune?.includes('red')) return;
    this._addSprite('fx_splash', null, e, now);
  }

  _addSprite(key, color, enemy, now, delayMs = 0) {
    const st = this.enemyState(enemy);
    this._fx.push({ id: this._seq++, kind: 'sprite', key, color, enemy, x: st.bodyX, y: st.bodyY, startMs: now + delayMs });
  }

  _resolve(bs, event, enemyId, now) {
    const e = bs.enemies.find((x) => x.id === enemyId);
    const wasAlive = e?.state === 'alive';
    const before = e?.progress;
    bs.resolveSkillHit(event, enemyId);
    if (!wasAlive) return;
    if (event.skill === 'line' && e.progress < before) {
      const st = this.enemyState(e);
      st.kbPx = (before - e.progress) * this.trackWidth;
      st.kbStartMs = now;
    }
    if (event.color === 'red' && event.skill !== 'color') this._redSplash(bs, e, now);
  }

  // 연출 위치를 살아 있는 적에 붙여 따라가게(죽으면 마지막 위치에 남김).
  _follow(o, foot) {
    if (!o.enemy || o.enemy.state !== 'alive') return;
    const st = this.enemyState(o.enemy);
    o.x = foot ? st.footX : st.bodyX;
    o.y = foot ? st.footY : st.bodyY;
  }

  // 새 이벤트 처리 + 진행 중 연출 갱신(명중 판정) + 상태 효과 파티클. _drawEnemies 다음에 부른다.
  update(bs, track, assets, now, particles, shake) {
    const dtMs = this._lastNow == null ? 0 : Math.min(50, Math.max(0, now - this._lastNow));
    this._lastNow = now;
    this.trackWidth = track.width;
    const man = assets?.skillManifest;
    const anims = assets?.skillAnims;
    const scale = assets?.enemySpriteRules?.displayScale ?? 2;

    for (const event of bs.events) {
      if (this._seen.has(event)) continue;
      if (event.type === 'skillCast') {
        this._seen.add(event);
        this._startCast(bs, event, track, man, anims, now);
      } else if (event.type === 'effectImmune') {
        this._seen.add(event);
        const e = bs.enemies.find((x) => x.id === event.enemyId);
        if (e) this._fx.push({ id: this._seq++, kind: 'text', enemy: e, startMs: now, ms: event.durationMs || 400 });
      }
    }

    let w = 0;
    for (const fx of this._fx) {
      if (this._step(fx, bs, track, man, anims, now, dtMs, scale, particles, shake)) this._fx[w++] = fx;
    }
    this._fx.length = w;

    this._updateStatus(bs, man, now, dtMs, scale, particles);
  }

  _startCast(bs, event, track, man, anims, now) {
    const skill = man?.skills?.[event.skill];
    const resolveAll = () => {
      for (const id of event.targets) this._resolve(bs, event, id, now);
    };
    if (!skill) {
      resolveAll(); // manifest가 없으면 연출 없이 즉시 적용.
      return;
    }
    const color = event.color;
    const byId = (id) => bs.enemies.find((x) => x.id === id);
    const base = { id: event.castId, event, startMs: now, resolved: false };

    if (event.skill === 'line' || event.skill === 'bomb') {
      const anim = anims?.get(skill.anim.replace('{color}', color));
      if (!anim) {
        resolveAll();
        return;
      }
      const hitFrame = typeof skill.hitFrame === 'object' ? skill.hitFrame[color] : skill.hitFrame;
      const anchorId = event.skill === 'line' ? event.targets[0] : event.extra?.centerEnemyId;
      const enemy = byId(anchorId);
      const st = enemy ? this.enemyState(enemy) : null;
      this._fx.push({
        ...base,
        kind: event.skill,
        anim,
        hitMs: frameStart(anim, hitFrame),
        enemy,
        x: event.skill === 'line' ? st?.bodyX : st?.footX,
        y: event.skill === 'line' ? st?.bodyY : st?.footY,
        shake: event.skill === 'bomb' && (color === 'red' || color === 'blue' || color === 'yellow') ? skill.shakeMs : 0,
        drop: event.skill === 'line' ? skill.dropFrom ?? null : null, // 위에서 꽂히는 구간(원본 px)
        dropFrame: skill.dropFrame ?? 1,
      });
    } else if (event.skill === 'box') {
      const souls = event.targets.map((id, i) => {
        const h = hash01(event.castId * 7 + i);
        const h2 = hash01(event.castId * 13 + i + 1);
        const edge = Math.floor(h * 3); // 0 위, 1 아래, 2 오른쪽 - 석상 쪽(왼쪽)은 쓰지 않는다.
        const left = track.x + track.width * 0.35;
        const x = edge === 2 ? track.x + track.width : left + (track.x + track.width - left) * h2;
        const y = edge === 0 ? track.y : edge === 1 ? track.y + track.height : track.y + track.height * h2;
        return { origId: id, target: byId(id), x, y, vx: 0, vy: 0, trailAcc: 0, done: false };
      });
      this._fx.push({ ...base, kind: 'box', souls, speed: skill.speedPxPerSec, curve: skill.curve });
    } else if (event.skill === 'color') {
      this._fx.push({ id: this._seq++, kind: 'flash', color: man.tint?.ramps?.[color]?.[3] ?? BONE, startMs: now, ms: skill.flashMs });
      for (const id of event.targets) {
        const e = byId(id);
        if (e) this._addSprite('hit', color, e, now);
      }
      resolveAll();
    } else if (event.skill === 'color_color') {
      const anim = anims?.get(skill.anim);
      if (!anim) {
        resolveAll();
        return;
      }
      const pillars = (event.extra?.order ?? event.targets).map((id, i) => {
        const enemy = byId(id);
        const st = enemy ? this.enemyState(enemy) : null;
        return { id, enemy, x: st?.footX, y: st?.footY, delayMs: i * skill.staggerMs, resolved: false };
      });
      this._fx.push({ ...base, kind: 'color_color', anim, pillars, hitMs: frameStart(anim, skill.hitFrame), flashMs: skill.flashMs });
    }
  }

  // fx 1개 진행. false = 끝(리스트에서 제거).
  _step(fx, bs, track, man, anims, now, dtMs, scale, particles, shake) {
    const age = now - fx.startMs;
    switch (fx.kind) {
      case 'sprite':
        this._follow(fx, false);
        return age < 0 || frameAt(anims?.get(fx.key) ?? { frames: 0 }, age) >= 0;
      case 'text':
      case 'flash':
        return age < fx.ms;
      case 'line':
      case 'bomb':
        this._follow(fx, fx.kind === 'bomb');
        if (!fx.resolved && age >= fx.hitMs) {
          fx.resolved = true;
          for (const id of fx.event.targets) this._resolve(bs, fx.event, id, now);
          if (fx.shake) shake?.(4, fx.shake);
        }
        return age < totalMs(fx.anim);
      case 'color_color': {
        let alive = false;
        for (const p of fx.pillars) {
          this._follow(p, true);
          const pAge = age - p.delayMs;
          if (!p.resolved && pAge >= fx.hitMs) {
            p.resolved = true;
            if (p === fx.pillars[0]) this._fx.push({ id: this._seq++, kind: 'flash', color: BONE, startMs: now, ms: fx.flashMs });
            if (p.enemy) p.hitStartMs = now;
            this._resolve(bs, fx.event, p.id, now);
          }
          if (pAge < totalMs(fx.anim) || (p.hitStartMs != null && now - p.hitStartMs < 300)) alive = true;
        }
        return alive;
      }
      case 'box': {
        const speed = fx.speed * scale;
        const dt = dtMs / 1000;
        let alive = false;
        for (const s of fx.souls) {
          if (s.done) continue;
          if (!s.target || s.target.state !== 'alive') {
            // 대상이 먼저 죽으면 core가 예약을 새 대상으로 옮긴다. 없으면 그 자리에서 소멸(hit 없음).
            const newId = bs.retargetSkillHit(fx.event, s.origId);
            s.target = newId == null ? null : bs.enemies.find((e) => e.id === newId);
            if (!s.target) {
              s.done = true;
              continue;
            }
            s.origId = newId;
          }
          const st = this.enemyState(s.target);
          const dx = st.bodyX - s.x;
          const dy = st.bodyY - s.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 8) {
            s.done = true;
            this._addSprite('hit', fx.event.color, s.target, now);
            this._resolve(bs, fx.event, s.origId, now); // origId = 지금 예약이 걸린 대상(바뀌었으면 새 대상).
            continue;
          }
          s.vx += ((dx / dist) * speed - s.vx) * fx.curve;
          s.vy += ((dy / dist) * speed - s.vy) * fx.curve;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.trailAcc += dtMs;
          if (s.trailAcc >= TRAIL_STEP_MS) {
            s.trailAcc -= TRAIL_STEP_MS;
            particles?.spawn({ x: s.x, y: s.y, vx: 0, vy: 0, life: 320, color: man?.tint?.ramps?.[fx.event.color]?.[2] ?? BONE, size: 2 * scale, battle: true });
          }
          alive = true;
        }
        return alive;
      }
      default:
        return false;
    }
  }

  // 상태 효과 파티클 + 표식이 붙는 순간 hit(초록).
  _updateStatus(bs, man, now, dtMs, scale, particles) {
    const ramps = man?.tint?.ramps;
    if (!ramps) return;
    for (const e of bs.enemies) {
      if (e.state !== 'alive' || !e.effects) continue;
      const st = this.enemyState(e);
      const fx = e.effects;
      if (fx.slow.time > 1e-9) {
        st.slowAcc += dtMs;
        while (st.slowAcc >= 500) {
          st.slowAcc -= 500;
          const j = (hash01(this._seq++) - 0.5) * 12 * scale;
          particles?.spawn({ x: st.footX + j, y: st.footY, vx: 0, vy: -10 * scale, life: 400, color: ramps.blue[3], size: scale, battle: true });
        }
      } else st.slowAcc = 0;
      if (fx.poison.stacks > 0 && fx.poison.time > 1e-9) {
        st.poisonAcc += dtMs;
        while (st.poisonAcc >= 333) {
          st.poisonAcc -= 333;
          const j = (hash01(this._seq++) - 0.5) * 10 * scale;
          particles?.spawn({ x: st.bodyX + j, y: st.bodyY, vx: 0, vy: 6 * scale, life: 500, color: ramps.purple[2], size: 2 * scale, battle: true });
        }
      } else st.poisonAcc = 0;
      if (fx.mark.stacks > st.lastMark) this._addSprite('hit', 'green', e, now);
      st.lastMark = fx.mark.stacks;
    }
  }

  _drawAnim(ctx, anim, frame, x, y, scale, color) {
    const img = color && anim.tinted ? anim.tinted[color] : anim.state?.loaded ? anim.state.img : null;
    if (!img) return;
    drawImageSnapped(ctx, img, frame * anim.frameW, 0, anim.frameW, anim.frameH, Math.round(x), Math.round(y), anim.frameW * scale, anim.frameH * scale);
  }

  // 진행 중 연출 그리기(적 다음, 석상 앞).
  // panel = 전투 패널 - 위(층 표시·성벽 HP 바)·오른쪽·아래는 패널 끝까지 덮어도 된다(운석·빛기둥·가시 낙하·영혼).
  draw(ctx, bs, track, assets, now, panel = track) {
    const anims = assets?.skillAnims;
    const scale = assets?.enemySpriteRules?.displayScale ?? 2;
    ctx.save();
    // 왼쪽만 전투 길에서 자른다 - 석상 쪽으로 넘어가지 않게(성벽에 붙은 적의 가시 꼬리 등).
    ctx.beginPath();
    ctx.rect(track.x, panel.y, panel.x + panel.width - track.x, panel.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    for (const fx of this._fx) {
      const age = now - fx.startMs;
      if (fx.kind === 'flash') {
        ctx.globalAlpha = 0.5 * (1 - age / fx.ms);
        ctx.fillStyle = fx.color;
        ctx.fillRect(track.x, track.y, track.width, track.height);
        ctx.globalAlpha = 1;
      } else if (fx.kind === 'sprite') {
        const anim = anims?.get(fx.key);
        const f = anim ? frameAt(anim, age) : -1;
        if (f >= 0) this._drawAnim(ctx, anim, f, fx.x - (anim.frameW * scale) / 2, fx.y - (anim.frameH * scale) / 2, scale, fx.color);
      } else if (fx.kind === 'line') {
        // 촉(22,22)이 몸통 중심에 오게. 맞기 전(hitMs)까지는 dropFrame을 dropFrom에서 가속하며 내려 꽂는다.
        let f = frameAt(fx.anim, age);
        let ox = 0;
        let oy = 0;
        if (fx.drop && age < fx.hitMs) {
          const k = 1 - (age / fx.hitMs) ** 2;
          ox = fx.drop[0] * k * scale;
          oy = fx.drop[1] * k * scale;
          f = fx.dropFrame;
        }
        if (f >= 0 && fx.x != null) this._drawAnim(ctx, fx.anim, f, fx.x - 22 * scale + ox, fx.y - 22 * scale + oy, scale);
      } else if (fx.kind === 'bomb') {
        const f = frameAt(fx.anim, age);
        if (f >= 0 && fx.x != null) this._drawAnim(ctx, fx.anim, f, fx.x - (fx.anim.frameW * scale) / 2, fx.y - fx.anim.frameH * scale, scale);
      } else if (fx.kind === 'color_color') {
        const hit = anims?.get('hit');
        for (const p of fx.pillars) {
          const f = frameAt(fx.anim, age - p.delayMs);
          if (f >= 0 && p.x != null) this._drawAnim(ctx, fx.anim, f, p.x - (fx.anim.frameW * scale) / 2, p.y - fx.anim.frameH * scale, scale);
          if (hit && p.hitStartMs != null && p.enemy) {
            const hAge = now - p.hitStartMs;
            if (hAge < 300) {
              const st = this.enemyState(p.enemy);
              const color = COLORS[Math.floor(hAge / 60) % COLORS.length];
              const hf = frameAt(hit, hAge % totalMs(hit));
              this._drawAnim(ctx, hit, Math.max(0, hf), st.bodyX - (hit.frameW * scale) / 2, st.bodyY - (hit.frameH * scale) / 2, scale, color);
            }
          }
        }
      } else if (fx.kind === 'box') {
        const soul = assets?.effectAnims?.get(`box_soul_${fx.event.color}`);
        for (const s of fx.souls) {
          if (s.done) continue;
          if (soul?.state?.loaded) {
            const f = Math.floor(age / soul.frameMs) % soul.frames;
            drawImageSnapped(ctx, soul.state.img, f * soul.frameW, 0, soul.frameW, soul.frameH, Math.round(s.x - soul.frameW), Math.round(s.y - soul.frameH), soul.frameW * 2, soul.frameH * 2);
          } else {
            ctx.fillStyle = BONE;
            ctx.fillRect(Math.round(s.x - 3), Math.round(s.y - 3), 6, 6);
          }
        }
      } else if (fx.kind === 'text') {
        const st = this.enemyState(fx.enemy);
        const k = age / fx.ms;
        ctx.globalAlpha = 1 - k;
        ctx.fillStyle = BONE;
        ctx.font = getFontString(12, true);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        drawText(ctx, t('battle.immune'), st.bodyX, st.headY - IMMUNE_RISE_PX * k);
        ctx.globalAlpha = 1;
      }
    }
    // 경직: 머리 위 1px 불꽃 4개 공전(반지름 6, 네이티브).
    const yellow = assets?.skillManifest?.tint?.ramps?.yellow?.[3];
    if (yellow) {
      ctx.fillStyle = yellow;
      for (const e of bs.enemies) {
        if (e.state !== 'alive' || !(e.effects?.stun.time > 1e-9)) continue;
        const st = this.enemyState(e);
        for (let i = 0; i < 4; i++) {
          const a = now / 250 + (i * Math.PI) / 2;
          ctx.fillRect(Math.round(st.bodyX + Math.cos(a) * 6 * scale), Math.round(st.headY - 4 * scale + Math.sin(a) * 3 * scale), scale, scale);
        }
      }
    }
    ctx.restore();
  }

  // HP 바 위(bottomY) 가로 상태 아이콘 [감속0, 독1, 경직2, 표식 3/4]. 반환 = 아이콘 줄 윗변(없으면 bottomY).
  drawStatusIcons(ctx, assets, enemy, cx, bottomY) {
    const fx = enemy.effects;
    const anim = assets?.skillAnims?.get('status_icons');
    if (!fx || !anim?.state?.loaded) return bottomY;
    let n = 0;
    const icons = this._iconBuf ?? (this._iconBuf = [0, 0, 0, 0]);
    if (fx.slow.time > 1e-9) icons[n++] = 0;
    if (fx.poison.stacks > 0 && fx.poison.time > 1e-9) icons[n++] = 1;
    if (fx.stun.time > 1e-9) icons[n++] = 2;
    if (fx.mark.stacks > 0) icons[n++] = fx.mark.stacks >= 2 ? 4 : 3;
    if (n === 0) return bottomY;
    const scale = assets.enemySpriteRules?.displayScale ?? 2;
    const w = anim.frameW * scale;
    const gap = scale;
    let x = cx - (n * w + (n - 1) * gap) / 2;
    const y = bottomY - anim.frameH * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < n; i++, x += w + gap) this._drawAnim(ctx, anim, icons[i], x, y, scale);
    ctx.restore();
    return y;
  }

  // 이름 오른쪽(x, 위 y)에 면역마다 gem_mini(그 색)+boss_icons 0, 약점마다 +1.
  drawBossIcons(ctx, assets, enemy, x, y) {
    const gem = assets?.skillAnims?.get('gem_mini');
    const icon = assets?.skillAnims?.get('boss_icons');
    if (!gem?.tinted || !icon?.state?.loaded) return;
    if (!enemy.immune?.length && !enemy.weak?.length) return;
    const scale = assets.enemySpriteRules?.displayScale ?? 2;
    const step = (icon.frameW + 1) * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    for (const list of [enemy.immune, enemy.weak]) {
      for (const color of list ?? []) {
        this._drawAnim(ctx, gem, 0, x + scale, y + scale, scale, color);
        this._drawAnim(ctx, icon, list === enemy.immune ? 0 : 1, x, y, scale);
        x += step;
      }
    }
    ctx.restore();
  }
}
