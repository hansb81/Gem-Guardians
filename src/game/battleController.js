import { BattleState } from '../battle/battleState.js';
import { getFloor, resolveFloorSpawns } from '../core/balance/floorGen.js';
import { towerAttack, clearBonus } from '../core/economy/economy.js';
import { playerState } from './playerState.js';

// 층 진행 + 골드/탑 레벨을 BattleState(순수 전투 로직)와 연결하는 글루. main.js는 이 하나만
// 들고 있으면 된다(퍼즐에서 잼이 터질 때 applyGemClear를 부르는 건 여전히 PuzzleBattleBridge).
//
// 탑 공격력은 "레벨 -> 공격력"을 미리 계산해 towersData.stats.attack에 박아두고, 레벨업 때
// 그 자리를 바로 고친다 - BattleState.applyGemClear는 towersData를 그대로 읽으므로 전투
// 중에도 즉시 반영된다(src/battle/battleState.js 쪽 설명 참고).
export class BattleController {
  constructor({ balance, enemies, obstacles, floorsData, towersBaseData, battleConfig, onBattleStateChanged }) {
    this.balance = balance;
    this.enemies = enemies;
    this.obstacles = obstacles;
    this.floorsData = floorsData;
    this.battleConfig = battleConfig;
    // 층이 바뀔 때마다(클리어/재도전/dev 이동) 새 BattleState를 만든다 - PuzzleBattleBridge가
    // 계속 그 최신 인스턴스에 쏘도록 main.js가 이 콜백으로 자기 참조를 갈아 끼운다.
    this.onBattleStateChanged = onBattleStateChanged;

    this.towersData = towersBaseData.map((tower, i) => ({
      ...tower,
      stats: { ...tower.stats, attack: towerAttack(balance, playerState.towerLevel(i)) },
    }));

    this._seenDeaths = new WeakSet();
    this.lastClearReward = null; // { killGold, bonusGold, total } - 클리어 팝업용.
    this._resetBattleState(playerState.floor);
  }

  // 새 BattleState를 만들어 this.battleState에 꽂고 onBattleStateChanged로 알린다(층
  // 클리어/재도전/dev 이동 모두 이 메서드를 거친다 - PuzzleBattleBridge가 참조를 놓치지
  // 않게 하는 유일한 경로). this.currentFloor/콜백의 floor 인자는 main.js가 그 층의
  // floor.obstacles로 퍼즐 보드를 다시 만드는 데 쓴다.
  _resetBattleState(floorNumber) {
    const floor = getFloor(this.balance, this.enemies, this.obstacles, this.floorsData, floorNumber);
    this.currentFloor = floor;
    const resolvedFloor = { wallHp: floor.wallHp, interval: floor.spawnInterval, spawns: resolveFloorSpawns(this.balance, this.enemies, floor) };
    this.floorTag = floor.tag;
    this.killGoldThisFloor = 0;
    this.lastClearReward = null;
    this.battleState = new BattleState({ towersData: this.towersData, resolvedFloor, battleConfig: this.battleConfig });
    this.onBattleStateChanged?.(this.battleState, floor);
  }

  get floor() {
    return playerState.floor;
  }

  update(dtSec) {
    this.battleState.update(dtSec);
    this._collectKillGold();
    // 클리어된 그 프레임에 한 번만 클리어 보상을 지급 - lastClearReward는 렌더가 팝업에
    // 보여줄 "얻은 골드"를 그대로 들고 있고, _resetBattleState가 null로 되돌린다(다음
    // 층을 새로 시작할 때까지는 다시 계산할 일이 없다).
    if (this.battleState.status === 'cleared' && !this.lastClearReward) this._applyClearReward();
  }

  _applyClearReward() {
    const isFirstClear = playerState.isFirstClearOf(this.floor);
    const bonusGold = clearBonus(this.balance, this.killGoldThisFloor, isFirstClear);
    playerState.addGold(bonusGold);
    playerState.save();
    this.lastClearReward = { killGold: this.killGoldThisFloor, bonusGold, total: this.killGoldThisFloor + bonusGold };
  }

  // 새로 발생한 enemyDie 이벤트마다 골드를 바로 지갑에 넣는다(실패해도 그때까지 잡은 골드는
  // 유지 - docs/balance.md §8). WeakSet이라 이벤트가 battleState.events에서 빠지면(수명이
  // 끝나면) 자동으로 더 이상 추적하지 않는다.
  // shortcut: 처치마다 storage.save()를 부르지 않는다(적이 많을 때 I/O가 잦아짐) - 레벨업/
  // 클리어/층 이동 시점에 같이 저장되므로 그 사이에 탭을 닫으면 그 구간 킬 골드만 날아갈 수
  // 있다. 체감상 문제되면 그때 쓰로틀 저장을 추가.
  _collectKillGold() {
    for (const event of this.battleState.events) {
      if (event.type !== 'enemyDie' || this._seenDeaths.has(event)) continue;
      this._seenDeaths.add(event);
      this.killGoldThisFloor += event.gold;
      playerState.addGold(event.gold);
    }
  }

  // 클리어 팝업의 "다음 층" - 보상은 이미 _applyClearReward()가 지급했으니 여기선 그냥 진행.
  advanceFloor() {
    playerState.advanceFloor();
    this._resetBattleState(playerState.floor);
  }

  // 실패 팝업의 "다시 하기" - 같은 층을 처음부터(잡은 골드는 이미 _collectKillGold로 지급됨).
  retryFloor() {
    this._resetBattleState(playerState.floor);
  }

  // 전투 영역 안에서 탑을 탭했을 때 - 성공하면 true(렌더가 반짝임+레벨 텍스트), 골드가
  // 모자라면 false(렌더가 흔들림 연출).
  tryLevelUpTower(index) {
    const ok = playerState.tryLevelUpTower(this.balance, index);
    if (ok) this.towersData[index].stats.attack = towerAttack(this.balance, playerState.towerLevel(index));
    return ok;
  }

  // MAX 버튼 - tryLevelUpTower와 같은 패턴으로 레벨업 직후 towersData.stats.attack을 갱신한다.
  maxLevelUpTower(index) {
    const ok = playerState.levelUpTowerMax(this.balance, index);
    if (ok) this.towersData[index].stats.attack = towerAttack(this.balance, playerState.towerLevel(index));
    return ok;
  }

  // 개발용(?dev=1) - 층 이동/골드 지급/레벨 일괄 설정. 밸런스 확인 전용(docs/balance.md).
  devSetFloor(floorNumber) {
    playerState.floor = Math.max(1, Math.floor(floorNumber));
    playerState.bestFloor = Math.max(playerState.bestFloor, playerState.floor);
    playerState.save();
    this._resetBattleState(playerState.floor);
  }

  devAddGold(amount) {
    playerState.addGold(amount);
    playerState.save();
  }

  devSetAllTowerLevels(level) {
    const clamped = Math.max(1, Math.min(this.balance.tower.maxLevel, Math.floor(level)));
    for (let i = 0; i < playerState.towerLevels.length; i++) {
      playerState.towerLevels[i] = clamped;
      this.towersData[i].stats.attack = towerAttack(this.balance, clamped);
    }
    playerState.save();
  }
}
