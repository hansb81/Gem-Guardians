import { BattleState } from '../battle/battleState.js';
import { getFloor, resolveFloorSpawns } from '../core/balance/floorGen.js';
import { towerAttack, clearBonus } from '../core/economy/economy.js';
import { playerState } from './playerState.js';
import { ItemController } from './itemController.js';
import { applySkillLevels, offerBossPack } from '../core/shop/shop.js';
import { createRng } from '../core/rng.js';

// 층 진행 + 골드/탑 레벨을 BattleState(순수 전투 로직)와 연결하는 글루. main.js는 이 하나만
// 들고 있으면 된다(퍼즐에서 잼이 터질 때 applyGemClear를 부르는 건 여전히 PuzzleBattleBridge).
//
// 탑 공격력은 "레벨 -> 공격력"을 미리 계산해 towersData.stats.attack에 박아두고, 레벨업 때
// 그 자리를 바로 고친다 - BattleState.applyGemClear는 towersData를 그대로 읽으므로 전투
// 중에도 즉시 반영된다(src/battle/battleState.js 쪽 설명 참고).
export class BattleController {
  constructor({ balance, enemies, obstacles, floorsData, towersBaseData, battleConfig, itemsConfig, shopConfig = null, onBattleStateChanged }) {
    this.balance = balance;
    this.enemies = enemies;
    this.obstacles = obstacles;
    this.floorsData = floorsData;
    this.battleConfig = battleConfig;
    // 상점(config/shop.json) - 젬 스킬 레벨을 층마다 battleConfig.skills에 곱하고, 보스층 패배 때 보스 돌파 팩을 띄운다.
    // 없으면(테스트·시뮬레이터) skills.json 그대로.
    this.shopConfig = shopConfig;
    // 층이 바뀔 때마다(클리어/재도전/dev 이동) 새 BattleState를 만든다 - PuzzleBattleBridge가
    // 계속 그 최신 인스턴스에 쏘도록 main.js가 이 콜백으로 자기 참조를 갈아 끼운다.
    this.onBattleStateChanged = onBattleStateChanged;

    this.towersData = towersBaseData.map((tower, i) => ({
      ...tower,
      stats: { ...tower.stats, attack: towerAttack(balance, playerState.towerLevel(i)) },
    }));

    // 하단 아이템(config/items.json) - 없으면 아이템 기능 없음. gameState는 main.js가 퍼즐 보드를
    // 새로 만들 때 items.gameState로 꽂는다.
    this.itemsConfig = itemsConfig ?? null;
    this.items = null;
    if (itemsConfig) {
      playerState.initItems(itemsConfig);
      this.items = new ItemController({ config: itemsConfig, player: playerState });
    }
    if (shopConfig) playerState.initShop(shopConfig);

    this._seenDeaths = new WeakSet();
    this.lastClearReward = null; // { killGold, bonusGold, total } - 클리어 팝업용.
    this._resetBattleState(playerState.floor);
  }

  // 새 BattleState를 만들어 this.battleState에 꽂고 onBattleStateChanged로 알린다(층
  // 클리어/재도전/dev 이동 모두 이 메서드를 거친다 - PuzzleBattleBridge가 참조를 놓치지
  // 않게 하는 유일한 경로). this.currentFloor/콜백의 floor 인자는 main.js가 그 층의
  // floor.obstacles로 퍼즐 보드를 다시 만드는 데 쓴다.
  // practice = 튜토리얼 다시 보기(연습 모드) 전용 전투 - 층 번호와 상관없이 그 층 데이터만 쓰고, 예약 아이템
  // 소모(beginFloor)·층 표시·클리어 보상은 하지 않는다. 진행 중 층/세이브는 그대로(나가면 retryFloor로 원래 층).
  _resetBattleState(floorNumber, { practice = false } = {}) {
    this.practice = practice;
    const floor = getFloor(this.balance, this.enemies, this.obstacles, this.floorsData, floorNumber);
    this.currentFloor = floor;
    const resolvedFloor = { wallHp: floor.wallHp, interval: floor.spawnInterval, spawnAt: floor.spawnAt, spawns: resolveFloorSpawns(this.balance, this.enemies, floor) };
    this.floorTag = floor.tag;
    this.killGoldThisFloor = 0; // 실제로 지급된 처치 골드(황금 주화 배율 포함).
    this._killGoldBase = 0; // 배율 전 처치 골드 - 클리어 보너스는 이걸로 계산해 층 골드가 정확히 x배가 되게.
    this.lastClearReward = null;
    // 젬 스킬 레벨은 inventory.skillLevel()만 읽는다(Lv 1 = skills.json 그대로).
    const skills = this.shopConfig ? applySkillLevels(this.battleConfig.skills, this.shopConfig.skills, (key) => playerState.inventory.skillLevel(key)) : this.battleConfig.skills;
    this.battleState = new BattleState({ towersData: this.towersData, resolvedFloor, battleConfig: { ...this.battleConfig, skills } });
    if (this.items) {
      this.items.resetFloor();
      this.items.battleState = this.battleState;
    }
    this._floorStarted = practice; // 예약 아이템은 beginFloor()(첫 update = 소환 연출 시작)에서 소모한다. 연습 모드는 소모 안 함.
    playerState.inventory.endFloor(); // 층 밖(메뉴·재도전 대기) - 장착 변경 즉시 적용.
    this.onBattleStateChanged?.(this.battleState, floor);
  }

