// 방치형 디펜스 "전투" 미니게임의 순수 로직. 브라우저 API 사용 금지, src/core는 import하지
// 않는다 - 퍼즐(매치-3) 로직과 완전히 독립적이다. 색은 문자열 id('red' 등)로만 다룬다.
//
// 컨셉: 잼 = 타워. 성벽 뒤에 색마다 탑 1개(총 5개)가 서서 적을 쏜다. 탑은 같은 색 잼이
// 퍼즐에서 터질 때만 쏜다(applyGemClear) - 자동 공격은 없다(docs/battle.md §4).
// 웨이브 없음: 층 전체의 적(resolvedFloor.spawns)이 interval초 간격으로 오른쪽 끝에서 한
// 줄로 소환된다. 전부 소환되고 살아있는 적이 없으면 층 클리어. 적은 성벽에 닿으면 멈추고
// attackIntervalSec마다 wallDmg. 성벽 HP 0 = 실패.
//
// resolvedFloor는 src/core/balance/floorGen.js의 resolveFloorSpawns()가 이미 소환 문자열을
// 스탯 객체(hp/def/speed/wallDmg/gold/name/anim/rank 등)로 바꿔둔 결과다 - 이 클래스는
// 그 숫자를 그대로 쓰기만 한다(밸런스 공식을 모른다).
import { pickSummonFrame, isSummonDone } from './summon.js';

export class BattleState {
  constructor({ towersData, resolvedFloor, battleConfig }) {
    this.towersData = towersData;
    this.battleConfig = battleConfig;
    this.resolvedFloor = resolvedFloor;
    // 가상 효과(modifier) 훅 - battleConfig.hooks가 없으면(게임 기본) undefined라 applyGemClear/
    // resolveTowerAttack에서 완전히 건너뛴다. tools/sim 전용(docs/simulation.md T2).
    this.hooks = battleConfig.hooks ?? null;
    // 젬 기술 v3(config/skills.json, docs/skills.md) - 없으면 색 효과·특수 잼 기술 없이 기존 사격만.
    this.skills = battleConfig.skills ?? null;

    // 렌더가 읽는 탑 뷰 - 색/이름/투사체 모양처럼 레벨이 바뀌어도 변하지 않는 값만 담는다.
    // 공격력(attack)은 towersData 쪽을 직접 읽는다(applyGemClear가 towersData를 보므로,
    // 레벨업은 towersData[i].stats.attack을 바로 고치면 전투 중에도 즉시 반영된다).
    this._towersView = towersData.map((tower) => ({
      id: tower.id,
      color: tower.color,
      name: tower.name,
      stats: { ...tower.stats },
      shape: tower.shape,
    }));

    this.wallMaxHealth = resolvedFloor.wallHp;
    this.wallHealth = this.wallMaxHealth;
    this.status = 'active';
    // 모래시계(docs/items.md B2) 남은 정지 시간(초) - 일반 적/보스 따로.
    this._freeze = { normal: 0, boss: 0 };
    // 결계(docs/items.md B3) 남은 시간(초) - 0보다 크면 성벽 피해(적 공격·시한폭탄) 0.
    this.wallShieldSec = 0;
    this._wallBlockFlashSec = 0; // 같은 적의 wallBlocked 이벤트 최소 간격(초, 결계 config).
    // 분노의 북(B5) - 모든 탑 피해(기본 사격 + 특수 잼 기술)의 공격력 배율. 스왑 횟수 추적은
    // ItemController가 맡고 여기는 배율만 켜고 끈다.
    this.atkMul = 1;

    this.spawns = resolvedFloor.spawns;
    this.spawnInterval = resolvedFloor.interval;
    // 무리 등장(floorShape.pack) 층은 적마다 등장 시각(초)이 따로 온다. 없으면 interval 간격.
    this.spawnAt = resolvedFloor.spawnAt ?? null;
    this.totalEnemies = this.spawns.length;

    this.enemies = [];
    this.events = [];

    this._nextEnemyId = 1;
    this._nextSpawnSeq = 1;
    // 날아가는 중인 탄의 "예상 피해 예약" - shotId -> { enemyId, damage, ageMs }. 적의
    // pendingDamage 합과 같은 내용을 shot 단위로도 들고 있어야 resolve/타임아웃 때 그 한
    // 발만 정확히 취소할 수 있다.
    this._pendingShots = new Map();
    this._nextShotId = 1;
    // 특수 잼 기술의 명중 대기 - castId -> { event, remaining: Map<enemyId, damage>, ageMs }.
    this._pendingSkills = new Map();
    this._nextCastId = 1;
    // 같은 스텝(한 update 사이)에 이미 가시를 맞은 적 - 두 번째 가시는 그 다음 앞 적에게.
    this._spikedThisStep = new Set();
    this._boxedThisStep = new Set(); // 같은 스텝의 영혼 불꽃이 이미 배정된 적(박스+박스 = 서로 다른 4마리).
    // 층 시작(첫 진입/다음 층) 연출 상태 - 렌더(battleRenderer)와 분리된 core/battle 쪽
    // 상태다. battleConfig.summon이 없으면(에셋 로더가 assets/summon/manifest.json을 못
    // 읽었을 때) 연출 없이 즉시 비활성 - 렌더는 바로 statue_idle로 그린다.
    this.summon = this._createSummon();
    // 튜토리얼(docs/tutorial.md 0장) 동안 true - 층 소환 타이머(웨이브)가 멈춘다.
    this.holdSpawns = false;
    this._startSpawning();
  }

