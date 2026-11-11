import { GameState } from './core/gameState.js';
import { Animator } from './render/animator.js';
import { CanvasRenderer } from './render/canvasRenderer.js';
import { PointerInput } from './input/pointerInput.js';
import { loadAssets, loadItemAssets } from './render/assetLoader.js';
import { isNeighbor, itemTargetCells } from './render/itemBarRenderer.js';
import { TitleScreen } from './render/titleScreen.js';
import { MainMenuScreen } from './render/mainMenuScreen.js';
import { ShopScreen } from './render/shopScreen.js';
import { RewardPopup, rewardFromDelta } from './render/rewardPopup.js';
import { loadBattleData } from './game/loadBattleData.js';
import { loadBalanceData } from './game/loadBalanceData.js';
import { PuzzleBattleBridge } from './game/puzzleBattleBridge.js';
import { BattleController } from './game/battleController.js';
import { playerState } from './game/playerState.js';
import { setupDevPanel } from './game/devPanel.js';
import { setupSfxTestPanel } from './game/sfxTestPanel.js';
import { audio, bgmForScene } from './audio/AudioManager.js';
import { ANIMATION_DURATIONS_MS } from './config/animation.js';
import { computeScreenFit, FRAME_LOGICAL_W } from './render/screenFit.js';
import { t, tOr, setLocale } from './config/i18n.js';
import { FONT_LOAD_SPECS } from './config/fonts.js';
import { towerAttack, normalFloorReward } from './core/economy/economy.js';
import { RankingUi } from './game/rankingUi.js';
import { pressButton } from './render/uiKit.js';
import { openPrepState, rememberTab, statueRowInfo, statueAllInfo, hitPrepPopup } from './render/ui/prepPopup.js';
import { Tutorial, shouldStartTutorial, completeTutorial } from './tutorial/tutorial.js';
import { resolveFloorSpawns } from './core/balance/floorGen.js';
import { platform } from './platform/index.js';
import { recoverPending, restore, syncServerIap } from './shop/iap.js';
import { storage } from './platform/storage.js';
import { loadServerConfig, setupServer } from './game/serverUi.js';
import { showRewarded } from './game/ads.js';
import { continueOptions, recordUse } from './game/adContinue.js';

setLocale(storage.load('locale') ?? 'ko'); // 설정 팝업의 언어 버튼이 저장한 값.
const canvas = document.getElementById('game-canvas');

// 자동재생 정책(첫 입력에서 resume) + 탭 숨김 시 suspend. 에셋 로드보다 먼저 걸어 둬야
// 첫 터치가 로딩 중에 들어와도 잠금이 풀린다.
audio.install();
// 타이틀 곡 - 첫 터치 전(suspended)이면 예약만 되고 resume() 직후 시작한다. 다음 곡(메뉴)은 미리 받는다.
// 웹에서는 첫 터치가 곧 문 열림이라 타이틀 곡이 거의 안 들린다(로딩 중에 터치한 경우만) - 의도된 것.
// Capacitor 포팅 때 WebView 자동재생 허용(Android mediaPlaybackRequiresUserGesture=false,
// iOS mediaTypesRequiringUserActionForPlayback 없음)으로 앱에서는 바로 나오게 한다.
audio.playBgm(bgmForScene('title'), { fadeInMs: 1500 });
audio.preloadBgm(bgmForScene('menu'));

// 층이 바뀌면(resetPuzzleBoard) 새 GameState로 재대입된다 - 그래서 let이다. 전투/층 데이터가
// 로드되기 전까지는 방해요소 없는 임시 보드로 퍼즐만 동작한다.
let gameState = new GameState({ seed: Date.now() });
// 상태를 갖지 않는 뷰 모델 빌더 - 매 프레임 gameState.board/effects를 직접 읽어서
// 그릴 목록을 새로 계산할 뿐, 자신만의 섀도 상태는 없다. reset()은 보드가 바뀔 때만 부른다.
const animator = new Animator();
const renderer = new CanvasRenderer(canvas);

// 전투/층 데이터 로드 전에는 null - loop()와 render()는 이 상태에서 퍼즐만 정상 동작해야
// 한다(로드 실패해도 퍼즐은 멈추지 않는다).
let controller = null;
let battleBridge = null;
let paused = false;
// 시작 화면(assets/title/README.md) - 탭/클릭/Enter/Space로 메인 메뉴로 넘어가고,
// 메인 메뉴(mockups/main-menu.html 시안 A)의 플레이 -> 일반 모드로 game에 들어간다.
// 다른 scene 동안은 퍼즐/전투 입력을 막는다.
let scene = 'title';
const titleScreen = new TitleScreen();
const mainMenuScreen = new MainMenuScreen();
// 랭킹 팝업(docs/ranking.md) - 메뉴 봉인 원석에서 연다. 서비스는 config/ranking.json을 읽은 뒤(init) 생긴다.
// 대표 석상 기본값 = 가장 레벨 높은 석상(같으면 앞쪽).
const ranking = new RankingUi({
  player: playerState,
  canvas,
  defaultStatue: () => {
    const towers = controller?.battleState?.towers ?? [];
    let best = 0;
    towers.forEach((_, i) => {
      if (playerState.towerLevel(i) > playerState.towerLevel(best)) best = i;
    });
    return towers[best]?.color ?? 'red';
  },
});
mainMenuScreen.rankingBadge = () => ranking.hasRewardBadge();
mainMenuScreen.itemIcons = () => renderer.itemAssets?.icons; // 출석·우편 보상 아이콘
// 이벤트 팝업 광고 칸(docs/ads.md 3장) - 배너를 띄울 수 있고 광고 제거가 없을 때만 칸을 그린다.
mainMenuScreen.popupAd = () => platform.caps.popupBanner && !playerState.inventory.isUnlocked('adFree');
mainMenuScreen.popupAdDebug = () => platform.adTesting;
const shopScreen = new ShopScreen();
function exitTitle() {
  if (scene !== 'title' || !titleScreen.tapReady) return;
  titleScreen.startExit(); // 터치 -> resume -> ui_door_open 다음에 곡 전환.
  audio.playBgm(bgmForScene('menu'), { crossfadeMs: 1600 }); // 문 열림(1.6초)이 끝날 때 메뉴 곡만 남는다.
  audio.preloadBgm(bgmForScene('game', controller?.currentFloor));
}
// 인게임 곡(일반/보스) - 같은 종류 층끼리는 playBgm이 no-op이라 끊기지 않는다.
let bossSeen = false; // 이 층에서 살아 있는 보스를 봤는지 - 보스 처치 순간 덕킹용.
function playGameBgm(crossfadeMs) {
  const floor = controller?.currentFloor;
  audio.playBgm(bgmForScene('game', floor), { crossfadeMs });
  // 보스 바로 전 층(9층대)에서 보스 곡을 미리 받는다.
  if (floor && (floor.floor + 1) % controller.balance.floorShape.bossEvery === 0) audio.preloadBgm('bgm_boss');
}
// 메뉴 <-> 인게임 화면 전환 페이드 - { phase: 'out'|'in', elapsedMs, halfMs, onBlack }. 검게
// 덮고(out) 완전히 검은 프레임에 onBlack()으로 scene을 바꾼 뒤 다시 밝혀 온다(in).
// timeScale과 무관한 실제 경과 시간으로 진행한다. 길이는 전환음에 맞춘다(assets/sfx/README.md
// "UI 메모": ui_game_enter 약 1.5초, ui_game_exit 약 1.3초) - 소리는 AudioManager가 내므로
// scene이 바뀌어도 끊기지 않는다.
let fade = null;
const ENTER_FADE_MS = 1200;
const EXIT_FADE_MS = 1000;
function startFade(totalMs, sfxKey, onBlack) {
  if (fade) return;
  fade = { phase: 'out', elapsedMs: 0, halfMs: totalMs / 2, onBlack };
  audio.play(sfxKey);
}
// 나가기: 층을 되감아 둬서 다시 플레이할 때 진행 중이던 전투가 아니라 그 층 처음부터 시작한다.
// 마켓 리더보드(토스 게임센터)에 일반 모드 최고 층 - 판이 끝날 때(메뉴로·패배)와 앱을 벗어날 때(onPause),
// 마지막으로 제출에 성공한 층보다 올랐을 때만. 앱을 그냥 닫아도 onPause에서 올라간다.
let leaderboardBusy = false;
function submitLeaderboard() {
  if (!platform.caps.leaderboard || leaderboardBusy) return;
  const best = playerState.bestFloor;
  if (best <= (storage.load('leaderboardSubmitted') ?? 0)) return;
  leaderboardBusy = true;
  platform.leaderboard
    .submit(best)
    .then((ok) => ok && storage.save('leaderboardSubmitted', best))
    .catch(() => {})
    .finally(() => {
      leaderboardBusy = false;
    });
}
platform.lifecycle.onPause(submitLeaderboard);

