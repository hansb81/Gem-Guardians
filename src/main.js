import { GameState } from './core/gameState.js';
import { Animator } from './render/animator.js';
import { CanvasRenderer } from './render/canvasRenderer.js';
import { PointerInput } from './input/pointerInput.js';
import { loadAssets, loadItemAssets } from './render/assetLoader.js';
import { isNeighbor, itemTargetCells } from './render/itemBarRenderer.js';
import { TitleScreen } from './render/titleScreen.js';
import { MainMenuScreen } from './render/mainMenuScreen.js';
import { ShopScreen } from './render/shopScreen.js';
import { MineScreen } from './render/mineScreen.js';
import { RewardPopup, rewardFromDelta } from './render/rewardPopup.js';
import { loadBattleData } from './game/loadBattleData.js';
import { loadBalanceData } from './game/loadBalanceData.js';
import { PuzzleBattleBridge } from './game/puzzleBattleBridge.js';
import { BattleController } from './game/battleController.js';
import { playerState } from './game/playerState.js';
import { setupDevPanel, devCheats } from './game/devPanel.js';
import { setupSfxTestPanel } from './game/sfxTestPanel.js';
import { audio, bgmForScene } from './audio/AudioManager.js';
import { ANIMATION_DURATIONS_MS } from './config/animation.js';
import { computeScreenFit, FRAME_LOGICAL_W } from './render/screenFit.js';
import { t, tOr, setLocale } from './config/i18n.js';
import { FONT_LOAD_SPECS } from './config/fonts.js';
import { towerAttack, normalFloorReward } from './core/economy/economy.js';
import { compLock } from './core/comp/endless.js';
import { RankingUi } from './game/rankingUi.js';
import { pressButton } from './render/uiKit.js';
import { openPrepState, rememberTab, statueRowInfo, statueAllInfo, hitPrepPopup, stageFxOnUpgrade } from './render/ui/prepPopup.js';
import { stageAttackMs } from './render/ui/stageGuardian.js';
import { cycleFilter, resetFilter, dragList, scrollList } from './render/ui/spiritTab.js';
import { Tutorial, shouldStartTutorial, completeTutorial } from './tutorial/tutorial.js';
import { resolveFloorSpawns } from './core/balance/floorGen.js';
import { platform, DEV_MODE, DEV_ALLOWED } from './platform/index.js';
import { restore, flushPendingPurchases, startPendingPurchases } from './shop/iap.js';
import { storage } from './platform/storage.js';
import { guardianFxSetting, lookGrade, fxTier } from './render/guardianFx.js';
import { UpgradeSfx, BULK_STAGGER_MS } from './audio/upgradeSfx.js';
import { loadServerConfig, setupServer, autoOpenAttendance, autoOpenEvent } from './game/serverUi.js';
import { titleLoginMode, linkFromTitle } from './game/titleLogin.js';
import { showRewarded } from './game/ads.js';
import { continueOptions, recordUse } from './game/adContinue.js';
import { CloudSave, saveSummary } from './net/cloudSave.js';
import { net, call, sayHello, refreshSessionUser, authClient } from './net/api.js';
import { Account } from './net/account.js';
import { pruneGrantedTx } from './core/inventory/inventory.js';
import { kstDate } from './core/kst.js';
import { GAME_INFO } from './config/gameInfo.js';
import { LANE_JITTER } from './render/battleRenderer.js';
import { GLOW } from './render/guardianFx.js';