  reset() {
    this.wallHealth = this.wallMaxHealth;
    this.status = 'active';
    this._freeze = { normal: 0, boss: 0 };
    this.wallShieldSec = 0;
    this.atkMul = 1;
    this.enemies = [];
    this.events = [];
    this._pendingShots = new Map();
    this._pendingSkills = new Map();
    this._spikedThisStep = new Set();
    this._boxedThisStep = new Set();
    this.summon = this._createSummon();
    this._startSpawning();
  }

  _createSummon() {
    const cfg = this.battleConfig.summon;
    const slotCount = this.towersData.length;
    if (!cfg?.frameMs?.length || slotCount === 0) return { active: false, elapsedMs: 0, slotCount: 0, _landFired: [] };
    return { active: true, elapsedMs: 0, slotCount, _landFired: new Array(slotCount).fill(false) };
  }

  // 슬롯별 frameMs 누적 프레임은 pickSummonFrame(src/battle/summon.js)로 계산한다(렌더도
  // battleState.summon.elapsedMs를 읽어 같은 함수로 다시 계산 - 상태 중복 없음). 슬롯이
  // landFrame에 들어가는 순간 summonLand 이벤트를 한 번만 내보낸다(SFX/약한 흔들림 훅).
  // 마지막 슬롯이 끝나면 summon.active를 꺼서 스폰 타이머와 퍼즐 입력 차단을 푼다.
  _advanceSummon(dtMs) {
    const summon = this.summon;
    if (!summon.active) return;
    summon.elapsedMs += dtMs;

    const cfg = this.battleConfig.summon;
    for (let i = 0; i < summon.slotCount; i++) {
      if (summon._landFired[i]) continue;
      const { started, frame } = pickSummonFrame(summon.elapsedMs, i, cfg);
      if (started && frame >= cfg.landFrame) {
        summon._landFired[i] = true;
        this._pushEvent('summonLand', { color: this.towersData[i].color });
      }
    }

    if (isSummonDone(summon.elapsedMs, summon.slotCount, cfg)) summon.active = false;
  }

  get towers() {
    return this._towersView;
  }

  // 퍼즐의 시한폭탄 방해요소가 타이머 만료로 터질 때 호출된다(PuzzleBattleBridge가
  // GameState.effects의 obstacleExpire를 읽고 전달) - 성벽 사격이 아니라 성벽 최대 HP의
  // 일정 비율을 직접 깎는다(docs/balance.md 7-2/7-3). 탑 사격과 같은 'wallDamaged' 이벤트를
  // 재사용해 렌더가 화면 흔들림 등을 그대로 처리할 수 있게 한다.
  // 결계 중이면 피해 0 - 대신 wallBlocked(source 'timeBomb')로 렌더가 적 공격 때와 같이 번쩍인다.
  applyObstacleWallDamage(pct) {
    if (this.status !== 'active') return;
    if (this.wallShieldSec > 0) {
      this._pushEvent('wallBlocked', { source: 'timeBomb' });
      return;
    }
    const amount = Math.round(this.wallMaxHealth * pct);
    this.wallHealth = Math.max(0, this.wallHealth - amount);
    this._pushEvent('wallDamaged', { amount, remainingHealth: this.wallHealth, source: 'obstacle' });
    if (this.wallHealth <= 0) this.status = 'failed';
  }

  // 수리 망치(docs/items.md B1) - 성벽 최대 HP x pct 회복, 최대치는 넘지 않는다.
  healWall(pct) {
    if (this.status !== 'active') return false;
    const before = this.wallHealth;
    this.wallHealth = Math.min(this.wallMaxHealth, before + Math.round(this.wallMaxHealth * pct));
    this._pushEvent('wallHealed', { amount: this.wallHealth - before, remainingHealth: this.wallHealth });
    return true;
  }

  // 모래시계(docs/items.md B2) - sec초 동안 모든 적의 이동·성벽 공격 정지(보스는 sec x bossMul).
  // 스폰·탑 사격·피해는 그대로. 진행 중에 다시 쓰면 남은 시간을 새로 덮어쓴다(합산 안 함).
  // 정지 중에 새로 나온 적도 같이 멈춘다(전역 타이머).
  freezeEnemies(sec, bossMul) {
    if (this.status !== 'active') return false;
    this._freeze.normal = sec;
    this._freeze.boss = sec * bossMul;
    this._pushEvent('enemiesFrozen', { durationSec: sec, bossDurationSec: this._freeze.boss });
    return true;
  }

  // 결계 두루마리(B3) - sec초 동안 성벽 피해 0. 다시 쓰면 남은 시간을 새로 덮어쓴다(합산 안 함).
  // blockFlashSec = 같은 적이 막힐 때 wallBlocked 이벤트를 다시 내기까지의 최소 간격.
  shieldWall(sec, blockFlashSec = 0) {
    if (this.status !== 'active') return false;
    this.wallShieldSec = sec;
    this._wallBlockFlashSec = blockFlashSec;
    this._pushEvent('wallShieldOn', { durationSec: sec });
    return true;
  }

