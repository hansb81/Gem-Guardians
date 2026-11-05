// 방치형 디펜스 "전투" 미니게임의 순수 로직. 브라우저 API 사용 금지, src/core는 import하지
// 않는다 - 퍼즐(매치-3) 로직과 완전히 독립적이다. 색은 문자열 id('red' 등)로만 다룬다.
//
// 컨셉: 잼 = 타워. 성벽 뒤에 색마다 탑 1개(총 5개)가 서서 적을 쏜다. 탑은 같은 색 잼이
// 퍼즐에서 터질 때만 쏜다(applyGemClear) - 자동 공격은 없다(docs/battle.md §4).
// 한 층 = 웨이브 여러 개(resolvedFloor.waves) - 웨이브의 적을 interval초 간격으로 오른쪽
// 끝에서 소환하고, 전멸하면 waveBreak초 뒤 다음 웨이브. 마지막 웨이브 전멸 = 층 클리어.
// 적은 성벽에 닿으면 멈추고 attackIntervalSec마다 wallDmg. 성벽 HP 0 = 실패.
//
// resolvedFloor는 src/core/balance/floorGen.js의 resolveFloorWaves()가 이미 소환 문자열을
// 스탯 객체(hp/def/speed/wallDmg/gold/name/anim/rank 등)로 바꿔둔 결과다 - 이 클래스는
// 그 숫자를 그대로 쓰기만 한다(밸런스 공식을 모른다).
import { pickSummonFrame, isSummonDone } from './summon.js';

export class BattleState {
  constructor({ towersData, resolvedFloor, battleConfig }) {
    this.towersData = towersData;
    this.battleConfig = battleConfig;
    this.resolvedFloor = resolvedFloor;

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

    this.waves = resolvedFloor.waves;
    this.totalWaves = this.waves.length;
    this.waveBreakSec = resolvedFloor.waveBreak;

    this.enemies = [];
    this.events = [];

    this._nextEnemyId = 1;
    this._nextSpawnSeq = 1;
    // 층 시작(첫 진입/다음 층) 연출 상태 - 렌더(battleRenderer)와 분리된 core/battle 쪽
    // 상태다. battleConfig.summon이 없으면(에셋 로더가 assets/summon/manifest.json을 못
    // 읽었을 때) 연출 없이 즉시 비활성 - 렌더는 바로 statue_idle로 그린다.
    this.summon = this._createSummon();
    this._startWave(0);
  }

  reset() {
    this.wallHealth = this.wallMaxHealth;
    this.status = 'active';
    this.enemies = [];
    this.events = [];
    this.summon = this._createSummon();
    this._startWave(0);
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
  // 마지막 슬롯이 끝나면 summon.active를 꺼서 스폰/웨이브 타이머와 퍼즐 입력 차단을 푼다.
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

  // 현재 웨이브 번호(1부터) / 전체 웨이브 수 - HUD("웨이브 n/N") 표시용.
  get waveNumber() {
    return this.waveIndex + 1;
  }

  _startWave(index) {
    this.waveIndex = index;
    this._phase = 'spawning';
    this._waveElapsedSec = 0;
    this._spawnedCount = 0;
  }

  _currentWave() {
    return this.waves[this.waveIndex];
  }

  _pushEvent(type, fields) {
    this.events.push({
      type,
      ...fields,
      elapsedMs: 0,
      durationMs: this.battleConfig.effectDurationsMs[type],
    });
  }

  // 살아있는 적 중 성벽에 가장 가까운(progress가 가장 높은) 1마리. progress가 동률이면
  // 먼저 스폰된 적을 우선한다(결정적 - Math.random 없이도 일관된 타겟팅). 사거리 제한 없음
  // (docs/battle.md §4 puzzleShot.range=unlimited)이라 필터 없이 전체에서 고른다.
  _frontmostEnemy() {
    let target = null;
    for (const enemy of this.enemies) {
      if (enemy.state !== 'alive') continue;
      if (!target || enemy.progress > target.progress || (enemy.progress === target.progress && enemy._spawnSeq < target._spawnSeq)) {
        target = enemy;
      }
    }
    return target;
  }

  // 탑 발사 시점 - towerAttack 이벤트만 내보낸다(피해는 아직 적용하지 않음). render가 이
  // 이벤트로 공격 애니메이션 + 투사체를 띄우고, 투사체가 화면에서 목표에 "충돌"하는 순간
  // resolveTowerAttack(event)를 호출해 실제 피해를 적용한다.
  _fireShot(tower, target, damage, cascadeIndex) {
    this._pushEvent('towerAttack', {
      towerId: tower.id,
      targetEnemyId: target.id,
      damage,
      cascadeIndex,
    });
  }

  // render가 투사체 충돌을 감지한 순간 호출한다. 목표가 그 사이 이미 죽었거나 전투가
  // 끝났으면 아무 일도 하지 않는다 - enemyHit/enemyDie 이벤트를 내보내고, 적이 죽으면
  // 웨이브/층 진행 판정까지 한다.
  resolveTowerAttack(event) {
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
      this._pushEvent('enemyDie', { enemyId: target.id, gold: target.gold, enemyType: target.type, rank: target.rank });
      this._checkWaveProgress();
    }
  }