  // 층 전투가 실제로 시작되는 순간(첫 update) 한 번만 - 예약한 층 시작 전 아이템(부스터·황금 주화)을
  // 소모하고 보드에 적용한다. 메뉴로 나가기(retryFloor)만 하고 시작하지 않으면 예약이 그대로 남는다.
  beginFloor() {
    if (this._floorStarted) return;
    this._floorStarted = true;
    playerState.inventory.beginFloor(); // 층 중에 바꾼 장착(pendingHotbar)을 여기서 적용, 이후 변경은 다음 층으로.
    if (!this.items) return;
    this.items.consumePreFloor();
    this.items.applyStarterSpecials();
  }

  get goldMul() {
    return this.items?.goldMul ?? 1;
  }

  // 패배 팝업 "부활"(docs/items.md C3) - 보유·층당 1회·실패 상태일 때만. 성공하면 전투가 이어진다.
  canRevive() {
    return !!this.items?.canUse('revive').ok;
  }

  revive() {
    return !!this.items?.use('revive').ok;
  }

  // 광고 이어하기(docs/ads.md) - 깃털 없이 같은 효과. 층당 횟수는 config adContinue.sharePerFloorWithRevive.
  get _shareContinue() {
    return !!this.itemsConfig?.adContinue?.sharePerFloorWithRevive;
  }

  adContinueLeft() {
    return this.items?.continueLeft(this._shareContinue) ?? 0;
  }

  adContinue() {
    return !!this.items?.continueFree(this._shareContinue);
  }

  get floor() {
    return this.practice ? this.currentFloor.floor : playerState.floor;
  }

  // 튜토리얼 다시 보기 - 1층 데이터로 튜토리얼 전용 전투를 연다(docs/tutorial.md 5장).
  startPractice() {
    this._resetBattleState(1, { practice: true });
  }

  update(dtSec) {
    this.beginFloor();
    this.battleState.update(dtSec);
    this._collectKillGold();
    // 클리어된 그 프레임에 한 번만 클리어 보상을 지급 - lastClearReward는 렌더가 팝업에
    // 보여줄 "얻은 골드"를 그대로 들고 있고, _resetBattleState가 null로 되돌린다(다음
    // 층을 새로 시작할 때까지는 다시 계산할 일이 없다).
    if (this.battleState.status === 'cleared' && !this.lastClearReward && !this.practice) this._applyClearReward();
    // 클리어 팝업에서는 장착 변경이 즉시 적용된다. 패배 팝업은 층 진행 중(pending - 재도전 때 적용, 부활하면 그대로).
    if (this.battleState.status === 'cleared' && playerState.inventory.inFloor) playerState.inventory.endFloor();
    // 보스층 패배 직후 - 보스 돌파 팩(상점 패키지) 노출. offerBossPack이 보스당 1회만 연다.
    if (this.battleState.status === 'failed' && this.floorTag === 'boss' && this.shopConfig && playerState.shop) {
      if (offerBossPack(playerState.shop, this.shopConfig, this.floor, Date.now())) playerState.save();
    }
  }