  // 분노의 북(B5) - 탑 공격력 배율 켜기/끄기(끝나는 시점은 ItemController가 스왑 수로 판단).
  setAtkBuff(mul) {
    if (this.status !== 'active') return false;
    this.atkMul = mul;
    this._pushEvent('atkBuffOn', { mul });
    return true;
  }

  clearAtkBuff() {
    if (this.atkMul === 1) return;
    this.atkMul = 1;
    this._pushEvent('atkBuffOff', {});
  }

  // 부활(C3) - 실패 직후에만. 성벽 HP = 최대 x pct, 모든 적 freezeSec초 정지(보스는 x bossMul), 다시 active.
  revive(pct, freezeSec, bossMul = 1) {
    if (this.status !== 'failed') return false;
    this.status = 'active';
    this.wallHealth = Math.round(this.wallMaxHealth * pct);
    this._pushEvent('wallRevived', { amount: this.wallHealth, remainingHealth: this.wallHealth });
    this.freezeEnemies(freezeSec, bossMul);
    return true;
  }

  isEnemyFrozen(enemy) {
    return (enemy.rank === 'boss' ? this._freeze.boss : this._freeze.normal) > 0;
  }

  get frozen() {
    return this._freeze.normal > 0 || this._freeze.boss > 0;
  }

  _advanceFreeze(dtSec) {
    if (!this.frozen) return;
    this._freeze.normal = Math.max(0, this._freeze.normal - dtSec);
    this._freeze.boss = Math.max(0, this._freeze.boss - dtSec);
    if (!this.frozen) this._pushEvent('enemiesUnfrozen', {});
  }

  // 남은 몬스터 수(아직 못 죽인 수) - HUD("남은 몬스터 n/N") 표시용.
  get remainingEnemies() {
    return this.totalEnemies - this._killedCount;
  }

  _startSpawning() {
    this._elapsedSec = 0;
    this._spawnedCount = 0;
    this._killedCount = 0;
  }

  _pushEvent(type, fields) {
    const event = {
      type,
      ...fields,
      elapsedMs: 0,
      durationMs: this.battleConfig.effectDurationsMs[type],
    };
    this.events.push(event);
    return event;
  }

  // 살아있는 적 중 성벽에 가장 가까운(progress가 가장 높은) 1마리. progress가 동률이면
  // 먼저 스폰된 적을 우선한다(결정적 - Math.random 없이도 일관된 타겟팅). 사거리 제한 없음
  // (docs/battle.md §4 puzzleShot.range=unlimited)이라 필터 없이 전체에서 고른다.
  _enemiesFrontToBack() {
    return this.enemies
      .filter((e) => e.state === 'alive')
      .sort((a, b) => b.progress - a.progress || a._spawnSeq - b._spawnSeq);
  }

  _frontmostEnemy() {
    return this._enemiesFrontToBack()[0] ?? null;
  }

  // 오버킬 방지: 이미 날아가는 탄의 예상 피해(pendingDamage)로 죽을 적은 건너뛰고 그 다음
  // 적을 노린다. 모두 죽을 예정이면 맨 앞 적으로 폴백한다(피해를 버리지 않는다 - 예상이
  // 빗나가거나 탄이 소멸할 수 있으므로).
  _pickTarget() {
    const order = this._enemiesFrontToBack();
    return order.find((e) => e.currentHealth - e.pendingDamage > 0) ?? order[0] ?? null;
  }

  // 예약 해제 - 탄이 명중했거나(resolve) 타임아웃으로 사라졌을 때.
  _releaseShot(shotId) {
    const shot = this._pendingShots.get(shotId);
    if (!shot) return;
    this._pendingShots.delete(shotId);
    const enemy = this.enemies.find((e) => e.id === shot.enemyId);
    if (enemy) enemy.pendingDamage = Math.max(0, enemy.pendingDamage - shot.damage);
  }

  // 탑 발사 시점 - towerAttack 이벤트만 내보낸다(피해는 아직 적용하지 않음). render가 이
  // 이벤트로 공격 애니메이션 + 투사체를 띄우고, 투사체가 화면에서 목표에 "충돌"하는 순간
  // resolveTowerAttack(event)를 호출해 실제 피해를 적용한다.
  _fireShot(tower, target, damage, cascadeIndex, color, isSpecial) {
    const shotId = this._nextShotId++;
    target.pendingDamage += damage;
    this._pendingShots.set(shotId, { enemyId: target.id, damage, ageMs: 0 });
    return this._pushEvent('towerAttack', {
      towerId: tower.id,
      targetEnemyId: target.id,
      damage,
      cascadeIndex,
      color,
      isSpecial,
      shotId,
      buffed: this.atkMul > 1, // 분노의 북 중 발사 - 렌더 전용(crit 폰트, 밝은 투사체).
    });
  }