function startExitToMenu() {
  if (fade) return;
  submitLeaderboard();
  audio.playBgm(bgmForScene('menu'), { crossfadeMs: 1000 });
  startFade(EXIT_FADE_MS, 'ui_game_exit', () => {
    controller?.retryFloor();
    paused = false;
    prep = null;
    prepLastTab = null; // 판이 끝나면 다음 판은 석상 탭부터.
    upgradeHold = null;
    scene = 'menu';
  });
}
// 상점(메뉴 오른쪽 위 아이콘) - 전체 화면 scene. 뒤로 가기(브라우저/안드로이드)로도 닫히도록 history에
// 한 칸 쌓고, 닫기 버튼·Esc는 history.back()으로 같은 경로(popstate)를 탄다.
const SHOP_FADE_MS = 400;
let shopReturnScene = 'menu'; // 상점을 연 곳 - 정비 팝업(prep)은 그대로 남아 있어 닫으면 그 팝업으로 돌아온다.
function enterShop(rail = 'items', hdr = null) {
  if (!controller?.shopConfig) return; // config/shop.json 로드 전/실패 - 상점 없음.
  shopReturnScene = scene === 'game' ? 'game' : 'menu';
  startFade(SHOP_FADE_MS, null, () => {
    shopScreen.open(rail, hdr);
    scene = 'shop';
  });
  history.pushState({ gg: 'shop' }, '');
}
function leaveShop() {
  startFade(SHOP_FADE_MS, null, () => {
    // 젬 스킬 레벨·4번째 슬롯을 산 경우 다음 전투에 반영되도록 층을 다시 만든다(아직 시작 전이라 진행 손실 없음).
    // 게임(정비 팝업)으로 돌아갈 때는 층을 다시 만들지 않는다 - 아래 버튼(다음 층/재도전)이 새 층을 만든다.
    if (shopReturnScene === 'menu' && shopScreen.changed) controller?.retryFloor();
    scene = shopReturnScene;
  });
}
function requestShopBack() {
  if (history.state?.gg === 'shop') history.back();
  else leaveShop();
}
window.addEventListener('popstate', () => {
  if (scene !== 'shop' || fade) return;
  if (shopScreen.closeOverlay()) history.pushState({ gg: 'shop' }, ''); // 팝업만 닫고 상점에 남는다.
  else leaveShop();
});
// 각 scene을 그린 다음 마지막에 불러 오버레이를 덮는다.
function drawFade(rawDtMs) {
  if (!fade) return;
  fade.elapsedMs += rawDtMs;
  const progress = Math.min(1, fade.elapsedMs / fade.halfMs);
  renderer.drawFadeOverlay(fade.phase === 'out' ? progress : 1 - progress);
  if (progress < 1) return;
  if (fade.phase === 'out') {
    fade.onBlack();
    fade = { phase: 'in', elapsedMs: 0, halfMs: fade.halfMs };
  } else {
    fade = null;
  }
}
// 정비 팝업(docs/upgrade-popup.md, src/render/ui/prepPopup.js) - null이 아니면 열려 있고 전투가 멈춘다.
// { context: 'floorClear'|'defeat'|'village'|'towerTap', tab, selectedTower, flash, view }.
let prep = null;
let prepLastTab = null; // 층 클리어/패배끼리 같은 판에서 마지막에 본 탭.
let upgradeHold = null;
// 인벤토리 탭: 고른 보유 아이템 id, 장착 칸 누름 { slot, downMs, done } - 0.5초 넘게 누르면 해제(loop), 그 전에 떼면 탭.
let invSel = null;
let invPress = null;
// 보유 목록 끌기 - { x, y, startScroll, moved } | null. 끌지 않고 떼면 그 자리 아이템을 고른다(스크롤과 탭 구분).
let invDrag = null;
const INV_DRAG_PX = 8;
const INV_HOLD_MS = 500;
const rewardPopup = new RewardPopup(); // 공통 획득 팝업(보스 첫 처치·상점 패키지/패스/무료)
let shownClearReward = null;
// 아이템 조준(docs/items.md 0장) - { slot, id, hover, first, down } | null. 조준 중엔 전투만
// targetingBattleTimeScale배속, 스왑 입력은 막는다. itemUi는 렌더에 넘기는 표시용 묶음(매 프레임 같은 객체 재사용).
let aim = null;
const itemUi = { items: null, config: null, equipped: null, counts: null, aim: null, preFloor: null, canRevive: false, adContinue: null, adBusy: false, adFailUntil: 0, goldMul: 1, inventory: null, bestFloor: 1, invSel: null, hasShop: false };
// 하단 바·패배 팝업·인벤토리 탭이 보는 장착/개수/예약 - inventory가 바뀔 때만 다시 읽는다(onChange).
function refreshInventoryUi() {
  const inv = playerState.inventory;
  itemUi.inventory = inv;
  itemUi.equipped = inv.hotbar();
  itemUi.counts = inv.data.items; // 읽기 전용.
  itemUi.preFloor = inv.data.loadout.preFloor; // 읽기 전용.
}
refreshInventoryUi();
playerState.inventory.onChange(refreshInventoryUi);
let sliderDrag = null; // 일시정지 팝업의 볼륨 슬라이더를 끌고 있는 중 - { channel, rect } | null. // 강화 버튼 꾹 누름 연속 강화 상태 - { index, nextMs, intervalMs } | null.
let timeScale = 1; // ?dev=1 2배속 토글용.
// 에셋 로드 전엔 그리지 않는다 - CanvasRenderer.assets===null일 때의 색/도형 fallback이
// 로딩 인디케이터(작은 텍스트 알약) 뒤로 그대로 보여서 "더미 이미지"처럼 보이는 걸 막는다.
let assetsReady = false;
let keepBoardOnFloorChange = false; // "다음 층" 진행일 때만 true - 퍼즐 보드를 새로 만들지 않는다.

// 최초 진입 튜토리얼(docs/tutorial.md) - config/tutorial.json + 레슨 보드. 진행 중이면 tutorial != null.
// 단계는 저장하지 않는다 - 층을 나가면(새 battleState) 버리고 다음 진입 때 처음부터.
let tutorialData = null;
let tutorial = null;
Promise.all(['config/tutorial.json', 'assets/ui/tutorial/boards.json'].map((p) => fetch(p).then((r) => r.json())))
  .then(([config, boards]) => {
    tutorialData = { config, boards };
  })
  .catch((err) => console.error('튜토리얼 데이터 로드 실패 - 튜토리얼 없이 진행:', err));

// 매 게임 프레임 전투 업데이트 전에 - 시작 조건이면 웨이브를 잡아 두고, 석상 소환이 끝나면 시작.
// 최초 자동 실행 = 1층 + done 아님. 연습 모드(다시 보기) = controller.practice 전투면 항상.
function tickTutorialStart() {
  if (!controller || !tutorialData) return;
  const bs = controller.battleState;
  if (tutorial && tutorial.battleState !== bs) {
    tutorial.abort(); // 층을 나감 - 기술 잠금·콤보 등 메모리 상태 원복, 다음엔 처음부터.
    tutorial = null;
  }
  if (tutorial?.finished && !tutorial.practice) tutorial = null; // 연습 모드는 끝나도 메뉴로 나갈 때까지 둔다.
  if (tutorial || bs.status !== 'active') return;
  if (!controller.practice && !shouldStartTutorial(playerState.tutorial, controller.floor)) return;
  bs.holdSpawns = true;
  if (bs.summon.active || fade) return;
  // 1층 일반 몬스터 풀의 첫 종류.
  const firstId = controller.enemies.chapters[0].pool[0];
  const [enemyStat] = resolveFloorSpawns(controller.balance, controller.enemies, { ...controller.currentFloor, spawns: [firstId] });
  aim = null;
  tutorial = new Tutorial({
    ...tutorialData,
    gameState,
    battleState: bs,
    enemyStat,
    practice: controller.practice,
    // 연습 모드는 세이브·보상 없이 메인 메뉴로(나가기와 같은 길 - retryFloor가 원래 층 전투로 되돌린다).
    onComplete: (rewarded) => (controller.practice ? startExitToMenu() : completeTutorial(playerState, tutorialData.config, rewarded)),
  });
}

// 메뉴 설정 > 튜토리얼 다시 보기 - 바로 튜토리얼 전용 전투(1층 데이터)로 들어간다.
function startTutorialPractice() {
  if (!controller || !tutorialData || fade) return;
  controller.startPractice();
  playGameBgm(1000);
  startFade(ENTER_FADE_MS, 'ui_game_enter', () => {
    scene = 'game';
  });
}

function tutorialRunning() {
  return tutorial != null && !tutorial.finished;
}

// 튜토리얼 중 캔버스 탭 - 팝업 버튼 > 건너뛰기 > info 스텝 넘기기. 레슨 스왑은 PointerInput -> tutorial.swap.
function handleTutorialPointerDown(x, y) {
  const ui = renderer.tutorial;
  ui.touching = true;
  const buttons = ui.layout.buttons;
  if (tutorial.popup) {
    if (!buttons) return;
    if (pressButton(x, y, buttons.start)) tutorial.confirmDone();
    else if (pressButton(x, y, buttons.skip)) tutorial.confirmSkip();
    else if (pressButton(x, y, buttons.keep)) tutorial.closeSkip();
    return;
  }
  if (pressButton(x, y, ui.layout.skip)) {
    ui.skipPressed = true;
    tutorial.openSkip();
    return;
  }
  if (tutorial.step?.type === 'info') tutorial.tap(t(tutorial.textKey).length);
  else if (tutorial.guideSwap && !pointInRect(x, y, renderer.lastLayout?.board)) tutorial.events.push({ type: 'tutorialHintPulse' });
}