  _applyClearReward() {
    const isFirstClear = playerState.isFirstClearOf(this.floor);
    const bonusGold = clearBonus(this.balance, this._killGoldBase, isFirstClear) * this.goldMul;
    playerState.addGold(bonusGold);
    const items = isFirstClear ? this._grantFirstClearItems() : [];
    playerState.save();
    // 랭킹 일반 모드 = 클리어한 층(main.js가 RankingService.submit('normal')에 연결, 더 높을 때만 갱신).
    this.onFloorClear?.(this.floor);
    // 경쟁 모드(아직 없음): 판을 시작할 때 seasonId = rankingService.currentSeason().id를 판 상태에 저장해 두고,
    // 판이 끝날 때 rankingService.submit('comp', { value: 판 점수, floor, at, seasonId })로 그 시즌에 넣는다(docs/ranking.md 5-1).
    // grant = 보스 첫 처치 보상 delta(획득 팝업용, 없으면 null).
    this.lastClearReward = { killGold: this.killGoldThisFloor, bonusGold, total: this.killGoldThisFloor + bonusGold, items, grant: isFirstClear ? this._lastBossGrant : null };
  }

  // 보스층 첫 클리어 = 서로 다른 무작위 아이템(층 번호 seed - 같은 층이면 같은 보상). 20층(설정값) 첫 클리어 = 4번째 슬롯.
  // 보상 풀 = hotbar 그룹 중 골드 구매 가능(다이아 전용 제외)하고 지금 해금된 것(21층 전 해제 부적 제외).
  // 지급은 inventory.grant 한 번(txId 'boss:{층}' - 같은 층 보상은 두 번 안 들어간다).
  _grantFirstClearItems() {
    const cfg = this.itemsConfig;
    this._lastBossGrant = null;
    if (!cfg) return [];
    const bundle = { items: {} };
    if (this.floor === cfg.slots.unlock4BossFirstClear) bundle.flags = ['slot4'];
    const granted = this.floorTag === 'boss' ? this._pickBossReward(cfg) : [];
    if (granted.length === 0 && !bundle.flags) return [];
    for (const id of granted) bundle.items[id] = 1;
    const res = playerState.inventory.grant(bundle, { src: 'bossReward', txId: `boss:${this.floor}` });
    this._lastBossGrant = res.ok ? res.delta : null;
    return res.ok ? granted : [];
  }

  _pickBossReward(cfg) {
    const ids = Object.keys(cfg.items).filter((id) => cfg.items[id].group === 'hotbar' && cfg.items[id].goldBase != null && this.items.isUnlocked(id));
    const rng = createRng(this.floor);
    const granted = [];
    while (granted.length < cfg.bossFirstClearReward.count && ids.length > 0) {
      granted.push(ids.splice(Math.floor(rng() * ids.length), 1)[0]); // 뽑은 건 빼서 중복 없이.
    }
    return granted;
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
      const gold = event.gold * this.goldMul;
      this._killGoldBase += event.gold;
      this.killGoldThisFloor += gold;
      playerState.addGold(gold);
    }
  }

  // 클리어 팝업의 "다음 층" - 보상은 이미 _applyClearReward()가 지급했으니 여기선 그냥 진행.
  // 최고 층이 올라가면 새로 해금된 아이템(unlockFloor)을 지급한다(initItems는 없는 키만 채운다).
  advanceFloor() {
    playerState.advanceFloor();
    if (this.itemsConfig) playerState.initItems(this.itemsConfig);
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

  // 일괄 강화 - 다섯 석상을 골고루 올리고 공격력을 다시 계산한다.
  levelUpAllEven() {
    const ok = playerState.levelUpAllEven(this.balance);
    if (ok) for (let i = 0; i < this.towersData.length; i++) this.towersData[i].stats.attack = towerAttack(this.balance, playerState.towerLevel(i));
    return ok;
  }

  // 개발용(?dev=1) - 층 이동/골드 지급/레벨 일괄 설정. 밸런스 확인 전용(docs/balance.md).
  devSetFloor(floorNumber) {
    playerState.floor = Math.max(1, Math.floor(floorNumber));
    playerState.bestFloor = Math.max(playerState.bestFloor, playerState.floor);
    playerState.save();
    if (this.itemsConfig) playerState.initItems(this.itemsConfig);
    this._resetBattleState(playerState.floor);
  }

  devAddGold(amount) {
    playerState.addGold(amount);
    playerState.save();
  }

  devAddAllItems(count) {
    if (!this.itemsConfig) return;
    const items = Object.fromEntries(Object.keys(this.itemsConfig.items).map((id) => [id, count]));
    playerState.inventory.grant({ items }, { src: 'dev' });
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