  // render가 투사체 충돌을 감지한 순간 호출한다. 목표가 그 사이 이미 죽었거나 전투가
  // 끝났으면 아무 일도 하지 않는다 - enemyHit/enemyDie 이벤트를 내보내고, 적이 죽으면
  // 층 클리어 판정까지 한다.
  resolveTowerAttack(event) {
    // 예약 해제가 먼저다 - 전투가 끝났거나 목표가 이미 죽어 아래에서 return해도 예약은
    // 남으면 안 된다. shotId 없는 호출(tools/sim의 2차 피해 등)은 그냥 넘어간다.
    if (event.shotId !== undefined) this._releaseShot(event.shotId);
    if (this.status !== 'active') return;
    const target = this.enemies.find((e) => e.id === event.targetEnemyId && e.state === 'alive');
    if (!target) return;

    this._damageEnemy(target, event.damage, { towerId: event.towerId, buffed: !!event.buffed });

    // fromModifier(합성 피해 - 범위/관통/연쇄/도트가 만든 2차 피해)는 색 효과·onHit을 다시 타지
    // 않는다(연쇄가 자기 자신을 다시 트리거해 무한 증폭되는 것을 막는다). 기본 사격의 색 효과는
    // colorEffects.appliesTo === 'all'일 때만(기본 'skills' = 기술 피해에만, docs/skills.md 1장).
    // tools/sim 전용 hooks(docs/simulation.md T2)는 그 뒤에 그대로.
    if (!event.fromModifier) {
      if (event.color && this.skills?.colorEffects.appliesTo === 'all') this._applyColorEffect(target, event.color, event.damage);
      this.hooks?.onHit?.(this, event, target);
    }
  }

  // 피해 적용 + enemyHit + 죽으면 enemyDie/클리어 판정. fields는 enemyHit에 그대로 붙는다
  // (towerId, source: 'poison'|'splash'|'skill' 등).
  _damageEnemy(target, damage, fields) {
    // hpFloor(튜토리얼) - 맞는 연출은 그대로, HP는 그 아래로 안 내려간다. skillBreaksFloor(쓰기 수)면 기술 피해만 뚫는다.
    const floor = target.hpFloor == null || (target.skillBreaksFloor && fields.source === 'skill') ? -Infinity : target.hpFloor;
    target.currentHealth = Math.max(floor, target.currentHealth - damage);
    this._pushEvent('enemyHit', {
      enemyId: target.id,
      damage,
      remainingHealth: Math.max(0, target.currentHealth),
      ...fields,
    });
    if (target.currentHealth <= 0) {
      target.state = 'dead';
      // 튜토리얼 몬스터는 처치 수·클리어 판정에 안 들어간다(골드는 0).
      if (!target.tutorial) this._killedCount++;
      this._pushEvent('enemyDie', { enemyId: target.id, gold: target.gold, enemyType: target.type, rank: target.rank, tutorial: !!target.tutorial });
      if (!target.tutorial) this._checkProgress();
    }
  }

  // 약점(× weaknessMul) 다음 표식(× (1 + perStack × 중첩)) - 피해 계산 맨 마지막 배율.
  _damageMul(enemy, color) {
    if (!this.skills) return 1;
    const weak = color && enemy.weak.includes(color) ? this.skills.bossRules.weaknessMul : 1;
    return weak * this._markMul(enemy);
  }

  _markMul(enemy) {
    const green = this.skills?.colorEffects.green;
    return green ? 1 + green.perStack * enemy.effects.mark.stacks : 1;
  }

  // 색 효과 1회 적용(docs/skills.md 1장). damage = 이번에 들어간 피해. ultimate = 궁극기·대폭발의
  // 강화판(skills.ultimateEffects): 레드 범위 없음, 블루 ×0.5 3초, 퍼플·그린 최대 중첩 즉시, 옐로우 보스 제외.
  _applyColorEffect(target, color, damage, ultimate = false) {
    const cfg = this.skills?.colorEffects[color];
    if (!cfg || !this.skills.unlocked?.colorEffects?.[color]) return;
    if (target.immune.includes(color)) {
      this._pushEvent('effectImmune', { enemyId: target.id, color });
      return;
    }
    const isBoss = target.rank === 'boss';
    const { bossRules } = this.skills;
    const fx = target.effects;
    switch (cfg.type) {
      case 'splash': {
        if (ultimate) break; // 궁극기는 전원 직격이라 범위 없음.
        // 2차 피해는 다시 색 효과를 타지 않는다. 레드 면역 적은 범위 피해를 안 받는다(직격은 받음).
        const dmg = Math.max(this.battleConfig.minDamage, Math.round(damage * cfg.ratio));
        for (const other of this.enemies) {
          if (other === target || other.state !== 'alive' || Math.abs(other.progress - target.progress) > cfg.radius) continue;
          if (other.immune.includes(color)) this._pushEvent('effectImmune', { enemyId: other.id, color });
          else this._damageEnemy(other, dmg, { source: 'splash', fromModifier: true });
        }
        break;
      }
      case 'slow': {
        const ult = ultimate ? this.skills.ultimateEffects : null;
        const mul = ult?.slowMul ?? cfg.mul;
        fx.slow.mul = isBoss ? 1 - (1 - mul) * bossRules.slowEffectMul : mul;
        fx.slow.time = ult?.slowDuration ?? cfg.duration;
        break;
      }
      case 'poison': {
        if (target.state !== 'alive') break;
        const p = fx.poison;
        if (p.stacks === 0) p.tickTimer = 0;
        p.stacks = ultimate ? cfg.maxStacks : Math.min(cfg.maxStacks, p.stacks + 1);
        p.base = damage / this._markMul(target); // 표식은 틱마다 다시 곱한다(이중 적용 방지).
        p.time = cfg.duration;
        break;
      }
      case 'stun':
        if (ultimate && isBoss) break;
        if (fx.stun.cooldown > 1e-9) break;
        fx.stun.time = cfg.duration * (isBoss ? bossRules.stunDurationMul : 1);
        fx.stun.cooldown = cfg.cooldown;
        break;
      case 'mark': {
        const m = fx.mark;
        if (ultimate) m.stacks = cfg.maxStacks;
        else if (m.stacks === 0 || (m.cooldown <= 1e-9 && m.stacks < cfg.maxStacks)) {
          m.stacks += 1;
          m.cooldown = cfg.stackCooldown;
        }
        m.time = cfg.duration;
        break;
      }
    }
  }

