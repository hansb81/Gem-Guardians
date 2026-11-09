// 진행도/재화 상태. 화면(HUD)과 BattleController가 이 객체 하나만 읽고 쓴다. 저장은
// storage(src/platform/storage.js - 마켓 어댑터 저장소)로 한다 - docs/balance.md
// §8 "저장: 최고 층, 현재 층, 골드, 탑 5개 레벨".
import { storage } from '../platform/storage.js';
import { towerLevelCost, maxTowerLevelUps, evenTowerLevelUps } from '../core/economy/economy.js';
import { normalizeShopSave } from '../core/shop/shop.js';
import { migrateSave, defaultSkillLevels, SAVE_VERSION } from '../core/inventory/inventory.js';
import { Inventory } from './inventory.js';
import { normalizeRanking } from '../ranking/rankingSave.js';
import { createRng } from '../core/rng.js';
import { migrateTutorialSave } from '../tutorial/tutorial.js';

// 키 v2: 상점(shop) 추가 때 올린 저장 키. 예전 키(v1)만 있으면 그걸 읽어 v2 키로 저장한다.
// 저장 형식 버전(saveVersion)은 키와 별개 - 2 = 아이템·장착·예약·젬 스킬이 inv 묶음(docs/inventory.md 2장).
const STORAGE_KEY = 'gemGuardians.save.v2';
const LEGACY_KEYS = ['gemGuardians.save.v1'];
const TOWER_COUNT = 5;

function defaults() {
  // shop = { purchasedOnce[], firstBuyUsed[], passes{weekly,monthly: {daysLeft, claimedToday}}, freeClaimedDate, day, offers }
  // (src/core/shop/shop.js defaultShopSave) - config/shop.json을 읽은 뒤 initShop이 채운다.
  // tutorial = 최초 진입 튜토리얼(docs/tutorial.md) - done이 true가 아니면 1층 진입 때 실행.
  return { gold: 0, diamonds: 0, floor: 1, bestFloor: 1, towerLevels: Array(TOWER_COUNT).fill(1), shop: null, tutorial: { done: false, version: 1 } };
}

// 랭킹용 기기 id. 서버 단계에서는 서버가 준 id로 바뀐다(docs/ranking.md 13-2 players).
function newPlayerId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  // shortcut: 비보안 컨텍스트(http LAN)에선 randomUUID가 없어 시각 씨앗 id - 서버 단계에서 서버 id로 교체
  return `p-${Date.now().toString(36)}-${Math.floor(createRng(Date.now())() * 1e9).toString(36)}`;
}

class PlayerState {
  constructor() {
    let saved = storage.load(STORAGE_KEY);
    for (const key of LEGACY_KEYS) saved ??= storage.load(key);
    const { inv, saveVersion, ...rest } = migrateSave(saved, Math.floor(Date.now() / 1000)) ?? {};
    Object.assign(this, defaults(), rest);
    if (!Array.isArray(this.towerLevels) || this.towerLevels.length !== TOWER_COUNT) {
      this.towerLevels = Array(TOWER_COUNT).fill(1);
    }
    // 튜토리얼 필드가 없던 세이브는 플레이 흔적이 있으면 done:true(src/tutorial/tutorial.js migrateTutorialSave).
    this.tutorial = migrateTutorialSave(saved);
    // 아이템·장착·예약·영구 보유는 전부 여기(src/game/inventory.js). 지갑은 this.gold/diamonds.
    this.inventory = new Inventory(inv, { wallet: this, save: () => this.save() });
    // 랭킹(docs/ranking.md 7-1) - 읽고 쓰는 곳은 src/ranking/rankingService.js(LocalRankingService) 하나.
    this.ranking = normalizeRanking(this.ranking, { bestFloor: this.bestFloor, nowMs: Date.now() });
    this.ranking.profile.playerId ||= newPlayerId();
  }

  save() {
    storage.save(STORAGE_KEY, {
      saveVersion: SAVE_VERSION,
      gold: this.gold,
      diamonds: this.diamonds,
      floor: this.floor,
      bestFloor: this.bestFloor,
      towerLevels: this.towerLevels,
      shop: this.shop,
      inv: this.inventory.data,
      ranking: this.ranking,
      tutorial: this.tutorial,
    });
  }