// 게임 서버(docs/server.md S1) - config/server.json enabled:false면 아무 요청 없음.
let serverUi = { enabled: false, handleMenuAction: () => false, pointerUp: () => {} };
Promise.all([loadBattleData(), loadBalanceData(), loadServerConfig()]).then(([battleData, balanceData, serverConfig]) => {
  if (!battleData || !balanceData) return;
  const devMode = new URLSearchParams(location.search).get('dev') === '1';
  serverUi = { ...serverUi, ...setupServer(serverConfig, { menu: mainMenuScreen, rewardPopup, player: playerState, dev: devMode }) };
  controller = new BattleController({
    balance: balanceData.balance,
    enemies: balanceData.enemies,
    obstacles: balanceData.obstacles,
    floorsData: balanceData.floorsData,
    itemsConfig: balanceData.items,
    shopConfig: balanceData.shop,
    towersBaseData: balanceData.balance.tower.towers,
    battleConfig: {
      cascadeBonusPerStep: balanceData.balance.tower.puzzleShot.cascadeBonus,
      minDamage: 1, // docs/battle.md §4 "최소 1" - 밸런스 손잡이가 아니라 공식 상수.
      attackIntervalSec: balanceData.enemies.attackInterval,
      effectDurationsMs: battleData.effectDurationsMs,
      summon: battleData.summon,
      skills: battleData.skills,
      // 기술 피해는 렌더(SkillFx)가 명중 순간 resolveSkillHit으로 적용한다(못 그리면 shotTimeoutMs 뒤 즉시 적용).
      deferSkillHits: true,
    },
  });
  if (balanceData.ranking) {
    // 참여 보상 골드 = 층 기준가 x 3(config/ranking.json tiers part.goldFloorMul) - 기준가는 상점과 같은 normalFloorReward.
    // 서버 랭킹은 일반 모드만, 마켓 리더보드가 있는 빌드(토스)는 그대로 마켓 리더보드(docs/server.md §9).
    ranking.init(balanceData.ranking, {
      floorGold: () => normalFloorReward(balanceData, playerState.bestFloor),
      server: serverUi.enabled && !platform.caps.leaderboard,
    });
    // 일반 모드 랭킹 = 클리어한 가장 높은 층(더 높을 때만 갱신, 도달 시각 기록).
    controller.onFloorClear = (floor) => ranking.service.submit('normal', { floor, at: ranking.service.now() });
  }
  // 퍼즐에서 잼이 터질 때마다 그 위치 -> 같은 색 탑으로 날아가는 빛줄기를 renderer에 스폰.
  battleBridge = new PuzzleBattleBridge(controller.battleState, {
    onGemClear: (info) => renderer.spawnPuzzleToTowerBeam(info),
  });

  // 층의 floor.obstacles로 퍼즐 보드를 새로 만든다(docs/balance.md 7장) - gameState를
  // 재대입하므로 battleBridge/animator의 "이전 보드 기준" 기억도 같이 비워야 한다.
  function resetPuzzleBoard(floorObstacles) {
    gameState = new GameState({
      seed: Date.now(),
      obstaclesConfig: balanceData.obstacles,
      floorObstacles,
    });
    gameState.setReduceEffects(!!renderer.assets?.effectsConfig?.settings?.reduceMotion);
    if (controller.items) controller.items.gameState = gameState;
    battleBridge.reset();
    animator.reset();
    // 다음 스테이지로 이동할 때도 보드가 뚝 바뀌지 않고 셔플 연출로 자리를 잡는다
    // (§셔플 애니메이션 - "다음 스테이지로 이동할때도 셔플을 사용한다", 보고 사항: 새로
    // 생성된 보드 자신을 한 번 더 섞어서 입장 연출로 재사용함).
    // skipClear - 입장에는 치울 이전 보드가 없다. 비우기 단계를 그대로 쓰면 방금 만든 보드가
    // 내려가며 사라졌다가 다시 위에서 떨어져 "두 번 떨어지는" 것처럼 보인다.
    gameState.shuffleBoard({ skipClear: true });
  }

  if (balanceData.shop) {
    shopScreen.setEnv({
      cfg: balanceData.shop,
      itemsConfig: balanceData.items,
      data: balanceData,
      player: playerState,
      save: () => playerState.save(),
      showReward: (r) => rewardPopup.show(r),
      itemIcons: () => renderer.itemAssets?.icons,
    });
    // 결제는 됐는데 지급 전에 꺼진 주문(토스 getPendingOrders 등) - 상점 데이터가 준비된 지금 다시 지급한다.
    if (platform.caps.iap) {
      const onGrant = (key, orderId) => shopScreen.grantPaid(key, orderId);
      recoverPending(onGrant).then(() => {
        // 토스: 복원 버튼이 없고 앱을 지우면 Storage도 지워진다 - 시작할 때 완료 주문으로 비소모성을 되살린다(txId라 중복 없음).
        if (platform.caps.autoRestore) restore(onGrant, (key, orderId) => shopScreen.revokePaid(key, orderId));
      });
      // 서버(S2): RevenueCat logIn, 환불 회수(hello revoke), 서버 확인 못 한 결제(pendingVerify) 다시 확인.
      serverUi.ready?.then(() =>
        syncServerIap({
          onGrant,
          onRevoke: (key, orderId) => shopScreen.revokePaid(key, orderId),
          grantedTx: () => playerState.inventory.data.grantedTx,
        })
      );
    }
  }

  // 생성자가 이미 첫 _resetBattleState를 한 번 돌렸지만(그때는 onBattleStateChanged가
  // 아직 없어 콜백으로 못 받는다) controller.currentFloor로 그 결과를 읽을 수 있다.
  resetPuzzleBoard(controller.currentFloor.obstacles);
  if (controller.itemsConfig) loadItemAssets(Object.keys(controller.itemsConfig.items)).then((a) => renderer.setItemAssets(a));
  controller.onBattleStateChanged = (bs, floor) => {
    aim = null;
    bossSeen = false;
    // 층 이동(다음 층/재도전/dev) - 일반 -> 보스 600ms, 보스 -> 일반 1000ms. 메뉴 복귀 페이드 중(retryFloor)은 제외.
    if (scene === 'game' && !fade) playGameBgm(floor.tag === 'boss' ? 600 : 1000);
    battleBridge.setTarget(bs);
    if (keepBoardOnFloorChange) {
      // "다음 층"은 퍼즐 보드를 그대로 이어간다(방해요소 처리는 continueToFloor 참고).
      keepBoardOnFloorChange = false;
      gameState.continueToFloor(floor.obstacles);
      return;
    }
    resetPuzzleBoard(floor.obstacles);
  };

  if (new URLSearchParams(location.search).get('dev') === '1') {
    setupDevPanel(controller, {
      setTimeScale: (v) => {
        timeScale = v;
      },
      getTimeScale: () => timeScale,
      triggerSpecialFx: devTriggerSpecialFx,
      triggerCombo: devTriggerCombo,
      triggerShuffle: () => gameState.shuffleBoard(),
      ranking: ranking.service ? ranking.dev() : null,
      server: serverUi.devToggle,
    });
    // 개발용 키(?dev=1): H = 맨 앞 몬스터에게 석상 투사체 1발(피해 1), K = 남은 HP만큼(처치) - 몬스터 타격·사망 이펙트 확인.
    window.addEventListener('keydown', (e) => {
      if (scene !== 'game' || (e.code !== 'KeyH' && e.code !== 'KeyK')) return;
      renderer._battleRenderer.devShoot(controller?.battleState, e.code === 'KeyK');
    });
    // 개발용 콘솔 훅(?dev=1) - 화면 확인 때 실패/부활 등 상태를 직접 만든다.
    window.__gg = {
      get controller() { return controller; },
      get gameState() { return gameState; },
      get tutorial() { return tutorial; },
      startTutorialPractice,
      back: () => backHandlers.some((h) => h()), // 뒤로가기 버튼 흉내(웹엔 없음).
      playerState,
      renderer,
      ranking,
      get server() { return serverUi; },
      enterGame: () => {
        playGameBgm(1000); // 실제 진입(플레이 버튼)과 같은 경로.
        scene = 'game';
      },
      openPrep: (context, tab) => {
        openPrep(context);
        if (tab) prep.tab = tab;
      },
      shopScreen,
      enterShop,
      mainMenuScreen, // 예: __gg.mainMenuScreen.events = [{ id: 1, title: { ko: "테스트" } }]
    };
  }
}).catch((err) => {
  // 여기서 던져진 예외는 controller를 null로 남겨 전투 화면만 조용히 사라지게 한다(퍼즐은
  // 계속 돌아가므로 증상이 "전투가 안 보임"뿐이라 원인을 찾기 어렵다 - config/balance.json에서
  // tower.towers가 빠졌을 때 실제로 겪었다). 복구는 못 해도 최소한 콘솔에 남긴다.
  console.error('전투/층 데이터 초기화 실패 - 전투 화면 없이 퍼즐만 동작한다:', err);
});

// 개발용(?dev=1) - line/bomb/box/color 발동 스프라이트(assets/effects)를 실제 보드 위에서
// 하나씩 터뜨려 확인한다. core의 매치/스왑 규칙(line/bomb는 직접 스왑으로 발동 안 됨)을
// 거치지 않고, gameState.js가 만드는 것과 같은 모양의 specialActivate effect를 직접
// gameState.effects에 꽂는다 - CanvasRenderer._spawnSpecialFx는 이 effect를 실제 발동과
// 구별하지 못한다(같은 입력이므로).
function devTriggerSpecialFx(kind) {
  const { board } = gameState;
  const position = { row: Math.floor(board.rows / 2), col: Math.floor(board.cols / 2) };
  let affected;
  let direction = null;
  if (kind === 'line') {
    direction = 'horizontal';
    affected = Array.from({ length: board.cols }, (_, col) => ({ row: position.row, col }));
  } else if (kind === 'bomb') {
    affected = [];
    for (let r = position.row - 1; r <= position.row + 1; r++) {
      for (let c = position.col - 1; c <= position.col + 1; c++) {
        if (r >= 0 && r < board.rows && c >= 0 && c < board.cols) affected.push({ row: r, col: c });
      }
    }
  } else if (kind === 'box') {
    affected = [position, { row: 0, col: 0 }, { row: board.rows - 1, col: board.cols - 1 }];
  } else {
    affected = [position, { row: 0, col: position.col }, { row: board.rows - 1, col: position.col }, { row: position.row, col: 0 }];
  }
  gameState.effects.push({ type: 'specialActivate', kind, direction, position, color: null, affected, cascadeIndex: 1, durationMs: 280, elapsedMs: 0 });
}