  // 독: duration 동안 총 base × ratio × 중첩을 tickSec마다 나눠서, 방어 무시, 표식 배율 적용.
  _tickPoison(enemy, dtSec) {
    const p = enemy.effects.poison;
    if (p.stacks === 0) return;
    const cfg = this.skills.colorEffects.purple;
    const ticks = cfg.duration / cfg.tickSec;
    p.time -= dtSec;
    p.tickTimer += dtSec;
    while (p.tickTimer >= cfg.tickSec - 1e-9 && enemy.state === 'alive') {
      p.tickTimer -= cfg.tickSec;
      p.carry += ((p.base * cfg.ratio * p.stacks) / ticks) * this._markMul(enemy);
      const dmg = Math.floor(p.carry + 1e-9);
      if (dmg > 0) {
        p.carry -= dmg;
        this._damageEnemy(enemy, dmg, { source: 'poison' });
      }
    }
    if (p.time <= 1e-9) {
      p.stacks = 0;
      p.carry = 0;
    }
  }

  // 매 update - 상태 효과 시간을 줄이고 이번 틱 이동 배율을 돌려준다(경직이면 0).
  _tickEffects(enemy, dtSec) {
    const fx = enemy.effects;
    if (fx.stun.cooldown > 0) fx.stun.cooldown -= dtSec;
    if (fx.mark.cooldown > 0) fx.mark.cooldown -= dtSec;
    if (fx.mark.time > 0) {
      fx.mark.time -= dtSec;
      if (fx.mark.time <= 1e-9) fx.mark.stacks = 0;
    }
    if (this.skills.colorEffects.purple) this._tickPoison(enemy, dtSec);
    let moveMul = 1;
    if (fx.slow.time > 1e-9) {
      moveMul = fx.slow.mul;
      fx.slow.time -= dtSec;
    }
    if (fx.stun.time > 1e-9) {
      fx.stun.time -= dtSec;
      return 0;
    }
    return moveMul;
  }

  // ---- 특수 잼 기술(docs/skills.md 2장) ----

