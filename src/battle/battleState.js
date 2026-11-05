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

    this.spawns = resolvedFloor.spawns;
    this.spawnInterval = resolvedFloor.interval;
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
    // 층 시작(첫 진입/다음 층) 연출 상태 - 렌더(battleRenderer)와 분리된 core/battle 쪽
    // 상태다. battleConfig.summon이 없으면(에셋 로더가 assets/summon/manifest.json을 못
    // 읽었을 때) 연출 없이 즉시 비활성 - 렌더는 바로 statue_idle로 그린다.
    this.summon = this._createSummon();
    this._startSpawning();
  }

  reset() {
    this.wallHealth = this.wallMaxHealth;
    this.status = 'active';
    this.enemies = [];
    this.events = [];
    this._pendingShots = new Map();
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
  applyObstacleWallDamage(pct) {
    if (this.status !== 'active') return;
    const amount = Math.round(this.wallMaxHealth * pct);
    this.wallHealth = Math.max(0, this.wallHealth - amount);
    this._pushEvent('wallDamaged', { amount, remainingHealth: this.wallHealth, source: 'obstacle' });
    if (this.wallHealth <= 0) this.status = 'failed';
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

    target.currentHealth -= event.damage;

    this._pushEvent('enemyHit', {
      enemyId: target.id,
      damage: event.damage,
      remainingHealth: Math.max(0, target.currentHealth),
      towerId: event.towerId,
    });

    if (target.currentHealth <= 0) {
      target.state = 'dead';
      this._killedCount++;
      this._pushEvent('enemyDie', { enemyId: target.id, gold: target.gold, enemyType: target.type, rank: target.rank });
      this._checkProgress();
    }

    // 가상 효과(modifier) 훅 - 기본은 battleConfig.hooks가 없어 아무 영향도 없다(docs/simulation.md
    // T2). 나중에 실제 잼 특수 효과/아이템이 생기면 이 자리에 onHit을 붙인다(도트/둔화/범위/관통/연쇄).
    // fromModifier(합성 피해 - 범위/관통/연쇄/도트가 만든 2차 피해)는 다시 onHit을 타지 않는다
    // (연쇄가 자기 자신을 다시 트리거해 무한 증폭되는 것을 막는다).
    if (!event.fromModifier) this.hooks?.onHit?.(this, event, target);
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
  applyGemClear(color, count, cascadeIndex, isSpecial = false) {
    if (this.status !== 'active') return undefined;

    const tower = this.towersData.find((t) => t.color === color);
    if (!tower) return undefined;

    const target = this._pickTarget();
    if (!target) return undefined;

    const { cascadeBonusPerStep, minDamage } = this.battleConfig;
    let rawDamage = tower.stats.attack * count * (1 + cascadeBonusPerStep * (cascadeIndex - 1));
    // 가상 효과(modifier) 훅 - 기본은 battleConfig.hooks가 없어 아무 영향도 없다(docs/simulation.md
    // T2). 나중에 실제 잼 특수 효과/아이템이 생기면 이 자리에 onShot을 붙인다(피해 배율/연타).
    if (this.hooks?.onShot) {
      rawDamage = this.hooks.onShot({ color, count, cascadeIndex, isSpecial, tower, target, rawDamage });
    }
    const damage = Math.max(minDamage, Math.round(rawDamage - target.def));

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
    });
  }

  _spawnDue() {
    while (this._spawnedCount < this.spawns.length && this._elapsedSec >= this._spawnedCount * this.spawnInterval) {
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

  update(dtSec) {
    const dtMs = dtSec * 1000;
    this._advanceEvents(dtMs);
    this._advanceSummon(dtMs);
    this._expirePendingShots(dtMs);

    if (this.status !== 'active') return;

    // 소환 연출이 끝나기 전엔(마지막 슬롯이 landFrame을 지나기 전) 스폰 타이머를 멈춘다 -
    // 적이 석상보다 먼저 나타나 보이지 않게 한다(docs 요청).
    if (!this.summon.active) {
      this._elapsedSec += dtSec;
      this._spawnDue();
    }

    const attackInterval = this.battleConfig.attackIntervalSec;
    for (const enemy of this.enemies) {
      if (enemy.state !== 'alive') continue;

      if (enemy.progress < 1) {
        enemy.progress = Math.min(1, enemy.progress + enemy.speed * dtSec);
      }

      if (enemy.progress >= 1 && !enemy._reachedLine) {
        enemy._reachedLine = true;
        this._pushEvent('enemyReachLine', { enemyId: enemy.id });
      }

      if (enemy.progress >= 1) {
        enemy._attackTimer += dtSec;
        while (enemy._attackTimer >= attackInterval && this.status === 'active') {
          enemy._attackTimer -= attackInterval;
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
