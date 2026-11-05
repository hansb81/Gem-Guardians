// 가상 효과(modifier) 엔진 - sim.json modifiers 목록을 src/battle/battleState.js의
// onShot/onHit 훅으로 번역한다. 게임 코드는 건드리지 않는다(훅은 기본 비활성, docs/simulation.md T2).
// trigger: allShots(모든 사격) / special(특수 잼이 터진 사격만) / color:<색>(그 색 탑만).

function triggerMatches(trigger, shot) {
  if (trigger === 'allShots') return true;
  if (trigger === 'special') return !!shot.isSpecial;
  if (trigger.startsWith('color:')) return shot.color === trigger.slice('color:'.length);
  return false;
}

// modifiers.<name>이 다른 이름 목록을 가리키면(allBasic) 재귀적으로 펼친다.
export function resolveModifierList(modifiersConfig, name) {
  const spec = modifiersConfig[name];
  if (!spec) return [];
  const out = [];
  for (const item of spec) {
    if (typeof item === 'string') out.push(...resolveModifierList(modifiersConfig, item));
    else out.push(item);
  }
  return out;
}

// battleState.resolveTowerAttack(event)를 다시 호출해 2차 피해(범위/관통/연쇄/도트)를 적용한다.
// fromModifier:true로 표시해 onHit이 자기 자신을 다시 트리거하지 않게 막는다(무한 증폭 방지).
function applySecondaryHit(stats, battleState, towerId, targetEnemyId, damage) {
  stats.extraDamage += damage;
  battleState.resolveTowerAttack({ towerId, targetEnemyId, damage, fromModifier: true });
}

export function buildModifierHooks(modList) {
  if (modList.length === 0) return null;

  let shotCounter = 0;
  // 훅 계측 - 효과가 실제로 발동했는지 확인용(T2). 발동 0회면 배선 버그다.
  const stats = { onShot: 0, onHit: 0, extraDamage: 0 };
  const dots = []; // { enemyId, remainingSec, perSec, carry } - carry = 소수점 누적(dt가 작아도 총량 유지)
  const slows = []; // { enemyId, baseSpeed, remainingSec }

  function onShot(shot) {
    let dmg = shot.rawDamage;
    for (const m of modList) {
      if (!triggerMatches(m.trigger, shot)) continue;
      if (!m.probe) stats.onShot += 1; // probe = T2 이분 탐색용 배율, 효과 계측에서 제외.
      if (m.type === 'dmgMul') {
        dmg *= m.value;
      } else if (m.type === 'burst') {
        shotCounter += 1;
        if (shotCounter % m.every === 0) dmg *= m.mul;
      }
    }
    return dmg;
  }

  function onHit(battleState, event, target) {
    for (const m of modList) {
      if (!triggerMatches(m.trigger, event)) continue;
      if (!m.probe) stats.onHit += 1;

      if (m.type === 'dot') {
        dots.push({ enemyId: target.id, remainingSec: m.seconds, perSec: (event.damage * m.ratio) / m.seconds, carry: 0 });
      } else if (m.type === 'slow') {
        if (target.state !== 'alive') continue;
        let rec = slows.find((s) => s.enemyId === target.id);
        if (!rec) {
          rec = { enemyId: target.id, baseSpeed: target.speed, remainingSec: 0 };
          slows.push(rec);
        }
        target.speed = rec.baseSpeed * m.speedMul;
        rec.remainingSec = m.seconds; // 재적용 시 곱 누적이 아니라 지속 시간만 연장.
      } else if (m.type === 'splash') {
        for (const other of battleState.enemies) {
          if (other.id === target.id || other.state !== 'alive') continue;
          if (Math.abs(other.progress - target.progress) > m.radius) continue;
          const dmg = Math.max(battleState.battleConfig.minDamage, Math.round(event.damage * m.ratio - other.def));
          applySecondaryHit(stats, battleState, event.towerId, other.id, dmg);
        }
      } else if (m.type === 'pierce') {
        const others = battleState.enemies
          .filter((e) => e.id !== target.id && e.state === 'alive')
          .sort((a, b) => b.progress - a.progress);
        let dmg = event.damage;
        for (let i = 0; i < m.targets - 1 && i < others.length; i++) {
          dmg *= m.ratio;
          const other = others[i];
          const d = Math.max(battleState.battleConfig.minDamage, Math.round(dmg - other.def));
          applySecondaryHit(stats, battleState, event.towerId, other.id, d);
        }
      } else if (m.type === 'chain') {
        const visited = new Set([target.id]);
        let dmg = event.damage;
        for (let i = 0; i < m.jumps; i++) {
          const next = battleState.enemies
            .filter((e) => !visited.has(e.id) && e.state === 'alive')
            .sort((a, b) => b.progress - a.progress)[0];
          if (!next) break;
          visited.add(next.id);
          dmg *= m.ratio;
          const d = Math.max(battleState.battleConfig.minDamage, Math.round(dmg - next.def));
          applySecondaryHit(stats, battleState, event.towerId, next.id, d);
        }
      }
    }
  }

  // DOT/둔화는 시간에 걸쳐 진행되므로 battleState.update(dt)와 같은 틱에서 돌려야 한다 -
  // run.js의 메인 루프가 매 틱 호출한다.
  function tick(dtSec, battleState) {
    for (let i = dots.length - 1; i >= 0; i--) {
      const d = dots[i];
      const enemy = battleState.enemies.find((e) => e.id === d.enemyId && e.state === 'alive');
      const step = Math.min(dtSec, d.remainingSec);
      d.remainingSec -= dtSec;
      if (enemy && step > 0) {
        d.carry += d.perSec * step;
        const amount = Math.floor(d.carry);
        if (amount > 0) {
          d.carry -= amount;
          applySecondaryHit(stats, battleState, null, enemy.id, amount);
        }
      }
      if (d.remainingSec <= 0 || !enemy) dots.splice(i, 1);
    }
    for (let i = slows.length - 1; i >= 0; i--) {
      const s = slows[i];
      s.remainingSec -= dtSec;
      if (s.remainingSec <= 0) {
        const enemy = battleState.enemies.find((e) => e.id === s.enemyId);
        if (enemy) enemy.speed = s.baseSpeed;
        slows.splice(i, 1);
      }
    }
  }

  return { onShot, onHit, tick, stats };
}