  // 대상과 적마다의 피해를 정해 skillCast를 내보내고 pendingDamage로 예약한다. 피해는 렌더가
  // 명중 시점에 resolveSkillHit으로 적용한다(battleConfig.deferSkillHits). 렌더가 아직 기술을
  // 안 그리면(deferSkillHits 없음 - 시뮬레이션·테스트·B 단계 전) 그 자리에서 즉시 적용한다.
  _castSkill(specialType, color, chosenColor, cascadeIndex) {
    const skills = this.skills;
    if (!skills) return;
    const skill = skills.specialGemToSkill[specialType];
    const spec = skills.specialSkills[skill];
    if (!spec || !skills.unlocked?.specialSkills?.[skill]) return;

    const effectColor = skill === 'color' ? chosenColor : skill === 'color_color' ? null : color;
    let attack;
    if (skill === 'color_color') {
      // 기획 미정: 대폭발은 색이 없어 탑 공격력 평균을 쓴다(보고 사항).
      attack = this.towersData.reduce((sum, t) => sum + t.stats.attack, 0) / Math.max(1, this.towersData.length);
    } else {
      const tower = this.towersData.find((t) => t.color === effectColor);
      if (!tower) return;
      attack = tower.stats.attack;
    }
    const raw = attack * this.atkMul * spec.mul;

    const order = this._enemiesFrontToBack();
    if (order.length === 0) return;
    // 명중 1번 = targets 한 칸(같은 적이 두 번 들어갈 수 있다 - 영혼 불꽃 되돌아 배정).
    // 피해는 고르는 즉시 pendingDamage로 예약해 다음 대상 선정에 반영한다.
    const { minDamage } = this.battleConfig;
    const targets = [];
    const damages = [];
    const remaining = new Map(); // enemyId -> 남은 명중 피해 목록
    const add = (e) => {
      const dmg = Math.max(minDamage, Math.round((raw - e.def) * this._damageMul(e, effectColor)));
      e.pendingDamage += dmg;
      targets.push(e);
      damages.push(dmg);
      if (!remaining.has(e.id)) remaining.set(e.id, []);
      remaining.get(e.id).push(dmg);
    };
    const extra = {};
    if (skill === 'line') {
      const fresh = order.filter((e) => !this._spikedThisStep.has(e.id));
      const target = fresh.find((e) => e.currentHealth - e.pendingDamage > 0) ?? fresh[0] ?? order[0];
      this._spikedThisStep.add(target.id);
      add(target);
    } else if (skill === 'bomb') {
      // 반경 안 적 수가 최대인 적이 중심(동률이면 앞쪽).
      let center = order[0];
      let best = 0;
      for (const c of order) {
        const n = order.filter((e) => Math.abs(e.progress - c.progress) <= spec.radius).length;
        if (n > best) {
          best = n;
          center = c;
        }
      }
      for (const e of order) if (Math.abs(e.progress - center.progress) <= spec.radius) add(e);
      extra.centerEnemyId = center.id;
    } else if (skill === 'box') {
      // 현재 HP 높은 순(동률이면 앞쪽 - order가 이미 앞쪽 순이고 정렬은 안정)으로 1발씩, 같은 스텝의
      // 다른 박스와 이어서 서로 다른 적에게. 다 돌았으면 처음부터 다시. 예약 피해로 죽을 적은 건너뜀.
      const byHp = [...order].sort((a, b) => b.currentHealth - a.currentHealth);
      const used = this._boxedThisStep;
      for (let i = 0; i < spec.count; i++) {
        const alive = (e) => e.currentHealth - e.pendingDamage > 0;
        let pick = byHp.find((e) => !used.has(e.id) && alive(e));
        if (!pick) {
          used.clear();
          pick = byHp.find(alive) ?? byHp[0];
        }
        used.add(pick.id);
        add(pick);
      }
    } else {
      for (const e of order) add(e);
      if (skill === 'color_color') extra.order = order.map((e) => e.id);
    }

    const castId = this._nextCastId++;
    const event = this._pushEvent('skillCast', {
      castId,
      skill,
      color: effectColor,
      targets: targets.map((e) => e.id),
      damage: raw,
      damages,
      cascadeIndex,
      extra,
      buffed: this.atkMul > 1,
    });
    this._pendingSkills.set(castId, { event, remaining, ageMs: 0 });
    if (!this.battleConfig.deferSkillHits) for (const e of targets) this.resolveSkillHit(event, e.id);
  }

  // 렌더가 기술이 enemyId에 명중하는 순간 부른다(resolveTowerAttack과 같은 예약 해제 순서).
  resolveSkillHit(event, enemyId) {
    const rec = this._pendingSkills.get(event.castId);
    const list = rec?.remaining.get(enemyId);
    if (!list) return;
    const dmg = list.shift(); // 같은 적이 여러 번이면 부를 때마다 1발씩.
    if (list.length === 0) rec.remaining.delete(enemyId);
    if (rec.remaining.size === 0) this._pendingSkills.delete(event.castId);
    const target = this.enemies.find((e) => e.id === enemyId);
    if (target) target.pendingDamage = Math.max(0, target.pendingDamage - dmg);
    if (this.status !== 'active' || !target || target.state !== 'alive') return;

    this._damageEnemy(target, dmg, { source: 'skill', skill: event.skill, buffed: !!event.buffed });

    const spec = this.skills.specialSkills[event.skill];
    if (event.skill === 'line' && !target.knockbackImmune && target.state === 'alive') {
      target.progress = Math.max(0, target.progress - spec.knockback);
      if (target.progress < 1) {
        // 성벽에 붙어 있던 적은 떨어져서 다시 걸어온다.
        target._reachedLine = false;
        target._attackTimer = 0;
      }
    }
    if (event.skill === 'color_color') {
      for (const c of Object.keys(this.skills.unlocked?.colorEffects ?? {})) this._applyColorEffect(target, c, dmg, true);
    } else if (event.color) {
      this._applyColorEffect(target, event.color, dmg, event.skill === 'color');
    }
  }

  // 영혼 불꽃처럼 날아가는 기술의 대상이 명중 전에 죽었을 때 렌더가 부른다. fromEnemyId 몫 1발의
  // 예약을 풀고, (HP - 예약 피해)가 남은 살아 있는 적 중 현재 HP 최대(동률이면 앞쪽)에게 새 피해로
  // 다시 예약한다. 반환 = 새 대상 id, 없으면 null(예약만 버림 - 렌더는 불꽃을 소멸시킨다).
  retargetSkillHit(event, fromEnemyId) {
    const rec = this._pendingSkills.get(event.castId);
    const list = rec?.remaining.get(fromEnemyId);
    if (!list) return null;
    const old = list.shift();
    if (list.length === 0) rec.remaining.delete(fromEnemyId);
    const from = this.enemies.find((e) => e.id === fromEnemyId);
    if (from) from.pendingDamage = Math.max(0, from.pendingDamage - old);

    let pick = null;
    for (const e of this._enemiesFrontToBack()) {
      if (e.currentHealth - e.pendingDamage <= 0) continue;
      if (!pick || e.currentHealth > pick.currentHealth) pick = e;
    }
    if (!pick || this.status !== 'active') {
      if (rec.remaining.size === 0) this._pendingSkills.delete(event.castId);
      return null;
    }
    const dmg = Math.max(this.battleConfig.minDamage, Math.round((event.damage - pick.def) * this._damageMul(pick, event.color)));
    pick.pendingDamage += dmg;
    if (!rec.remaining.has(pick.id)) rec.remaining.set(pick.id, []);
    rec.remaining.get(pick.id).push(dmg);
    return pick.id;
  }

