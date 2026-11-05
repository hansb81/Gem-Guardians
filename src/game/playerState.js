// 진행도/재화 상태. 화면(HUD)과 BattleController가 이 객체 하나만 읽고 쓴다. 저장은
// storage 인터페이스(지금은 localStorage, 나중에 Capacitor Preferences)로 한다 - docs/balance.md
// §8 "저장: 최고 층, 현재 층, 골드, 탑 5개 레벨".
import { storage } from '../platform/storage.js';
import { towerLevelCost, maxTowerLevelUps } from '../core/economy/economy.js';

const STORAGE_KEY = 'gemGuardians.save.v1';
const TOWER_COUNT = 5;

function defaults() {
  return { gold: 0, diamonds: 0, floor: 1, bestFloor: 1, towerLevels: Array(TOWER_COUNT).fill(1) };
}

class PlayerState {
  constructor() {
    const saved = storage.load(STORAGE_KEY);
    Object.assign(this, defaults(), saved ?? {});
    if (!Array.isArray(this.towerLevels) || this.towerLevels.length !== TOWER_COUNT) {
      this.towerLevels = Array(TOWER_COUNT).fill(1);
    }
  }

  save() {
    storage.save(STORAGE_KEY, {
      gold: this.gold,
      diamonds: this.diamonds,
      floor: this.floor,
      bestFloor: this.bestFloor,
      towerLevels: this.towerLevels,
    });
  }

  addGold(amount) {
    this.gold += amount;
  }

  // 지금 층이 그 플레이어의 "맨 앞(bestFloor)"이면 처음 클리어 - 그래야 docs/balance.md §8의
  // clearBonusMul/replayClearMul 구분이 성립한다(한 번 넘어간 층을 dev 도구 등으로 다시 깨면
  // replay).
  isFirstClearOf(floor) {
    return floor >= this.bestFloor;
  }

  // 층 클리어 후 다음 층으로 진행 - bestFloor를 갱신하고 저장한다. 클리어 보상은
  // BattleController가 economy.clearBonus()로 계산해 addGold로 넣어준 뒤 이 메서드를 부른다.
  advanceFloor() {
    this.bestFloor = Math.max(this.bestFloor, this.floor + 1);
    this.floor += 1;
    this.save();
  }

  towerLevel(index) {
    return this.towerLevels[index];
  }

  nextTowerLevelCost(balance, index) {
    return towerLevelCost(balance, this.towerLevels[index]);
  }

  // 탑 탭 레벨업 - 골드가 충분하면 즉시 1레벨 올리고 저장, 모자라면 false(흔들림 연출용).
  tryLevelUpTower(balance, index) {
    const level = this.towerLevels[index];
    if (level >= balance.tower.maxLevel) return false;
    const cost = towerLevelCost(balance, level);
    if (this.gold < cost) return false;
    this.gold -= cost;
    this.towerLevels[index] = level + 1;
    this.save();
    return true;
  }

  // MAX 버튼 - 지금 골드로 살 수 있는 만큼 한 번에 올린다. 한 레벨도 못 올리면 false.
  levelUpTowerMax(balance, index) {
    const { levels, cost, newLevel } = maxTowerLevelUps(balance, this.towerLevels[index], this.gold);
    if (levels === 0) return false;
    this.gold -= cost;
    this.towerLevels[index] = newLevel;
    this.save();
    return true;
  }
}

export const playerState = new PlayerState();