  // 현재 웨이브가 다 스폰됐고 살아있는 적이 없으면: 마지막 웨이브면 층 클리어, 아니면
  // waveBreakSec 뒤 다음 웨이브 시작(update()의 waveBreak 카운트다운으로 넘어간다).
  _checkWaveProgress() {
    const wave = this._currentWave();
    const allSpawned = this._spawnedCount >= wave.spawns.length;
    const anyAlive = this.enemies.some((e) => e.state === 'alive');
    if (!allSpawned || anyAlive) return;

    if (this.waveIndex >= this.totalWaves - 1) {
      this.status = 'cleared';
    } else {
      this._phase = 'waveBreak';
      this._waveBreakRemainingSec = this.waveBreakSec;
    }
  }

  // 퍼즐에서 color 잼 count개가 cascadeIndex 단계에 지워졌을 때(특수 잼 효과로 지워진 잼
  // 포함) 그 색 탑이 즉시 1발 쏜다 - 탑이 쏘는 유일한 경로다. 피해 = 공격력 x count x
  // (1 + cascadeBonusPerStep x (cascadeIndex-1)) - 적 방어력, 최소 minDamage. 사거리 제한 없음.
  applyGemClear(color, count, cascadeIndex) {
    if (this.status !== 'active') return;

    const tower = this.towersData.find((t) => t.color === color);
    if (!tower) return;

    const target = this._frontmostEnemy();
    if (!target) return;

    const { cascadeBonusPerStep, minDamage } = this.battleConfig;
    const rawDamage = tower.stats.attack * count * (1 + cascadeBonusPerStep * (cascadeIndex - 1));
    const damage = Math.max(minDamage, Math.round(rawDamage - target.def));

    this._fireShot(tower, target, damage, cascadeIndex);
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
      _spawnSeq: this._nextSpawnSeq++,
      _reachedLine: false,
      _attackTimer: 0,
    });
  }

  _spawnDue() {
    const wave = this._currentWave();
    while (this._spawnedCount < wave.spawns.length && this._waveElapsedSec >= this._spawnedCount * wave.interval) {
      this._spawnEnemy(wave.spawns[this._spawnedCount]);
      this._spawnedCount++;
    }
  }

  update(dtSec) {
    const dtMs = dtSec * 1000;
    this._advanceEvents(dtMs);
    this._advanceSummon(dtMs);

    if (this.status !== 'active') return;

    // 소환 연출이 끝나기 전엔(마지막 슬롯이 landFrame을 지나기 전) 스폰/웨이브 타이머를
    // 멈춘다 - 적이 석상보다 먼저 나타나 보이지 않게 한다(docs 요청).
    if (!this.summon.active) {
      if (this._phase === 'waveBreak') {
        this._waveBreakRemainingSec -= dtSec;
        if (this._waveBreakRemainingSec <= 0) this._startWave(this.waveIndex + 1);
      }
      // waveBreak가 이번 틱에 끝나 바로 'spawning'으로 넘어갔으면 같은 틱에 첫 소환까지 한다
      // (shortcut: 그 경계 틱만 waveElapsedSec에 남은 dt 전체가 들어가 수 ms 오차가 생길 수
      // 있음 - 프레임 dt가 작아 체감 불가. 더 정확히 하려면 waveBreak 초과분만 넘겨야 함).
      if (this._phase === 'spawning') {
        this._waveElapsedSec += dtSec;
        this._spawnDue();
      }
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