  // 전부 스폰됐고 살아있는 적이 없으면 층 클리어(웨이브 구분 없음 - docs/balance.md §6).
  _checkProgress() {
    const allSpawned = this._spawnedCount >= this.spawns.length;
    const anyAlive = this.enemies.some((e) => e.state === 'alive');
    if (allSpawned && !anyAlive) this.status = 'cleared';
  }

  // 퍼즐에서 color 잼 count개가 cascadeIndex 단계에 지워졌을 때(특수 잼 효과로 지워진 잼
  // 포함) 그 색 탑이 즉시 1발 쏜다 - 탑이 쏘는 유일한 경로다. 피해 = 공격력 x count x
  // (1 + cascadeBonusPerStep x (cascadeIndex-1)) - 적 방어력, 최소 minDamage. 사거리 제한 없음.
  //
  // specialType('line_h'|'line_v'|'bomb'|'box'|'color'|'color_color')이 있으면 특수 잼 기술을
  // 추가로 발동한다(skillCast). chosenColor = 무지개가 고른 색. count 0이면 기본 사격 없이 기술만 -
  // PuzzleBattleBridge는 특수 잼 발동 이펙트마다 이렇게 부르고, 지워진 칸의 사격은 따로 그대로 쏜다.
  applyGemClear(color, count, cascadeIndex, isSpecial = false, specialType = null, chosenColor = null) {
    if (this.status !== 'active') return undefined;
    if (specialType) this._castSkill(specialType, color, chosenColor, cascadeIndex);
    if (count <= 0 || this.status !== 'active') return undefined;

    const tower = this.towersData.find((t) => t.color === color);
    if (!tower) return undefined;

    const target = this._pickTarget();
    if (!target) return undefined;

    const { cascadeBonusPerStep, minDamage } = this.battleConfig;
    let rawDamage = tower.stats.attack * this.atkMul * count * (1 + cascadeBonusPerStep * (cascadeIndex - 1));
    // 가상 효과(modifier) 훅 - 기본은 battleConfig.hooks가 없어 아무 영향도 없다(docs/simulation.md
    // T2). 나중에 실제 잼 특수 효과/아이템이 생기면 이 자리에 onShot을 붙인다(피해 배율/연타).
    if (this.hooks?.onShot) {
      rawDamage = this.hooks.onShot({ color, count, cascadeIndex, isSpecial, tower, target, rawDamage });
    }
    const damage = Math.max(minDamage, Math.round((rawDamage - target.def) * this._damageMul(target, color)));

    return this._fireShot(tower, target, damage, cascadeIndex, color, isSpecial);
  }

  _advanceEvents(dtMs) {
    if (this.events.length === 0) return;
    const diedIds = [];
    this.events = this.events.filter((event) => {
      event.elapsedMs += dtMs;
      if (event.elapsedMs < event.durationMs) return true;
      if (event.type === 'enemyDie') diedIds.push(event.enemyId);
      return false;
    });
    if (diedIds.length > 0) {
      this.enemies = this.enemies.filter((e) => !diedIds.includes(e.id));
    }
  }

  _spawnEnemy(stat) {
    this.enemies.push({
      id: this._nextEnemyId++,
      type: stat.type,
      rank: stat.rank,
      name: stat.name,
      anim: stat.anim,
      progress: 0,
      currentHealth: stat.hp,
      maxHealth: stat.hp,
      def: stat.def,
      speed: stat.speed,
      wallDmg: stat.wallDmg,
      gold: stat.gold,
      state: 'alive',
      pendingDamage: 0,
      _spawnSeq: this._nextSpawnSeq++,
      _reachedLine: false,
      _attackTimer: 0,
      _blockFlashTimer: 0, // 결계에 막힌 wallBlocked 이벤트 쿨다운(초).
      immune: stat.immune ?? [],
      weak: stat.weak ?? [],
      knockbackImmune: !!stat.knockbackImmune,
      // 상태 효과(docs/skills.md 1장), 시간 단위 초. 적마다 한 번만 만든다(매 프레임 할당 없음).
      effects: {
        slow: { time: 0, mul: 1 },
        poison: { time: 0, stacks: 0, base: 0, tickTimer: 0, carry: 0 },
        stun: { time: 0, cooldown: 0 },
        mark: { time: 0, stacks: 0, cooldown: 0 },
      },
    });
  }

  // 튜토리얼 몬스터(docs/tutorial.md 3장) - 층 소환 목록과 별개. stopAt(길 비율)에서 멈춰 성벽을 치지 않고,
  // 골드 0·처치 수 제외. hpFloor가 null이 아니면 HP가 그 아래로 안 내려간다.
  spawnTutorialEnemy(stat, { hp = 1, hpFloor = null, stopAt = 0.6 } = {}) {
    this._spawnEnemy({ ...stat, hp, gold: 0 });
    const enemy = this.enemies[this.enemies.length - 1];
    Object.assign(enemy, { tutorial: true, hpFloor, stopAt });
    return enemy;
  }