// 개발용(?dev=1) - 특수 잼 조합(10종) 확인. 이건 가짜 effect를 꽂지 않고 보드 가운데에 두
// 특수 잼을 심어 실제로 스왑한다 - core의 조합 판정/변환/연쇄 발동까지 전부 진짜 경로를
// 타므로, 렌더러의 조합 연출과 core 스케줄이 어긋나는지도 같이 보인다.
function devTriggerCombo(kindA, kindB) {
  const { board } = gameState;
  // 가운데 행에서 가장 가까운 "평범한 잼 2칸"을 찾는다(방해요소/빈칸/애니메이션 중인 칸 제외).
  const free = (r, c) => board.get(r, c) >= 0 && board.cellStates[board.index(r, c)] === null;
  const mid = Math.floor(board.rows / 2);
  for (let d = 0; d < board.rows; d++) {
    for (const row of d === 0 ? [mid] : [mid - d, mid + d]) {
      if (row < 0 || row >= board.rows) continue;
      for (let col = 0; col < board.cols - 1; col++) {
        if (!free(row, col) || !free(row, col + 1)) continue;
        board.setSpecial(row, col, { kind: kindA, direction: kindA === 'line' ? 'horizontal' : null });
        board.setSpecial(row, col + 1, { kind: kindB, direction: kindB === 'line' ? 'vertical' : null });
        gameState.trySwap(row, col, row, col + 1);
        return;
      }
    }
  }
}

// 보드 쪽(gameState.update)이 멈춰야 하는 조건 - 일시정지/팝업/전투 종료. 소환 연출 중은
// 뺀다: 입장/다음 스테이지 셔플이 빛기둥 떨어지는 연출과 같은 시점에 돌아가야 해서(보고
// 사항), 셔플도 gameState.update로 진행되는 보드 effect라 이 틱에 같이 멈추면 안 된다.
function isBoardUpdateBlocked() {
  return (
    scene !== 'game' ||
    paused ||
    prep != null ||
    tutorial?.popup != null ||
    (controller != null && controller.battleState.status !== 'active')
  );
}

// 입력 차단 조건 - 위 조건 + 소환 연출 중(석상이 아직 떨어지는 중엔 스와이프를 막는다).
function isBlocked() {
  return isBoardUpdateBlocked() || (controller != null && controller.battleState.summon.active);
}