  // 상점 저장 상태(config/shop.json) - 없는 키만 채운다. 젬 스킬 기본 레벨(색 1, 특수 기술 해금 전 0)도
  // 없는 키만 inventory.perm.skills에 채운다. initItems와 같은 시점에 한 번.
  initShop(shopConfig) {
    this.shop = normalizeShopSave(this.shop, shopConfig);
    const skills = this.inventory.data.perm.skills;
    for (const [key, lv] of Object.entries(defaultSkillLevels(shopConfig.skills))) skills[key] ??= lv;
    this.save();
  }

  // 임시 지급(docs/items.md - 상점 전 단계 값, docs/inventory.md 4·8장): unlockFloor 없는 아이템 중 txId
  // 'start:{id}'를 아직 안 받은 것만 starterCount(없으면 starter.count)개 - 첫 실행이면 전부, config에 새 아이템이
  // 생기면 그것만. 장착이 비어 있었으면(첫 실행) 기본 장착. unlockFloor가 있는 아이템(해제 부적)은 최고 층이 닿고
  // 아직 한 번도 가진 적 없으면 txId 'unlock:{id}'로 지급 - 층이 오를 때마다 다시 부른다.
  initItems(itemsConfig) {
    const inv = this.inventory;
    inv.setConfig(itemsConfig);
    const { starter } = itemsConfig;
    const countOf = (id) => itemsConfig.items[id].starterCount ?? starter.count;
    const startIds = Object.keys(itemsConfig.items).filter((id) => (itemsConfig.items[id].unlockFloor ?? 1) <= 1);
    inv.expandStartTx(startIds); // 'start' 한 줄 기록(인벤토리 A 저장) -> start:{id}
    const newIds = startIds.filter((id) => !inv.data.grantedTx.includes(`start:${id}`));
    if (newIds.length > 0) {
      const fresh = inv.data.loadout.hotbar.every((id) => id == null);
      inv.grant({ items: Object.fromEntries(newIds.map((id) => [id, countOf(id)])) }, { src: 'start', txId: newIds.map((id) => `start:${id}`) });
      // 지급 때 빈 칸 자동 장착이 config 순서로 채웠으니 기본 장착으로 맞춘다(equip은 같은 아이템이면 자리 바꾸기).
      if (fresh) starter.equipped.forEach((id, i) => inv.equip(i, id));
    }
    for (const [id, it] of Object.entries(itemsConfig.items)) {
      if ((it.unlockFloor ?? 1) > 1 && this.isItemUnlocked(id) && !(id in inv.data.items)) {
        inv.grant({ items: { [id]: countOf(id) } }, { src: 'floorUnlock', txId: `unlock:${id}` });
      }
    }
  }

  isItemUnlocked(id) {
    return this.bestFloor >= (this.inventory.config?.items[id]?.unlockFloor ?? 1);
  }

  // 개발용 - 지금 상태를 v1 저장 형식(items/equipped/preFloor/shop.skillLv)으로 되돌려 저장. 다시 불러오면
  // (새로고침) 생성자가 마이그레이션을 다시 돈다. grantedTx·log는 v1에 없으므로 사라진다.
  devRevertSaveToV1() {
    const { items, loadout, perm } = this.inventory.data;
    const equipped = loadout.hotbar.slice(0, this.inventory.slotCount());
    storage.save(STORAGE_KEY, {
      gold: this.gold, diamonds: this.diamonds, floor: this.floor, bestFloor: this.bestFloor, towerLevels: this.towerLevels,
      items: { ...items }, equipped, preFloor: { ...loadout.preFloor },
      shop: this.shop && { ...this.shop, skillLv: { ...perm.skills } },
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

  // 일괄 강화 - 다섯 석상을 골고루(낮은 레벨부터) 지금 골드만큼 올린다. 한 레벨도 못 올리면 false.
  levelUpAllEven(balance) {
    const { levels, cost, count } = evenTowerLevelUps(balance, this.towerLevels, this.gold);
    if (count === 0) return false;
    this.gold -= cost;
    for (let i = 0; i < levels.length; i++) this.towerLevels[i] = levels[i];
    this.save();
    return true;
  }
}

export const playerState = new PlayerState();