  // 기술/탄이 날아가는 중인지(튜토리얼 "모든 연쇄/기술이 끝남" 판정).
  get attacksInFlight() {
    return this._pendingShots.size > 0 || this._pendingSkills.size > 0;
  }

  _spawnDue() {
    while (this._spawnedCount < this.spawns.length && this._elapsedSec >= (this.spawnAt ? this.spawnAt[this._spawnedCount] : this._spawnedCount * this.spawnInterval)) {
      this._spawnEnemy(this.spawns[this._spawnedCount]);
      this._spawnedCount++;
    }
  }

  // 안전장치: 렌더가 어떤 이유로든 resolveTowerAttack을 못 부르면(탭 전환, 투사체 유실)
  // 적이 영원히 "죽을 예정"으로 남아 표적에서 빠진다. 일정 시간이 지난 예약은 버린다.
  _expirePendingShots(dtMs) {
    if (this._pendingShots.size === 0) return;
    const timeoutMs = this.battleConfig.shotTimeoutMs ?? 3000;
    for (const [shotId, shot] of this._pendingShots) {
      shot.ageMs += dtMs;
      if (shot.ageMs >= timeoutMs) this._releaseShot(shotId);
    }
  }

  // 기술은 탄과 달리 타임아웃이면 버리지 않고 남은 명중을 즉시 적용한다.
  _expirePendingSkills(dtMs) {
    if (this._pendingSkills.size === 0) return;
    const timeoutMs = this.battleConfig.shotTimeoutMs ?? 3000;
    for (const rec of [...this._pendingSkills.values()]) {
      rec.ageMs += dtMs;
      if (rec.ageMs < timeoutMs) continue;
      for (const [id, list] of [...rec.remaining]) while (list.length > 0) this.resolveSkillHit(rec.event, id);
    }
  }

  update(dtSec) {
    const dtMs = dtSec * 1000;
    this._advanceEvents(dtMs);
    this._advanceSummon(dtMs);
    this._expirePendingShots(dtMs);
    this._expirePendingSkills(dtMs);
    this._spikedThisStep.clear();
    this._boxedThisStep.clear();

    if (this.status !== 'active') return;

    // 소환 연출이 끝나기 전엔(마지막 슬롯이 landFrame을 지나기 전) 스폰 타이머를 멈춘다 -
    // 적이 석상보다 먼저 나타나 보이지 않게 한다(docs 요청).
    if (!this.summon.active && !this.holdSpawns) {
      this._elapsedSec += dtSec;
      this._spawnDue();
    }

    const attackInterval = this.battleConfig.attackIntervalSec;
    const { normal: frozenNormal, boss: frozenBoss } = this._freeze;
    this._advanceFreeze(dtSec);
    const shielded = this.wallShieldSec > 0;
    if (shielded) {
      this.wallShieldSec = Math.max(0, this.wallShieldSec - dtSec);
      if (this.wallShieldSec === 0) this._pushEvent('wallShieldOff', {});
    }
    for (const enemy of this.enemies) {
      if (enemy.state !== 'alive') continue;

      const moveMul = this.skills ? this._tickEffects(enemy, dtSec) : 1;
      if (enemy.state !== 'alive' || this.status !== 'active') continue; // 독으로 죽음/클리어.
      if (moveMul === 0) continue; // 경직 - 이동·성벽 공격(_attackTimer) 정지.
      if ((enemy.rank === 'boss' ? frozenBoss : frozenNormal) > 0) continue; // 모래시계 정지(isEnemyFrozen과 같은 판정, 갱신 전 값).

      const stopAt = enemy.stopAt ?? 1;
      if (enemy.progress < stopAt) {
        enemy.progress = Math.min(stopAt, enemy.progress + enemy.speed * moveMul * dtSec);
      }

      if (enemy.progress >= 1 && !enemy._reachedLine) {
        enemy._reachedLine = true;
        this._pushEvent('enemyReachLine', { enemyId: enemy.id });
      }

      if (enemy.progress >= 1) {
        enemy._attackTimer += dtSec;
        if (enemy._blockFlashTimer > 0) enemy._blockFlashTimer -= dtSec;
        while (enemy._attackTimer >= attackInterval && this.status === 'active') {
          enemy._attackTimer -= attackInterval;
          if (shielded) {
            // 결계 - 공격 박자는 그대로, 피해 0. 렌더 번쩍임용 wallBlocked는 같은 적당 _wallBlockFlashSec에 한 번만.
            if (enemy._blockFlashTimer <= 0) {
              enemy._blockFlashTimer = this._wallBlockFlashSec;
              this._pushEvent('wallBlocked', { sourceEnemyId: enemy.id, source: 'enemy' });
            }
            continue;
          }
          this.wallHealth = Math.max(0, this.wallHealth - enemy.wallDmg);
          this._pushEvent('wallDamaged', {
            amount: enemy.wallDmg,
            remainingHealth: this.wallHealth,
            sourceEnemyId: enemy.id,
          });
          if (this.wallHealth <= 0) {
            this.status = 'failed';
          }
        }
      }
    }
  }
}