// ?jitter=0 끔 / ?jitter=8 일반 ±8(엘리트 0.6배) - 적 줄 안 흩기 비교용(개발 빌드만).
if (DEV_ALLOWED) {
  // ?glow=always|pulse|off - 수호자 외곽선 글로우 방식 비교용(개발 빌드만, 배포는 pulse 고정).
  const glow = new URLSearchParams(location.search).get('glow');
  if (glow === 'always' || glow === 'off') GLOW.mode = glow;
  const j = new URLSearchParams(location.search).get('jitter');
  if (j !== null && Number.isFinite(Number(j))) {
    LANE_JITTER.enabled = Number(j) > 0;
    LANE_JITTER.normal = Number(j);
    LANE_JITTER.elite = Math.round(Number(j) * 0.6);
  }
}

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
mainMenuScreen.compStatus = () => compStatus();
mainMenuScreen.crown = () => ranking.devCrown ?? ranking.crown;
ranking.crownSheet = (metal) => mainMenuScreen.crownSheet(metal);
if (DEV_ALLOWED) {
  // ?crown=iron|bronze|silver|gold 메뉴 왕관 금속 고정, ?swirl=1 새 시즌 소용돌이 한 번(개발 빌드만).
  const q = new URLSearchParams(location.search);
  ranking.devCrown = q.get('crown');
  if (q.has('rankPlayers')) ranking.devPlayers = Number(q.get('rankPlayers')) || 0; // ?rankPlayers=3|30 가짜 순위표 인원
  ranking.swirl = q.has('swirl');
}
mainMenuScreen.normalFloor = () => playerState.floor; // controller.floor는 경쟁·튜토리얼 판이면 다른 값
mainMenuScreen.itemIcons = () => renderer.itemAssets?.icons; // 출석·우편 보상 아이콘
// 이벤트 팝업 광고 칸(docs/ads.md 3장) - 배너를 띄울 수 있고 광고 제거가 없을 때만 칸을 그린다.
// 이벤트가 없으면("준비 중" 문구뿐) 광고도 없다 - AdMob: 콘텐츠 없는 화면에 광고 금지.
mainMenuScreen.popupAd = () => platform.caps.popupBanner && mainMenuScreen.events.length > 0 && !playerState.inventory.isUnlocked('adFree');
mainMenuScreen.popupAdDebug = () => platform.adTesting;
const shopScreen = new ShopScreen();
const mineScreen = new MineScreen();
function exitTitle() {
  if (scene !== 'title' || !titleScreen.tapReady || titleScreen.login.busy) return;
  if (mainMenuScreen.account) mainMenuScreen.account.msg = null; // 타이틀 실패 문구를 계정 팝업에 남기지 않음
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
    refreshInventoryUi(); // 경쟁 판 키트 -> 본편 장착으로
    if (compResult) {
      rewardPopup.show(compResult);
      compResult = null;
    }
    CloudSave.flush('menu');
    nudgeCheck = true; // 15층 첫 클리어 뒤 메뉴 복귀 = 연결 권유 한 번

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
    if (shopReturnScene !== 'game' && shopScreen.changed) controller?.retryFloor();
    scene = shopReturnScene;
    if (scene === 'mine') mineScreen.onResume(); // 산 다이아를 바로 반영
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
// 광산(docs/mine.md 15장) - 상점과 같은 전체 화면 scene, 같은 뒤로 가기 경로(history 한 칸).
// 입구 = 메인 메뉴 오른쪽 열 3번째 버튼(mainMenuScreen.mine).
function enterMine() {
  if (!mineScreen.ready || scene === 'mine' || fade) return;
  startFade(SHOP_FADE_MS, null, () => {
    mineScreen.open();
    scene = 'mine';
  });
  history.pushState({ gg: 'mine' }, '');
}
function leaveMine() {
  startFade(SHOP_FADE_MS, null, () => {
    scene = 'menu';
  });
}
// 광산에서 다이아가 모자라 상점(다이아)으로 - history에 상점 칸을 하나 더 쌓아, 상점을 닫으면 광산(열려 있던 팝업 그대로)으로 돌아온다.
function mineToShop() {
  if (!controller?.shopConfig || fade) return;
  shopReturnScene = 'mine';
  startFade(SHOP_FADE_MS, null, () => {
    shopScreen.open('dia');
    scene = 'shop';
  });
  history.pushState({ gg: 'shop' }, '');
}
function requestMineBack() {
  if (history.state?.gg === 'mine') history.back();
  else leaveMine();
}
window.addEventListener('popstate', () => {
  if (scene !== 'mine' || fade) return;
  if (mineScreen.closeOverlay()) history.pushState({ gg: 'mine' }, ''); // 팝업만 닫고 광산에 남는다.
  else leaveMine();
});
// 백그라운드에서 돌아오면 바로 정산(1초 틱을 기다리지 않는다).
platform.lifecycle.onResume(() => scene === 'mine' && mineScreen.onResume());
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
// { context: 'floorClear'|'defeat'|'village'|'vault'|'towerTap', tab, selectedTower, flash, view }.
let prep = null;
let rankingOpenAt = null; // 메뉴 원석 누름 연출이 끝나 랭킹 팝업을 열 시각(ms). 연출 중이 아니면 null.
let vaultOpenAt = null; // 메뉴 보물상자 열기 연출이 끝나 보관함 팝업을 열 시각(ms). 연출 중이 아니면 null.
let spiritEnv = null; // { cfg: config/spirits.json, floorReward() } - 데이터 로드 뒤(정령 탭 view·레벨업 비용)
let prepLastTab = null; // 층 클리어/패배끼리 같은 판에서 마지막에 본 탭.
let upgradeHold = null;
// 인벤토리 탭: 고른 보유 아이템 id, 장착 칸 누름 { slot, downMs, done } - 0.5초 넘게 누르면 해제(loop), 그 전에 떼면 탭.
let invSel = null;
let invPress = null;
// 보유 목록 끌기 - { x, y, startScroll, moved } | null. 끌지 않고 떼면 그 자리 아이템을 고른다(스크롤과 탭 구분).
let invDrag = null;
const INV_DRAG_PX = 8;
const INV_HOLD_MS = 500;
let spiritDrag = null; // 정령 목록 끌기 { y, startScroll, moved, id } - 끌지 않고 떼면 그 칸(id)을 연다
let spiritPress = null; // 정령 탭 필터 버튼 누름 { kind, downMs, done } - 길게(INV_HOLD_MS) = 전체로
let mineVeinToast = false; // 새 광맥 토스트 대기(보상 팝업이 닫히면 띄운다)
// 메뉴의 광산 버튼 상태(객체 하나를 재사용 - 매 프레임 만들지 않는다). 설정을 읽은 뒤 mainMenuScreen.mine에 연결.
const mineMenu = {
  get locked() {
    return !playerState.mine.unlocked;
  },
  get badge() {
    return mineScreen.menuBadge();
  },
  get floor() {
    return mineScreen.env.cfg.veins[0].unlockBossFloor;
  },
};
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

// 클라우드 저장(docs/auth.md §3, src/net/cloudSave.js). 시작 때 저장(initShop·initItems·90일 정리)이 끝난 뒤 init해야
// 그 저장들이 dirty로 잡히지 않는다(진짜 진행만 dirty). 판정은 hello -> 미지급 복구·출석·우편 다음.
let cloudConflict = null;
let iapEnv = null; // 결제 지급·회수 콜백(상점 준비 뒤) - 계정 전환 전 결제 대기열 비우기에도 씀 // 메뉴에 띄울 충돌 팝업 인자(메뉴에 다른 팝업이 없을 때 연다)
// ---- 경쟁 모드(docs/ranking.md 5장) ----
// 판 = 서버 rank-comp-start(시즌 시드·하루 입장) -> BattleController.startComp(무한 웨이브) -> 패배/나가기 때 rank-comp-finish.
let compCfg = null; // config/ranking.json comp
let rankingCfg = null; // config/ranking.json(compUnlocked 판정)
let compBusy = false; // 시작 요청 중(연타 방지)
let compLeftAsked = false;
let compResult = null; // 메뉴로 돌아온 뒤 띄울 경쟁 결과 팝업
// 메뉴 모드 팝업·랭킹 탭이 보는 상태: unlocked = config compUnlocked + 본편 unlockBestFloor층 도달 + 서버 랭킹 연결, open = 지금 시작 가능.
function compStatus() {
  const svc = ranking.service;
  const lock = compLock(rankingCfg, playerState.bestFloor, !!svc && 'compLeft' in svc && net.on);
  if (lock) return { unlocked: false, open: false, hint: t(lock.hint, lock.params ?? undefined) };
  if (svc.compLeft == null && !compLeftAsked) {
    compLeftAsked = true; // 남은 입장은 한 번 물어 둔다(이후엔 시작 응답이 갱신). 실패하면 다음에 다시.
    svc.me('comp').finally(() => (compLeftAsked = svc.compLeft != null));
  }
  const left = svc.compLeft;
  return { unlocked: true, open: left !== 0, left, daily: compCfg.dailyEntries, hint: left === 0 ? t('comp.noEntries') : null };
}

// 일반 모드 시작(메뉴 플레이 버튼·랭킹 내 기록 카드 "도전하러 가기").
function startNormalGame() {
  playGameBgm(1000);
  startFade(ENTER_FADE_MS, 'ui_game_enter', () => {
    scene = 'game';
  });
}

async function startCompGame() {
  if (compBusy || fade || !controller || !compStatus().open) return;
  compBusy = true;
  let res;
  try {
    res = await call('rank-comp-start');
  } finally {
    compBusy = false;
  }
  if (res.left != null) ranking.service.compLeft = res.left;
  if (!res.ok) {
    mainMenuScreen.showToast(t(res.reason === 'dailyLimit' ? 'comp.noEntries' : 'comp.startFail'));
    return;
  }
  controller.startComp({ runId: res.runId, seasonId: res.seasonId, seed: Number(res.seed) >>> 0, modifier: res.modifier ?? null, cfg: compCfg });
  itemUi.equipped = Object.keys(controller.comp.kit); // 하단 바 = 이번 판 키트(본편 가방은 그대로)
  itemUi.counts = controller.comp.kit;
  playGameBgm(1000);
  startFade(ENTER_FADE_MS, 'ui_game_enter', () => {
    scene = 'game';
  });
}

// 판 끝(패배 "결과 보기" 또는 일시정지 "나가기") - 지금 점수로 제출하고 메뉴로, 메뉴에서 결과 팝업.
// 앱을 강제로 끄면 제출되지 않는다(입장 1회는 이미 씀).
function endCompRun() {
  const run = controller?.comp;
  if (!run || run.done || fade) return;
  run.done = true;
  const points = run.score.total;
  const wave = controller.battleState.wave;
  compResult = { title: t('comp.resultTitle'), notes: [t('comp.resultScore', { score: points.toLocaleString() }), t('comp.resultWave', { wave })], gold: 0, diamonds: 0, items: {}, skills: {}, flags: [] };
  call('rank-comp-finish', { runId: run.runId, points, floor: wave, log: run.input.log }).then((r) => {
    if (!r.ok) console.warn('경쟁 점수 제출 실패/보류', r);
    ranking.crownDirty(); // 메뉴 왕관 금속 다시 받기
  });
  ranking.service.submit('comp', { value: points, floor: wave, at: ranking.service.now(), seasonId: run.seasonId }); // 오프라인 표시용 기기 기록
  startExitToMenu(); // retryFloor가 본편 층 전투로 되돌린다(경쟁 판 상태는 버림)
}

function startCloudSave() {
  const tx = playerState.inventory.data.grantedTx;
  const kept = pruneGrantedTx(tx, kstDate(Date.now())); // KST 오늘
  if (kept.length !== tx.length) {
    tx.splice(0, tx.length, ...kept);
    playerState.save();
  }
  CloudSave.init({
    playerState,
    storage,
    net,
    call,
    reload: () => location.reload(),
    deviceId: platform.identity.getUserId().catch(() => null), // platformUserId(웹·Capacitor 공통)
    appVersion: GAME_INFO.version,
  });
  Account.init({
    client: authClient,
    net,
    call,
    sayHello: () => sayHello(playerState.ranking.profile.playerId, GAME_INFO.version),
    refreshUser: refreshSessionUser,
    cloud: CloudSave,
    playerState,
    storage,
    platformAuth: platform.auth,
    flushPurchases: () => (iapEnv ? flushPendingPurchases(iapEnv) : { ok: true, left: 0 }),
    iapLogIn: (id) => platform.iap.logIn?.(id),
    restorePurchases: () => (platform.caps.iap && iapEnv ? restore(iapEnv.onGrant, iapEnv.onRevoke) : null),
    chooseConflict: ({ server, device, purchases }) =>
      new Promise((resolve) => {
        cloudConflict = {
          bodyKey: 'menu.saveConflict.bodyGoogle',
          titles: [t('menu.saveConflict.google'), t('menu.saveConflict.thisDevice')],
          server: { ...server.summary, updatedAt: server.updatedAt, platform: server.platform },
          device,
          purchases,
          cancel: true,
          onPick: resolve,
        };
      }),
    session: platform.session,
    location: () => window.location,
    replaceUrl: (u) => history.replaceState(history.state, '', u),
    reload: () => location.reload(),
  });
  if (Account.takeDeletedNotice()) mainMenuScreen.showToast(t('menu.deleteAccount.deletedToast'));
  // 설정 > 계정(서버가 켜져 있으면 늘 - 계정 삭제는 모든 빌드. Google 연결 부분은 caps.login이 있을 때만).
  if (serverUi.enabled) {
    const dispatch = mainMenuScreen.dispatch;
    mainMenuScreen.dispatch = (action) => accountAction(action) || dispatch(action);
    mainMenuScreen.account = {
      state: () => Account.state(),
      cloud: () => CloudSave.status(),
      googleOn: () => !!net.googleWebClientId && platform.caps.login.includes('google') && (platform.auth.redirect || platform.auth.providers.includes('google')),
      busy: false,
      msg: null,
      confirm: false,
    };
  }
  if (CloudSave.takeLoadedNotice()) showNotice(t('menu.saveConflict.loaded')); // 계정 줄(titleLoginOn) 뒤에 - 타이틀 로그인으로 불러왔으면 타이틀에
  const inv = playerState.inventory;
  const grant = inv.grant.bind(inv);
  inv.grant = (...args) => {
    const r = grant(...args);
    if (r.ok) CloudSave.flush('grant'); // 결제·보상 지급 직후 바로 올림
    if (r.ok && String(args[1]?.txId ?? '').startsWith('iap:')) pendingNudge = 'firstPurchase'; // 첫 결제 지급 직후 연결 권유
    return r;
  };
  platform.lifecycle.onPause(() => CloudSave.flush('pause'));
  serverUi.started?.then(async () => {
    if (accountResume?.action === 'redirect') return null; // Google로 다시 다녀오는 중
    if (accountResume?.action === 'resume') {
      // 웹: B로 로그인해 돌아옴 -> 진행 고르기. 취소·실패면 A로 돌아와 평소 시작 판정.
      const r = await runAccount(() => Account.resumeSwitch(accountResume.intent));
      accountResume = null;
      if (r?.ok) return null;
    }
    return CloudSave.syncOnStart(net.hello?.save ?? null);
  }).then((r) => {
    if (r?.action !== 'conflict' || !r.server) return;
    const owner = r.kind === 'owner'; // 기기 save 주인 != 지금 계정
    cloudConflict = {
      bodyKey: owner ? 'menu.saveConflict.bodyAccount' : 'menu.saveConflict.bodyDevice',
      titles: [t(owner ? 'menu.saveConflict.thisAccount' : 'menu.saveConflict.other'), t('menu.saveConflict.thisDevice')],
      server: { ...r.server.summary, updatedAt: r.server.updatedAt, platform: r.server.platform },
      device: saveSummary(playerState.snapshot()),
    };
  });
}

// 계정 연결(docs/auth.md §5, src/net/account.js).
let accountResume = null; // 웹 리다이렉트에서 돌아온 결과 { action:'redirect'|'resume', intent? }
// hello 뒤, 미지급 복구 전(serverUi beforeStart): 웹 Google 리다이렉트에서 돌아왔으면 처리.
async function accountRedirect() {
  if (!platform.caps.login?.length || !platform.auth.redirect) return null;
  const r = await Account.handleRedirect();
  if (r.action === 'linked') mainMenuScreen.showToast(t('menu.account.linkedToast'));
  else if (r.action === 'failed' && r.reason !== 'cancel') mainMenuScreen.showToast(t(`menu.account.fail.${r.reason}`));
  if (r.action === 'redirect' || r.action === 'resume') {
    accountResume = r;
    return { skipStart: true };
  }
  return null;
}
const ACCOUNT_FAILS = new Set(['offline', 'unavailable', 'error']);
// 계정 동작 하나: 팝업 "연결 중…"(입력 막음) -> 결과 토스트/실패 문구.
async function runAccount(fn) {
  const acc = mainMenuScreen.account;
  if (acc?.busy) return null;
  if (acc) Object.assign(acc, { busy: true, msg: null });
  let r;
  try {
    r = await fn();
  } catch (e) {
    console.warn('[account]', e);
    r = { ok: false, reason: 'error' };
  } finally {
    if (acc) acc.busy = false;
  }
  if (r?.ok && r.kind === 'linked') showNotice(t(r.switched ? 'menu.account.switchedToast' : 'menu.account.linkedToast'));
  else if (r && !r.ok && r.reason !== 'cancel' && acc) acc.msg = ACCOUNT_FAILS.has(r.reason) ? r.reason : 'error';
  return r;
}
// 타이틀 로그인 입구(docs/auth.md §15) - 서버 켜짐 + Google 로그인 수단이 있을 때만. 같은 Account.link를 부른다.
let titleNetReady = false; // serverUi.started 끝(hello·웹 리다이렉트 처리 뒤)
const titleLoginOn = () => serverUi.enabled && !!mainMenuScreen.account?.googleOn();
// 토스트: 타이틀에 로그인 입구가 있으면 타이틀에(메뉴 토스트는 메뉴가 보일 때부터라 타이틀에선 안 보인다).
function showNotice(text) {
  (scene === 'title' && titleLoginOn() ? titleScreen : mainMenuScreen).showToast(text);
}
function syncTitleLogin() {
  const acc = mainMenuScreen.account;
  const l = titleScreen.login;
  if (!titleScreen.tapReady || !titleLoginOn()) {
    l.mode = null;
    return;
  }
  const state = Account.state();
  l.mode = titleLoginMode({
    loginOn: true,
    ready: titleNetReady,
    netOn: net.on,
    state,
    tutorialDone: !!playerState.tutorial?.done,
    bestFloor: playerState.bestFloor,
    purchases: playerState.inventory.data.grantedTx.filter((tx) => String(tx).startsWith('iap:')).length,
  });
  l.busy = acc.busy;
  l.msg = acc.msg;
  l.email = state.email ?? null;
}
// 메뉴의 계정 동작(계정 팝업·연결 권유·삭제 입력 칸 Enter). 처리했으면 true.
function accountAction(action) {
  if (action === 'accountLink') runAccount(() => Account.link('google'));
  else if (action === 'accountSignOut') runAccount(() => Account.signOut());
  else if (action === 'accountDelete') runAccount(() => Account.deleteAccount());
  else return false;
  return true;
}
// 연결 권유(docs/auth.md §8 끝): 15층 첫 클리어 뒤 메뉴 복귀 1번, 첫 결제 지급 직후 1번. 게스트·로그인 수단·서버 켜짐일 때만.
let nudgeCheck = false;
let pendingNudge = null;
function maybeNudge() {
  const id = pendingNudge ?? (nudgeCheck && playerState.bestFloor > 15 ? 'floor15' : null);
  nudgeCheck = false;
  pendingNudge = null;
  const acc = mainMenuScreen.account;
  if (!id || !acc || !net.on || !acc.googleOn() || Account.state().kind !== 'guest' || playerState.nudges.includes(id)) return;
  playerState.nudges.push(id);
  playerState.save();
  mainMenuScreen.popup = 'linkNudge';
}

// 게임 서버(docs/server.md S1) - config/server.json enabled:false면 아무 요청 없음.
let serverUi = { enabled: false, handleMenuAction: () => false, pointerUp: () => {} };
// gameDataReady = 전투·밸런스 데이터 + 서버 설정(계정 줄·서버 연결이 여기서 생긴다) - 타이틀 터치도 이걸 기다린다.
const gameDataReady = Promise.all([loadBattleData(), loadBalanceData(), loadServerConfig()]).then(([battleData, balanceData, serverConfig]) => {
  if (!battleData || !balanceData) return;
  serverUi = { ...serverUi, ...setupServer(serverConfig, { menu: mainMenuScreen, rewardPopup, player: playerState, dev: DEV_MODE, beforeStart: accountRedirect }) };
  serverUi.started?.then(() => (titleNetReady = true));
  if (balanceData.spirits) spiritEnv = { cfg: balanceData.spirits, floorReward: () => normalFloorReward(balanceData, playerState.bestFloor) };
  controller = new BattleController({
    balance: balanceData.balance,
    enemies: balanceData.enemies,
    obstacles: balanceData.obstacles,
    floorsData: balanceData.floorsData,
    itemsConfig: balanceData.items,
    shopConfig: balanceData.shop,
    mineConfig: balanceData.mine,
    spiritsConfig: balanceData.spirits,
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
  startCloudSave();
  if (balanceData.ranking) {
    // 참여 보상 골드 = 층 기준가 x 3(config/ranking.json tiers part.goldFloorMul) - 기준가는 상점과 같은 normalFloorReward.
    // 서버 랭킹은 일반 모드만, 마켓 리더보드가 있는 빌드(토스)는 그대로 마켓 리더보드(docs/server.md §9).
    compCfg = balanceData.ranking.comp ?? null;
    rankingCfg = balanceData.ranking;
    ranking.init(balanceData.ranking, {
      floorGold: () => normalFloorReward(balanceData, playerState.bestFloor),
      server: serverUi.enabled && !platform.caps.leaderboard,
      compOpen: () => compStatus().unlocked,
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
      seed: controller.comp ? (controller.comp.seed ^ 0x51a7e) >>> 0 : Date.now(), // 경쟁 모드 = 주간 시드(모두 같은 보드)
      obstaclesConfig: balanceData.obstacles,
      floorObstacles,
    });
    gameState.setReduceEffects(!!renderer.assets?.effectsConfig?.settings?.reduceMotion);
    controller.gameState = gameState;
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

  if (balanceData.mine) {
    mineScreen.setEnv({
      cfg: balanceData.mine,
      player: playerState,
      save: () => playerState.save(),
      floorGold: () => normalFloorReward(balanceData, playerState.bestFloor), // R - 상점과 같은 기준
      serverToday: () => serverUi.att?.status?.today ?? null, // 출석 상태의 서버 날짜(KST) - 없으면 기기 시각
      itemIcons: () => renderer.itemAssets?.icons,
      guide: renderer.tutorial, // 강조 틀 그림(hl_frame) 재사용
      adFree: () => playerState.inventory.isUnlocked('adFree'),
      // 광고 가속 = 패배 이어하기와 같은 보상형 광고 흐름(src/game/ads.js), 횟수만 따로(mine.daily.ads). 보상형이 없는 플랫폼은 광고 칸이 숨는다.
      canAd: () => platform.caps.rewarded,
      watchAd: () => showRewarded('mine', { loadTimeoutMs: balanceData.items.adContinue.loadTimeoutMs }),
    });
    mainMenuScreen.mine = () => mineMenu;
  }
  if (balanceData.shop) {
    shopScreen.setEnv({
      cfg: balanceData.shop,
      itemsConfig: balanceData.items,
      data: balanceData,
      player: playerState,
      save: () => playerState.save(),
      showReward: (r) => rewardPopup.show(r),
      watchAd: () => showRewarded('shop', { loadTimeoutMs: balanceData.items.adContinue.loadTimeoutMs }), // 오늘의 무료 1개
      itemIcons: () => renderer.itemAssets?.icons,
      serverToday: () => serverUi.att?.status?.today ?? null, // 상점·패스 하루 기준도 광산과 같은 서버 날짜(KST) 우선
      playerId: () => net.playerId ?? null, // 환불 안내 팝업의 회원 번호(설정 > 게임 정보의 회원 번호와 같은 id)
    });
    // 결제는 됐는데 지급 전에 꺼진 주문(토스 getPendingOrders 등) - 상점 데이터가 준비된 지금 다시 지급한다.
    iapEnv = {
      onGrant: (key, orderId) => shopScreen.grantPaid(key, orderId),
      onRevoke: (key, orderId) => shopScreen.revokePaid(key, orderId),
      grantedTx: () => playerState.inventory.data.grantedTx,
    };
    // 미지급 주문 복구는 바로(hello 안 기다림), 서버(S2) - RevenueCat logIn, 환불 회수, pendingVerify 재확인 - 는 hello 뒤.
    // 계정 전환 전에는 같은 두 단계를 차례로 부르는 flushPendingPurchases(docs/auth.md §5-4).
    if (platform.caps.iap) startPendingPurchases(iapEnv, serverUi.ready, { autoRestore: platform.caps.autoRestore });
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

  if (DEV_MODE) {
    setupDevPanel(controller, {
      setTimeScale: (v) => {
        timeScale = v;
      },
      getTimeScale: () => timeScale,
      triggerSpecialFx: devTriggerSpecialFx,
      triggerCombo: devTriggerCombo,
      triggerShuffle: () => gameState.shuffleBoard(),
      addSpecial: devAddSpecial,
      ranking: ranking.service ? ranking.dev() : null,
      server: serverUi.devToggle,
      mine: balanceData.mine ? { open: enterMine, cheat: (kind) => mineScreen.dev(kind) } : null,
      cloud: serverUi.enabled
        ? {
            upload: async () => {
              CloudSave.markDirty(); // 바뀐 게 없어도 올려 본다
              const res = await CloudSave.flush('account');
              return res ? (res.ok ? `rev ${res.rev}` : res.reason) : '꺼짐·충돌 중';
            },
            pull: async () => {
              const res = await call('save-get');
              if (!res.ok || !res.save) return res.reason ?? '서버 save 없음';
              await CloudSave.applyServer(res.save);
            },
            fakeConflict: async () => {
              CloudSave.devFakeConflict();
              await storage.flush();
              location.reload();
            },
          }
        : null,
    });
    // 개발용 키(?dev=1): H = 맨 앞 몬스터에게 석상 투사체 1발(피해 1), K = 남은 HP만큼(처치) - 몬스터 타격·사망 이펙트 확인.
    window.addEventListener('keydown', (e) => {
      if (scene !== 'game' || !devCheats.on || (e.code !== 'KeyH' && e.code !== 'KeyK')) return;
      renderer._battleRenderer.devShoot(controller?.battleState, e.code === 'KeyK');
    });
    // 개발용 콘솔 훅(?dev=1) - 화면 확인 때 실패/부활 등 상태를 직접 만든다.
    window.__gg = {
      get controller() { return controller; },
      get gameState() { return gameState; },
      get tutorial() { return tutorial; },
      startTutorialPractice,
      addSpecial: devAddSpecial, // 스토어 스크린샷(tools/store_screenshots.mjs)
      triggerCombo: devTriggerCombo,
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
      titleScreen,
      laneJitter: LANE_JITTER, // 적 줄 안 흩기 - 콘솔에서 바로 바꿔 비교(__gg.laneJitter.normal = 8)
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
// 구별하지 못한다(같은 입력이므로). 바로 꽂지 않고 다음 gameState.update 직후에 넣는다 - 프레임 사이에
// 꽂으면 update가 elapsedMs를 먼저 올려서 battleBridge(elapsedMs===0만 처리)가 전투 기술을 놓친다.
const devQueuedEffects = [];
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
  // 전투 기술 색 = 가운데 칸 잼 색(방해요소·빈칸이면 영향 칸 중 첫 잼, 없으면 0). 컬러는 고른 색(color)으로 쓴다.
  const gemColor = [position, ...affected].map((c) => board.get(c.row, c.col)).find((v) => v >= 0) ?? 0;
  devQueuedEffects.push({ type: 'specialActivate', kind, direction, position, color: kind === 'color' ? gemColor : null, gemColor, affected, cascadeIndex: 1, durationMs: 280, elapsedMs: 0 });
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

// 개발용(?dev=1) - 랜덤한 평범한 잼 칸(특수 잼·방해요소·애니메이션 중 칸 제외) 하나를 특수 잼으로 바꾼다.
// 무지개는 아이템(무지개 결정)과 같은 경로(useRainbow)라 생성 연출까지 나온다. 칸 고르기는 보드 seed RNG.
function devAddSpecial(kind) {
  const { board } = gameState;
  const free = [];
  for (let i = 0; i < board.grid.length; i++) {
    const row = Math.floor(i / board.cols);
    const col = i % board.cols;
    if (board.grid[i] >= 0 && !board.specials[i] && !board.occupants[i] && board.isCellStable(row, col)) free.push({ row, col });
  }
  if (free.length === 0) return;
  const { row, col } = free[Math.floor(board.rng() * free.length)];
  if (kind === 'color') gameState.useRainbow(row, col);
  else board.setSpecial(row, col, { kind, direction: kind === 'line' ? (board.rng() < 0.5 ? 'horizontal' : 'vertical') : null });
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
    else if (aim.axis) toggleAimAxis(); // 낫: 같은 슬롯을 다시 누르면 가로/세로 전환(취소는 보드 밖 탭).
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
  aim = { slot, id, hover: null, first: null, down: false, confirm, axis: cfg.target === 'line' ? 'row' : null };
  audio.play('ui_click');
}

function toggleAimAxis() {
  aim.axis = aim.axis === 'row' ? 'col' : 'row';
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
    target = cfg.target === 'line' ? (aim.axis === 'row' ? { row: hover.row } : { col: hover.col }) : hover;
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
        CloudSave.flush('floor');
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
      invSel = hit.id; // 예약 아이템도 아래 설명 패널에 보여 준다(켜기/끄기는 그대로 한 번에).
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
    // ---- 정령 탭(src/render/ui/spiritTab.js) ----
    case 'spiritSlot':
      audio.play('ui_click');
      prep.spirit.slot = hit.index;
      return;
    case 'spiritFilter': // 탭 = 다음 값(손을 뗄 때), 길게 누르기 = 그 필터만 전체로(processSpiritHold)
      spiritPress = { kind: hit.kind, downMs: performance.now(), done: false };
      return;
    case 'spiritItem': // 목록은 끌면 스크롤, 그냥 떼면 그 칸을 연다(pointerup)
    case 'spiritList':
      spiritDrag = { y: y / layout.scale, startScroll: prep.spirit.scroll, moved: false, id: hit.id ?? null };
      return;
    case 'spiritBack':
      audio.play('ui_cancel');
      prep.spirit.detail = null;
      return;
    case 'spiritEquip':
      audio.play(playerState.inventory.equipSpirit(prep.spirit.slot, hit.id).ok ? 'ui_click' : 'gem_swap_fail');
      return;
    case 'spiritLevelUp':
      audio.play(playerState.inventory.levelUpSpirit(hit.id, spiritEnv.floorReward()).ok ? 'ui_click' : 'gem_swap_fail');
      return;
  }
}

// 정비 팝업 그 줄의 강화 연출(공격 동작·번쩍임·반짝이·"+1")을 delayMs 뒤에 시작한다.
function bumpStageFx(index, delayMs = 0) {
  if (!prep) return;
  const look = lookGrade(playerState.towerLevel(index), controller.balance.towerLookTiers);
  const attackMs = stageAttackMs(renderer.assets, controller.battleState.towers[index].color, look);
  prep.fx[index] = stageFxOnUpgrade(prep.fx[index], performance.now() + delayMs, attackMs);
}

// 일괄 강화 - 다섯 석상을 골고루. 오른 석상마다 탑 연출, 팝업 연출은 오른 줄마다 위에서 아래로 80ms씩 늦춰서.
function upgradeAllStatues() {
  if (!controller) return false;
  const before = playerState.towerLevels.slice();
  const ok = controller.levelUpAllEven();
  if (!ok) { audio.play('gem_swap_fail'); return false; }
  const upped = before.map((l, i) => (playerState.towerLevel(i) > l ? i : -1)).filter((i) => i >= 0);
  if (scene === 'game') for (const i of upped) renderer.triggerTowerTapFx(controller.battleState.towers[i].id, true, playerState.towerLevel(i));
  upgradeSfx.all(upped, upped.some((i) => towerLook(before[i]) !== towerLook(playerState.towerLevel(i))));
  for (const i of upped) bumpStageFx(i, i * BULK_STAGGER_MS);
  return true;
}

const towerLook = (level) => lookGrade(level, controller.balance.towerLookTiers);
// 지연 재생은 타이머로 - audio.play의 minGapMs/maxInstances는 호출 시각 기준이라 delayMs만 다른
// 같은 소리를 한 번에 여러 개 걸면(일괄 강화) 첫 번째만 난다.
const upgradeSfx = new UpgradeSfx((key, { delayMs = 0, ...opts } = {}) => {
  if (delayMs) setTimeout(() => audio.play(key, opts), delayMs);
  else audio.play(key, opts);
});

// 석상 강화(1레벨/MAX). 성공하면 그 줄을 card_selected + "+1"·공격 동작, 전투 화면이 뒤에 있으면 탑 연출도 같이.
function upgradeStatue(index, max) {
  if (!controller) return false;
  const before = playerState.towerLevel(index);
  const ok = max ? controller.maxLevelUpTower(index) : controller.tryLevelUpTower(index);
  if (scene === 'game') renderer.triggerTowerTapFx(controller.battleState.towers[index].id, ok, playerState.towerLevel(index));
  if (ok) upgradeSfx.one(index, performance.now(), towerLook(before) !== towerLook(playerState.towerLevel(index)), max);
  else audio.play('gem_swap_fail');
  if (ok && prep) {
    prep.selectedTower = index;
    bumpStageFx(index);
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
  if (invSel == null || inv.config?.items[invSel]?.group !== 'hotbar') {
    // 고른 게 없거나 장착할 수 없는 것(예약·부활)을 골라 둔 상태면 그 칸의 아이템을 골라 설명만 보여 준다.
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
  // 정령 탭 필터 버튼 길게 누르기 = 그 필터만 전체로(손을 떼도 다음 값으로 안 넘어간다).
  if (spiritPress && !spiritPress.done && nowMs - spiritPress.downMs >= INV_HOLD_MS) {
    spiritPress.done = true;
    if (prep) resetFilter(prep.spirit, spiritPress.kind);
    audio.play('ui_cancel');
  }
  if (!invPress || invPress.done || nowMs - invPress.downMs < INV_HOLD_MS) return;
  invPress.done = true;
  if (playerState.inventory.unequip(invPress.slot).ok) audio.play('ui_cancel');
}

// 일시정지 버튼(재화 바 오른쪽)/팝업 버튼/탑 탭 클릭 판정. 보드 스와이프
// (PointerInput)와는 별개의 영역이라 겹치지 않는다.
canvas.addEventListener('pointerdown', (e) => {
  if (fade || compBusy) return; // 화면 전환 페이드·경쟁 판 시작 응답 대기 중에는 입력을 받지 않는다.
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
    const hit = titleScreen.hitLogin(frameX(e), frameY(e));
    if (hit === 'google') runAccount(() => linkFromTitle(Account, serverUi.started));
    else if (hit !== 'block') exitTitle(); // null(평소) | 'guest'
    return;
  }

  const x = frameX(e);
  const y = frameY(e);

  if (scene === 'menu') {
    if (ranking.isOpen) {
      const go = ranking.pointerDown(x, y);
      if (go === 'openMode') mainMenuScreen.popup = 'mode';
      else if (go === 'startNormal') startNormalGame();
      return;
    }
    if (prep) {
      handlePrepPointerDown(x, y);
      return;
    }
    const action = mainMenuScreen.handlePointerDown(x, y);
    if (action === 'replayTutorial') startTutorialPractice();
    else if (action === 'startNormalGame') startNormalGame();
    else if (action === 'startCompGame') startCompGame();
    else if (action === 'openShop') enterShop();
    else if (action === 'openMine') enterMine();
    else if (action === 'openShopGold') enterShop('dia', 'goldex');
    else if (action === 'openShopDia') enterShop('dia');
    else if (action === 'exitApp') platform.lifecycle.exit();
    else if (!accountAction(action)) serverUi.handleMenuAction(action);
    return;
  }

  if (scene === 'shop') {
    if (shopScreen.handlePointerDown(x, y) === 'exit') requestShopBack();
    return;
  }
  if (scene === 'mine') {
    const act = mineScreen.handlePointerDown(x, y);
    if (act === 'exit') requestMineBack();
    else if (act === 'shopDia') mineToShop();
    return;
  }

  // 뒤로가기로 연 "마을로 나갈까요?" 확인(전투 scene 위의 메뉴 모달).
  if (mainMenuScreen.popup) {
    if (mainMenuScreen.handlePointerDown(x, y) === 'quitFloor') {
      prep = null;
      upgradeHold = null;
      if (controller?.comp) endCompRun(); // 경쟁 판 = 지금 점수로 제출하고 나감
      else startExitToMenu(); // 정비 팝업 "마을로"와 같은 길.
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
      else if (action === 'compEnd' || (action === 'exit' && controller?.comp)) {
        endCompRun(); // 경쟁 판: 패배 "결과 보기" / 일시정지 "나가기" = 지금 점수로 제출하고 메뉴로
      } else if (action === 'revive') {
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

// 위 판정이 탭으로 DOM 입력 칸(쿠폰·랭킹 닉네임, render/ui/domInput.js)을 열어 포커스를 줬으면, 이어지는 mousedown
// 기본 동작이 포커스를 빼앗지 않게 막는다(위 리스너 다음에 등록 = 판정 뒤에 실행).
canvas.addEventListener('pointerdown', (e) => {
  if (document.activeElement?.tagName === 'INPUT') e.preventDefault();
});

canvas.addEventListener('pointermove', (e) => {
  if (invDragMove(frameY(e))) return;
  if (spiritDrag && prep) {
    dragList(prep.spirit, spiritDrag, frameY(e) / (renderer.prepLayout?.scale ?? 1));
    return;
  }
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
  if (scene === 'mine') return;
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
  if (spiritPress && !spiritPress.done && prep) {
    cycleFilter(prep.spirit, spiritPress.kind);
    audio.play('ui_click');
  }
  spiritPress = null;
  if (spiritDrag && !spiritDrag.moved && spiritDrag.id && prep) {
    prep.spirit.detail = spiritDrag.id;
    audio.play('ui_click');
  }
  spiritDrag = null;
  if (aim?.down) aimPointerUp();
  upgradeHold = null;
  sliderDrag = null;
  const menuUp = scene === 'menu' && !fade && !compBusy ?mainMenuScreen.handlePointerUp(frameX(e), frameY(e)) : mainMenuScreen.handlePointerUp();
  if (menuUp === 'openRanking') rankingOpenAt = mainMenuScreen.crystalTapAt + mainMenuScreen.crystalTapMs();
  if (menuUp === 'openPrep') openPrep('village');
  if (menuUp === 'openVault') vaultOpenAt = mainMenuScreen.chestOpenAt + mainMenuScreen.chestOpenMs();
  if (scene === 'shop') shopScreen.handlePointerUp();
  mineScreen.handlePointerUp(); // 강화 버튼 꾹 누르기 끝 + 미뤄 둔 저장
});
window.addEventListener('pointercancel', () => {
  renderer.tutorial.touching = false;
  renderer.tutorial.skipPressed = false;
  ranking.pointerUp();
  invPress = null;
  spiritPress = null;
  spiritDrag = null;
  invDrag = null;
  if (aim) aim.down = false;
  upgradeHold = null;
  sliderDrag = null;
  mainMenuScreen.handlePointerUp();
  shopScreen.cancelPointer();
  mineScreen.cancelPointer();
});

canvas.addEventListener(
  'wheel',
  (e) => {
    if (compBusy) return;
    if (scene === 'menu' && ranking.isOpen) {
      e.preventDefault();
      ranking.wheel(e.deltaY);
      return;
    }
    if (scene === 'menu' && mainMenuScreen.handleWheel(e.deltaY)) {
      e.preventDefault();
      return;
    }
    if (prep?.tab === 'spirit' && !prep.spirit.detail && (scene === 'menu' || scene === 'game')) {
      e.preventDefault();
      scrollList(prep.spirit, prep.spirit.scroll + e.deltaY * 0.5);
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
  () => fade != null || compBusy, // 화면 전환·경쟁 판 시작 응답 대기 중엔 무시.
  // 타이틀도 바로 끄지 않고 종료 확인(토스 심사: 종료할 때 확인 모달). 모달이 떠 있으면 닫기.
  // 문 열림 전환 중엔 무시(삼킴).
  () => scene === 'title' && (titleScreen.exiting || mainMenuScreen.closePopup() || (platform.caps.exit && openExitConfirm('app'))),
  () => {
    if (scene !== 'shop') return false;
    if (!shopScreen.closeOverlay()) requestShopBack();
    return true;
  },
  () => {
    if (scene !== 'mine') return false;
    if (!mineScreen.closeOverlay()) requestMineBack();
    return true;
  },
  () => scene === 'menu' && ranking.isOpen && (ranking.close(), true),
  () => scene === 'menu' && prep != null && ((prep = null), (upgradeHold = null), true),
  () => scene === 'menu' && vaultOpenAt != null, // 상자 열기 연출 중(0.34초)에는 뒤로가기도 받지 않는다.
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
  if (scene === 'mine' && e.code === 'Escape' && !fade) {
    if (!mineScreen.closeOverlay()) requestMineBack();
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
    controller?.logSwap(r1, c1, r2, c2); // 경쟁 판 입력 기록(일반 모드는 아무것도 안 함)
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
// mode: 경쟁 판이면 'competitive'(깃털·광고 이어하기 없음 - docs/ads.md).
let adBusy = false; // 광고 띄우는 중(연타·재진입 금지, 일시정지 팝업 안 띄움)
function continueState() {
  const cfg = controller?.itemsConfig?.adContinue;
  if (!controller || controller.battleState.status !== 'failed') return { revive: false, ad: false };
  return continueOptions({
    cfg,
    mode: controller.comp ? 'competitive' : 'normal',
    tutorial: tutorialRunning(),
    featherOk: controller.canRevive(),
    floorLeft: controller.adContinueLeft(),
    adReady: platform.caps.rewarded || playerState.inventory.isUnlocked('adFree'),
    save: playerState.adContinue,
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
  if (controller.adContinue()) {
    playerState.adContinue = recordUse(playerState.adContinue, Date.now());
    playerState.save();
  }
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
  itemUi.floorGold = controller?.killGoldThisFloor ?? 0; // 패배 팝업 "획득 골드"(처치 골드는 즉시 지급분)
  itemUi.comp = controller?.comp && !controller.comp.done ? controller.comp : null; // 패배 팝업 = 경쟁 결과 버튼
  return itemUi;
}

function buildBattleHud() {
  if (!controller) return null;
  const { balance, battleState } = controller;
  const comp = controller.comp;
  return {
    floor: controller.floor,
    // 경쟁 판: 층 배지 = "웨이브 N"(바뀔 때 배너도), 보드 위 점수 띠 = 경쟁 점수(퍼즐 점수 대신).
    label: comp ? t('comp.waveBanner', { wave: battleState.wave }) : null,
    compScore: comp ? comp.score.total : null,
    chapter: comp ? t('comp.waveBanner', { wave: battleState.wave }) : tOr(`names.chapter.${Math.floor((controller.floor - 1) / 10) % controller.enemies.chapters.length}`, controller.currentFloor.chapter),
    tag: controller.floorTag,
    remainingEnemies: battleState.remainingEnemies,
    totalEnemies: battleState.totalEnemies,
    gold: playerState.gold,
    // 경쟁 판은 석상 레벨 고정(comp.towerLevel) - 레벨 글자·모습·이펙트도 그 값으로(본편 레벨 아님).
    towerLevels: comp ? comp.towerLevels : playerState.towerLevels,
    towerCosts: comp ? null : playerState.towerLevels.map((_, i) => playerState.nextTowerLevelCost(balance, i)),
    towerAttacks: (comp ? comp.towerLevels : playerState.towerLevels).map((lvl) => towerAttack(balance, lvl)),
    towerNextAttacks: (comp ? comp.towerLevels : playerState.towerLevels).map((lvl) => towerAttack(balance, lvl + 1)),
    maxLevel: balance.tower.maxLevel,
    towerFxTiers: balance.towerFxTiers ?? null, // 수호자 레벨 구간 이펙트(guardianFx.js)
    towerLookTiers: balance.towerLookTiers ?? null, // 수호자 모습 등급 시트(guardianFx.lookGrade)
    guardianFx: guardianFxSetting.enabled(),
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

// 획득 팝업 내용에 정령을 붙인다. list = [{ id, kind: 'new'|'star'|'stones', stones(중복 변환분), stoneReward }].
function withSpirits(reward, list, title) {
  const base = reward ?? { gold: 0, diamonds: 0, items: {}, skills: {}, flags: [] };
  const cfg = spiritEnv?.cfg;
  return {
    ...base,
    ...(title ? { title } : null),
    spirits: list.map((s) => ({ id: s.id, kind: s.kind, stones: s.stones, element: cfg?.spirits[s.id]?.element, grade: cfg?.spirits[s.id]?.grade })),
    spiritStones: list.reduce((n, s) => n + (s.stoneReward ?? 0) + (s.stones ?? 0), 0),
  };
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
    v.towers[i] = { color: tower.color, name: tOr(`names.tower.${tower.color}`, tower.name), level, look: lookGrade(level, balance.towerLookTiers), fxTier: guardianFxSetting.enabled() && balance.towerFxTiers ? fxTier(level, balance.towerFxTiers) : 0, atk, nextAtk: towerAttack(balance, level + 1), info: statueRowInfo(balance, level, playerState.gold) };
  });
  v.all = statueAllInfo(balance, playerState.towerLevels, playerState.gold);
  const inv = playerState.inventory;
  // 정령 탭: 층 중에 바꾼 장착(pendingSpirits)이 있으면 그쪽을 보여 준다(하단 아이템 장착 칸과 같은 규칙).
  v.spirit = spiritEnv && { cfg: spiritEnv.cfg, owned: inv.data.perm.spirits, slots: inv.pendingSpirits() ?? inv.spiritSlots(), pending: inv.inFloor, stones: inv.spiritStones, gold: playerState.gold, floorReward: spiritEnv.floorReward() };
  renderer.drawPrepPopup(prep, buildItemUi());
}

let lastBattleStatus = null;
// 메뉴·상점·광산은 거의 정적 - rAF를 하나씩 건너뛰어 30fps로 그린다(배터리 절반). 건너뛴 프레임은 lastTime을
// 안 바꾸므로 다음 프레임 dt에 그대로 쌓인다. 화면을 만지는 중·직후(스크롤 관성·길게 누르기)와 페이드 중엔 60fps.
const HALF_FPS_SCENES = new Set(['menu', 'shop', 'mine']);
const FULL_FPS_AFTER_INPUT_MS = 1500;
let lastInputAt = 0;
let skipOdd = false;
const noteInput = () => (lastInputAt = performance.now());
for (const type of ['pointerdown', 'pointermove', 'wheel']) canvas.addEventListener(type, noteInput, { passive: true });
function loop(now) {
  if (HALF_FPS_SCENES.has(scene) && !fade && now - lastInputAt > FULL_FPS_AFTER_INPUT_MS && (skipOdd = !skipOdd)) {
    requestAnimationFrame(loop);
    return;
  }
  syncBanner();
  syncPopupBanner();
  const rawDtMs = Math.min(64, now - lastTime);
  const dt = Math.min((now - lastTime) / 1000, MAX_DT_SEC) * timeScale;
  lastTime = now;

  if (scene === 'title') {
    syncTitleLogin();
    // 타이틀에서 Google 연결 중 진행 고르기(onPick)가 나오면 타이틀 위에 바로(입력은 위 pointerdown의 팝업 분기).
    if (cloudConflict?.onPick && !mainMenuScreen.popup) {
      mainMenuScreen.openSaveConflict(cloudConflict);
      cloudConflict = null;
    }
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
    // 보물상자: 열기 연출이 끝나면 보관함 팝업(그 사이 다른 팝업이 떴으면 열지 않는다), 팝업이 닫히면 상자도 바로 닫힘.
    if (vaultOpenAt != null && now >= vaultOpenAt) {
      vaultOpenAt = null;
      if (!mainMenuScreen.popup && !ranking.isOpen && !rewardPopup.active && !fade) {
        openPrep('vault');
        playerState.inventory.markItemsSeen(playerState.bestFloor); // 빨간 점 1(새 아이템) 끔.
      }
    }
    if (vaultOpenAt == null && !prep) mainMenuScreen.chestOpenAt = null;
    // 원석: 누름 연출이 끝나면 랭킹 팝업. 새 시즌 소용돌이는 메뉴가 가려지지 않았을 때 한 번.
    const menuFree = !mainMenuScreen.popup && !ranking.isOpen && !rewardPopup.active && !prep && !fade;
    if (rankingOpenAt != null && now >= rankingOpenAt) {
      rankingOpenAt = mainMenuScreen.crystalTapAt = null;
      if (menuFree) ranking.open();
    } else if (ranking.swirl && menuFree) {
      ranking.swirl = false;
      mainMenuScreen.swirlAt = now;
    }
    drawPrep(now);
    // 메뉴에 있는 동안 1초마다 시즌 넘김 확인(지난 시즌 보상은 서버가 우편으로).
    ranking.tick(now);
    // 계정 전환 중 고르기(onPick)는 계정 팝업 위로 바로.
    const popupFree = !mainMenuScreen.popup || (cloudConflict?.onPick && mainMenuScreen.popup === 'account');
    if (cloudConflict && !prep && popupFree && !fade && !ranking.isOpen && !rewardPopup.active) {
      mainMenuScreen.openSaveConflict(cloudConflict);
      cloudConflict = null;
    } else if ((nudgeCheck || pendingNudge) && !prep && !mainMenuScreen.popup && !fade && !ranking.isOpen && !rewardPopup.active) maybeNudge();
    // 하루 첫 메뉴 진입: 출석 팝업 자동 1회(저장 충돌·연결 권유가 먼저, 그게 닫힌 뒤에). 그다음 차례 = 새 이벤트 상세 자동 1회(docs/events.md).
    else if (!cloudConflict && !prep && !fade && !ranking.isOpen && !rewardPopup.active) {
      const done = !!playerState.tutorial?.done;
      autoOpenAttendance(serverUi.att, mainMenuScreen, done) || autoOpenEvent(serverUi, mainMenuScreen, done);
    }
    // 소급 지급한 보스 정령(inv.pendingSpiritNotice) - 메뉴에서 다른 팝업이 없을 때 한 번 보여 주고 비운다.
    const spiritNotice = playerState.inventory.data.pendingSpiritNotice;
    if (spiritNotice.length > 0 && spiritEnv && !prep && !mainMenuScreen.popup && !fade && !ranking.isOpen && !rewardPopup.active) {
      rewardPopup.show(withSpirits(null, spiritNotice, t('spirit.noticeTitle')));
      playerState.inventory.clearSpiritNotice();
    }
    renderer.drawRankingPopup(ranking, now);
    renderer.drawRewardPopup(rewardPopup); // 출석·우편 받기
    if (compBusy) renderer.drawBusyOverlay(now); // 경쟁 판 시작 응답 대기
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
  if (scene === 'mine') {
    renderer.drawShop(mineScreen, now); // 전체 화면 scene 공용: 블리드 + screen.draw
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
    if (devQueuedEffects.length > 0) {
      gameState.effects.push(...devQueuedEffects); // core가 이번 update에 낸 이펙트와 같은 시점(elapsedMs 0)
      devQueuedEffects.length = 0;
    }
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
    renderer.drawMenuPopup(mainMenuScreen, now); // 뒤로가기 종료 확인(열려 있을 때만) + 전투 중 한 줄 알림.
    if (tutorialRunning()) {
      renderer.drawTutorial(tutorial, now);
      tutorial.events.length = 0; // 이번 프레임에 그린 이벤트(손가락 강조) 소비.
    }
    // 보스 첫 처치 보상 - 클리어 보상이 새로 계산된 프레임에 한 번 획득 팝업으로.
    const clear = controller?.lastClearReward;
    if (clear && clear !== shownClearReward) {
      shownClearReward = clear;
      // 보스 첫 처치 정령(새로 얻음 / 별 +1 / 정령석 변환)과 정령석을 아이템 보상과 같은 팝업에.
      const reward = rewardFromDelta(clear.grant);
      rewardPopup.show(clear.spirit ? withSpirits(reward, [clear.spirit]) : reward);
      // 광산: 10층 보스 첫 처치 = 보상 팝업 다음에 해금 안내 1회, 20~50층 = 새 광맥 토스트(보상 팝업을 닫은 뒤).
      if (clear.mineOpened?.length) {
        if (clear.floor === mineMenu.floor) rewardPopup.show({ title: t('mine.openedTitle'), notes: [t('mine.openedHint')], gold: 0, diamonds: 0, items: {}, skills: {}, flags: [] });
        else mineVeinToast = true;
      }
    }
    if (mineVeinToast && !rewardPopup.active) {
      mineVeinToast = false;
      mainMenuScreen.showToast(t('mine.newVein'), true);
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
  // 게임 데이터도 기다린다 - 안 그러면 데이터가 늦은 날 메뉴에 먼저 들어가 설정의 계정 줄·서버 기능이 잠깐 없다. 실패해도 터치는 연다.
  gameDataReady.catch((e) => console.warn('[main] 게임 데이터', e)),
])
  .then(([assets]) => {
    renderer.setAssets(assets);
    titleScreen.uiAssets = assets;
    assetsReady = true;
    renderer.tutorial.load();
    if (DEV_ALLOWED && new URLSearchParams(location.search).has('sfxtest')) setupSfxTestPanel();
  })
  .catch(() => {
    // 방어적 - loadAssets 내부에서 이미 모든 실패를 흡수하지만, 혹시라도 던지면 그냥 fallback으로 진행.
    assetsReady = true;
  })
  .finally(() => {
    titleScreen.tapReady = true;
  });

requestAnimationFrame(loop);
