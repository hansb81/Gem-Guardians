import { GameState } from './core/gameState.js';
import { Animator } from './render/animator.js';
import { CanvasRenderer } from './render/canvasRenderer.js';
import { PointerInput } from './input/pointerInput.js';
import { loadAssets } from './render/assetLoader.js';
import { TitleScreen } from './render/titleScreen.js';
import { MainMenuScreen } from './render/mainMenuScreen.js';
import { loadBattleData } from './game/loadBattleData.js';
import { loadBalanceData } from './game/loadBalanceData.js';
import { PuzzleBattleBridge } from './game/puzzleBattleBridge.js';
import { BattleController } from './game/battleController.js';
import { playerState } from './game/playerState.js';
import { setupDevPanel } from './game/devPanel.js';
import { LAYOUT_CONFIG } from './config/layout.js';
import { t } from './config/i18n.js';
import { FONT_LOAD_SPECS } from './config/fonts.js';
import { towerAttack } from './core/economy/economy.js';

const canvas = document.getElementById('game-canvas');
const loadingEl = document.getElementById('loading-indicator');

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
function exitTitle() {
  if (scene === 'title') titleScreen.startExit();
}
let selectedTowerIndex = null; // null이 아니면 타워 강화 팝업이 열려 있다 - 탭한 탑 줄은 card_selected로 표시.
let upgradeTab = 'levelUp'; // 팝업 탭('levelUp'|'inventory') - 팝업을 새로 열 때마다 레벨업 탭으로 리셋.
let upgradeHold = null; // 강화 버튼 꾹 누름 연속 강화 상태 - { index, nextMs, intervalMs } | null.
let timeScale = 1; // ?dev=1 2배속 토글용.
// 에셋 로드 전엔 그리지 않는다 - CanvasRenderer.assets===null일 때의 색/도형 fallback이
// 로딩 인디케이터(작은 텍스트 알약) 뒤로 그대로 보여서 "더미 이미지"처럼 보이는 걸 막는다.
let assetsReady = false;