function pointInRect(x, y, rect) {
  return !!rect && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

// ---- 하단 아이템(docs/items.md) ----
function cellAtPoint(x, y) {
  const b = renderer.lastLayout?.board;
  if (!pointInRect(x, y, b)) return null;
  return { row: Math.floor((y - b.y) / b.cellSize), col: Math.floor((x - b.x) / b.cellSize) };
}

function cancelAim() {
  if (!aim) return;
  aim = null;
  audio.play('ui_cancel');
}

// 실제로 실행된 순간(즉시 또는 예약 실행) - 망치·낫 연출. 나머지는 core/battle 이벤트로 기존 연출.
function playItemFx(id, target) {
  renderer.playItemFx(controller.itemsConfig.items[id], target, gameState.board);
}

function tapItemSlot(slot) {
  if (aim?.slot === slot) {
    if (aim.confirm) useInstantItem(slot, aim.id);
    else cancelAim();
    return;
  }
  const id = playerState.inventory.hotbar()[slot];
  if (id == null) return;
  const items = controller.items;
  const now = performance.now();
  // 대기(예약) 중이면 canUse가 busy - 흔들기만 하고 조준에 들어가지 않는다.
  if (!items.canUse(id).ok) {
    renderer.itemBar.shakeSlot(slot, now);
    audio.play('gem_swap_fail');
    return;
  }
  const cfg = controller.itemsConfig.items[id];
  // 즉시 사용(대상 없음) 아이템은 같은 슬롯을 한 번 더 눌러야 쓴다(확인). 다른 곳 탭 = 취소.
  const confirm = cfg.kind === 'battle' || cfg.target === 'none';
  aim = { slot, id, hover: null, first: null, down: false, confirm };
  audio.play('ui_click');
}

function useInstantItem(slot, id) {
  aim = null;
  const now = performance.now();
  if (controller.items.use(id).ok) {
    audio.play('ui_click');
    renderer.itemBar.showTip(slot, now);
  } else {
    renderer.itemBar.shakeSlot(slot, now);
    audio.play('gem_swap_fail');
  }
}

function aimPointerDown(cell) {
  aim.down = true;
  aim.hover = cell;
  const cfg = controller.itemsConfig.items[aim.id];
  // 장갑: 첫 칸이 없거나 이웃이 아닌 칸을 누르면 그 칸이 새 첫 칸. 염료: 첫 칸 = 바꿀 잼.
  if (cfg.target === 'pair' && (!aim.first || !isNeighbor(aim.first, cell))) aim.first = cell;
  if (cfg.action === 'recolor') aim.first = cell; // 색은 팔레트(renderer.lastLayout.dyePalette)에서 고른다.
}

// 손을 뗀 칸에 use(). 실패하면 칸이 흔들리고 조준 유지.
function aimPointerUp() {
  aim.down = false;
  const cfg = controller.itemsConfig.items[aim.id];
  const hover = aim.hover;
  if (!hover) return;
  let target;
  if (cfg.target === 'pair') {
    if (!aim.first || !isNeighbor(aim.first, hover)) {
      aim.hover = null; // 첫 칸만 고름 - 이웃 칸을 기다린다.
      return;
    }
    target = { a: aim.first, b: hover };
  } else if (cfg.action === 'recolor') {
    aim.hover = null; // 칸은 골랐다 - 팔레트 탭(useDyeColor)을 기다린다.
    return;
  } else {
    target = cfg.target === 'row' ? { row: hover.row } : cfg.target === 'col' ? { col: hover.col } : hover;
  }
  const id = aim.id;
  const result = controller.items.use(id, target);
  if (result.ok) {
    aim = null;
    audio.play(cfg.target === 'pair' ? 'gem_swap' : 'ui_click');
    if (!result.pending) playItemFx(id, target);
    return;
  }
  const { rows, cols } = gameState.board;
  renderer.itemBar.shakeCells(itemTargetCells(cfg.target, target, rows, cols), performance.now());
  audio.play('gem_swap_fail');
}

// 염료 팔레트 탭 - 고른 칸(aim.first)을 그 색으로. 실패(무지개/이미 그 색)면 칸이 흔들리고 조준 유지.
function useDyeColor(color) {
  const id = aim.id;
  const target = { row: aim.first.row, col: aim.first.col, color };
  const result = controller.items.use(id, target);
  if (result.ok) {
    aim = null;
    audio.play('ui_click');
    playItemFx(id, target);
    return;
  }
  renderer.itemBar.shakeCells([aim.first], performance.now());
  audio.play('gem_swap_fail');
}

function openPrep(context) {
  prep = openPrepState(context, prepLastTab);
  prep.view = { floor: 1, best: 1, gold: 0, totalAttack: 0, towers: [], nowMs: 0 };
  invSel = null;
  renderer.inventoryTab.reset();
}

// 정비 팝업 터치 - 닫기/탭/아래 버튼/석상 강화·MAX/보관함 본문. 팝업이 떠 있으면 다른 입력은 받지 않는다.
// 강화 버튼은 탭 = 1레벨, 누르고 있으면 upgradeHold를 세팅해 loop()가 연속 강화를 진행한다.
function handlePrepPointerDown(x, y) {
  const layout = renderer.prepLayout;
  if (!layout) return;
  const hit = hitPrepPopup(layout, x, y);
  if (!hit) return;
  switch (hit.type) {
    case 'close':
      audio.play('ui_cancel');
      prep = null;
      upgradeHold = null;
      return;
    case 'tab':
      audio.play('ui_click');
      prep.tab = hit.tab;
      if (prep.context === 'floorClear' || prep.context === 'defeat') prepLastTab = rememberTab(prepLastTab, hit.tab);
      return;
    case 'action':
      audio.play('ui_click');
      upgradeHold = null;
      prep = null;
      if (hit.action === 'next') {
        keepBoardOnFloorChange = true;
        controller?.advanceFloor();
      } else if (hit.action === 'retry') controller?.retryFloor();
      else startExitToMenu(); // 마을로 - 나가기와 같은 길(층을 되감고 메뉴로).
      return;
    case 'upgrade':
      if (upgradeStatue(hit.index, false)) upgradeHold = { index: hit.index, nextMs: performance.now() + 300, intervalMs: 150 };
      return;
    case 'max':
      upgradeStatue(hit.index, true);
      return;
    case 'all':
      upgradeAllStatues();
      return;
    case 'filter':
      audio.play('ui_click');
      renderer.inventoryTab.setFilter(hit.filter);
      return;
    case 'slot':
      invPress = { slot: hit.index, downMs: performance.now(), done: false };
      return;
    case 'reserve':
      audio.play('ui_click');
      if (!togglePreFloor(hit.id)) audio.play('gem_swap_fail');
      return;
    case 'detailAction': {
      audio.play('ui_click');
      const a = hit.action;
      if (a.kind === 'buy' || a.kind === 'shop') enterShop('items');
      else if (!(a.kind === 'equip' ? playerState.inventory.equip(a.slot, invSel) : playerState.inventory.unequip(a.slot)).ok) audio.play('gem_swap_fail');
      return;
    }
    case 'item':
      invDrag = { y: hit.by, startScroll: renderer.inventoryTab.scroll, moved: false, id: hit.id };
      return;
  }
}

// 일괄 강화 - 다섯 석상을 골고루. 오른 석상마다 탑 연출, 팝업 흰 테는 첫 번째 오른 석상.
function upgradeAllStatues() {
  if (!controller) return false;
  const before = playerState.towerLevels.slice();
  const ok = controller.levelUpAllEven();
  if (!ok) { audio.play('gem_swap_fail'); return false; }
  const upped = before.map((l, i) => (playerState.towerLevel(i) > l ? i : -1)).filter((i) => i >= 0);
  if (scene === 'game') for (const i of upped) renderer.triggerTowerTapFx(controller.battleState.towers[i].id, true, playerState.towerLevel(i));
  else audio.play('ui_click');
  if (prep) prep.flash = { index: upped[0], atMs: performance.now(), white: true };
  return true;
}

// 석상 강화(1레벨/MAX). 성공하면 그 줄을 card_selected + "+1"·흰 테, 전투 화면이 뒤에 있으면 탑 연출도 같이.
function upgradeStatue(index, max) {
  if (!controller) return false;
  const ok = max ? controller.maxLevelUpTower(index) : controller.tryLevelUpTower(index);
  if (scene === 'game') renderer.triggerTowerTapFx(controller.battleState.towers[index].id, ok, playerState.towerLevel(index));
  else audio.play(ok ? 'ui_click' : 'gem_swap_fail');
  if (ok && prep) {
    prep.selectedTower = index;
    prep.flash = { index, atMs: performance.now(), white: true };
  }
  return ok;
}

// 보유 목록 끌기(basis 좌표) - 끌지 않고 떼면 그 자리 아이템을 고른다(스크롤과 탭 구분).
function invDragMove(y) {
  if (!invDrag) return false;
  const dy = y / (renderer.prepLayout?.scale ?? 1) - invDrag.y;
  if (Math.abs(dy) > INV_DRAG_PX) invDrag.moved = true;
  if (invDrag.moved) renderer.inventoryTab.setScroll(invDrag.startScroll - dy);
  return true;
}

function invDragEnd() {
  const d = invDrag;
  invDrag = null;
  if (!d || d.moved || d.id == null) return;
  invSel = invSel === d.id ? null : d.id;
  audio.play('ui_click');
}

// 정비 팝업 보관함 탭이 떠 있는지 - 휠 스크롤용.
function inventoryOpen() {
  return prep?.tab === 'vault' && (scene === 'menu' || scene === 'game');
}

const INV_FAIL_TEXT = { noStock: 'inv.noStock', locked: 'inv.locked', notEquipable: 'inv.notEquipable' };
function inventorySlotTap(slot) {
  const inv = playerState.inventory;
  const tab = renderer.inventoryTab;
  const now = performance.now();
  if (slot >= inv.slotCount()) {
    tab.shakeSlot(slot, now);
    tab.toast(t('inv.locked'), now);
    audio.play('gem_swap_fail');
    return;
  }
  if (invSel == null) {
    // 고른 게 없으면 그 칸의 아이템을 골라 설명만 보여 준다.
    invSel = (inv.pendingHotbar() ?? inv.hotbar())[slot] ?? null;
    audio.play('ui_click');
    return;
  }
  const res = inv.equip(slot, invSel);
  if (res.ok || res.reason === 'alreadyEquipped') {
    audio.play('ui_click');
    invSel = null;
    return;
  }
  tab.shakeSlot(slot, now);
  if (INV_FAIL_TEXT[res.reason]) tab.toast(t(INV_FAIL_TEXT[res.reason]), now);
  audio.play('gem_swap_fail');
}

function processInventoryHold(nowMs) {
  if (!invPress || invPress.done || nowMs - invPress.downMs < INV_HOLD_MS) return;
  invPress.done = true;
  if (playerState.inventory.unequip(invPress.slot).ok) audio.play('ui_cancel');
}

// 재화 바 "+"(상점 자리)/일시정지 버튼/팝업 버튼/탑 탭 클릭 판정. 보드 스와이프
// (PointerInput)와는 별개의 영역이라 겹치지 않는다.
canvas.addEventListener('pointerdown', (e) => {
  if (fade) return; // 화면 전환 페이드 중에는 입력을 받지 않는다.
  if (rewardPopup.active) {
    rewardPopup.handlePointerDown(frameX(e), frameY(e));
    return;
  }
  if (scene === 'title') {
    // 뒤로가기로 연 종료 확인이 떠 있으면 그 모달 입력만(문 열림 안 함).
    if (mainMenuScreen.popup) {
      if (mainMenuScreen.handlePointerDown(frameX(e), frameY(e)) === 'exitApp') platform.lifecycle.exit();
      return;
    }
    exitTitle();
    return;
  }

  const x = frameX(e);
  const y = frameY(e);

  if (scene === 'menu') {
    if (ranking.isOpen) {
      if (ranking.pointerDown(x, y) === 'openMode') mainMenuScreen.popup = 'mode';
      return;
    }
    if (prep) {
      handlePrepPointerDown(x, y);
      return;
    }
    const action = mainMenuScreen.handlePointerDown(x, y);
    if (action === 'replayTutorial') startTutorialPractice();
    else if (action === 'startNormalGame') {
      playGameBgm(1000);
      startFade(ENTER_FADE_MS, 'ui_game_enter', () => {
        scene = 'game';
      });
    } else if (action === 'openShop') enterShop();
    else if (action === 'openShopGold') enterShop('dia', 'goldex');
    else if (action === 'openShopDia') enterShop('dia');
    else if (action === 'exitApp') platform.lifecycle.exit();
    else serverUi.handleMenuAction(action);
    return;
  }

  if (scene === 'shop') {
    if (shopScreen.handlePointerDown(x, y) === 'exit') requestShopBack();
    return;
  }

  // 뒤로가기로 연 "마을로 나갈까요?" 확인(전투 scene 위의 메뉴 모달).
  if (mainMenuScreen.popup) {
    if (mainMenuScreen.handlePointerDown(x, y) === 'quitFloor') {
      prep = null;
      upgradeHold = null;
      startExitToMenu(); // 정비 팝업 "마을로"와 같은 길.
    }
    return;
  }

  if (tutorialRunning()) {
    handleTutorialPointerDown(x, y);
    return;
  }

  if (prep && !paused) {
    handlePrepPointerDown(x, y);
    return;
  }

  const popup = renderer.lastLayout?.popup;
  if (popup?.audio && handleAudioSettingsPointerDown(popup.audio, x, y)) return;
  if (popup) {
    for (const [action, btnRect] of Object.entries(popup.buttons)) {
      // 나가기는 전환음(ui_game_exit)을 startExitToMenu가 낸다.
      if (!pressButton(x, y, btnRect, action === 'exit' ? 'none' : 'click')) continue;
      if (action === 'resume') paused = false;
      else if (action === 'revive') {
        if (!controller?.revive()) audio.play('gem_swap_fail');
      } else if (action === 'adContinue') {
        startAdContinue();
      } else if (action === 'restart' && controller?.battleState.status === 'failed') {
        // 부활 안 함 = 정비 팝업(패배). 아래 "재도전"/"마을로"가 나가는 길.
        openPrep('defeat');
      } else if (action === 'restart') {
        controller?.retryFloor();
        paused = false;
      } else if (action === 'next') {
        // 다음 층 전에 정비 팝업(층 클리어)을 띄우고, 아래 "{n+1}층으로"를 누르면 그때 진행한다.
        openPrep('floorClear');
        paused = false;
      } else if (action === 'exit') {
        startExitToMenu();
      }
      return;
    }
    return; // 팝업이 떠 있으면 그 외 클릭(보드 등)은 무시.
  }

  if (pointInRect(x, y, renderer.lastLayout?.pauseButton)) {
    if (controller && controller.battleState.status !== 'active') return;
    audio.play('ui_click');
    paused = !paused;
    return;
  }

  if (pressButton(x, y, renderer.lastLayout?.currencyPlusButton)) {
    // 상점 자리 - 지금은 자리만(추후 상점 연결).
    return;
  }

  if (controller?.items && !isBlocked()) {
    const slots = renderer.lastLayout?.itemSlots ?? [];
    for (let i = 0; i < slots.length; i++) {
      if (pointInRect(x, y, slots[i])) {
        tapItemSlot(i);
        return;
      }
    }
    if (aim) {
      // 염료 팔레트가 떠 있으면: 스와치 탭 = 그 색으로, 그 밖 = 취소.
      const palette = renderer.lastLayout?.dyePalette;
      if (palette) {
        const hit = palette.find((sw) => pointInRect(x, y, sw.rect));
        if (hit) useDyeColor(hit.color);
        else cancelAim();
        return;
      }
      const cell = aim.confirm ? null : cellAtPoint(x, y);
      if (cell) aimPointerDown(cell);
      else cancelAim(); // 보드 밖 탭 = 취소(소모 없음).
      return;
    }
  }
  // 석상을 탭해도 강화 팝업은 열지 않는다 - 강화 팝업은 클리어 팝업의 "다음 층"에서만 열린다.
});

// 일시정지 팝업의 효과음/배경음 슬라이더 + 음소거 버튼. 누르는 순간 값을 반영하고
// gem_select를 한 번 들려준다(드래그 중에는 값만 따라온다 - 매 프레임 소리를 내지 않는다).
function handleAudioSettingsPointerDown(rects, x, y) {
  if (pointInRect(x, y, rects.mute)) {
    audio.toggleMute();
    audio.play('ui_click'); // 토글 뒤에 내야 음소거를 풀 때만 들린다.
    return true;
  }
  for (const channel of ['sfx', 'bgm']) {
    if (!pointInRect(x, y, rects[channel])) continue;
    sliderDrag = { channel, rect: rects[channel] };
    audio.setVolume(channel, (x - rects[channel].x) / rects[channel].width);
    audio.play('gem_select');
    return true;
  }
  return false;
}

canvas.addEventListener('pointermove', (e) => {
  if (invDragMove(frameY(e))) return;
  if (ranking.pointerMove(frameY(e))) return;
  // 터치는 누른 동안만, 마우스는 떼고 움직여도 미리보기가 따라온다.
  if (aim) {
    if (!aim.confirm) aim.hover = cellAtPoint(frameX(e), frameY(e));
    return;
  }
  if (scene === 'menu') {
    mainMenuScreen.handlePointerMove(frameX(e), frameY(e));
    return;
  }
  if (scene === 'shop') {
    shopScreen.handlePointerMove(frameX(e), frameY(e));
    return;
  }
  if (!sliderDrag) return;
  audio.setVolume(sliderDrag.channel, (frameX(e) - sliderDrag.rect.x) / sliderDrag.rect.width);
});

// 강화 버튼을 누른 채 손가락/포인터가 캔버스 밖으로 나가거나 뗄 때 연속 강화를 멈춘다.
window.addEventListener('pointerup', (e) => {
  renderer.tutorial.touching = false;
  renderer.tutorial.skipPressed = false;
  invDragEnd();
  ranking.pointerUp();
  serverUi.pointerUp();
  if (invPress && !invPress.done) inventorySlotTap(invPress.slot);
  invPress = null;
  if (aim?.down) aimPointerUp();
  upgradeHold = null;
  sliderDrag = null;
  const menuUp = scene === 'menu' && !fade ? mainMenuScreen.handlePointerUp(frameX(e), frameY(e)) : mainMenuScreen.handlePointerUp();
  if (menuUp === 'openRanking') ranking.open();
  if (menuUp === 'openInventory') {
    openPrep('village');
    playerState.inventory.markItemsSeen(playerState.bestFloor); // 빨간 점 1(새 아이템) 끔.
  }
  if (scene === 'shop') shopScreen.handlePointerUp();
});
window.addEventListener('pointercancel', () => {
  renderer.tutorial.touching = false;
  renderer.tutorial.skipPressed = false;
  ranking.pointerUp();
  invPress = null;
  invDrag = null;
  if (aim) aim.down = false;
  upgradeHold = null;
  sliderDrag = null;
  mainMenuScreen.handlePointerUp();
  shopScreen.cancelPointer();
});

canvas.addEventListener(
  'wheel',
  (e) => {
    if (scene === 'menu' && ranking.isOpen) {
      e.preventDefault();
      ranking.wheel(e.deltaY);
      return;
    }
    if (scene === 'menu' && mainMenuScreen.handleWheel(e.deltaY)) {
      e.preventDefault();
      return;
    }
    if (inventoryOpen()) {
      e.preventDefault();
      renderer.inventoryTab.setScroll(renderer.inventoryTab.scroll + e.deltaY * 0.5);
      return;
    }
    if (scene !== 'shop') return;
    e.preventDefault();
    shopScreen.handleWheel(e.deltaY);
  },
  { passive: false }
);

// 뒤로가기(안드로이드 버튼·토스 backEvent - platform.lifecycle.onBack). 위에서부터 처음 처리한 핸들러에서 멈춘다:
// 열린 팝업 닫기 -> 게임 중이면 일시정지 팝업 -> 메뉴면 종료 확인 모달. true = 처리함(앱이 닫히지 않는다).
const backHandlers = [
  () => fade != null, // 화면 전환 중엔 무시.
  // 타이틀도 바로 끄지 않고 종료 확인(토스 심사: 종료할 때 확인 모달). 모달이 떠 있으면 닫기.
  // 문 열림 전환 중엔 무시(삼킴).
  () => scene === 'title' && (titleScreen.exiting || mainMenuScreen.closePopup() || (platform.caps.exit && openExitConfirm('app'))),
  () => {
    if (scene !== 'shop') return false;
    if (!shopScreen.closeOverlay()) requestShopBack();
    return true;
  },
  () => scene === 'menu' && ranking.isOpen && (ranking.close(), true),
  () => scene === 'menu' && prep != null && ((prep = null), (upgradeHold = null), true),
  () => scene === 'menu' && mainMenuScreen.closePopup(),
  // 메뉴 맨 끝 = 종료 확인. 앱을 스스로 못 닫는 마켓(iOS·웹)은 처리 안 함(OS 기본 동작).
  () => scene === 'menu' && platform.caps.exit && openExitConfirm('app'),
  // 토스 심사: 뒤로가기는 "뒤로 가거나 종료" - 아무 반응 없는 화면이 없게 한다.
  () => scene === 'game' && rewardPopup.active && (rewardPopup.dismiss(), true),
  () => scene === 'game' && mainMenuScreen.closePopup(),
  () => {
    if (scene !== 'game' || !tutorialRunning()) return false;
    if (tutorial.popup === 'skip') tutorial.closeSkip();
    else if (tutorial.popup === 'done') tutorial.confirmDone();
    else tutorial.openSkip(); // 건너뛰기 확인.
    return true;
  },
  () => scene === 'game' && paused && ((paused = false), true), // 일시정지 팝업 닫기(계속).
  // 층 클리어·패배(결과 팝업·정비 팝업) = 마을로 나갈지 확인.
  () => scene === 'game' && controller?.battleState.status !== 'active' && openExitConfirm('floor'),
  () => scene === 'game' && ((paused = true), true),
];
function openExitConfirm(kind) {
  mainMenuScreen.exitKind = kind;
  mainMenuScreen.popup = 'exit';
  return true;
}
platform.lifecycle.onBack(() => backHandlers.some((h) => h()));

window.addEventListener('keydown', (e) => {
  if (scene === 'shop' && e.code === 'Escape' && !fade) {
    if (!shopScreen.closeOverlay()) requestShopBack();
    return;
  }
  if (scene !== 'title' || mainMenuScreen.popup) return;
  if (e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    exitTitle();
  }
});

// 캔버스 = 화면 전체. 안전영역(노치·홈 바·토스 닫기 버튼 줄)과 배너 광고 자리를 뺀 칸 가운데에 9:16 안전 frame을
// 놓는다(src/render/screenFit.js) - 게임 UI는 frame 안, frame 밖(블리드)엔 배경만. 배너가 있으면 맨 아래 핫바와
// 배너 사이를 BANNER_GAP 이상 띄운다(광고 정책: 조작 영역 바로 옆 금지).
const BANNER_GAP = 8;
const BANNER_FILL = '#0d0a10';
// 배너 자리: 배너를 쓰는 빌드이고 광고 제거를 안 샀으면 어느 화면이든 하단에 항상 비워 둔다 - 배너를 켜고 끌 때마다
// 캔버스 배율이 바뀌면 픽셀아트가 출렁여 보이므로, 배율은 광고 제거 구매·insets 변화(창 크기 포함) 때만 다시 계산한다.
// 배너가 안 보이는 화면이나 광고가 안 채워진 경우(noFill)엔 이 칸이 BANNER_FILL로 보인다(어댑터가 배너를 이 위에 띄운다).
let bannerReserved = false;
let bannerSlot = null; // <div id="banner-slot">
// 입력·DOM 오버레이 좌표는 전부 frame 기준 - getBoundingClientRect를 쓰는 곳(pointerInput, rankingUi, 메뉴 이벤트 배너)이
// frame 사각형(CSS px)을 받게 여기 한 곳에서 바꾼다(캔버스 자체는 화면 전체, 왼쪽 위 0,0). u = 논리 1px(360x640 좌표)당 CSS px.
let frameBox = { left: 0, top: 0, x: 0, y: 0, width: 0, height: 0, right: 0, bottom: 0, u: 1 };
canvas.getBoundingClientRect = () => frameBox;
// 포인터 -> 렌더러가 그리는 frame 논리 좌표(360x640).
const frameX = (e) => (e.clientX - frameBox.left) / frameBox.u;
const frameY = (e) => (e.clientY - frameBox.top) / frameBox.u;
function resize() {
  const dpr = window.devicePixelRatio || 1;
  const ins = platform.layout.getInsets();
  const slotH = bannerReserved ? platform.ads.getBannerSlotHeight() : 0;
  if (slotH > 0) {
    if (!bannerSlot) {
      bannerSlot = document.createElement('div');
      bannerSlot.id = 'banner-slot';
      bannerSlot.style.cssText = `position:fixed;left:0;right:0;background:${BANNER_FILL};`;
      document.body.appendChild(bannerSlot);
    }
    bannerSlot.style.bottom = `${ins.bottom}px`;
    bannerSlot.style.height = `${slotH}px`;
  }
  if (bannerSlot) bannerSlot.style.display = slotH > 0 ? 'block' : 'none';
  const cssW = window.innerWidth;
  const cssH = window.innerHeight;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  const fit = computeScreenFit(Math.round(cssW * dpr), Math.round(cssH * dpr), dpr, ins, slotH > 0 ? slotH + BANNER_GAP : 0);
  const f = fit.frame.css;
  frameBox = { left: f.x, top: f.y, x: f.x, y: f.y, width: f.w, height: f.h, right: f.x + f.w, bottom: f.y + f.h, u: f.w / FRAME_LOGICAL_W };
  renderer.resize(fit);
}
// 배너를 보일 화면은 메인 메뉴·전투만(토스: 인트로·로딩·컷신 광고 금지 - 타이틀·로딩·문 전환·튜토리얼·상점은 숨김).
// 페이드 중엔 그대로. 매 프레임 불러도 바뀔 때만 SDK를 부르고, 자리(배율)는 광고 제거가 바뀔 때만 다시 잡는다.
let bannerShown = false;
function syncBanner() {
  // 자리는 배너를 쓰는 빌드면(어댑터 설정) 광고 SDK 준비 전부터 비워 둔다 - 준비가 늦어도 배율이 안 바뀐다.
  const reserve = platform.ads.getBannerSlotHeight() > 0 && !playerState.inventory.isUnlocked('adFree');
  if (reserve !== bannerReserved) {
    bannerReserved = reserve;
    resize();
  }
  const show = reserve && platform.caps.banner && (scene === 'menu' || scene === 'game') && !tutorialRunning();
  if (show === bannerShown) return;
  bannerShown = show;
  if (show) platform.ads.showBanner().catch(() => {}); // noFill(0)이어도 자리는 그대로.
  else platform.ads.hideBanner();
}
// 앱 빌드: 전투 중 백그라운드로 가면 일시정지 팝업(돌아와서 "계속"). 웹은 탭 전환이 잦아 그대로 둔다.
if (platform.id !== 'web') {
  platform.lifecycle.onPause(() => {
    if (scene === 'game' && !prep && !tutorialRunning() && !adBusy && controller?.battleState.status === 'active') paused = true;
  });
}

// 이벤트 팝업 배너(docs/ads.md 3장) - 하단 배너(syncBanner)와 별개. 매 프레임 "지금 띄울 위치"를 구해 바뀔 때만 SDK를 부른다:
// 팝업 열림 = show, 닫힘·다른 팝업·씬 전환·백그라운드 = hide, 복귀·resize = 다시 계산해 show.
let appHidden = false;
platform.lifecycle.onPause(() => (appHidden = true));
platform.lifecycle.onResume(() => (appHidden = false));
let popupBanner = null; // 지금 띄운 {x, y, width, height}(CSS px) | null
function syncPopupBanner() {
  const want = !appHidden && scene === 'menu' && !fade && mainMenuScreen.popup === 'event' ? mainMenuScreen.adBannerCss(canvas) : null;
  const same = want === popupBanner || (want && popupBanner && want.x === popupBanner.x && want.y === popupBanner.y);
  if (same) return;
  popupBanner = want;
  if (want) platform.ads.showPopupBanner(want);
  else platform.ads.hidePopupBanner();
}

// devicePixelRatio 변화(브라우저 줌, 외부 모니터 이동 등)를 감지해 다시 그린다.
function watchDevicePixelRatio() {
  const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mq.addEventListener(
    'change',
    () => {
      resize();
      watchDevicePixelRatio();
    },
    { once: true }
  );
}

window.addEventListener('resize', resize);
platform.layout.onInsetsChange(resize);
window.addEventListener('orientationchange', resize);
watchDevicePixelRatio();
resize();

new PointerInput(canvas, {
  getBoardRect: () => (renderer.lastLayout ? renderer.lastLayout.board : null),
  // 눌린 칸이 안정 칸이 아니면(자신이나 아래 칸이 애니메이션 중이거나 빈 칸) 입력을
  // 받지 않는다. 드래그 목표 칸은 gameState.trySwap()이 다시 검사한다.
  // 일시정지/전투 종료 중에는(isBlocked) 입력 자체를 받지 않는다.
  canInteract: (row, col) =>
    !isBlocked() &&
    !aim && // 조준 중엔 스왑 입력을 막는다(보드 탭은 조준이 받는다).
    (!tutorialRunning() || tutorial.guideSwap != null) && // 튜토리얼은 레슨 스왑 단계에서만.
    gameState.board.isCellStable(row, col),
  onSelect: () => audio.play('gem_select'),
  onSwap: (r1, c1, r2, c2) => {
    if (isBlocked() || aim) return;
    if (tutorialRunning()) {
      // 안내한 두 칸만 - 아니면 tutorial이 손가락 강조(tutorialHintPulse)만 낸다.
      if (tutorial.swap(r1, c1, r2, c2)) audio.play('gem_swap');
      return;
    }
    // trySwap은 매치가 없어 되돌아가는 스왑에도 true를 준다(거절되는 건 인접 아님/잠긴 열 등
    // 아예 받아들여지지 않은 입력뿐) - 스왑음은 유효/무효 모두 내고, 되돌아감은 cellStates의
    // bounce로 가려내 그 절반 지점(= 되돌아가기 시작하는 순간)에 실패음을 낸다.
    if (!gameState.trySwap(r1, c1, r2, c2)) return;
    audio.play('gem_swap');
    if (gameState.board.cellStates[gameState.board.index(r1, c1)]?.bounce) {
      audio.play('gem_swap_fail', { delayMs: ANIMATION_DURATIONS_MS.swap });
    }
  },
});

let lastTime = performance.now();
// 탭 전환/절전 복귀 등으로 프레임 간격이 비정상적으로 커지면(수 초) 그 dt가 그대로
// gameState/battleState에 들어가 캐스케이드·공격 타이머가 한 프레임에 몰려 처리되면서
// 화면이 멈춘 것처럼 보일 수 있다 - CanvasRenderer._lastFrameTime의 64ms clamp와 같은
// 값으로 맞춘다(렌더가 이미 쓰던 값).
const MAX_DT_SEC = 0.064;

// 다음 층 예약 켜기/끄기(inventory.setReserve) - 성공하면 true.
function togglePreFloor(id) {
  const inv = playerState.inventory;
  return inv.setReserve(id, !inv.data.loadout.preFloor[id]).ok;
}

// 패배 팝업 이어하기(docs/ads.md 2장) - 깃털·광고 버튼 판정은 continueOptions 하나.
// mode: 경쟁 모드는 아직 잠김(플레이 경로 없음) - 열리면 여기서 그 판의 모드를 넘긴다.
const AD_CONTINUE_KEY = 'adContinue';
let adBusy = false; // 광고 띄우는 중(연타·재진입 금지, 일시정지 팝업 안 띄움)
function continueState() {
  const cfg = controller?.itemsConfig?.adContinue;
  if (!controller || controller.battleState.status !== 'failed') return { revive: false, ad: false };
  return continueOptions({
    cfg,
    mode: 'normal',
    tutorial: tutorialRunning(),
    featherOk: controller.canRevive(),
    floorLeft: controller.adContinueLeft(),
    adReady: platform.caps.rewarded || playerState.inventory.isUnlocked('adFree'),
    save: storage.load(AD_CONTINUE_KEY),
    nowMs: Date.now(),
  });
}

async function startAdContinue() {
  if (adBusy || !continueState().ad) return;
  const bs = controller.battleState;
  if (!playerState.inventory.isUnlocked('adFree')) {
    adBusy = true;
    let r;
    try {
      r = await showRewarded('revive', { loadTimeoutMs: controller.itemsConfig.adContinue.loadTimeoutMs });
    } finally {
      adBusy = false;
    }
    if (!r.shown) itemUi.adFailUntil = performance.now() + 2000;
    // 보상 이벤트를 받았을 때만, 그 사이 층이 바뀌지 않았을 때만(중간에 닫으면 아무 일 없음).
    if (!r.rewarded || controller.battleState !== bs) return;
  }
  if (controller.adContinue()) storage.save(AD_CONTINUE_KEY, recordUse(storage.load(AD_CONTINUE_KEY), Date.now()));
}

function buildItemUi() {
  itemUi.items = controller?.items ?? null;
  itemUi.config = controller?.itemsConfig ?? null;
  itemUi.aim = aim;
  itemUi.bestFloor = playerState.bestFloor;
  itemUi.invSel = invSel;
  itemUi.hasShop = !!controller?.shopConfig;
  const cont = continueState();
  itemUi.canRevive = cont.revive;
  itemUi.adContinue = cont.ad ? (playerState.inventory.isUnlocked('adFree') ? 'free' : 'ad') : null;
  itemUi.adBusy = adBusy;
  itemUi.goldMul = controller?.goldMul ?? 1;
  return itemUi;
}

function buildBattleHud() {
  if (!controller) return null;
  const { balance, battleState } = controller;
  return {
    floor: controller.floor,
    chapter: tOr(`names.chapter.${Math.floor((controller.floor - 1) / 10) % controller.enemies.chapters.length}`, controller.currentFloor.chapter),
    tag: controller.floorTag,
    remainingEnemies: battleState.remainingEnemies,
    totalEnemies: battleState.totalEnemies,
    gold: playerState.gold,
    towerLevels: playerState.towerLevels,
    towerCosts: playerState.towerLevels.map((_, i) => playerState.nextTowerLevelCost(balance, i)),
    towerAttacks: playerState.towerLevels.map((lvl) => towerAttack(balance, lvl)),
    towerNextAttacks: playerState.towerLevels.map((lvl) => towerAttack(balance, lvl + 1)),
    maxLevel: balance.tower.maxLevel,
  };
}

// 강화 버튼을 꾹 누르고 있는 동안 0.3초 뒤부터 연속 강화한다(처음 150ms 간격, 점점 빨라져
// 최소 50ms). 골드가 모자라 실패하면(tryLevelUpTower === false) 멈춘다 - pointerup을
// 기다리지 않고도 반복이 저절로 끝난다.
function processUpgradeHold(nowMs) {
  if (!upgradeHold || !controller) return;
  if (nowMs < upgradeHold.nextMs) return;
  const ok = upgradeStatue(upgradeHold.index, false);
  if (!ok) {
    upgradeHold = null;
    return;
  }
  upgradeHold.intervalMs = Math.max(50, upgradeHold.intervalMs * 0.85);
  upgradeHold.nextMs = nowMs + upgradeHold.intervalMs;
}

// 정비 팝업 그릴 값(석상 5줄·골드·층) - 팝업이 열려 있을 때만 매 프레임 채운다.
function drawPrep(now) {
  if (!prep || !controller) return;
  const v = prep.view;
  const { balance, battleState } = controller;
  v.floor = controller.floor;
  v.best = playerState.bestFloor;
  v.gold = playerState.gold;
  v.nowMs = now;
  v.totalAttack = 0;
  battleState.towers.forEach((tower, i) => {
    const level = playerState.towerLevel(i);
    const atk = towerAttack(balance, level);
    v.totalAttack += atk;
    v.towers[i] = { color: tower.color, name: tOr(`names.tower.${tower.color}`, tower.name), level, atk, nextAtk: towerAttack(balance, level + 1), info: statueRowInfo(balance, level, playerState.gold) };
  });
  v.all = statueAllInfo(balance, playerState.towerLevels, playerState.gold);
  renderer.drawPrepPopup(prep, buildItemUi());
  if (prep.flash) prep.flash.white = false; // 흰 테는 1프레임만.
}

let lastBattleStatus = null;
function loop(now) {
  syncBanner();
  syncPopupBanner();
  const rawDtMs = Math.min(64, now - lastTime);
  const dt = Math.min((now - lastTime) / 1000, MAX_DT_SEC) * timeScale;
  lastTime = now;

  if (scene === 'title') {
    renderer.drawTitle(titleScreen, now, rawDtMs);
    // 문 열림 전환 끝부분(1250~2200ms)은 메인 메뉴를 그 위에 겹쳐 띄운다.
    const menuAlpha = titleScreen.menuFadeAlpha();
    if (menuAlpha > 0) renderer.drawMainMenu(mainMenuScreen, playerState, now, menuAlpha);
    else renderer.drawMenuPopup(mainMenuScreen); // 뒤로가기 종료 확인(열려 있을 때만).
    if (titleScreen.isExitDone()) scene = 'menu';
    drawFade(rawDtMs);
    requestAnimationFrame(loop);
    return;
  }

  if (scene === 'menu') {
    audio.setBgmDuck(1);
    processUpgradeHold(now);
    processInventoryHold(now); // 보관함 장착 칸 길게 누르기 = 해제.
    renderer.drawMainMenu(mainMenuScreen, playerState, now, 1);
    drawPrep(now);
    // 메뉴에 있는 동안 1초마다 시즌 넘김 확인 -> 지난 시즌 결과 팝업(다른 팝업이 없을 때).
    ranking.tick(now, !prep && !mainMenuScreen.popup && !fade);
    renderer.drawRankingPopup(ranking, now);
    renderer.drawRewardPopup(rewardPopup); // 출석·우편 받기
    drawFade(rawDtMs);
    requestAnimationFrame(loop);
    return;
  }

  if (scene === 'shop') {
    renderer.drawShop(shopScreen, now);
    renderer.drawRewardPopup(rewardPopup);
    drawFade(rawDtMs);
    requestAnimationFrame(loop);
    return;
  }

  processUpgradeHold(now);
  processInventoryHold(now);
  // 층 전투 시작(첫 프레임) - 예약 아이템 소모 + 시작 부스터 배치. gameState.update보다 먼저라 입장 셔플이 특수 잼을 같이 옮긴다.
  controller?.beginFloor();
  tickTutorialStart();

  if (!isBoardUpdateBlocked()) {
    // 발동/조합 스프라이트가 아직 재생 중이면 중력/리필을 미룬다(GameState.settleHold 주석 참고).
    gameState.settleHold = assetsReady && renderer.isSpecialFxBusy();
    gameState.update(dt);
    // 매 프레임: 북 버프 진행 + 예약된 낫·망치·섞기 - 실행되면 연출, 시간 초과로 취소되면 슬롯 흔들림 + "보드 정리 중".
    const items = controller?.items;
    if (items) {
      const pendingTarget = items.pending?.target;
      const result = items.update(dt);
      if (result?.ok) playItemFx(result.id, pendingTarget);
      else if (result) {
        const now = performance.now();
        renderer.itemBar.shakeSlot(playerState.inventory.hotbar().indexOf(result.id), now);
        renderer.itemBar.toast(t('item.boardBusy'), now);
        audio.play('gem_swap_fail');
      }
    }
  }
  // BGM 덕킹: 일시정지 0.5배, 승리/패배 팝업 0.4배, 결과 팝업을 닫고 정비 팝업만 남으면 0.7배,
  // 보스 처치 순간(호위가 남아도) 600ms에 걸쳐 0.4배. 다음 층이 시작되면(status active) 1배.
  const bs = controller?.battleState;
  // 패배한 순간 한 번 - 리더보드 제출(판 종료).
  if (bs?.status === 'failed' && lastBattleStatus !== 'failed') submitLeaderboard();
  lastBattleStatus = bs?.status ?? null;
  if (bs) {
    const bossAlive = bs.enemies.some((e) => e.rank === 'boss' && e.state === 'alive');
    if (bossAlive) bossSeen = true;
    const bossDown = bossSeen && !bossAlive;
    const ended = bs.status !== 'active';
    const duck = paused ? 0.5 : ended && prep ? 0.7 : bossDown || ended ? 0.4 : 1;
    audio.setBgmDuck(duck, bossDown && duck === 0.4 ? 600 : 350);
  }
  // 층이 끝나면(클리어/실패 팝업) 조준을 푼다 - 팝업이 우선.
  if (aim && controller && controller.battleState.status !== 'active') aim = null;
  // battleState.update()는 status!=='active'면 내부에서 바로 리턴한다(이벤트 애니메이션만
  // 계속 진행) - 그래서 isBlocked() 전체가 아니라 paused + 정비 팝업(prep)만
  // 따로 막는다. status가 'cleared'/'failed'로 막 바뀐 바로 그 프레임에도 controller.update()가
  // 계속 불려야 BattleController._applyClearReward()(클리어 보상 지급, 팝업에 쓸 골드 계산)가
  // 실행된다 - isBlocked() 전체로 막으면 상태가 바뀐 다음 프레임부터 전투 업데이트 자체가
  // 멈춰서 보상이 영원히 계산되지 않는다(이 상태 전환 프레임에는 팝업이 열려 있을 수 없으므로
  // prep 체크를 더해도 이 보상 계산 타이밍에는 영향이 없다).
  if (!paused && prep == null && controller && !tutorial?.popup) {
    battleBridge.update(gameState);
    // 조준 중엔 전투만 느리게(퍼즐은 정상 속도로 연쇄 마무리).
    controller.update(aim ? dt * controller.itemsConfig.targetingBattleTimeScale : dt);
  }
  if (tutorialRunning() && !paused && prep == null) tutorial.update(dt * 1000);

  // 힌트(입력이 일정 시간 없으면 가능한 수 한 칸을 보여줌)는 이제 GameState가 직접 관리한다
  // (trySwap이 유휴 타이머를 리셋하고, update()가 idleMs를 넘기면 hintCell을 채운다) -
  // main.js는 더 이상 중복 추적하지 않고 그대로 넘겨준다(docs/plan.md §16/§19).
  if (assetsReady) {
    renderer.render(
      gameState,
      animator,
      controller?.battleState ?? null,
      tutorialRunning() ? null : gameState.hintCell,
      playerState,
      paused,
      buildBattleHud(),
      controller?.lastClearReward ?? null,
      prep != null,
      buildItemUi()
    );
    if (!paused) drawPrep(now);
    renderer.drawMenuPopup(mainMenuScreen); // 뒤로가기 종료 확인(열려 있을 때만).
    if (tutorialRunning()) {
      renderer.drawTutorial(tutorial, now);
      tutorial.events.length = 0; // 이번 프레임에 그린 이벤트(손가락 강조) 소비.
    }
    // 보스 첫 처치 보상 - 클리어 보상이 새로 계산된 프레임에 한 번 획득 팝업으로.
    const clear = controller?.lastClearReward;
    if (clear && clear !== shownClearReward) {
      shownClearReward = clear;
      rewardPopup.show(rewardFromDelta(clear.grant));
    }
    renderer.drawRewardPopup(rewardPopup);
  }

  drawFade(rawDtMs);
  requestAnimationFrame(loop);
}

// 캔버스 텍스트가 폰트 로드 전에 그려지면 폴백 글꼴로 한 번 그려졌다가 바뀌어 보일 수
// 있으므로, 이미지 로딩과 함께 기다린다. 폰트 fetch가 실패해도(오프라인/파일 누락) 게임이
// 멈추지 않도록 각 load()는 개별로 흡수한다.
function loadFonts() {
  if (!document.fonts) return Promise.resolve();
  return Promise.all(FONT_LOAD_SPECS.map((spec) => document.fonts.load(spec).catch(() => {})));
}

// 이미지(+effects.json) 로딩 중에는 타이틀이 진행률 게이지를 보여준다. manifest/effects.json이
// 없거나 fetch가 실패해도 loadAssets()는 throw하지 않으므로(빈 설정으로 resolve) 게임이
// 멈추지 않는다 - 이미지가 전혀 없어도 fallback 도형으로 정상 동작해야 한다.
Promise.all([
  loadAssets((loadedCount, totalCount) => titleScreen.setLoadProgress(loadedCount, totalCount)), // 타이틀 로딩 게이지
  loadFonts(),
])
  .then(([assets]) => {
    renderer.setAssets(assets);
    assetsReady = true;
    renderer.tutorial.load();
    if (new URLSearchParams(location.search).has('sfxtest')) setupSfxTestPanel();
  })
  .catch(() => {
    // 방어적 - loadAssets 내부에서 이미 모든 실패를 흡수하지만, 혹시라도 던지면 그냥 fallback으로 진행.
    assetsReady = true;
  })
  .finally(() => {
    titleScreen.tapReady = true;
  });

requestAnimationFrame(loop);