Promise.all([loadBattleData(), loadBalanceData()]).then(([battleData, balanceData]) => {
  if (!battleData || !balanceData) return;
  controller = new BattleController({
    balance: balanceData.balance,
    enemies: balanceData.enemies,
    obstacles: balanceData.obstacles,
    floorsData: balanceData.floorsData,
    towersBaseData: balanceData.balance.tower.towers,
    battleConfig: {
      cascadeBonusPerStep: balanceData.balance.tower.puzzleShot.cascadeBonus,
      minDamage: 1, // docs/battle.md §4 "최소 1" - 밸런스 손잡이가 아니라 공식 상수.
      attackIntervalSec: balanceData.enemies.attackInterval,
      effectDurationsMs: battleData.effectDurationsMs,
      summon: battleData.summon,
    },
  });
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
    battleBridge.reset();
    animator.reset();
    // 다음 스테이지로 이동할 때도 보드가 뚝 바뀌지 않고 셔플 연출로 자리를 잡는다
    // (§셔플 애니메이션 - "다음 스테이지로 이동할때도 셔플을 사용한다", 보고 사항: 새로
    // 생성된 보드 자신을 한 번 더 섞어서 입장 연출로 재사용함).
    gameState.shuffleBoard();
  }

  // 생성자가 이미 첫 _resetBattleState를 한 번 돌렸지만(그때는 onBattleStateChanged가
  // 아직 없어 콜백으로 못 받는다) controller.currentFloor로 그 결과를 읽을 수 있다.
  resetPuzzleBoard(controller.currentFloor.obstacles);
  controller.onBattleStateChanged = (bs, floor) => {
    battleBridge.setTarget(bs);
    resetPuzzleBoard(floor.obstacles);
  };

  if (new URLSearchParams(location.search).get('dev') === '1') {
    setupDevPanel(controller, {
      setTimeScale: (v) => {
        timeScale = v;
      },
      getTimeScale: () => timeScale,
      triggerSpecialFx: devTriggerSpecialFx,
      triggerShuffle: () => gameState.shuffleBoard(),
    });
  }
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

// 일시정지 중이거나, 타워 강화 팝업이 열려 있거나, 전투가 끝난(승리/패배) 상태거나, 층
// 시작 석상 소환 연출이 끝나지 않았으면 퍼즐/전투 로직 진행과 보드 입력을 멈춘다(팝업도
// 일시정지와 같은 방식으로 게임을 멈춘다).
function isBlocked() {
  return (
    scene !== 'game' ||
    paused ||
    selectedTowerIndex != null ||
    (controller != null && (controller.battleState.status !== 'active' || controller.battleState.summon.active))
  );
}

function pointInRect(x, y, rect) {
  return !!rect && x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

// 타워 강화 팝업이 열려 있을 때의 터치 판정 - 닫기/탭 전환/줄마다의 강화·MAX 버튼.
// 강화 버튼은 탭 = 1레벨, 누르고 있으면 upgradeHold를 세팅해 loop()가 연속 강화를 진행한다.
function handleUpgradePopupPointerDown(popup, x, y) {
  if (pointInRect(x, y, popup.closeButton)) {
    selectedTowerIndex = null;
    upgradeHold = null;
    return;
  }
  if (pointInRect(x, y, popup.tabs?.levelUp)) {
    upgradeTab = 'levelUp';
    return;
  }
  if (pointInRect(x, y, popup.tabs?.inventory)) {
    upgradeTab = 'inventory';
    return;
  }

  if (popup.tab !== 'levelUp' || !popup.rows || !controller) return;
  for (let i = 0; i < popup.rows.length; i++) {
    const row = popup.rows[i];
    if (!row || !row.affordable) continue;
    const towerId = controller.battleState.towers[i].id;
    if (pointInRect(x, y, row.upgradeButton)) {
      const ok = controller.tryLevelUpTower(i);
      renderer.triggerTowerTapFx(towerId, ok, playerState.towerLevel(i));
      upgradeHold = { index: i, nextMs: performance.now() + 300, intervalMs: 150 };
      return;
    }
    if (pointInRect(x, y, row.maxButton)) {
      const ok = controller.maxLevelUpTower(i);
      renderer.triggerTowerTapFx(towerId, ok, playerState.towerLevel(i));
      return;
    }
  }
}

// 재화 바 "+"(상점 자리)/일시정지 버튼/팝업 버튼/탑 탭 클릭 판정. 보드 스와이프
// (PointerInput)와는 별개의 영역이라 겹치지 않는다.
canvas.addEventListener('pointerdown', (e) => {
  if (scene === 'title') {
    exitTitle();
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  if (scene === 'menu') {
    if (mainMenuScreen.handlePointerDown(x, y) === 'startNormalGame') scene = 'game';
    return;
  }

  const popup = renderer.lastLayout?.popup;
  if (popup?.kind === 'towerUpgrade') {
    handleUpgradePopupPointerDown(popup, x, y);
    return;
  }
  if (popup) {
    for (const [action, btnRect] of Object.entries(popup.buttons)) {
      if (!pointInRect(x, y, btnRect)) continue;
      if (action === 'resume') paused = false;
      else if (action === 'restart') {
        controller?.retryFloor();
        paused = false;
      } else if (action === 'next') {
        controller?.advanceFloor();
        paused = false;
      } else if (action === 'exit') {
        // 나가기: 돌아갈 별도 메인 화면이 아직 없어 지금은 다시 시작과 동일하게 처리한다.
        controller?.retryFloor();
        paused = false;
      }
      return;
    }
    return; // 팝업이 떠 있으면 그 외 클릭(보드 등)은 무시.
  }

  if (pointInRect(x, y, renderer.lastLayout?.pauseButton)) {
    if (controller && controller.battleState.status !== 'active') return;
    paused = !paused;
    return;
  }

  if (pointInRect(x, y, renderer.lastLayout?.currencyPlusButton)) {
    // 상점 자리 - 지금은 자리만(추후 상점 연결).
    return;
  }

  // 전투 영역 안의 탭은 타워 강화 팝업을 띄운다(assets/ui/README.md "타워 강화 팝업") - 연
  // 탑 줄은 card_selected로 표시되고, 게임은 팝업이 열린 동안 일시정지와 같은 방식으로 멈춘다.
  // 퍼즐 보드 드래그와 섞이지 않는다(PointerInput은 board 영역만 본다).
  if (!isBlocked() && controller) {
    const towerIndex = renderer.hitTestTower(x, y, controller.battleState);
    if (towerIndex != null) {
      selectedTowerIndex = towerIndex;
      upgradeTab = 'levelUp';
    }
  }
});

// 강화 버튼을 누른 채 손가락/포인터가 캔버스 밖으로 나가거나 뗄 때 연속 강화를 멈춘다.
window.addEventListener('pointerup', () => {
  upgradeHold = null;
});
window.addEventListener('pointercancel', () => {
  upgradeHold = null;
});

window.addEventListener('keydown', (e) => {
  if (scene !== 'title') return;
  if (e.code === 'Enter' || e.code === 'Space') {
    e.preventDefault();
    exitTitle();
  }
});

// 데스크톱도 모바일과 같은 고정 비율(LAYOUT_CONFIG.aspectRatio) 캔버스를 쓴다 - 창이 그
// 비율보다 넓거나 길면 나머지는 레터박스(style.css의 검은 배경)로 남는다.
function fitAspectRatio(maxWidth, maxHeight, ratio) {
  if (maxWidth / maxHeight > ratio) return { width: maxHeight * ratio, height: maxHeight };
  return { width: maxWidth, height: maxWidth / ratio };
}

function resize() {
  const dpr = window.devicePixelRatio || 1;
  const { width, height } = fitAspectRatio(window.innerWidth, window.innerHeight, LAYOUT_CONFIG.aspectRatio);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  renderer.resize(width, height, dpr);
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
window.addEventListener('orientationchange', resize);
watchDevicePixelRatio();
resize();

new PointerInput(canvas, {
  getBoardRect: () => (renderer.lastLayout ? renderer.lastLayout.board : null),
  // 눌린 칸 자체가 애니메이션 중이거나(cellStates !== null) 그 칸의 열이 다른 해소로
  // 잠겨 있으면 입력을 받지 않는다. 드래그 목표 칸은 gameState.trySwap()이 다시 검사한다.
  // 일시정지/전투 종료 중에는(isBlocked) 입력 자체를 받지 않는다.
  canInteract: (row, col) =>
    !isBlocked() &&
    gameState.board.cellStates[gameState.board.index(row, col)] === null &&
    !gameState.board.isColumnLocked(col),
  onSwap: (r1, c1, r2, c2) => {
    if (isBlocked()) return;
    gameState.trySwap(r1, c1, r2, c2);
  },
});

let lastTime = performance.now();
// 탭 전환/절전 복귀 등으로 프레임 간격이 비정상적으로 커지면(수 초) 그 dt가 그대로
// gameState/battleState에 들어가 캐스케이드·공격 타이머가 한 프레임에 몰려 처리되면서
// 화면이 멈춘 것처럼 보일 수 있다 - CanvasRenderer._lastFrameTime의 64ms clamp와 같은
// 값으로 맞춘다(렌더가 이미 쓰던 값).
const MAX_DT_SEC = 0.064;

function buildBattleHud() {
  if (!controller) return null;
  const { balance, battleState } = controller;
  return {
    floor: controller.floor,
    chapter: controller.currentFloor.chapter,
    tag: controller.floorTag,
    wave: battleState.waveNumber,
    totalWaves: battleState.totalWaves,
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
  const { index } = upgradeHold;
  const towerId = controller.battleState.towers[index].id;
  const ok = controller.tryLevelUpTower(index);
  renderer.triggerTowerTapFx(towerId, ok, playerState.towerLevel(index));
  if (!ok) {
    upgradeHold = null;
    return;
  }
  upgradeHold.intervalMs = Math.max(50, upgradeHold.intervalMs * 0.85);
  upgradeHold.nextMs = nowMs + upgradeHold.intervalMs;
}

function loop(now) {
  const rawDtMs = Math.min(64, now - lastTime);
  const dt = Math.min((now - lastTime) / 1000, MAX_DT_SEC) * timeScale;
  lastTime = now;

  if (scene === 'title') {
    renderer.drawTitle(titleScreen, now, rawDtMs);
    if (titleScreen.isExitDone()) scene = 'menu';
    requestAnimationFrame(loop);
    return;
  }

  if (scene === 'menu') {
    renderer.drawMainMenu(mainMenuScreen, playerState, now);
    requestAnimationFrame(loop);
    return;
  }

  processUpgradeHold(now);

  if (!isBlocked()) {
    gameState.update(dt);
  }
  // battleState.update()는 status!=='active'면 내부에서 바로 리턴한다(이벤트 애니메이션만
  // 계속 진행) - 그래서 isBlocked() 전체가 아니라 paused + 타워 강화 팝업(selectedTowerIndex)만
  // 따로 막는다. status가 'cleared'/'failed'로 막 바뀐 바로 그 프레임에도 controller.update()가
  // 계속 불려야 BattleController._applyClearReward()(클리어 보상 지급, 팝업에 쓸 골드 계산)가
  // 실행된다 - isBlocked() 전체로 막으면 상태가 바뀐 다음 프레임부터 전투 업데이트 자체가
  // 멈춰서 보상이 영원히 계산되지 않는다(이 상태 전환 프레임에는 팝업이 열려 있을 수 없으므로
  // selectedTowerIndex 체크를 더해도 이 보상 계산 타이밍에는 영향이 없다).
  if (!paused && selectedTowerIndex == null && controller) {
    battleBridge.update(gameState);
    controller.update(dt);
  }

  // 힌트(입력이 일정 시간 없으면 가능한 수 한 칸을 보여줌)는 이제 GameState가 직접 관리한다
  // (trySwap이 유휴 타이머를 리셋하고, update()가 idleMs를 넘기면 hintCell을 채운다) -
  // main.js는 더 이상 중복 추적하지 않고 그대로 넘겨준다(docs/plan.md §16/§19).
  if (assetsReady) {
    renderer.render(
      gameState,
      animator,
      controller?.battleState ?? null,
      gameState.hintCell,
      playerState,
      paused,
      buildBattleHud(),
      controller?.lastClearReward ?? null,
      selectedTowerIndex,
      upgradeTab
    );
  }

  requestAnimationFrame(loop);
}

// 캔버스 텍스트가 폰트 로드 전에 그려지면 폴백 글꼴로 한 번 그려졌다가 바뀌어 보일 수
// 있으므로, 이미지 로딩과 함께 기다린다. 폰트 fetch가 실패해도(오프라인/파일 누락) 게임이
// 멈추지 않도록 각 load()는 개별로 흡수한다.
function loadFonts() {
  if (!document.fonts) return Promise.resolve();
  return Promise.all(FONT_LOAD_SPECS.map((spec) => document.fonts.load(spec).catch(() => {})));
}

// 이미지(+effects.json) 로딩 중에는 간단한 진행률만 보여준다. manifest/effects.json이
// 없거나 fetch가 실패해도 loadAssets()는 throw하지 않으므로(빈 설정으로 resolve) 게임이
// 멈추지 않는다 - 이미지가 전혀 없어도 fallback 도형으로 정상 동작해야 한다.
Promise.all([
  loadAssets((loadedCount, totalCount) => {
    if (!loadingEl) return;
    loadingEl.textContent = totalCount > 0 ? t('loading.progress', { loaded: loadedCount, total: totalCount }) : t('loading.default');
  }),
  loadFonts(),
])
  .then(([assets]) => {
    renderer.setAssets(assets);
    assetsReady = true;
  })
  .catch(() => {
    // 방어적 - loadAssets 내부에서 이미 모든 실패를 흡수하지만, 혹시라도 던지면 그냥 fallback으로 진행.
    assetsReady = true;
  })
  .finally(() => {
    if (loadingEl) loadingEl.remove();
  });

requestAnimationFrame(loop);
