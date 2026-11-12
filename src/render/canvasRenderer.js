import { EMPTY, OBSTACLE } from '../core/board.js';
import { computeShuffleFallTiming, shuffleElapsedMs } from './animator.js';
import { GEM_TYPES } from '../config/gems.js';
import { SPECIAL_GEM_CONFIG } from '../config/specialGems.js';
import { HINT_CONFIG } from '../config/hint.js';
import { COMBO_CONFIG } from '../config/combo.js';
import { HUD_CONFIG } from '../config/hud.js';
import { computeLayout } from './layout.js';
import { FRAME_LOGICAL_W, FRAME_LOGICAL_H, screen, snapPx, drawImageSnapped, gemPixelScale } from './screenFit.js';
import { ParticlePool } from './effects/particlePool.js';
import { BattleRenderer } from './battleRenderer.js';
import { haptics } from '../platform/haptics.js';
import { audio } from '../audio/AudioManager.js';
import { drawDamage, drawNine, drawFixedImage, drawText, getUi, getUiFont, getUiMeta, snap, uiReady } from './uiKit.js';
import { t } from '../config/i18n.js';
import { getFontString } from '../config/fonts.js';
import { boltPath, drawPixelBolt } from './effects/pixelBolt.js';
import { ItemBarRenderer, drawItemIconFallback } from './itemBarRenderer.js';
import { InventoryTab } from './inventoryTab.js';
import { layoutPrepPopup, drawPrepPopup } from './ui/prepPopup.js';
import { layoutRankingPopup, drawRankingPopup } from './ui/rankingPopup.js';
import { DETONATION_CONFIG } from '../config/detonation.js';
import { TutorialRenderer } from './tutorialRenderer.js';
import { fmt } from './shopText.js';

const RAINBOW = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'];
const DEFAULT_MAX_PARTICLES = 240;
const BOARD_FLOAT_MS = 600; // 보드 위 데미지 폰트 숫자(해제 부적 +5) 수명
const BOMB_BOUNCE_MS = 250; // 해제 부적 후 시한폭탄 숫자 튕김
const BLEED_FILL = '#0d0a10'; // frame 밖 기본 블리드(배경 manifest에 bleedFill이 없을 때)
// 특수 잼 조합(comboActivate)은 전용 소리가 아직 없다 - 섞인 두 종류의 소리를 같이 낸다
// (assets/sfx/README.md "특수 보석끼리 조합은 ... 두 소리를 같이 재생").
const COMBO_SFX = { line: 'line_fire', bomb: 'bomb_explode', box: 'box_open', color: 'color_burst' };
// 연쇄 몇 단계에서 combo_great를 들려줄지(README "연쇄 5단계 이상 도달 시 1번").
const COMBO_GREAT_CASCADE = 5;

// assets/effects/manifest.json 애니메이션 하나의 프레임 번호를 ageMs로 찾는다.
// frameMs는 숫자(고정 길이, box_soul/color_wisp처럼 loop:true) 또는 배열(프레임마다
// 다른 길이)일 수 있다(README 참고). loop가 아닌데 ageMs가 전체 길이를 넘으면 -1(끝남).
// audioCues는 at(ms) 오름차순이어야 _advanceAndDrawSpecialFx가 앞에서부터 하나씩 꺼내 쓸 수 있다
// (affected 칸 순서는 거리순이 아니다).
function sortCues(cues) {
  return cues.sort((a, b) => a.at - b.at);
}

function effectFrameIndex(anim, ageMs) {
  const { frames, frameMs, loop } = anim;
  if (typeof frameMs === 'number') {
    if (loop) return Math.floor(ageMs / frameMs) % frames;
    const f = Math.floor(ageMs / frameMs);
    return f < frames ? f : -1;
  }
  let total = 0;
  for (const m of frameMs) total += m;
  let tMs = ageMs;
  if (loop) tMs = ((ageMs % total) + total) % total;
  else if (ageMs >= total) return -1;
  let acc = 0;
  for (let f = 0; f < frames; f++) {
    acc += frameMs[f];
    if (tMs < acc) return f;
  }
  return frames - 1;
}

// Canvas 2D에 전투 패널 + 퍼즐 보드를 그린다. 입력 모듈은 lastLayout.board를 읽어
// 화면 좌표 -> 보드 좌표 변환에 사용한다.
export class CanvasRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cssWidth = 0;
    this.cssHeight = 0;
    this.lastLayout = null;

    // setAssets()로 주입되기 전까지는 null - render()는 이 상태에서도 전부 색/도형
    // fallback으로 그려야 한다.
    this.assets = null;

    this._particles = new ParticlePool(DEFAULT_MAX_PARTICLES);
    this._battleRenderer = new BattleRenderer();
    // 젬 기술 이펙트가 같은 파티클 풀과 화면 흔들림을 쓴다(풀은 setAssets에서 바뀔 수 있어 거기서도 다시 꽂음).
    this._battleRenderer.particles = this._particles;
    this._battleRenderer.shake = (amount, ms) => this._triggerShake(amount, ms);
    // gameState.effects 항목(객체 참조) 단위로 "이미 한 번 처리했는지"를 기억한다. WeakSet이라
    // 그 effect 객체가 gameState.effects에서 빠져 더 이상 참조되지 않으면 자동으로 사라진다
    // (별도 정리 코드 불필요).
    this._seenEffects = new WeakSet();

    this._shakeAmount = 0;
    this._shakeTotalMs = 0;
    this._shakeRemainingMs = 0;
    this._shakeX = 0;
    this._shakeY = 0;

    // 히트스톱(§2) - 큰 조합(comboActivate) 적중 시 화면만 잠깐 멈춘다. render() 최상단에서
    // 실시간 경과로 감쇠시키고, 남아있으면 그리기 자체를 건너뛴다(이전 프레임이 그대로 남음).
    this._hitstopRemainingMs = 0;
    this._lastHitstopCheckMs = null;

    // 낙하 착지 스쿼시(§11) - 렌더 전용 임시 상태. 키: `${row},${col}`. 항상
    // Animator.getNewlySettledCells()로 매 프레임 다시 유도되므로 프레임이 드롭돼도
    // 보드와 어긋나지 않는다.
    this._landingSquashes = new Map();

    // 박스 잼 체인 라이트닝(§9) - source->target 지그재그 점 캐시(70ms마다 재계산). 매 프레임
    // 새 배열을 만들지 않도록 points는 flat [x0,y0,x1,y1,...] 배열을 재사용한다.

    // 폭탄 충격파(§3) 대상 effect 참조만 담는 재사용 배열(소스=gameState.effects 항목 그대로).
    this._shockwaveSources = [];
    this._shockwaveScratch = { x: 0, y: 0 };

    // 콤보 마일스톤/브레이크 배너 - 렌더 전용 임시 상태(gameState에 넣지 않는다, §10).
    this._comboMilestone = null; // { label, elapsedMs }

    // combo_great / timebomb_tick 판정용 - core에 전용 effect가 없는 소리들이라 렌더에서
    // 직전 값과 비교해 "변한 순간"을 찾는다(퍼즐 로직은 건드리지 않는다).
    this._prevCascadeCount = 0;
    this._bombTimers = new Map(); // 보드 인덱스 -> 지난 프레임의 timeBomb timer
    this._bombBoard = null;

    // 퍼즐에서 잼이 터진 위치 -> 같은 색 탑으로 날아가는 빛줄기. 발생이 드물고(잼 제거
    // 시점에만) 수명이 짧아 풀 없이 일반 배열로 충분하다(이벤트 배열들과 같은 관례).
    this._puzzleBeams = [];

    // 방해요소(상자/돌/시한폭탄) 부서짐·폭발 스프라이트 애니메이션 - _puzzleBeams와 같은
    // "활성 항목 배열 + 매 프레임 진행/정리" 패턴. _obstacleCellAnims는 보드 칸 범위(클립 안,
    // crate_break/stone_hit/stone_break/time_bomb_explode), _obstacleBombFlights는 칸 밖
    // 전투 화면까지 날아가는 볼트/벽 히트(time_bomb_bolt/wall_hit) 단계.
    this._obstacleCellAnims = [];
    this._obstacleBombFlights = [];

    // 잼 터짐 이펙트(assets/effects) - _obstacleCellAnims와 같은 "활성 항목 배열 + 매 프레임
    // 진행/정리" 패턴이지만, core의 specialActivate effect(수명 280ms)보다 스프라이트 재생이
    // 더 오래갈 수 있어(README 점4) 자체 ageMs 타이머로 core effect와 독립적으로 재생한다.
    // _specialFxReserved: 지금 specialFx가 담당 중인 칸(`row,col`) - getNewlyClearingCells가
    // 이 칸들에 대해 또 일반 pop을 중복으로 띄우지 않도록 막는다.
    this._specialFx = [];
    this._simplePops = [];
    this._specialFxReserved = new Set();
    // 변환형 조합(라인+컬러 등)의 연쇄 발동을 리드인+캐리어가 끝날 때까지 통째로 늦추기 위한
    // { cells: Set<"r,c">, delayMs }. 해당 칸의 specialActivate가 올 때 하나씩 소모된다.
    // shortcut: 그 발동이 끝내 오지 않으면 항목이 남는다 - 다음 조합이 통째로 덮어쓴다.
    this._comboChainDelay = null;
    this._boltCanvas = null;
    this._boltCtx = null;

    this._lastFrameTime = null;

    // 셔플 연출(§셔플 애니메이션) - 2단계 시작/끝 사운드 훅은 elapsedMs 경계를 지켜봐야 해서
    // _seenEffects의 "처음 봤을 때 1번"으로는 못 낸다. effect 객체 참조를 키로 "scatter를
    // 이미 냈는지"만 들고 있다가, 다음 프레임에 그 effect가 gameState.effects에서 더 이상
    // 안 보이면(= durationMs를 넘어 제거됨) 그 순간 shuffleSettle을 낸다.
    this._shuffleAudioMarks = new Map();

    // 하단 아이템 바/조준(docs/items.md). itemAssets = { icons: Map<id, imgState>, hit: imgState }.
    this.itemBar = new ItemBarRenderer();
    this.itemAssets = null;
    this._itemFx = []; // 망치 번쩍 / 낫 세그먼트 - { kind, cells, ageMs }
    this._boardFloats = []; // 보드 위 데미지 폰트 숫자(해제 부적 "+5") - { row, col, text, variant, ageMs }
    this._bombBounce = new Map(); // "row,col" -> ageMs - 시한폭탄 타이머 숫자 튕김(해제 부적)
    this.tutorial = new TutorialRenderer(); // 에셋은 main.js가 load()
  }

  // 튜토리얼 대상 이름 -> 지금 레이아웃의 화면 rect(docs/tutorial.md 2장). render() 뒤에만 유효.
  getUiRect(name) {
    const L = this.lastLayout;
    if (!L) return null;
    const b = L.battleParts;
    switch (name) {
      case 'currencyBar': return L.currencyBar;
      case 'floorBox': return b?.floorLabel ?? null;
      case 'itemBar': return L.actionBar;
      case 'topRightButton': return L.skipButton ?? b?.pauseButton ?? null;
      case 'battlePanel': return L.battle;
      case 'wallGauge': return b?.wallBar ?? null;
      case 'statues': return b?.towerArea ?? null;
      case 'board': return L.board;
      default: return null;
    }
  }

  // 게임 화면(render) 위에 튜토리얼 오버레이 - 건너뛰기 버튼 rect를 먼저 정해 topRightButton 대상으로도 쓴다.
  drawTutorial(tut, now) {
    if (!this.lastLayout) return;
    this.lastLayout.skipButton = this.tutorial.layoutSkip(this.ctx, this.lastLayout.battleParts?.pauseButton);
    this.tutorial.draw(this.ctx, this, tut, now);
  }

  setItemAssets(itemAssets) {
    this.itemAssets = itemAssets;
  }

  // assetLoader.loadAssets()의 결과를 주입한다. 호출 전에는 this.assets가 null이라
  // 전부 fallback 도형으로 그려진다.
  setAssets(assets) {
    this.assets = assets;
    const maxParticles = assets?.effectsConfig?.settings?.maxParticles ?? DEFAULT_MAX_PARTICLES;
    if (maxParticles !== this._particles.particles.length) {
      this._particles = new ParticlePool(maxParticles);
      this._battleRenderer.particles = this._particles;
    }
  }

  // screenFit.computeScreenFit() 결과를 받는다. 캔버스 = 화면 전체(full), ctx 원점 = frame 왼쪽 위(정수 기기 px),
  // 좌표계 = frame 논리 360x640(1 = frame.unit 기기 px). cssWidth/cssHeight는 이름만 남은 논리 크기(항상 360x640).
  // 각 화면은 이 크기만 보고 그린다 - frame 밖은 drawBleed()가 채운다.
  resize(fit) {
    this.fit = fit;
    this.cssWidth = FRAME_LOGICAL_W;
    this.cssHeight = FRAME_LOGICAL_H;
    const { unit, x, y } = fit.frame;
    screen.unit = unit;
    Object.assign(screen.full, { x: -x / unit, y: -y / unit, width: fit.full.w / unit, height: fit.full.h / unit });
    if (this.canvas.width !== fit.full.w) this.canvas.width = fit.full.w;
    if (this.canvas.height !== fit.full.h) this.canvas.height = fit.full.h;
    this.ctx.setTransform(unit, 0, 0, unit, x, y);
  }

  // 매 프레임 맨 먼저 - 캔버스 전체(frame 밖 블리드 포함)를 단색으로. 그림 블리드는 각 배경(LayeredBg)이 그 위에 그린다.
  drawBleed(fill = BLEED_FILL) {
    const { ctx, fit } = this;
    if (!fit) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, fit.full.w, fit.full.h);
    ctx.restore();
  }

  // 타이틀 화면(titleScreen.js) - ctx/css 크기만 공유하고 그리기는 TitleScreen이 직접 한다.
  drawTitle(titleScreen, now, dtMs) {
    const { ctx, cssWidth: width, cssHeight: height } = this;
    this.drawBleed(titleScreen.bg.bleedFill);
    titleScreen.draw(ctx, width, height, dtMs, now);
  }

  // 메인 메뉴(mainMenuScreen.js) - ctx/css 크기만 공유하고 그리기는 MainMenuScreen이 직접 한다.
  // alpha < 1이면 타이틀 문 열림 전환 위로 겹쳐지는 크로스페이드다(titleScreen.menuFadeAlpha).
  // 전투 scene 위에 메뉴의 종료 확인 모달만(뒤로가기 - 정비 팝업에서).
  drawMenuPopup(mainMenuScreen) {
    mainMenuScreen.drawPopupOnly(this.ctx, this.cssWidth, this.cssHeight, this.assets);
  }

  drawMainMenu(mainMenuScreen, playerState, now, alpha = 1) {
    const { ctx, cssWidth: width, cssHeight: height } = this;
    if (alpha >= 1) {
      this.drawBleed(mainMenuScreen.bgLayers.bleedFill);
      mainMenuScreen.draw(ctx, width, height, playerState, now, this.assets);
      return;
    }
    ctx.save();
    ctx.globalAlpha = alpha;
    mainMenuScreen.draw(ctx, width, height, playerState, now, this.assets);
    ctx.restore();
  }

  // 상점 scene(shopScreen.js) - 메인 메뉴처럼 ctx/css 크기만 공유하고 그리기는 ShopScreen이 직접 한다.
  drawShop(shopScreen, now) {
    const { ctx, cssWidth: width, cssHeight: height } = this;
    this.drawBleed();
    shopScreen.draw(ctx, width, height, now, this.assets);
  }

  // 화면 전환용 검은 오버레이(alpha 0~1) - 어떤 scene을 그린 뒤든 그 위에 덮는다.
  drawFadeOverlay(alpha) {
    const { ctx, cssWidth: width, cssHeight: height } = this;
    if (alpha <= 0 || width === 0 || height === 0) return;
    ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, alpha)})`;
    const F = screen.full; // 블리드까지 덮는다.
    ctx.fillRect(F.x, F.y, F.width, F.height);
  }

  // itemUi = { items(ItemController), config(items.json), equipped, counts, aim } | null(아이템 기능 없음).
  render(gameState, animator, battleState, hintCell = null, playerState = null, paused = false, battleHud = null, clearReward = null, prepOpen = false, itemUi = null) {
    const { ctx, cssWidth: width, cssHeight: height } = this;
    if (width === 0 || height === 0) return;

    const now = performance.now();

    // 히트스톱(§2) - 화면만 멈춘다. gameState.update(dt)는 main.js 루프가 render()와
    // 무관하게 계속 호출하므로 로직 시간은 저절로 안 멈춘다 - 여기서 그리기만 건너뛴다.
    if (this._hitstopRemainingMs > 0) {
      const elapsed = this._lastHitstopCheckMs == null ? 0 : now - this._lastHitstopCheckMs;
      this._hitstopRemainingMs -= elapsed;
      this._lastHitstopCheckMs = now;
      if (this._hitstopRemainingMs > 0) return;
    } else {
      this._lastHitstopCheckMs = now;
    }

    const dtMs = this._lastFrameTime == null ? 16 : Math.min(64, now - this._lastFrameTime);
    this._lastFrameTime = now;

    this.drawBleed(); // 히트스톱 중엔 위에서 return - 이전 프레임이 그대로 남는다.

    const { board } = gameState;
    const layout = computeLayout(width, height, board.rows, board.cols);
    this.lastLayout = layout;

    const battleLayout = battleState ? this._battleRenderer.getLayout(layout.battle) : null;

    this._collectNewEffects(gameState, animator, layout.board);
    this._advanceShuffleAudio(gameState);
    this._collectNewBattleEffects(battleState, battleLayout);
    this._particles.update(dtMs);
    this._updateShake(dtMs, now);
    this._advanceComboBanners(dtMs);

    // 낙하 착지 스쿼시(§11) - 먼저 기존 항목을 늙히고, 그다음 "방금 settle된" 칸을 0ms로
    // 새로 등록한다(gameState._advanceEffects와 같은 순서 - 신규 항목이 이번 틱에 같이
    // 늙지 않도록).
    this._advanceLandingSquashes(dtMs);
    const newlySettled = animator.getNewlySettledCells(board);
    for (const cell of newlySettled) {
      this._landingSquashes.set(`${cell.row},${cell.col}`, { elapsedMs: 0 });
    }
    // 착지음은 같은 프레임에 여러 열이 멈춰도 1번(열마다 1번 + manifest minGapMs 40ms).
    if (newlySettled.length > 0) audio.play('gem_land');

    const shockwaveSources = this._collectShockwaveSources(gameState);

    ctx.save();
    ctx.translate(snapPx(this._shakeX), snapPx(this._shakeY));

    this._drawCurrencyBar(layout.currencyBar, playerState, itemUi?.goldMul ?? 1);
    this._drawBattlePanel(layout.battle);
    if (battleState) {
      this._battleRenderer.draw(ctx, layout.battle, battleState, now, this.assets, battleHud, paused, this.itemAssets?.icons);
      // 같은 풀을 전투 영역으로 잘라 한 번 더 그린다(보드 쪽은 _drawBoard가 보드로 잘라 그림).
      // settings.boardParticlesOverBattle=false면 퍼즐 파편은 빼고 전투 파티클만.
      ctx.save();
      ctx.beginPath();
      ctx.rect(layout.battle.x, layout.battle.y, layout.battle.width, layout.battle.height);
      ctx.clip();
      this._particles.draw(ctx, this.assets?.effectsConfig?.settings?.boardParticlesOverBattle === false);
      ctx.restore();
    }
    this.lastLayout.pauseButton = battleLayout?.pauseButton ?? null;
    this.lastLayout.battleParts = battleLayout;
    this.lastLayout.battle = battleLayout ? { ...layout.battle, towerArea: battleLayout.towerArea } : null;
    this._drawBoard(
      layout.board,
      animator.getDisplayList(board, gameState, this.assets?.effectsConfig),
      animator.getObstacleDisplayList(board),
      animator.getEffects(gameState, this.assets?.effectsConfig),
      shockwaveSources,
      now,
      dtMs,
      hintCell,
      gameState.effects.find((e) => e.type === 'shuffle')
    );
    this._drawScoreBar(layout.scoreBar, gameState);
    this._advanceAndDrawItemFx(layout.board, gameState.board, dtMs);
    if (itemUi?.items) this.itemBar.drawBoardOverlay(ctx, layout.board, layout.scoreBar, itemUi, itemUi.config.items, now);
    this._advanceAndDrawBoardFloats(layout.board, dtMs);
    // 염료 색 고르기 - 칸을 고른 뒤 그 옆에 5색 팔레트(main.js가 lastLayout.dyePalette로 탭 판정).
    const dyeAim = itemUi?.aim?.first && itemUi.config.items[itemUi.aim.id]?.action === 'recolor' ? itemUi.aim : null;
    this.lastLayout.dyePalette = dyeAim
      ? this.itemBar.drawDyePalette(ctx, this.assets, layout.board, dyeAim.first, GEM_TYPES.length, (value, x, y, s) => this._drawGem({ value, special: null, row: -1, col: -1 }, x, y, s, now))
      : null;
    this._advanceAndDrawPuzzleBeams(ctx, layout.board, battleLayout, battleState, dtMs);
    // 시한폭탄 폭발 후 성벽으로 날아가는 볼트/벽 히트 - 보드 클립 밖(전투 영역)까지 이동하므로
    // _drawBoard 밖(퍼즐->탑 빔과 같은 레이어)에서 그린다.
    this._advanceAndDrawObstacleBombFlights(ctx, layout.board, battleLayout, dtMs);
    if (itemUi?.items) {
      this._drawPanelIron(layout.actionBar);
      this.lastLayout.itemSlots = this.itemBar.drawBar(ctx, layout.actionBar, this.assets, this.itemAssets?.icons, itemUi, now);
    } else {
      this._drawActionBar(layout.actionBar);
      this.lastLayout.itemSlots = null;
    }

    ctx.restore();

    // 팝업(일시정지/승리/패배/탑 강화)은 화면 흔들림 영향을 받지 않도록 shake translate 밖에서 그린다.
    this._drawPopup(width, height, battleState, paused, clearReward, prepOpen, itemUi);
  }

  // 전투 영역 화면 좌표가 탑 위면 그 인덱스, 아니면 null. main.js가 pointerdown에서 보드
  // 드래그/팝업 버튼과 겹치지 않을 때만 호출한다.
  hitTestTower(x, y, battleState) {
    const battleLayout = this.lastLayout?.battle;
    if (!battleLayout || !battleState) return null;
    return this._battleRenderer.hitTestTower(battleLayout.towerArea, battleState.towers ?? [], this.assets, x, y);
  }

  triggerTowerTapFx(towerId, success, newLevel) {
    this._battleRenderer.triggerTowerTapFx(towerId, success, performance.now(), newLevel);
  }

  // 하단 스킬/아이템 바 공간. 실제 스킬/아이템 시스템은 아직 기획에 없어 빈 슬롯만 그린다.
  _drawActionBar(rect) {
    const { ctx } = this;
    this._drawPanelIron(rect);

    const slotCount = 4;
    const slotGap = rect.height * 0.15;
    const slotSize = rect.height - slotGap * 2;
    const totalSlotsWidth = slotCount * slotSize + (slotCount - 1) * slotGap;
    const startX = rect.x + (rect.width - totalSlotsWidth) / 2;
    const y = rect.y + slotGap;

    const path = 'items/slot_normal.png';
    const state = getUi(this.assets, path);
    const ready = uiReady(state);

    if (ready) ctx.save();
    if (ready) ctx.imageSmoothingEnabled = false;
    for (let i = 0; i < slotCount; i++) {
      const x = startX + i * (slotSize + slotGap);
      if (ready) {
        drawImageSnapped(ctx, state.img, x, y, slotSize, slotSize);
      } else {
        ctx.fillStyle = '#272c3a';
        ctx.strokeStyle = '#4a5265';
        ctx.lineWidth = 1.5;
        ctx.fillRect(x, y, slotSize, slotSize);
        ctx.strokeRect(x, y, slotSize, slotSize);
      }
    }
    if (ready) ctx.restore();
  }

  // 퍼즐 보드의 (row,col) 위치 -> 같은 색 탑으로 날아가는 빛줄기를 새로 하나 스폰한다.
  // src/game/puzzleBattleBridge.js가 잼이 터질 때마다 호출한다(렌더는 이 호출 시점엔 아무것도
  // 그리지 않고, 다음 render() 프레임에서 현재 레이아웃 기준으로 위치를 계산해 그린다).
  spawnPuzzleToTowerBeam({ color, row, col }) {
    this._puzzleBeams.push({ color, row, col, elapsedMs: 0 });
  }

  _drawBattlePanel(rect) {
    this._drawPanelIron(rect);
  }

  // panels/panel_iron(9-slice) - 재화 바 아래 패널들(전투 패널/하단 아이템 바)이 공유하는
  // 배경. 이미지가 없으면 기존 색 사각형으로 폴백한다.
  _drawPanelIron(rect) {
    const { ctx } = this;
    const path = 'panels/panel_iron.png';
    const state = getUi(this.assets, path);
    const meta = getUiMeta(this.assets, path);
    if (uiReady(state) && meta?.slice) {
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      drawNine(ctx, state.img, meta.slice, rect.x, rect.y, snap(rect.width), snap(rect.height));
      ctx.restore();
      return;
    }
    ctx.fillStyle = '#1b1f2a';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = '#3a4150';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  }

  _drawBoard(rect, displayList, obstacleList, effects, shockwaveSources, nowMs, dtMs, hintCell, shuffleFx) {
    const { ctx } = this;
    ctx.fillStyle = '#0d0f14';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    const { cellSize, rows, cols } = rect;

    // 보드 영역 밖(위쪽 전투 화면 등)으로는 아무 것도 새지 않게 클립한다 - 스폰 낙하가
    // 보드 위 칸에서 시작할 때 전투 화면 쪽으로 비어져 보이는 문제 방지.
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    const tileA = getUi(this.assets, 'board/tile_a.png');
    const tileB = getUi(this.assets, 'board/tile_b.png');
    const tilesReady = uiReady(tileA) && uiReady(tileB);
    if (tilesReady) ctx.save();
    if (tilesReady) ctx.imageSmoothingEnabled = false;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const x = rect.x + c * cellSize;
        const y = rect.y + r * cellSize;
        if (tilesReady) {
          const tile = (r + c) % 2 === 0 ? tileA : tileB;
          drawImageSnapped(ctx, tile.img, 0, 0, tile.img.width, tile.img.height, x, y, cellSize, cellSize);
        } else {
          ctx.fillStyle = (r + c) % 2 === 0 ? '#181c25' : '#141720';
          ctx.fillRect(x, y, cellSize, cellSize);
        }
      }
    }
    if (tilesReady) ctx.restore();

    this._drawEffects(rect, effects);

    const shockwaveCfg = this.assets?.effectsConfig?.shockwave;
    // 특수 잼은 일반 잼보다 나중에 그린다 - 특수 잼 이미지의 효과(균열 끝, 불꽃 등)는 8px
    // 여백으로 옆 칸까지 번지는데, 먼저 그리면 그 위를 옆 칸의 일반 잼이 덮어버린다(README 참고).
    const normalItems = [];
    const specialItems = [];
    for (const item of displayList) {
      // 발동 스프라이트가 담당 중인 armed 칸은 fx에게 맡긴다 - core의 armed 간격과 manifest의
      // 명중 간격이 달라서(예: 박스 boxStepMs 150 vs box_box 50) fx가 이미 터뜨린 칸을 core가
      // 아직 지우지 않았을 때 "터진 잼이 다시 보이는" 걸 막는다. 터지기 전까지는 fx가
      // _drawFrozenGemAt으로 같은 잼을 그려준다(README 점4).
      if (item.armed && this._specialFxReserved.has(`${item.row},${item.col}`)) continue;
      (item.special ? specialItems : normalItems).push(item);
    }
    for (const item of normalItems) this._drawDisplayItem(rect, item, shockwaveSources, shockwaveCfg, nowMs, hintCell);
    for (const item of specialItems) this._drawDisplayItem(rect, item, shockwaveSources, shockwaveCfg, nowMs, hintCell);

    // 잼 터짐 이펙트(assets/effects) - 일반 pop + line/bomb/box/color 발동 스프라이트.
    // 잼을 그린 바로 다음(README "이펙트는 잼보다 나중에").
    this._advanceAndDrawSpecialFx(rect, dtMs, nowMs);

    // occupant(상자·돌) - 잼 다음에 그린다(assets/obstacles/README.md "순서(권장)").
    this._drawOccupants(rect, obstacleList);
    // 시한폭탄 오버레이 + 남은 횟수 숫자 - occupant 다음.
    this._drawTimeBombOverlays(rect, displayList, nowMs);

    this._particles.draw(ctx);

    // 방해요소 부서짐/폭발(칸 범위 한정 - crate_break/stone_hit/stone_break/time_bomb_explode) -
    // README 순서상 가장 마지막.
    this._advanceAndDrawObstacleCellAnims(rect, dtMs);

    if (shuffleFx) this._drawShuffleText(rect, shuffleFx);

    ctx.restore();
    this._drawBoardFrame(rect);
  }

  // panels/board_frame(9-slice, 가운데 투명) - 보드 바깥으로 5px(원본 px) 크게 그려
  // 보드 테두리를 감싼다(README).
  _drawBoardFrame(rect) {
    const { ctx } = this;
    const path = 'panels/board_frame.png';
    const state = getUi(this.assets, path);
    const meta = getUiMeta(this.assets, path);
    if (uiReady(state) && meta?.slice) {
      const margin = 5 * 2; // 원본 5px x 2배
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      drawNine(
        ctx,
        state.img,
        meta.slice,
        rect.x - margin,
        rect.y - margin,
        snap(rect.width + margin * 2),
        snap(rect.height + margin * 2)
      );
      ctx.restore();
      return;
    }
    ctx.strokeStyle = '#3a4150';
    ctx.lineWidth = 2;
    ctx.strokeRect(rect.x + 1, rect.y + 1, rect.width - 2, rect.height - 2);
  }


  // ------------------------------------------------------------
  // 퍼즐 방해요소(상자/돌/시한폭탄) - assets/obstacles/README.md 규격(잼과 동일: 48px 이미지,
  // 몸통 32px, 칸 중심에 cellSize/bodySize 배율로 그린다). 로직은 src/core/obstacles에 있고,
  // 여기서는 board.occupants/attachments(Animator가 노출한 displayList/obstacleList)를
  // 읽어 표현만 한다.
  // ------------------------------------------------------------

  // 48px 방해요소 이미지 1장을 칸 중심에 그린다(occupant 정지 이미지, hp별 이미지 공용).
  // 이미지가 없거나 로드 실패면 false를 돌려줘 호출부가 도형 폴백을 그리게 한다.
  _drawObstacleCellImage(rect, key, row, col) {
    const state = this.assets?.obstacleImages?.get(key);
    if (!state?.loaded || state.failed) return false;
    const { ctx } = this;
    const { cellSize } = rect;
    const tileSize = this.assets?.obstacleTileSize ?? 48;
    const bodySize = this.assets?.obstacleBodySize ?? 32;
    const imageSize = tileSize * (cellSize / bodySize);
    const cx = rect.x + (col + 0.5) * cellSize;
    const cy = rect.y + (row + 0.5) * cellSize;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    drawImageSnapped(ctx, state.img, cx - imageSize / 2, cy - imageSize / 2, imageSize, imageSize);
    ctx.restore();
    return true;
  }

  // 방해요소 스프라이트 시트 한 프레임을 칸 중심에 그린다(occupant 이미지와 같은 좌표 변환).
  // loop=false면 마지막 프레임에서 멈춘다(gemAnim과 달리 재생이 끝나면 호출부가 목록에서 치운다).
  _drawObstacleCellSprite(rect, anim, elapsedMs, row, col, loop = false) {
    if (!anim?.state?.loaded || anim.state.failed) return;
    const { ctx } = this;
    const { cellSize } = rect;
    const tileSize = this.assets?.obstacleTileSize ?? 48;
    const bodySize = this.assets?.obstacleBodySize ?? 32;
    const imageSize = tileSize * (cellSize / bodySize);
    const cx = rect.x + (col + 0.5) * cellSize;
    const cy = rect.y + (row + 0.5) * cellSize;
    const frame = loop
      ? Math.floor(elapsedMs / anim.frameMs) % anim.frames
      : Math.min(anim.frames - 1, Math.floor(elapsedMs / anim.frameMs));
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    drawImageSnapped(ctx, anim.state.img, frame * anim.frameW, 0, anim.frameW, anim.frameH, cx - imageSize / 2, cy - imageSize / 2, imageSize, imageSize);
    ctx.restore();
  }

  // occupant(상자/돌) - Animator.getObstacleDisplayList()가 돌려준 { row, col, occupant }
  // 목록을 그린다. 종류별 이미지는 manifest.obstacles[type]에서 읽는다(hpImages가 있으면
  // hp별, 없으면 단일 image) - 새 방해요소가 추가돼도 타입 이름으로 분기하지 않는다.
  _drawOccupants(rect, obstacleList) {
    if (!obstacleList || obstacleList.length === 0) return;
    const obstacleTypes = this.assets?.obstacleManifest?.obstacles ?? {};
    for (const item of obstacleList) {
      const { occupant, row, col } = item;
      if (!occupant) continue;
      const cfg = obstacleTypes[occupant.type];
      let imageKey = null;
      if (cfg?.hpImages) imageKey = `${occupant.type}_hp${occupant.hp}`;
      else if (cfg?.image) imageKey = occupant.type;
      const drawn = imageKey ? this._drawObstacleCellImage(rect, imageKey, row, col) : false;
      if (!drawn) this._drawOccupantFallback(rect, occupant, row, col);
    }
  }

  // occupant 이미지가 없을 때의 임시 도형 - 나무상자(crate)=갈색 사각형+X, 돌덩이(stone)=회색
  // 다각형(hp 1이면 금 간 선 추가). 알려지지 않은 새 방해요소는 중립 회색 사각형만 그려
  // 크래시 없이 안전하게 넘어간다(id로 그리기 여부 자체를 분기하지 않는다 - 위 _drawOccupants가
  // "이미지가 없으면" 호출하는 것 하나로 모든 경우를 덮는다).
  _drawOccupantFallback(rect, occupant, row, col) {
    const { ctx } = this;
    const { cellSize } = rect;
    const cx = rect.x + (col + 0.5) * cellSize;
    const cy = rect.y + (row + 0.5) * cellSize;
    const size = cellSize * 0.64;
    ctx.save();
    if (occupant.type === 'crate') {
      ctx.fillStyle = '#8a5a2b';
      ctx.strokeStyle = '#5c3a1a';
      ctx.lineWidth = Math.max(2, size * 0.08);
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
      ctx.beginPath();
      ctx.moveTo(cx - size / 2, cy - size / 2);
      ctx.lineTo(cx + size / 2, cy + size / 2);
      ctx.moveTo(cx + size / 2, cy - size / 2);
      ctx.lineTo(cx - size / 2, cy + size / 2);
      ctx.stroke();
    } else if (occupant.type === 'stone') {
      const r = size / 2;
      ctx.fillStyle = '#7d828a';
      ctx.strokeStyle = '#4b4f56';
      ctx.lineWidth = Math.max(2, size * 0.08);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const px = cx + Math.cos(a) * r;
        const py = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (occupant.hp <= 1) {
        ctx.strokeStyle = '#2a2d31';
        ctx.lineWidth = Math.max(1, size * 0.05);
        ctx.beginPath();
        ctx.moveTo(cx - r * 0.5, cy - r * 0.4);
        ctx.lineTo(cx, cy);
        ctx.lineTo(cx - r * 0.2, cy + r * 0.5);
        ctx.stroke();
      }
    } else {
      ctx.fillStyle = '#555b66';
      ctx.strokeStyle = '#2f3339';
      ctx.lineWidth = Math.max(2, size * 0.08);
      ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
      ctx.strokeRect(cx - size / 2, cy - size / 2, size, size);
    }
    ctx.restore();
  }

  // 시한폭탄 오버레이(심지 불꽃 idle/warn 루프) + 남은 횟수 숫자 - displayList(잼) 중
  // item.attachment?.type === 'timeBomb'인 칸 위에 그린다.
  _drawTimeBombOverlays(rect, displayList, nowMs) {
    for (const item of displayList) {
      if (item.attachment?.type === 'timeBomb') this._drawTimeBombOverlay(rect, item.row, item.col, item.attachment, nowMs);
    }
  }

  _drawTimeBombOverlay(rect, row, col, attachment, nowMs) {
    const cfg = this.assets?.obstacleManifest?.obstacles?.timeBomb ?? {};
    const warnAt = cfg.warnAt ?? 2;
    const warn = attachment.timer <= warnAt;
    const animKey = warn ? (cfg.warn ?? 'time_bomb_warn') : (cfg.idle ?? 'time_bomb_idle');
    const anim = this.assets?.obstacleAnims?.get(animKey);
    if (anim?.state?.loaded && !anim.state.failed) {
      // 같은 프레임이 한꺼번에 깜빡이지 않도록 칸 기반 고정 오프셋(§_cellAnimOffset, 잼 idle과 동일).
      const offset = this._cellAnimOffset(row, col);
      this._drawObstacleCellSprite(rect, anim, nowMs + offset, row, col, true);
    } else {
      this._drawTimeBombOverlayFallback(rect, row, col, warn);
    }
    this._drawTimeBombDigits(rect, row, col, attachment.timer, warn, cfg.digits);
  }

  // 오버레이 이미지가 없을 때의 임시 도형 - 경고 여부에 따라 색만 다른 얇은 원형 테두리.
  _drawTimeBombOverlayFallback(rect, row, col, warn) {
    const { ctx } = this;
    const { cellSize } = rect;
    const cx = rect.x + (col + 0.5) * cellSize;
    const cy = rect.y + (row + 0.5) * cellSize;
    ctx.save();
    ctx.strokeStyle = warn ? '#ff4d4d' : '#ffb86b';
    ctx.lineWidth = Math.max(2, cellSize * 0.08);
    ctx.beginPath();
    ctx.arc(cx, cy, cellSize * 0.4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // README "시한폭탄 숫자 그리기" 그대로 - 48px 프레임 좌표 digits.center를 칸 실제 배율
  // (cellSize/bodySize - 반응형, README의 고정 drawScale=2 대신)로 환산해 그린다. 두 자리면
  // 글리프 4px 간격으로 겹쳐 그린다(외곽선 1px 공유). 숫자는 항상 코드로 그린다(프로젝트 관례).
  _drawTimeBombDigits(rect, row, col, timer, warn, digitsCfg) {
    if (!digitsCfg) return;
    const state = this.assets?.obstacleImages?.get('timeBomb_digits');
    if (!state?.loaded || state.failed) return;
    const { ctx } = this;
    const { cellSize } = rect;
    const tileSize = this.assets?.obstacleTileSize ?? 48;
    const bodySize = this.assets?.obstacleBodySize ?? 32;
    const s = cellSize / bodySize;
    const cx = rect.x + (col + 0.5) * cellSize;
    const cy = rect.y + (row + 0.5) * cellSize;
    const text = String(Math.max(0, timer));
    const rowIdx = warn ? (digitsCfg.rows?.warn ?? 1) : (digitsCfg.rows?.normal ?? 0);
    const glyphW = digitsCfg.glyphW ?? 5;
    const glyphH = digitsCfg.glyphH ?? 7;
    const [centerX, centerY] = digitsCfg.center ?? [34, 14];
    const half = tileSize / 2;
    const w = glyphW + (text.length - 1) * 4;
    const ox = cx - half * s + (centerX - Math.floor(w / 2)) * s;
    // 해제 부적 직후 한 번 튕김(위로 최대 3px x s, BOMB_BOUNCE_MS 동안 sin).
    const bounceAge = this._bombBounce.get(`${row},${col}`);
    const bounce = bounceAge != null ? Math.round(Math.sin(Math.min(1, bounceAge / BOMB_BOUNCE_MS) * Math.PI) * 3 * s) : 0;
    const oy = cy - half * s + (centerY - Math.floor(glyphH / 2)) * s - bounce;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    [...text].forEach((ch, i) => {
      drawImageSnapped(ctx, state.img, Number(ch) * glyphW, rowIdx * glyphH, glyphW, glyphH, ox + i * 4 * s, oy, glyphW * s, glyphH * s);
    });
    ctx.restore();
  }

  // gameState.effects에 새로 나타난 obstacleDamaged/obstacleDestroyed/obstacleExpire를
  // 재생할 스프라이트 애니메이션으로 큐에 넣는다(_collectNewEffects가 호출). 매칭되는 애니메이션이
  // 없는 경우(timeBomb의 gemCleared 해제, 혹은 이름이 생소한 미래의 새 방해요소)는 조용히
  // 아무것도 하지 않는다 - id로 분기가 실패해도 크래시하지 않는다.
  _spawnObstacleFx(effect) {
    const cell = effect.cell;
    if (!cell) return;
    if (effect.type === 'obstacleDamaged') {
      if (effect.id === 'stone' && effect.hp === 1) {
        this._obstacleCellAnims.push({ animKey: 'stone_hit', baseImageKey: 'stone_hp1', row: cell.row, col: cell.col, elapsedMs: 0 });
      }
    } else if (effect.type === 'obstacleDestroyed') {
      if (effect.id === 'crate') {
        this._obstacleCellAnims.push({ animKey: 'crate_break', baseImageKey: null, row: cell.row, col: cell.col, elapsedMs: 0 });
      } else if (effect.id === 'stone') {
        this._obstacleCellAnims.push({ animKey: 'stone_break', baseImageKey: null, row: cell.row, col: cell.col, elapsedMs: 0 });
      }
      // id === 'timeBomb'(cause: 'gemCleared') 등 그 외 - 조용히 사라짐, 애니메이션 없음
      // (폭발 연출은 obstacleExpire 전용 - README/매뉴얼 지침).
    } else if (effect.type === 'obstacleExpire' && effect.id === 'timeBomb') {
      const { row, col } = cell;
      this._obstacleCellAnims.push({
        animKey: 'time_bomb_explode',
        baseImageKey: null,
        row,
        col,
        elapsedMs: 0,
        // 폭발 재생이 끝나면 성벽으로 날아가는 볼트 단계를 시작한다(_obstacleBombFlights).
        onDone: () => this._obstacleBombFlights.push({ phase: 'bolt', elapsedMs: 0, row, col }),
      });
    }
  }

  // 방해요소 칸 애니메이션(crate_break/stone_hit/stone_break/time_bomb_explode) 진행 + 그리기.
  // _puzzleBeams와 같은 "활성 배열을 매 프레임 다시 쌓는" 패턴 - 다 끝난 항목만 걷어낸다.
  _advanceAndDrawObstacleCellAnims(rect, dtMs) {
    if (this._obstacleCellAnims.length === 0) return;
    const next = [];
    for (const fx of this._obstacleCellAnims) {
      fx.elapsedMs += dtMs;
      const anim = this.assets?.obstacleAnims?.get(fx.animKey);
      const durationMs = anim ? anim.frames * anim.frameMs : 300;
      if (fx.elapsedMs >= durationMs) {
        fx.onDone?.();
        continue;
      }
      if (fx.baseImageKey) this._drawObstacleCellImage(rect, fx.baseImageKey, fx.row, fx.col);
      this._drawObstacleCellSprite(rect, anim, fx.elapsedMs, fx.row, fx.col, false);
      next.push(fx);
    }
    this._obstacleCellAnims = next;
  }

  // 전투 화면 절대 좌표(보드 칸 크기와 무관)에 그리는 방해요소 스프라이트(볼트/벽 히트) -
  // manifest.drawScale배로만 그린다(README 규격). facing: 기본 오른쪽을 보게 그려져 있어
  // angle(라디안)만큼 회전시켜 목표 방향을 보게 한다. pivot은 회전·이동 기준점.
  _drawObstacleScreenSprite(ctx, anim, elapsedMs, cx, cy, angle = 0) {
    if (!anim?.state?.loaded || anim.state.failed) return;
    const scale = this.assets?.obstacleDrawScale ?? 2;
    const frame = anim.loop
      ? Math.floor(elapsedMs / anim.frameMs) % anim.frames
      : Math.min(anim.frames - 1, Math.floor(elapsedMs / anim.frameMs));
    const pivot = anim.pivot ?? [anim.frameW / 2, anim.frameH / 2];
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.translate(cx, cy);
    if (angle) ctx.rotate(angle);
    drawImageSnapped(ctx, 
      anim.state.img,
      frame * anim.frameW,
      0,
      anim.frameW,
      anim.frameH,
      -pivot[0] * scale,
      -pivot[1] * scale,
      anim.frameW * scale,
      anim.frameH * scale
    );
    ctx.restore();
  }

  // 시한폭탄 폭발(time_bomb_explode, 칸 범위)이 끝난 뒤 성벽까지: bolt(약 0.35초 비행) ->
  // wall_hit(+화면 흔들림). battleLayout이 없으면(배틀 미연결) 그 항목만 조용히 버린다.
  // _advanceAndDrawPuzzleBeams와 같은 "advance+draw를 한 메서드에서, render()가 직접 호출"
  // 패턴(보드 클립 밖까지 그려야 해서 _drawBoard 안에 둘 수 없다).
  _advanceAndDrawObstacleBombFlights(ctx, boardRect, battleLayout, dtMs) {
    if (this._obstacleBombFlights.length === 0) return;
    const boltAnim = this.assets?.obstacleAnims?.get('time_bomb_bolt');
    const hitAnim = this.assets?.obstacleAnims?.get('wall_hit');
    const boltMs = 350; // README: "약 0.35초"
    const hitMs = hitAnim ? hitAnim.frames * hitAnim.frameMs : 360;
    const wallShake = this.assets?.effectsConfig?.events?.wallDamaged?.shake;

    const next = [];
    for (const fx of this._obstacleBombFlights) {
      fx.elapsedMs += dtMs;

      if (fx.phase === 'bolt') {
        if (!battleLayout?.wallBar) continue;
        const wallX = battleLayout.wallBar.x + battleLayout.wallBar.width / 2;
        const wallY = battleLayout.wallBar.y + battleLayout.wallBar.height / 2;
        const sx = boardRect.x + (fx.col + 0.5) * boardRect.cellSize;
        const sy = boardRect.y + (fx.row + 0.5) * boardRect.cellSize;
        if (fx.elapsedMs >= boltMs) {
          fx.phase = 'hit';
          fx.elapsedMs = 0;
          fx.wallX = wallX;
          fx.wallY = wallY;
          if (wallShake) this._triggerShake(wallShake.amount, wallShake.life);
          next.push(fx);
          continue;
        }
        const t = fx.elapsedMs / boltMs;
        const angle = Math.atan2(wallY - sy, wallX - sx);
        this._drawObstacleScreenSprite(ctx, boltAnim, fx.elapsedMs, sx + (wallX - sx) * t, sy + (wallY - sy) * t, angle);
        next.push(fx);
        continue;
      }

      if (fx.phase === 'hit') {
        if (fx.elapsedMs >= hitMs) continue;
        this._drawObstacleScreenSprite(ctx, hitAnim, fx.elapsedMs, fx.wallX, fx.wallY, 0);
        next.push(fx);
      }
    }
    this._obstacleBombFlights = next;
  }

  _drawDisplayItem(rect, item, shockwaveSources, shockwaveCfg, nowMs, hintCell) {
    const { cellSize } = rect;
    const shock = this._shockwaveOffsetFor(item.row, item.col, shockwaveSources, cellSize, shockwaveCfg);
    const cellX = rect.x + item.col * cellSize + shock.x;
    const cellY = rect.y + item.row * cellSize + shock.y;
    const isHint = !!hintCell && item.row === hintCell.row && item.col === hintCell.col;
    this._drawGem(item, cellX, cellY, cellSize, nowMs, isHint);
  }

  _drawGem(item, cellX, cellY, cellSize, nowMs, isHint = false) {
    const { ctx } = this;
    const { value, special, opacity = 1, scale = 1 } = item;

    // idle 애니메이션(지금은 shimmer만)은 오프스크린 캐시를 건드리지 않고, 그릴 때
    // 알파에만 곱해진다 - 매 프레임 달라지는 값 때문에 캐시 키가 계속 바뀌지 않도록.
    const idle = special && SPECIAL_GEM_CONFIG[special.kind]?.idle;
    let idleAlpha = 1;
    if (idle?.type === 'shimmer') {
      idleAlpha = 1 - 0.08 + 0.08 * Math.sin((nowMs / idle.periodMs) * Math.PI * 2);
    }

    // 힌트(일정 시간 입력 없음): 특정 칸을 확대/축소 + 은은한 빛으로 가능한 수를 알려준다.
    let hintScale = 1;
    let hintWave = 0;
    if (isHint) {
      const { periodMs, amount } = HINT_CONFIG.pulse;
      hintWave = Math.sin((nowMs / periodMs) * Math.PI * 2);
      hintScale = 1 + hintWave * amount * 0.5;
    }

    // armed(발동 대기, §6) - 남은 시간 비율(progress)에 비례해 커지고 떨리고(고정 주파수
    // sin/cos, Math.random 금지) cause색으로 빛난다.
    let armedScale = 1;
    let armedOffsetX = 0;
    let armedOffsetY = 0;
    let armedGlowColor = null;
    let armedGlowStrength = 0;
    if (item.armed) {
      const armedCfg = this.assets?.effectsConfig?.armed ?? {};
      const progress = item.progress ?? 0;
      const scaleMax = armedCfg.scaleMax ?? 1.25;
      armedScale = 1 + (scaleMax - 1) * progress;
      const jitterPx = (armedCfg.jitterPx ?? 2) * progress;
      armedOffsetX = Math.sin(nowMs / 37) * jitterPx;
      armedOffsetY = Math.cos(nowMs / 53) * jitterPx;
      armedGlowColor = armedCfg.glowColorByCause?.[item.cause] ?? null;
      armedGlowStrength = progress;
    }

    // 낙하 착지 스쿼시(§11) - 비대칭 스케일(세로 눌림 -> 복귀). 항상 render()가 매 프레임
    // Animator.getNewlySettledCells()에서 다시 유도한 현재 상태만 읽는다.
    let squashX = 1;
    let squashY = 1;
    const squashEntry = this._landingSquashes.get(`${item.row},${item.col}`);
    if (squashEntry) {
      // 셔플 착지(§셔플 애니메이션)는 entry에 자기 durationMs/amount를 직접 실어 보낸다(일반
      // 낙하 착지보다 더 약하고 짧은 바운스) - 없으면 평소처럼 전역 landingSquash 설정을 쓴다.
      const squashCfg = this.assets?.effectsConfig?.landingSquash ?? {};
      const durationMs = squashEntry.durationMs ?? squashCfg.durationMs ?? 140;
      const amount = squashEntry.amount ?? squashCfg.amount ?? 0.22;
      const remain = Math.max(0, 1 - squashEntry.elapsedMs / durationMs);
      squashY = 1 - amount * remain;
      squashX = 1 + amount * 0.5 * remain;
    }

    // 잼 에셋은 48px 이미지(몸통 32px + 효과용 여백 8px씩) - 몸통이 칸 크기에 가장 가까운 정수 배율
    // (원본 1px = m 기기 px)로 칸 중심에 맞춰 그린다(README 참고). 여백(그림자·외곽)도 같은 m이라
    // 이미지 전체는 칸보다 커지고, 그 여백은 옆 칸으로 살짝 번진다.
    const tileSize = this.assets?.gemTileSize ?? 48;
    const bodySize = this.assets?.gemBodySize ?? 32;
    const bodyRatio = bodySize / tileSize;
    const baseImageSize = (tileSize * gemPixelScale(cellSize * screen.unit, bodySize)) / screen.unit;

    const baseScale = scale * hintScale * armedScale;
    const sizeX = baseImageSize * baseScale * squashX;
    const sizeY = baseImageSize * baseScale * squashY;
    const cx = cellX + cellSize / 2 + armedOffsetX;
    const cy = cellY + cellSize / 2 + armedOffsetY;
    const x = snapPx(cx - sizeX / 2);
    const y = snapPx(cy - sizeY / 2);

    ctx.save();
    ctx.globalAlpha = opacity * idleAlpha;
    // 잼 에셋은 픽셀아트(assets/gems) - 어떤 칸 크기로 그려도 뭉개지지 않도록 스무딩을
    // 끈다(manifest.imageSmoothing, 기본 false). ctx.save()로 묶여 있어 이 _drawGem
    // 호출이 끝나면(ctx.restore()) 자동으로 원복된다.
    ctx.imageSmoothingEnabled = this.assets?.gemImageSmoothing ?? false;

    if (armedGlowColor) {
      ctx.shadowColor = armedGlowColor;
      ctx.shadowBlur = cellSize * 0.5 * armedGlowStrength;
    } else if (isHint) {
      const { color, blurRatio } = HINT_CONFIG.glow;
      ctx.shadowColor = color;
      ctx.shadowBlur = cellSize * blurRatio * Math.max(0, hintWave);
    }

    if (special?.kind === 'color') {
      this._drawGemImage(null, null, x, y, sizeX, sizeY, nowMs, item.row, item.col, bodyRatio);
      if (idle?.type === 'shimmer') {
        this._drawShimmerHighlight(cx, cy, Math.min(sizeX, sizeY) * bodyRatio, nowMs, idle.periodMs);
      }
    } else {
      const gem = GEM_TYPES[value];
      if (!gem) {
        ctx.restore();
        return;
      }
      let variant = 'normal';
      if (special?.kind === 'bomb') variant = 'bomb';
      else if (special?.kind === 'box') variant = 'box';
      else if (special?.kind === 'line') variant = special.direction === 'vertical' ? 'line_v' : 'line_h';

      this._drawGemImage(gem, variant, x, y, sizeX, sizeY, nowMs, item.row, item.col, bodyRatio);
    }

    ctx.restore();
  }

  // 잼 한 장을 그린다. variant===null이면 컬러(무지개) 잼. 특수 잼은 "기본 잼 + 오버레이"가
  // 아니라 assets/gems/manifest.json이 주는 완성된 이미지 한 장(bomb/box/color는 루프
  // 애니메이션 시트)으로 그린다 - README 참고.
  _drawGemImage(gem, variant, x, y, w, h, nowMs, row, col, bodyRatio) {
    const { ctx } = this;
    const colorId = gem?.id ?? null;

    let animKey = null;
    if (variant === 'bomb') animKey = `bomb_${colorId}`;
    else if (variant === 'box') animKey = `box_${colorId}`;
    else if (variant === 'line_h') animKey = `line_h_${colorId}`;
    else if (variant === 'line_v') animKey = `line_v_${colorId}`;
    else if (variant === null) animKey = 'color';

    const anim = animKey ? this.assets?.gemAnims?.get(animKey) : null;
    if (anim && anim.state.loaded && !anim.state.failed) {
      // 같은 종류 잼이 한꺼번에 똑같이 깜빡이지 않도록 칸 위치 기반 고정 오프셋으로 시작
      // 시간을 어긋나게 한다(Math.random 대신 - 보드/화면과 결정적으로 맞음).
      const offset = this._cellAnimOffset(row, col);
      const frame = Math.floor((nowMs + offset) / anim.frameMs) % anim.frames;
      drawImageSnapped(ctx, anim.state.img, frame * anim.frameW, 0, anim.frameW, anim.frameH, x, y, w, h);
      return;
    }

    const staticState = variant === null ? this.assets?.gemColorImage : this.assets?.gemImages?.get(`${colorId}_${variant}`);
    if (staticState && staticState.loaded && !staticState.failed) {
      drawImageSnapped(ctx, staticState.img, x, y, w, h);
      return;
    }

    this._drawGemFallback(gem, variant, x, y, w, h, bodyRatio);
  }

  // 칸 위치 -> 고정 애니메이션 시작 오프셋(ms). Math.random 금지 - 결정적 해시만 사용.
  _cellAnimOffset(row, col) {
    return (row * 7919 + col * 104729) % 100000;
  }

  // 이미지가 없거나 로드 실패 시의 임시 도형. 기본 잼 색 원 위에 종류별 마커를 얹는다.
  // w,h는 효과용 여백을 포함한 전체 이미지 박스 - 도형은 몸통 비율(bodyRatio)만큼만
  // 차지하게 그려서 옆 칸까지 번지지 않게 한다.
  _drawGemFallback(gem, variant, x, y, w, h, bodyRatio = 1) {
    const { ctx } = this;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const size = Math.min(w, h) * bodyRatio;
    if (!gem) {
      this._drawColorGemFallback(ctx, cx, cy, size);
      return;
    }
    ctx.fillStyle = gem.color;
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
    ctx.fill();
    if (variant === 'bomb') this._drawBombMarker(ctx, cx, cy, size);
    else if (variant === 'line_h') this._drawLineMarker(ctx, cx, cy, size, 'horizontal');
    else if (variant === 'line_v') this._drawLineMarker(ctx, cx, cy, size, 'vertical');
    else if (variant === 'box') this._drawBoxMarker(ctx, cx, cy, size);
  }


  // ------------------------------------------------------------
  // 낙하 착지 스쿼시(§11) - render()가 매 프레임 호출. Map 값만 늙히고, 끝난 항목은 지운다.
  // ------------------------------------------------------------

  // 셔플 연출 중 보드 위에 뜨는 "SHUFFLE" 텍스트(§0 팝/§3 착지 - 0단계에서 페이드인, 3단계에서
  // 페이드아웃). 흔들림/연출 줄이기(reduceMotion)일 땐 전체 페이드로 대체되므로 띄우지 않는다.
  _drawShuffleText(rect, shuffleFx) {
    const cfg = this.assets?.effectsConfig;
    if (cfg?.settings?.reduceMotion) return;
    // 입장 연출(skipClear)은 재배치가 아니다 - "SHUFFLE" 문구를 띄우면 층에 들어올 때마다
    // 보드가 섞인 것처럼 읽힌다(gameState.shuffleBoard({skipClear}) 주석 참고).
    if (shuffleFx.skipClear) return;
    const phases = cfg?.shuffleAnim?.phases;
    if (!phases) return;

    const elapsed = shuffleFx.elapsedMs;
    let opacity;
    if (elapsed < phases.clearMs) {
      opacity = phases.clearMs > 0 ? elapsed / phases.clearMs : 1;
    } else if (elapsed < phases.fallEndMs) {
      opacity = 1;
    } else {
      opacity = 1 - Math.min(1, (elapsed - phases.fallEndMs) / Math.max(1, phases.totalMs - phases.fallEndMs));
    }
    if (opacity <= 0) return;

    const { ctx } = this;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = getFontString(Math.round(rect.cellSize * 0.5));
    drawText(ctx, t('puzzle.shuffle'), rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.restore();
  }

  _advanceLandingSquashes(dtMs) {
    if (this._landingSquashes.size === 0) return;
    const defaultDurationMs = this.assets?.effectsConfig?.landingSquash?.durationMs ?? 140;
    for (const [key, entry] of this._landingSquashes) {
      entry.elapsedMs += dtMs;
      if (entry.elapsedMs >= (entry.durationMs ?? defaultDurationMs)) this._landingSquashes.delete(key);
    }
  }

  // ------------------------------------------------------------
  // 폭탄 충격파(§3) - specialActivate(kind=bomb)/comboActivate(bomb_bomb) 이펙트가 살아있는
  // 동안, 그 중심 주변 칸에 바깥으로 밀렸다 복귀하는 변위를 준다.
  // ------------------------------------------------------------

  _collectShockwaveSources(gameState) {
    const sources = this._shockwaveSources;
    sources.length = 0;
    for (const effect of gameState.effects) {
      if (effect.type === 'specialActivate' && effect.kind === 'bomb') sources.push(effect);
      else if (effect.type === 'comboActivate' && effect.comboKind === 'bomb_bomb') sources.push(effect);
    }
    return sources;
  }

  // 반환 객체는 호출마다 재사용되는 스크래치 - 받는 즉시 x/y만 읽고 버려야 한다(다음 호출에서
  // 덮어써짐).
  _shockwaveOffsetFor(row, col, sources, cellSize, cfg) {
    const out = this._shockwaveScratch;
    out.x = 0;
    out.y = 0;
    if (!sources || sources.length === 0 || !cfg) return out;

    const radius = cfg.radiusCells ?? 1.5;
    const amp = cellSize * (cfg.amplitudeRatio ?? 0.12);
    for (const src of sources) {
      const dRow = row - src.position.row;
      const dCol = col - src.position.col;
      const dist = Math.sqrt(dRow * dRow + dCol * dCol);
      if (dist <= 0 || dist > radius) continue;
      const t = src.durationMs > 0 ? Math.min(1, src.elapsedMs / src.durationMs) : 1;
      const push = amp * Math.sin(t * Math.PI) * (1 - dist / radius);
      out.x += (dCol / dist) * push;
      out.y += (dRow / dist) * push;
    }
    return out;
  }

  // ------------------------------------------------------------
  // 잼 터짐 이펙트(assets/effects) - README.md 참고. line/bomb/box/color 발동 하나당
  // "스프라이트 재생 일정" 객체 하나를 만들어 this._specialFx에 넣고, 매 프레임 자체 ageMs로
  // 진행시킨다(core의 specialActivate effect 수명과 무관 - 점 4).
  // ------------------------------------------------------------

  // board.cellStates(있으면, armed/clearing 모두 원래 값을 들고 있다) 우선, 없으면 board.grid -
  // specialFx를 만드는 시점에 그 칸의 "원래" 잼 색을 읃는다.
  _cellColorId(board, row, col) {
    const idx = row * board.cols + col;
    const cs = board.cellStates[idx];
    const value = cs && cs.value !== undefined ? cs.value : board.grid[idx];
    return GEM_TYPES[value]?.id ?? null;
  }

  // assets/effects/manifest.json 애니메이션 하나의 전체 길이(ms). 에셋이 아직 없을 때도
  // 일정이 끊기지 않도록 fallback(README 표의 길이)을 쓴다.
  _effectAnimDurationMs(key, fallback) {
    const anim = this.assets?.effectAnims?.get(key);
    if (!anim) return fallback;
    if (typeof anim.frameMs === 'number') return anim.frameMs * anim.frames;
    return anim.frameMs.reduce((a, b) => a + b, 0);
  }

  // audioCues: { at(ms), key, step } - 이펙트와 같은 지연에 소리를 내기 위한 일정
  // (assets/sfx/README.md "타이밍"). _advanceAndDrawSpecialFx가 ageMs가 at을 넘길 때 재생한다.
  _spawnSpecialFx(effect, board) {
    const { kind, position, affected } = effect;
    const step = effect.cascadeIndex ?? 1;

    if (kind === 'line') {
      const stepMs = this.assets?.effectFxManifest?.line?.stepMs ?? 30;
      const colorId = this._cellColorId(board, position.row, position.col);
      const originKey = `line_${effect.direction === 'vertical' ? 'v' : 'h'}_origin_${colorId}`;
      let maxEnd = this._effectAnimDurationMs(originKey, 380);
      const targets = [];
      for (const cell of affected) {
        if (cell.row === position.row && cell.col === position.col) continue;
        const along = effect.direction === 'vertical' ? cell.row : cell.col;
        const originAlong = effect.direction === 'vertical' ? position.row : position.col;
        const dist = Math.abs(along - originAlong);
        const fireAtMs = dist * stepMs;
        const targetColorId = this._cellColorId(board, cell.row, cell.col);
        const seg = along % 2 === 0 ? 'seg0' : 'seg1';
        const segKey = `line_${effect.direction === 'vertical' ? 'v' : 'h'}_${seg}_${targetColorId}`;
        const end = fireAtMs + Math.max(this._effectAnimDurationMs(`pop_${targetColorId}`, 270), this._effectAnimDurationMs(segKey, 320));
        maxEnd = Math.max(maxEnd, end);
        targets.push({ row: cell.row, col: cell.col, colorId: targetColorId, special: this._cellSpecial(board, cell.row, cell.col), fireAtMs, seg });
        this._specialFxReserved.add(`${cell.row},${cell.col}`);
      }
      const cues = [{ at: 0, key: 'line_fire' }, ...targets.map((tg) => ({ at: tg.fireAtMs, key: 'gem_pop', step }))];
      this._specialFx.push({ kind: 'line', direction: effect.direction, row: position.row, col: position.col, colorId, ageMs: 0, totalLifeMs: maxEnd, targets, audioCues: sortCues(cues) });
    } else if (kind === 'bomb') {
      const hitMs = this.assets?.effectFxManifest?.bomb?.hitMs ?? 110;
      const colorId = this._cellColorId(board, position.row, position.col);
      let maxEnd = this._effectAnimDurationMs(`bomb_${colorId}`, 500);
      const targets = [];
      for (const cell of affected) {
        if (cell.row === position.row && cell.col === position.col) continue;
        const targetColorId = this._cellColorId(board, cell.row, cell.col);
        const end = hitMs + this._effectAnimDurationMs(`pop_${targetColorId}`, 270);
        maxEnd = Math.max(maxEnd, end);
        targets.push({ row: cell.row, col: cell.col, colorId: targetColorId, special: this._cellSpecial(board, cell.row, cell.col), fireAtMs: hitMs });
        this._specialFxReserved.add(`${cell.row},${cell.col}`);
      }
      const cues = [{ at: 0, key: 'bomb_explode' }, ...targets.map(() => ({ at: hitMs, key: 'gem_pop', step }))];
      this._specialFx.push({ kind: 'bomb', row: position.row, col: position.col, colorId, ageMs: 0, totalLifeMs: maxEnd, targets, audioCues: sortCues(cues) });
    } else if (kind === 'box') {
      const cfg = this.assets?.effectFxManifest?.box ?? { startMs: 60, durationMs: 300, growPart: 0.3, reshapeMs: 70, hitMs: 150 };
      const colorId = this._cellColorId(board, position.row, position.col);
      let maxEnd = Math.max(this._effectAnimDurationMs(`box_origin_${colorId}`, 330), cfg.startMs + cfg.durationMs);
      const targets = [];
      for (const cell of affected) {
        if (cell.row === position.row && cell.col === position.col) continue;
        const targetColorId = this._cellColorId(board, cell.row, cell.col);
        const end = cfg.hitMs + Math.max(this._effectAnimDurationMs(`pop_${targetColorId}`, 270), this._effectAnimDurationMs(`box_hit_${colorId}`, 220));
        maxEnd = Math.max(maxEnd, end);
        const seed = ((cell.row * 97 + cell.col * 31 + position.row * 13 + position.col * 7 + 1) * 2654435761) >>> 0;
        targets.push({ row: cell.row, col: cell.col, colorId: targetColorId, special: this._cellSpecial(board, cell.row, cell.col), seed, boltCache: null });
        this._specialFxReserved.add(`${cell.row},${cell.col}`);
      }
      // 번개가 꽂히는 순간(cfg.hitMs)마다 box_zap + 그 칸의 pop.
      const cues = [{ at: 0, key: 'box_open' }];
      for (const tg of targets) cues.push({ at: cfg.hitMs, key: 'box_zap' }, { at: cfg.hitMs, key: 'gem_pop', step });
      this._specialFx.push({ kind: 'box', row: position.row, col: position.col, colorId, ageMs: 0, totalLifeMs: maxEnd, targets, cfg, audioCues: sortCues(cues) });
    } else if (kind === 'color') {
      const colorCfg = this.assets?.effectFxManifest?.color ?? { waveStartMs: 240, stepMs: 45, minFlightMs: 60 };
      const waveStartMs = colorCfg.waveStartMs ?? 240;
      let maxEnd = this._effectAnimDurationMs('color_origin', 460);
      const targets = [];
      for (const cell of affected) {
        if (cell.row === position.row && cell.col === position.col) continue;
        const dist = Math.hypot(cell.row - position.row, cell.col - position.col);
        const flightMs = Math.max(colorCfg.minFlightMs ?? 60, dist * (colorCfg.stepMs ?? 45));
        const targetColorId = this._cellColorId(board, cell.row, cell.col);
        const arriveAtMs = waveStartMs + flightMs;
        const end = arriveAtMs + Math.max(this._effectAnimDurationMs(`pop_${targetColorId}`, 270), this._effectAnimDurationMs(`color_mark_${targetColorId}`, 200));
        maxEnd = Math.max(maxEnd, end);
        targets.push({ row: cell.row, col: cell.col, colorId: targetColorId, special: this._cellSpecial(board, cell.row, cell.col), flightMs });
        this._specialFxReserved.add(`${cell.row},${cell.col}`);
      }
      // charge(발동 순간) -> color_origin이 터지며 wisp가 날아가는 프레임에 burst -> 도착마다 hit.
      const cues = [{ at: 0, key: 'color_charge' }, { at: waveStartMs, key: 'color_burst' }];
      for (const tg of targets) {
        cues.push({ at: waveStartMs + tg.flightMs, key: 'color_hit' }, { at: waveStartMs + tg.flightMs, key: 'gem_pop', step });
      }
      this._specialFx.push({ kind: 'color', row: position.row, col: position.col, ageMs: 0, totalLifeMs: maxEnd, targets, waveStartMs, audioCues: sortCues(cues) });
    }
  }

  // 그 칸의 "원래" 잼 한 장(색 + 특수 종류) - 조합 리드인에서 합쳐지는 두 특수 잼을 그릴 때 쓴다.
  _comboGemAt(board, row, col) {
    const idx = row * board.cols + col;
    return {
      colorId: this._cellColorId(board, row, col),
      special: board.cellStates[idx]?.special ?? board.specials[idx] ?? null,
    };
  }

  // 그 칸의 특수 종류(core가 이미 지운 칸도 cellState에 남은 값) - fx가 터지기 전 잼을 얼려 그릴 때 쓴다.
  _cellSpecial(board, row, col) {
    return this._comboGemAt(board, row, col).special;
  }

  // _spawnSpecialFx와 같은 입력(specialActivate 모양)으로 fx를 만들고 재생만 delayMs 늦춘다
  // (ageMs를 음수로 시작 - 그 사이 대상 칸의 잼은 _advanceAndDrawSpecialFx가 얼려 그린다).
  // freezeOrigin: 발동 칸 자체의 잼도 얼려 그린다(변환으로 이미 특수 잼이 된 칸이 자기 발동을
  // 기다리는 동안 보여야 하므로). 반환 = 이번에 만들어진 fx들(조합 전용 필드를 덧붙이려고).
  _spawnDelayedFx(effectLike, board, delayMs, { freezeOrigin = false } = {}) {
    const from = this._specialFx.length;
    this._spawnSpecialFx(effectLike, board);
    const made = this._specialFx.slice(from);
    for (const fx of made) {
      fx.ageMs = -Math.max(0, delayMs);
      if (!freezeOrigin) continue;
      const idx = fx.row * board.cols + fx.col;
      fx.originGem = {
        colorId: fx.colorId ?? this._cellColorId(board, fx.row, fx.col),
        special: board.cellStates[idx]?.special ?? board.specials[idx] ?? null,
      };
      this._specialFxReserved.add(`${fx.row},${fx.col}`);
    }
    return made;
  }

  // 변환형 조합: core는 변환 직후(등장 순서 * DETONATION_CONFIG.transformStepMs = 40ms)에
  // 바로 specialActivate를 낸다 - 순서와 간격은 core 그대로 두고, 리드인+캐리어(불씨/번개)
  // 연출이 끝날 때까지 그 발동의 "그리기"만 통째로 늦춘다(보드 데이터는 그대로).
  // carrier: 불씨/번개를 나르는 fx. revealAtMs: 칸("r,c") -> carrier 나이 기준 도착 시각. 도착 전엔
  // carrier가 원래 잼을, 도착 후엔 연쇄 fx가 이어받을 때까지 carrier가 변환된 특수 잼을 그린다
  // (둘이 같은 시계로 넘겨받아야 빈 프레임 - 깜빡임 - 이 없다).
  // stepMs: cells 순서(core의 발동 순서)마다 그리기를 더 늦추는 간격.
  _deferComboChain(cells, delayMs, revealAtMs, stepMs = 0, carrier = null) {
    const order = new Map(cells.map((c, i) => [`${c.row},${c.col}`, i]));
    this._comboChainDelay = { cells: new Set(order.keys()), order, delayMs, stepMs, revealAtMs, carrier };
  }

  // 아직 터지기 전인 fx 대상 칸이면, 그 칸에 닿기까지 남은 시간(ms). 아니면 0.
  _pendingHitMs(row, col) {
    let wait = 0;
    for (const fx of this._specialFx) {
      for (const t of fx.targets) {
        if (t.row !== row || t.col !== col) continue;
        const hitAt =
          fx.kind === 'box' ? (t.hitMs ?? fx.cfg.hitMs) : fx.kind === 'color' ? fx.waveStartMs + t.flightMs : t.fireAtMs ?? 0;
        wait = Math.max(wait, hitAt - fx.ageMs);
      }
    }
    return wait;
  }

  // flightMs를 바꾼 뒤(컬러+컬러의 무지개 물결) 수명과 소리 일정을 다시 계산한다.
  _retimeColorFx(fx, step) {
    const cues = [{ at: 0, key: 'color_charge' }, { at: fx.waveStartMs, key: 'color_burst' }];
    let maxEnd = this._effectAnimDurationMs('color_origin', 460);
    for (const target of fx.targets) {
      const arriveAtMs = fx.waveStartMs + target.flightMs;
      const tail = Math.max(
        this._effectAnimDurationMs(`pop_${target.colorId}`, 270),
        this._effectAnimDurationMs(`color_mark_${target.colorId}`, 200)
      );
      maxEnd = Math.max(maxEnd, arriveAtMs + tail);
      cues.push({ at: arriveAtMs, key: 'color_hit' }, { at: arriveAtMs, key: 'gem_pop', step });
    }
    fx.totalLifeMs = maxEnd;
    fx.audioCues = sortCues(cues);
  }

  // 특수 잼 조합(comboActivate) - manifest.combo + art/effects/combos/README.md의 10종.
  // 공통 리드인(두 특수 잼이 swapMs 동안 ref 칸으로 미끄러진 뒤 바로 사라짐) 다음에,
  // 조합별 연출을 #1~#5 발동 fx의 조합으로 만든다(_spawnDelayedFx가 같은 _spawnSpecialFx
  // 경로를 쓰고 재생만 늦춘다 - 조합 전용 드로잉 엔진을 따로 만들지 않는다).
  _spawnComboFx(effect, gameState) {
    const { board } = gameState;
    const cfg = this.assets?.effectFxManifest?.combo ?? {};
    // manifest.combo는 조합별 간격을 산문으로만 적어뒀다 - 숫자 필드가 생기면 그걸 쓰고,
    // 없으면 그 산문에 적힌 값을 기본값으로 쓴다.
    const swapMs = cfg.swapMs ?? 120;
    const boxBoxStepMs = cfg.boxBoxStepMs ?? 50; // 박스+박스: 번개 6갈래 간격.
    const boxLineStepMs = cfg.boxLineStepMs ?? 40; // 박스+라인/폭탄: 번개 2갈래 간격.
    const chainGapMs = cfg.chainGapMs ?? 100; // 변환이 다 끝난 뒤 연쇄 발동까지의 틈.
    const boxChainGapMs = cfg.boxChainGapMs ?? 60;
    const boxColorStepMs = cfg.boxColorStepMs ?? 120; // 박스+컬러: 박스마다 번개를 쏘는 간격.
    const colorColorGapMs = cfg.colorColorGapMs ?? 60; // 컬러+컬러: 소용돌이 2개의 시간차.
    const colorColorStepMs = cfg.colorColorStepMs ?? 55; // 컬러+컬러: 무지개 물결, 칸 거리당.

    const ref = effect.position;
    const affected = effect.affected ?? [];
    // plan 순서상 affected[0] = 스왑을 시작한 칸(a), position = 플레이어가 옮긴 도착 칸(b).
    const a = affected[0] ?? ref;
    const gemA = this._comboGemAt(board, a.row, a.col);
    const gemB = this._comboGemAt(board, ref.row, ref.col);
    const mergeColorId = gemB.colorId ?? gemA.colorId;
    const cascadeIndex = effect.cascadeIndex ?? 1;

    this._specialFx.push({
      kind: 'comboLead',
      row: ref.row,
      col: ref.col,
      fromRow: a.row,
      fromCol: a.col,
      gemA,
      gemB,
      swapMs,
      ageMs: 0,
      totalLifeMs: swapMs,
      targets: [],
      audioCues: [],
    });

    const inBounds = (r, c) => r >= 0 && r < board.rows && c >= 0 && c < board.cols;
    const rowOf = (r) => Array.from({ length: board.cols }, (_, c) => ({ row: r, col: c }));
    const colOf = (c) => Array.from({ length: board.rows }, (_, r) => ({ row: r, col: c }));
    const merged = (cell) =>
      (cell.row === ref.row && cell.col === ref.col) || (cell.row === a.row && cell.col === a.col);
    const rest = affected.filter((cell) => !merged(cell));
    const transformCells =
      gameState.effects.find((e) => e.type === 'specialTransform' && e.cascadeIndex === cascadeIndex)?.cells ?? [];
    const boxColorId = gemB.special?.kind === 'box' ? gemB.colorId : gemA.colorId;

    switch (effect.comboKind) {
      case 'line_line':
        // 합쳐진 칸에서 가로/세로 빛줄기 동시(+).
        this._spawnDelayedFx({ kind: 'line', direction: 'horizontal', position: ref, affected: rowOf(ref.row), cascadeIndex }, board, swapMs);
        this._spawnDelayedFx({ kind: 'line', direction: 'vertical', position: ref, affected: colOf(ref.col), cascadeIndex }, board, swapMs);
        break;

      case 'line_bomb': {
        // 가운데 폭탄 + 가로 3줄/세로 3줄("굵은 +"). position을 늘 ref로 둬서 칸별 지연이 ref
        // 기준으로 계산되게 하고, 가운데가 아닌 줄만 origin을 끈다.
        const box3 = [];
        for (let r = ref.row - 1; r <= ref.row + 1; r++) {
          for (let c = ref.col - 1; c <= ref.col + 1; c++) if (inBounds(r, c)) box3.push({ row: r, col: c });
        }
        this._spawnDelayedFx({ kind: 'bomb', direction: null, position: ref, affected: box3, cascadeIndex }, board, swapMs);
        for (let r = ref.row - 1; r <= ref.row + 1; r++) {
          if (r < 0 || r >= board.rows) continue;
          const made = this._spawnDelayedFx({ kind: 'line', direction: 'horizontal', position: ref, affected: rowOf(r), cascadeIndex }, board, swapMs);
          if (r !== ref.row) for (const fx of made) fx.noOrigin = true;
        }
        for (let c = ref.col - 1; c <= ref.col + 1; c++) {
          if (c < 0 || c >= board.cols) continue;
          const made = this._spawnDelayedFx({ kind: 'line', direction: 'vertical', position: ref, affected: colOf(c), cascadeIndex }, board, swapMs);
          if (c !== ref.col) for (const fx of made) fx.noOrigin = true;
        }
        break;
      }

      case 'bomb_bomb': {
        // 보통 폭탄 4개를 2x2로 동시에(각 3x3이 겹쳐 4x4를 덮는다). core가 4x4를 보드 안으로
        // 밀어넣으므로 affected는 늘 4x4다. 주변 칸 pop은 평소 폭탄과 같은 bomb.hitMs.
        let minRow = Infinity;
        let maxRow = -Infinity;
        let minCol = Infinity;
        let maxCol = -Infinity;
        for (const cell of affected) {
          minRow = Math.min(minRow, cell.row);
          maxRow = Math.max(maxRow, cell.row);
          minCol = Math.min(minCol, cell.col);
          maxCol = Math.max(maxCol, cell.col);
        }
        const made = this._spawnDelayedFx({ kind: 'bomb', direction: null, position: ref, affected, cascadeIndex }, board, swapMs);
        const r0 = Math.min(minRow + 1, maxRow);
        const c0 = Math.min(minCol + 1, maxCol);
        for (const fx of made) {
          fx.colorId = mergeColorId;
          fx.centers = [
            { row: r0, col: c0 },
            { row: r0, col: c0 + 1 },
            { row: r0 + 1, col: c0 },
            { row: r0 + 1, col: c0 + 1 },
          ];
        }
        break;
      }

      case 'box_box': {
        // 번개 6갈래, 두 박스 색을 번갈아 boxBoxStepMs 간격.
        const made = this._spawnDelayedFx({ kind: 'box', direction: null, position: ref, color: null, affected: [ref, ...rest], cascadeIndex }, board, swapMs);
        for (const fx of made) {
          fx.targets.forEach((target, i) => {
            target.boltColorId = i % 2 === 0 ? gemB.colorId : gemA.colorId;
            target.startMs = fx.cfg.startMs + i * boxBoxStepMs;
            target.hitMs = fx.cfg.hitMs + i * boxBoxStepMs;
          });
          fx.totalLifeMs += Math.max(0, fx.targets.length - 1) * boxBoxStepMs;
        }
        break;
      }

      case 'color_color': {
        // 소용돌이 2개(colorColorGapMs 차이) -> 무지개 물결이 가운데부터 보드 전체로.
        const made = this._spawnDelayedFx({ kind: 'color', direction: null, position: ref, color: null, affected: [ref, ...rest], cascadeIndex }, board, swapMs);
        for (const fx of made) {
          fx.noWisp = true;
          fx.extraOrigin = { row: a.row, col: a.col, atMs: colorColorGapMs };
          for (const target of fx.targets) {
            const dist = Math.hypot(target.row - ref.row, target.col - ref.col);
            target.flightMs = colorColorGapMs + dist * colorColorStepMs;
          }
          this._retimeColorFx(fx, cascadeIndex);
        }
        break;
      }

      case 'line_color':
      case 'bomb_color':
      case 'box_color': {
        // 무지개 불씨가 같은 색 잼마다 날아가 닿는 순간 특수 잼 그림으로 바뀐다(번쩍임 없음).
        // 박스+컬러의 chainCells(같은 색 기존 특수 잼)는 바뀌지 않고 불씨를 맞은 뒤 차례대로 터진다.
        const chainCells = effect.chainCells ?? [];
        const carried = [...transformCells, ...chainCells];
        if (carried.length === 0) break;
        const [fx] = this._spawnDelayedFx({ kind: 'color', direction: null, position: ref, color: null, affected: [ref, ...carried], cascadeIndex }, board, swapMs);
        if (!fx) break;
        const chainKeys = new Set(chainCells.map((c) => `${c.row},${c.col}`));
        let lastArriveMs = 0;
        const revealAtMs = new Map();
        for (const target of fx.targets) {
          const key = `${target.row},${target.col}`;
          target.transform = true;
          target.revealSpecial = target.special; // 닿은 뒤 연쇄 fx가 이어받을 때까지 이 그림을 그린다.
          if (!chainKeys.has(key)) target.special = null; // 변환 칸은 불씨가 닿기 전까지 일반 잼으로 보인다.
          const arriveMs = fx.waveStartMs + target.flightMs;
          revealAtMs.set(key, arriveMs);
          lastArriveMs = Math.max(lastArriveMs, arriveMs);
        }
        // 박스+컬러는 박스마다 번개가 따로 보이도록 차례마다 boxColorStepMs를 더 띄운다.
        const stepMs = effect.comboKind === 'box_color' ? boxColorStepMs : 0;
        this._deferComboChain(carried, swapMs + lastArriveMs + chainGapMs, revealAtMs, stepMs, fx);
        break;
      }

      case 'box_line':
      case 'box_bomb': {
        // 번개 2갈래(boxLineStepMs 간격)가 그 색 잼 2개를 쳐서 변신시킨 뒤 차례로 발동.
        if (transformCells.length === 0) break;
        const [fx] = this._spawnDelayedFx({ kind: 'box', direction: null, position: ref, color: null, affected: [ref, ...transformCells], cascadeIndex }, board, swapMs);
        if (!fx) break;
        fx.colorId = boxColorId; // 번개/origin 색은 박스 잼 색(ref에 라인 잼이 있을 수도 있다).
        let lastHitMs = 0;
        const revealAtMs = new Map();
        fx.targets.forEach((target, i) => {
          target.transform = true;
          target.revealSpecial = target.special;
          target.special = null; // 번개가 닿기 전까지 일반 잼으로 보인다.
          target.startMs = fx.cfg.startMs + i * boxLineStepMs;
          target.hitMs = fx.cfg.hitMs + i * boxLineStepMs;
          revealAtMs.set(`${target.row},${target.col}`, target.hitMs);
          lastHitMs = Math.max(lastHitMs, target.hitMs);
        });
        fx.totalLifeMs += Math.max(0, fx.targets.length - 1) * boxLineStepMs;
        this._deferComboChain(transformCells, swapMs + lastHitMs + boxChainGapMs, revealAtMs, 0, fx);
        break;
      }

      default:
        break;
    }
  }

  // 조합 리드인 - 두 특수 잼이 swapMs 동안 ref 칸으로 미끄러진 뒤 바로 사라진다.
  _drawComboLeadFx(rect, fx, nowMs) {
    if (fx.ageMs >= fx.swapMs) return;
    const t = fx.swapMs > 0 ? fx.ageMs / fx.swapMs : 1;
    this._drawFrozenGemAt(rect, fx.row, fx.col, fx.gemB.colorId, nowMs, fx.gemB.special);
    const row = fx.fromRow + (fx.row - fx.fromRow) * t;
    const col = fx.fromCol + (fx.col - fx.fromCol) * t;
    this._drawFrozenGemAt(rect, row, col, fx.gemA.colorId, nowMs, fx.gemA.special);
  }

  // ageMs 기준으로 한 프레임을 cx,cy(화면 픽셀, 칸 중심 기준 아님 - 이미 중심 좌표로 받는다)에
  // 그린다. 배율은 cellSize/32(README "칸 크기가 64px가 아니면 배율 = 칸 크기/32").
  _drawEffectSpriteAtPx(rect, animKey, ageMs, px, py) {
    if (ageMs < 0) return false; // 아직 시작 전(_spawnDelayedFx가 ageMs를 음수로 시작시킨다).
    const anim = this.assets?.effectAnims?.get(animKey);
    if (!anim?.state?.loaded || anim.state.failed) return false;
    const frame = effectFrameIndex(anim, ageMs);
    if (frame < 0) return false;
    const { ctx } = this;
    const scale = rect.cellSize / 32;
    const cx = rect.x + px * scale;
    const cy = rect.y + py * scale;
    const w = anim.frameW * scale;
    const h = anim.frameH * scale;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    drawImageSnapped(ctx, anim.state.img, frame * anim.frameW, 0, anim.frameW, anim.frameH, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
    return true;
  }

  // row,col(칸 단위, 소수 가능 - color_wisp 비행 중간 위치 등)을 칸 중심 픽셀로 바꿔 그린다.
  _drawEffectSprite(rect, animKey, ageMs, row, col) {
    return this._drawEffectSpriteAtPx(rect, animKey, ageMs, (col + 0.5) * 32, (row + 0.5) * 32);
  }

  // 아직 터지지 않은(또는 발동 그리기를 아직 시작하지 않은) 칸의 잼을 그대로 그린다
  // (specialFx가 core의 clearing/falling보다 그리기를 늦추는 동안 - README 점4, "보드
  // 데이터는 그대로 두고 그리기만 지연시켜"). 그 자리를 완전히 덮으므로 Animator가 그 사이
  // 그린 다른 내용(이미 새로 채워진 잼 등) 위에 그대로 올라간다. row/col은 소수도 된다
  // (조합 리드인에서 두 특수 잼이 한 칸으로 미끄러지는 동안 - manifest.combo.swapMs).
  // special을 주면 그 특수 잼 그림으로 그린다(없으면 일반 잼 - 변환 전 모습).
  _drawFrozenGemAt(rect, row, col, colorId, nowMs, special = null) {
    const value = GEM_TYPES.findIndex((g) => g.id === colorId);
    if (value < 0 && special?.kind !== 'color') return;
    const item = { row, col, value, special, opacity: 1, scale: 1 };
    this._drawGem(item, rect.x + col * rect.cellSize, rect.y + row * rect.cellSize, rect.cellSize, nowMs);
  }

  // README #4 drawPixelBolt - 원본 해상도(칸=32px) 오프스크린 캔버스에 찍고 cellSize/32배로
  // 확대해 그린다. 반환값 = 뻗는 중인 머리 위치(px,py, 32px/칸 좌표) 또는 null.
  _drawPixelBolt(rect, fx, target, boltAge) {
    const sx = (fx.col + 0.5) * 32;
    const sy = (fx.row + 0.5) * 32;
    const tx = (target.col + 0.5) * 32;
    const ty = (target.row + 0.5) * 32;
    const margin = 24;
    const minX = Math.min(sx, tx) - margin;
    const minY = Math.min(sy, ty) - margin;
    const w = Math.ceil(Math.max(sx, tx) + margin - minX);
    const h = Math.ceil(Math.max(sy, ty) + margin - minY);

    if (!this._boltCanvas) {
      this._boltCanvas = document.createElement('canvas');
      this._boltCtx = this._boltCanvas.getContext('2d');
    }
    if (this._boltCanvas.width < w) this._boltCanvas.width = w;
    if (this._boltCanvas.height < h) this._boltCanvas.height = h;
    const bctx = this._boltCtx;
    bctx.clearRect(0, 0, w, h);

    const reshapeMs = fx.cfg.reshapeMs ?? 70;
    const seed = (target.seed + Math.floor(boltAge / reshapeMs)) >>> 0;
    if (!target.boltCache || target.boltCache.seed !== seed) {
      target.boltCache = { seed, path: boltPath(sx - minX, sy - minY, tx - minX, ty - minY, seed) };
    }

    const t = Math.min(1, boltAge / (fx.cfg.durationMs ?? 300));
    const colorCfg = this.assets?.effectFxManifest?.box?.colors?.[target.boltColorId ?? fx.colorId] ?? {};
    const put = (x, y, color) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      bctx.fillStyle = color;
      bctx.fillRect(x, y, 1, 1);
    };
    const head = drawPixelBolt(put, target.boltCache.path, t, colorCfg);

    const { ctx } = this;
    const scale = rect.cellSize / 32;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    drawImageSnapped(ctx, this._boltCanvas, 0, 0, w, h, rect.x + minX * scale, rect.y + minY * scale, w * scale, h * scale);
    ctx.restore();

    return head ? { x: head[0] + minX, y: head[1] + minY } : null;
  }

  // 줄 잼 발동(README #2) - 잼(얼려두기) -> pop -> line 세그먼트 -> origin 순으로 그린다.
  _drawLineFx(rect, fx, nowMs) {
    for (const target of fx.targets) {
      if (fx.ageMs < target.fireAtMs) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs, target.special);
    }
    const axis = fx.direction === 'vertical' ? 'v' : 'h';
    for (const target of fx.targets) {
      if (fx.ageMs < target.fireAtMs) continue;
      const localAge = fx.ageMs - target.fireAtMs;
      this._drawEffectSprite(rect, `pop_${target.colorId}`, localAge, target.row, target.col);
      this._drawEffectSprite(rect, `line_${axis}_${target.seg}_${target.colorId}`, localAge, target.row, target.col);
    }
    // 라인+폭탄 조합의 "가운데가 아닌 줄"은 origin 없이 세그먼트만 이어 그린다(manifest.combo).
    if (!fx.noOrigin) this._drawEffectSprite(rect, `line_${axis}_origin_${fx.colorId}`, fx.ageMs, fx.row, fx.col);
  }

  // 폭탄 발동(README #3) - 잼 -> pop -> 폭탄 스프라이트(폭탄이 pop보다 위) 순.
  _drawBombFx(rect, fx, nowMs) {
    for (const target of fx.targets) {
      if (fx.ageMs < target.fireAtMs) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs, target.special);
    }
    for (const target of fx.targets) {
      if (fx.ageMs < target.fireAtMs) continue;
      this._drawEffectSprite(rect, `pop_${target.colorId}`, fx.ageMs - target.fireAtMs, target.row, target.col);
    }
    // 폭탄+폭탄 조합은 centers(2x2 네 칸)마다 보통 폭탄을 동시에 그린다.
    const key = `bomb_${fx.colorId}`;
    if (!fx.centers) this._drawEffectSprite(rect, key, fx.ageMs, fx.row, fx.col);
    else for (const c of fx.centers) this._drawEffectSprite(rect, key, fx.ageMs, c.row, c.col);
  }

  // 박스 발동(README #4) - 잼 -> pop/box_origin -> 픽셀 번개 -> box_soul -> box_hit 순.
  // 조합에서는 대상마다 startMs/hitMs(갈래별 간격)와 boltColorId(두 박스 색 번갈아)가 다를 수
  // 있고, transform이 붙은 대상은 터지지 않는다(특수 잼 그림은 연쇄 fx의 originGem이 그린다).
  _drawBoxFx(rect, fx, nowMs) {
    const { cfg } = fx;
    const hitOf = (target) => target.hitMs ?? cfg.hitMs;
    for (const target of fx.targets) {
      if (fx.ageMs < hitOf(target)) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs, target.special);
      else if (target.transform && !target.handoff) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs, target.revealSpecial);
    }
    for (const target of fx.targets) {
      if (fx.ageMs < hitOf(target) || target.transform) continue;
      this._drawEffectSprite(rect, `pop_${target.colorId}`, fx.ageMs - hitOf(target), target.row, target.col);
    }
    this._drawEffectSprite(rect, `box_origin_${fx.colorId}`, fx.ageMs, fx.row, fx.col);
    for (const target of fx.targets) {
      const boltAge = fx.ageMs - (target.startMs ?? cfg.startMs);
      if (boltAge < 0 || boltAge > cfg.durationMs) continue;
      const head = this._drawPixelBolt(rect, fx, target, boltAge);
      if (head) this._drawEffectSpriteAtPx(rect, `box_soul_${target.boltColorId ?? fx.colorId}`, fx.ageMs, head.x, head.y);
    }
    for (const target of fx.targets) {
      if (fx.ageMs < hitOf(target) || target.transform) continue;
      this._drawEffectSprite(rect, `box_hit_${fx.colorId}`, fx.ageMs - hitOf(target), target.row, target.col);
    }
  }

  // 컬러 발동(README #5) - 잼 -> pop -> color_origin -> color_wisp(비행) -> color_mark 순.
  // 조합에서는 extraOrigin(컬러+컬러의 두 번째 소용돌이), noWisp(컬러+컬러는 불씨 없이
  // 물결만), transform(불씨가 꽂힌 잼이 터지는 대신 특수 잼으로 변신)이 붙는다.
  _drawColorFx(rect, fx, nowMs) {
    for (const target of fx.targets) {
      const arriveAtMs = fx.waveStartMs + target.flightMs;
      if (fx.ageMs < arriveAtMs) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs, target.special);
      else if (target.transform && !target.handoff) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs, target.revealSpecial);
    }
    for (const target of fx.targets) {
      const arriveAtMs = fx.waveStartMs + target.flightMs;
      if (fx.ageMs < arriveAtMs || target.transform) continue;
      this._drawEffectSprite(rect, `pop_${target.colorId}`, fx.ageMs - arriveAtMs, target.row, target.col);
    }
    this._drawEffectSprite(rect, 'color_origin', fx.ageMs, fx.row, fx.col);
    if (fx.extraOrigin) {
      this._drawEffectSprite(rect, 'color_origin', fx.ageMs - fx.extraOrigin.atMs, fx.extraOrigin.row, fx.extraOrigin.col);
    }
    if (!fx.noWisp && fx.ageMs >= fx.waveStartMs) {
      for (const target of fx.targets) {
        const arriveAtMs = fx.waveStartMs + target.flightMs;
        if (fx.ageMs >= arriveAtMs) continue;
        const easeT = (fx.ageMs - fx.waveStartMs) / target.flightMs;
        const ease = easeT * easeT;
        const row = fx.row + (target.row - fx.row) * ease;
        const col = fx.col + (target.col - fx.col) * ease;
        this._drawEffectSprite(rect, 'color_wisp', fx.ageMs, row, col);
      }
    }
    for (const target of fx.targets) {
      const arriveAtMs = fx.waveStartMs + target.flightMs;
      if (fx.ageMs < arriveAtMs || target.transform) continue;
      this._drawEffectSprite(rect, `color_mark_${target.colorId}`, fx.ageMs - arriveAtMs, target.row, target.col);
    }
  }

  // "발동/조합 스프라이트가 아직 재생 중"(아직 시작 전인 지연 연출도 포함) - main.js가 매
  // 프레임 GameState.settleHold에 넣어, 연출이 끝나기 전에 중력/리필이 돌지 않게 한다.
  // 일반 매치 pop(_simplePops, 270ms)은 core의 clear(180ms)+fall보다 짧아 세지 않는다.
  isSpecialFxBusy() {
    return this._specialFx.length > 0 || this._itemFx.some((fx) => fx.kind === 'scythe');
  }

  // 아이템 사용 연출 시작(main.js가 use()/예약 실행 성공 직후 부른다). 잼 제거 pop·무지개 생성·
  // 장갑 스왑·수리/모래시계는 core/battle 이벤트로 기존 연출이 그대로 나오므로 여기선 망치·낫만.
  playItemFx(cfg, target, board) {
    if (cfg.action === 'recolor') {
      // 염료: 기존 pop 파편을 새 색으로 짧게.
      const rect = this.lastLayout?.board;
      if (rect) this._spawnBurst(rect, target.row, target.col, { count: 8, speed: 110, life: 240, size: 3 }, 1, GEM_TYPES[target.color]?.color ?? '#ffffff');
      return;
    }
    if (cfg.action !== 'destroy') return;
    if (cfg.target === 'cell') {
      this._itemFx.push({ kind: 'hammer', cells: [target], ageMs: 0 });
      const rect = this.lastLayout?.board;
      if (rect) this._spawnBurst(rect, target.row, target.col, { count: 10, speed: 120, life: 380, size: 3 }, 1, '#d8d0c0');
      this._triggerShake(2, 160);
      return;
    }
    // 낫: 시작 칸(왼쪽/위쪽 끝)부터 lineStepMs 간격으로 line 세그먼트. 색은 그 칸에서 지워지는
    // 잼 색(방해요소 칸은 앞 칸 색을 이어 쓴다).
    const n = cfg.target === 'row' ? board.cols : board.rows;
    const cells = [];
    let colorId = GEM_TYPES[0].id;
    for (let i = 0; i < n; i++) {
      const row = cfg.target === 'row' ? target.row : i;
      const col = cfg.target === 'row' ? i : target.col;
      const idx = board.index(row, col);
      colorId = GEM_TYPES[board.cellStates[idx]?.value ?? board.grid[idx]]?.id ?? colorId;
      cells.push({ row, col, colorId, seg: i % 2 === 0 ? 'seg0' : 'seg1' });
    }
    this._itemFx.push({ kind: 'scythe', axis: cfg.target === 'row' ? 'h' : 'v', cells, ageMs: 0 });
  }

  // 보드 위 데미지 폰트 숫자(README 추천 움직임: 0.6초 떠오르며 마지막 0.2초 사라짐) + 시한폭탄 숫자 튕김 수명.
  _advanceAndDrawBoardFloats(rect, dtMs) {
    for (const [key, age] of this._bombBounce) {
      if (age + dtMs >= BOMB_BOUNCE_MS) this._bombBounce.delete(key);
      else this._bombBounce.set(key, age + dtMs);
    }
    if (this._boardFloats.length === 0) return;
    const { ctx } = this;
    const fontMeta = this.assets?.uiFont;
    const next = [];
    for (const f of this._boardFloats) {
      f.ageMs += dtMs;
      if (f.ageMs >= BOARD_FLOAT_MS) continue;
      next.push(f);
      const t = f.ageMs / BOARD_FLOAT_MS;
      const x = rect.x + (f.col + 0.5) * rect.cellSize;
      const y = rect.y + (f.row + 0.3) * rect.cellSize - 18 * t;
      const img = getUiFont(this.assets, f.variant);
      ctx.save();
      ctx.globalAlpha = t > 0.67 ? Math.max(0, 1 - (t - 0.67) / 0.33) : 1;
      if (fontMeta?.chars && uiReady(img)) {
        ctx.imageSmoothingEnabled = false;
        drawDamage(ctx, img.img, fontMeta, f.text, x, Math.round(y - fontMeta.cellH), 2);
      } else {
        ctx.fillStyle = '#f2d264';
        ctx.font = getFontString(12, true);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        drawText(ctx, f.text, x, y);
      }
      ctx.restore();
    }
    this._boardFloats = next;
  }

  _advanceAndDrawItemFx(rect, board, dtMs) {
    if (this._itemFx.length === 0) return;
    const next = [];
    for (const fx of this._itemFx) {
      fx.ageMs += dtMs;
      let alive = false;
      if (fx.kind === 'hammer') {
        alive = this._drawItemHit(rect, fx.cells[0], fx.ageMs);
      } else {
        fx.cells.forEach((c, i) => {
          const age = fx.ageMs - i * DETONATION_CONFIG.lineStepMs;
          if (age < 0 || this._drawEffectSprite(rect, `line_${fx.axis}_${c.seg}_${c.colorId}`, age, c.row, c.col)) alive = true;
        });
      }
      if (alive) next.push(fx);
    }
    this._itemFx = next;
  }

  // skills/sheets/hit.png(16x16 x3, 50/60/80ms, 흰 마스크) - 없으면 흰 사각 번쩍 1프레임 대체.
  _drawItemHit(rect, cell, ageMs) {
    const { ctx } = this;
    const frameMs = [50, 60, 80];
    let frame = 0;
    let acc = 0;
    while (frame < frameMs.length && ageMs >= acc + frameMs[frame]) acc += frameMs[frame++];
    if (frame >= frameMs.length) return false;
    const size = rect.cellSize;
    const x = rect.x + cell.col * size;
    const y = rect.y + cell.row * size;
    const hit = this.itemAssets?.hit;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (uiReady(hit)) drawImageSnapped(ctx, hit.img, frame * 16, 0, 16, 16, x, y, size, size);
    else if (frame === 0) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x + size * 0.2, y + size * 0.2, size * 0.6, size * 0.6);
    }
    ctx.restore();
    return true;
  }

  // this._simplePops(일반 매치 pop) + this._specialFx(line/bomb/box/color) 진행/그리기.
  // _drawBoard가 잼을 그린 바로 다음에 호출한다(README "이펙트는 잼보다 나중에 그리세요").
  _advanceAndDrawSpecialFx(rect, dtMs, nowMs) {
    if (this._simplePops.length > 0) {
      const next = [];
      for (const pop of this._simplePops) {
        pop.ageMs += dtMs;
        if (this._drawEffectSprite(rect, `pop_${pop.colorId}`, pop.ageMs, pop.row, pop.col)) next.push(pop);
      }
      this._simplePops = next;
    }

    if (this._specialFx.length === 0) return;
    const next = [];
    for (const fx of this._specialFx) {
      fx.ageMs += dtMs;
      // 아직 시작 전(_spawnDelayedFx로 미룬 조합 연쇄) - 그 칸들의 잼만 얼려 그려서, core가
      // 이미 지워버린 자리에 구멍이 보이지 않게 한다(README 점4와 같은 "그리기만 지연").
      if (fx.ageMs < 0) {
        for (const target of fx.targets) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs, target.special);
        if (fx.originGem && fx.ageMs >= (fx.originRevealAge ?? -Infinity)) {
          this._drawFrozenGemAt(rect, fx.row, fx.col, fx.originGem.colorId, nowMs, fx.originGem.special);
        }
        next.push(fx);
        continue;
      }
      while (fx.audioCues.length > 0 && fx.audioCues[0].at <= fx.ageMs) {
        const cue = fx.audioCues.shift();
        audio.play(cue.key, { step: cue.step });
      }
      if (fx.kind === 'line') this._drawLineFx(rect, fx, nowMs);
      else if (fx.kind === 'bomb') this._drawBombFx(rect, fx, nowMs);
      else if (fx.kind === 'box') this._drawBoxFx(rect, fx, nowMs);
      else if (fx.kind === 'color') this._drawColorFx(rect, fx, nowMs);
      else if (fx.kind === 'comboLead') this._drawComboLeadFx(rect, fx, nowMs);

      if (fx.ageMs > fx.totalLifeMs) {
        for (const target of fx.targets) this._specialFxReserved.delete(`${target.row},${target.col}`);
        if (fx.originGem) this._specialFxReserved.delete(`${fx.row},${fx.col}`);
        continue;
      }
      next.push(fx);
    }
    this._specialFx = next;
  }

  // 컬러 잼 fallback: 무지개 원(임시 도형).
  _drawColorGemFallback(ctx, cx, cy, size) {
    const radius = size / 2;
    const gradient = ctx.createConicGradient ? ctx.createConicGradient(0, cx, cy) : null;
    if (gradient) {
      RAINBOW.forEach((color, i) => gradient.addColorStop(i / RAINBOW.length, color));
      gradient.addColorStop(1, RAINBOW[0]);
      ctx.fillStyle = gradient;
    } else {
      ctx.fillStyle = RAINBOW[2];
    }
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, size * 0.06);
    ctx.stroke();
  }

  // 컬러 잼 shimmer idle: 캐시된 합성 위에 약하게 회전하는 하이라이트를 덧그린다(과하지 않게).
  _drawShimmerHighlight(cx, cy, size, nowMs, periodMs) {
    const { ctx } = this;
    const angle = (nowMs / periodMs) * Math.PI * 2;
    ctx.save();
    ctx.globalAlpha *= 0.35;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, size * 0.05);
    ctx.beginPath();
    ctx.arc(cx, cy, size * 0.42, angle, angle + Math.PI * 0.6);
    ctx.stroke();
    ctx.restore();
  }

  // 폭탄 잼 fallback: 원래 색 도형 위에 굵은 테두리.
  _drawBombMarker(ctx, cx, cy, size) {
    ctx.strokeStyle = '#1b1f2a';
    ctx.lineWidth = Math.max(2, size * 0.12);
    ctx.beginPath();
    ctx.arc(cx, cy, size / 2 - ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, size * 0.04);
    ctx.stroke();
  }

  // 라인 잼 fallback: 원래 색 도형 위에 방향을 나타내는 밝은 막대.
  _drawLineMarker(ctx, cx, cy, size, direction) {
    ctx.fillStyle = '#ffffff';
    const thickness = Math.max(2, size * 0.18);
    if (direction === 'vertical') {
      ctx.fillRect(cx - thickness / 2, cy - size / 2, thickness, size);
    } else {
      ctx.fillRect(cx - size / 2, cy - thickness / 2, size, thickness);
    }
  }

  // 박스 잼 fallback: 원래 색 도형 위에 흰 2x2 그리드 금(박스 느낌).
  _drawBoxMarker(ctx, cx, cy, size) {
    const half = size * 0.3;
    const gap = size * 0.06;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, size * 0.08);
    ctx.strokeRect(cx - half, cy - half, half - gap / 2, half - gap / 2);
    ctx.strokeRect(cx + gap / 2, cy - half, half - gap / 2, half - gap / 2);
    ctx.strokeRect(cx - half, cy + gap / 2, half - gap / 2, half - gap / 2);
    ctx.strokeRect(cx + gap / 2, cy + gap / 2, half - gap / 2, half - gap / 2);
  }

  // Animator.getEffects가 남긴 유일한 도형 - 특수 잼 생성(specialCreate)의 짧은 글로우.
  // 발동/조합/변환은 모두 assets/effects 스프라이트(_advanceAndDrawSpecialFx)가 그린다.
  _drawEffects(rect, effects) {
    if (!effects || effects.length === 0) return;
    const { ctx } = this;
    const { cellSize } = rect;

    for (const effect of effects) {
      if (effect.kind !== 'glow') continue;
      ctx.save();
      ctx.globalAlpha = Math.max(0, effect.opacity ?? 1);
      const cx = rect.x + (effect.col + 0.5) * cellSize;
      const cy = rect.y + (effect.row + 0.5) * cellSize;
      const color = effect.color ?? '#ffffff';
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = cellSize * 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, cellSize * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ------------------------------------------------------------
  // 파티클/화면흔들림: effects.json(settings/cascade/events)을 읽어 gameState.effects에
  // "새로" 나타난 항목과 방금 clearing이 시작된 칸들에 대해 파티클을 스폰하고, shake를 건다.
  // ------------------------------------------------------------

  _collectNewEffects(gameState, animator, boardRect) {
    const cfg = this.assets?.effectsConfig ?? {};
    const events = cfg.events ?? {};
    const settings = cfg.settings ?? {};
    const cascadeCfg = cfg.cascade ?? {};
    const intensity = settings.intensity ?? 1;

    for (const effect of gameState.effects) {
      if (this._seenEffects.has(effect)) continue;
      this._seenEffects.add(effect);

      // 히트스톱(§2) - "큰 조합"(comboActivate, 종류 무관) 적중마다 트리거.
      if (effect.type === 'comboActivate' && settings.hitstop) {
        this._hitstopRemainingMs = Math.max(this._hitstopRemainingMs, settings.hitstopMs ?? 50);
      }
      // 콤보 HUD 배너(§10) - comboChange가 tier 경계값과 정확히 같으면 마일스톤 문구.
      if (effect.type === 'comboChange') {
        const tier = COMBO_CONFIG.tiers.find((t) => t.min === effect.comboStreak);
        if (tier) this._comboMilestone = { label: t(tier.labelKey), elapsedMs: 0 };
      }

      // 방해요소 부서짐/폭발 스프라이트 애니메이션(파티클/흔들림과 별개 - effects.json
      // 설정 유무와 무관하게 항상 재생 시도한다).
      if (effect.type === 'obstacleDamaged' || effect.type === 'obstacleDestroyed' || effect.type === 'obstacleExpire') {
        this._spawnObstacleFx(effect);
      }
      if (effect.type === 'timeBombTimerAdded') {
        this._boardFloats.push({ row: effect.cell.row, col: effect.cell.col, text: `+${effect.add}`, variant: 'yellow', ageMs: 0 });
        this._bombBounce.set(`${effect.cell.row},${effect.cell.col}`, 0);
      }
      // 잼 터짐 이펙트(assets/effects) - line/bomb/box(일반)/color 발동마다 스프라이트
      // 재생 일정을 만든다(설정 유무와 무관하게 항상 시도 - obstacleFx와 같은 이유).
      if (effect.type === 'specialActivate') {
        // 변환형 조합으로 막 만들어진 특수 잼의 발동은 조합 리드인+캐리어 연출이 끝난 뒤에
        // 그린다(_deferComboChain - core의 순서/간격은 그대로).
        const chain = this._comboChainDelay;
        const key = `${effect.position.row},${effect.position.col}`;
        if (chain?.cells.has(key)) {
          chain.cells.delete(key);
          if (chain.cells.size === 0) this._comboChainDelay = null;
          const revealAge = chain.revealAtMs?.get(key);
          const delayMs = chain.delayMs + (chain.order.get(key) ?? 0) * chain.stepMs;
          const { carrier } = chain;
          const handed = carrier?.targets.find((t) => `${t.row},${t.col}` === key);
          if (handed) handed.handoff = true;
          for (const fx of this._spawnDelayedFx(effect, gameState.board, delayMs, { freezeOrigin: true })) {
            // carrier가 도착하는 바로 그 프레임부터 그린다(이미 도착했으면 즉시).
            if (revealAge != null && carrier) fx.originRevealAge = -delayMs + (revealAge - carrier.ageMs);
          }
        } else {
          // 연쇄로 터진 특수 잼은, 그 칸을 칠 연출(번개·줄기 등)이 아직 안 닿았으면 닿을 때까지 그리기만 미룬다.
          const holdMs = this._pendingHitMs(effect.position.row, effect.position.col);
          if (holdMs > 0) this._spawnDelayedFx(effect, gameState.board, holdMs, { freezeOrigin: true });
          else this._spawnSpecialFx(effect, gameState.board);
        }
      } else if (effect.type === 'comboActivate') {
        this._spawnComboFx(effect, gameState);
      }

      // 효과음(assets/sfx)은 effects.json에 particles/shake 항목이 없어도(hint 등) 독립적으로
      // 재생을 시도한다 - manifest/파일이 없으면 AudioManager가 조용히 무음 처리한다.
      this._playEffectSfx(effect);

      const key = this._effectConfigKey(effect);
      if (!key) continue;

      const eventCfg = events[key];
      if (!eventCfg) continue;

      const scale = this._cascadeScale(effect.cascadeIndex, cascadeCfg);
      const pos = effect.position ?? effect.cell;
      if (eventCfg.particles && pos) {
        this._spawnBurst(boardRect, pos.row, pos.col, eventCfg.particles, intensity * scale, this._colorForEffect(effect, eventCfg));
      }
      if (eventCfg.converge && effect.position) {
        this._spawnConvergeBurst(boardRect, effect.position.row, effect.position.col, eventCfg.converge, this._colorForEffect(effect, eventCfg));
      }
      if (eventCfg.shake && settings.screenShake) {
        this._triggerShake(eventCfg.shake.amount * intensity * scale, eventCfg.shake.life);
      }
      if (eventCfg.haptics && settings.haptics) {
        haptics[eventCfg.haptics]?.();
      }
    }

    // 일반 매치 제거 - Animator의 "방금 clearing 시작" 판정 상태를 매 프레임 갱신해야 하므로
    // 항상 호출한다. specialFx(line/bomb/box/color)가 이미 담당 중인 칸(_specialFxReserved)은
    // 제외한다 - 그 칸의 pop은 specialFx 자신의 지연 일정(hitMs 등)에 맞춰 따로 재생된다.
    const newlyClearing = animator.getNewlyClearingCells(gameState.board);
    // gem_pop_n은 연쇄 단계로 고른다. 같은 프레임에 여러 칸이 터져도 manifest의 minGapMs(25ms)가
    // 중복을 걸러낸다(README "한 프레임에 보석 20개가 터져도 소리가 뭉개지지 않게").
    const popStep = Math.max(1, gameState.cascadeCount || 1);
    for (const cell of newlyClearing) {
      if (this._specialFxReserved.has(`${cell.row},${cell.col}`)) continue;
      const colorId = GEM_TYPES[cell.value]?.id;
      if (!colorId) continue;
      this._simplePops.push({ row: cell.row, col: cell.col, colorId, ageMs: 0 });
      audio.play('gem_pop', { step: popStep });
    }

    // 한 이동에서 연쇄 5단계 처음 도달(cascadeCount는 유효 스왑마다 0으로 리셋된다).
    const cascade = gameState.cascadeCount ?? 0;
    if (cascade >= COMBO_GREAT_CASCADE && this._prevCascadeCount < COMBO_GREAT_CASCADE) audio.play('combo_great');
    this._prevCascadeCount = cascade;

    this._advanceTimeBombAudio(gameState.board);

    // 기존 파편 파티클(§1) - pop_{색} 스프라이트가 이미 번쩍임/산산조각/파편을 다 그리므로
    // 기본은 끈다. settings.legacyClearParticles:true로 다시 켤 수 있다.
    const clearCfg = events.clear;
    if (settings.legacyClearParticles && clearCfg?.particles && newlyClearing.length > 0) {
      for (const cell of newlyClearing) {
        const color = GEM_TYPES[cell.value]?.color ?? '#ffffff';
        this._spawnBurst(boardRect, cell.row, cell.col, clearCfg.particles, intensity, color);
      }
    }
  }

  // 효과음 이벤트 연결(assets/sfx/README.md "이벤트 연결") - effect 1개당 1번. 특수 잼
  // 발동(specialActivate)만 예외로, 이펙트 지연(stepMs/hitMs/wisp 도착)에 맞춰야 해서
  // _spawnSpecialFx가 만든 audioCues가 낸다.
  _playEffectSfx(effect) {
    switch (effect.type) {
      case 'specialCreate':
        audio.play('special_create');
        return;
      case 'shuffle':
        audio.play('shuffle');
        return;
      case 'hint':
        audio.play('hint');
        return;
      case 'obstacleDamaged':
        if (effect.id === 'stone') audio.play('stone_hit');
        return;
      case 'obstacleDestroyed':
        if (effect.id === 'crate') audio.play('crate_break');
        else if (effect.id === 'stone') audio.play('stone_break');
        return;
      case 'obstacleExpire':
        if (effect.id === 'timeBomb') audio.play('timebomb_explode');
        return;
      case 'comboActivate':
        for (const kind of new Set(String(effect.comboKind ?? '').split('_'))) {
          if (COMBO_SFX[kind]) audio.play(COMBO_SFX[kind], { step: effect.cascadeIndex ?? 1 });
        }
        return;
      default:
    }
  }

  // 시한폭탄 타이머(timebomb_tick / 남은 수 1이면 timebomb_warn) - core에 "줄어들었다" 이벤트가
  // 없어서 board.attachments의 timer를 직접 지켜본다. 층이 바뀌면 보드 객체가 바뀌므로 기억을
  // 비운다(같은 인덱스를 이전 보드 기준으로 오판하지 않게 - Animator.reset()과 같은 이유).
  _advanceTimeBombAudio(board) {
    const atts = board.attachments;
    if (!Array.isArray(atts)) return;
    if (this._bombBoard !== board) {
      this._bombTimers.clear();
      this._bombBoard = board;
    }
    let ticked = false;
    let warned = false;
    for (let i = 0; i < atts.length; i++) {
      const att = atts[i];
      if (att?.type !== 'timeBomb') {
        this._bombTimers.delete(i);
        continue;
      }
      const prev = this._bombTimers.get(i);
      if (prev != null && att.timer < prev) {
        ticked = true;
        if (att.timer === 1) warned = true;
      }
      this._bombTimers.set(i, att.timer);
    }
    if (warned) audio.play('timebomb_warn');
    else if (ticked) audio.play('timebomb_tick');
  }

  // 셔플 사운드 훅(§사운드 훅) - shuffleStart는 _collectNewEffects의 범용 "처음 봤을 때 1번"
  // 경로(_effectConfigKey)가 이미 낸다. 여기서는:
  // - shuffleLand: 칸이 착지하는 그 틱마다 - 같은 프레임에 여러 칸이 착지해도 1번만, 그리고
  //   마지막으로 낸 지 soundGapMs(기본 40ms) 안 지났으면 건너뛴다(스펙 "최소 40ms 간격"). 착지
  //   바운스 자체(세로 스케일 연출)는 animator의 computeShuffleFallPose가 이미 그려주므로 여기선
  //   손대지 않는다.
  // - shuffleSettle: effect가 gameState.effects에서 사라지는 순간 - core의 _advanceEffects가
  //   durationMs를 넘기면 바로 배열에서 빼버려 "끝난 그 틱"을 여기서 직접 볼 수 없으므로,
  //   "지난 프레임엔 있었는데 이번 프레임엔 없다"로 판정한다.
  // 흔들림/연출 줄이기(settings.reduceMotion)일 땐 떨어지기 단계가 없으므로 착지 사운드를
  // 건너뛴다(shuffleStart/Settle은 그대로 낸다).
  _advanceShuffleAudio(gameState) {
    const cfg = this.assets?.effectsConfig;
    const reduced = cfg?.settings?.reduceMotion;
    const shuffleAnim = cfg?.shuffleAnim;
    const { rows, cols } = gameState.board;
    const soundGapMs = shuffleAnim?.land?.soundGapMs ?? 40;
    const current = new Set();

    for (const effect of gameState.effects) {
      if (effect.type !== 'shuffle') continue;
      current.add(effect);
      let marks = this._shuffleAudioMarks.get(effect);
      if (!marks) {
        marks = { landedCells: new Set(), lastLandSoundMs: null };
        this._shuffleAudioMarks.set(effect, marks);
      }
      if (reduced || !shuffleAnim) continue;

      const timing = computeShuffleFallTiming(effect.seed, rows, cols, shuffleAnim);
      // animator가 그릴 때 쓰는 것과 같은 실효 경과 시간이어야 착지음이 화면과 맞는다
      // (입장 연출은 §0 비우기만큼 타임라인이 앞당겨져 있다).
      const elapsed = shuffleElapsedMs(effect, shuffleAnim);
      let landedNow = false;
      for (const move of effect.moves) {
        if (move.value === EMPTY || move.value === OBSTACLE) continue;
        const idx = move.to.row * cols + move.to.col;
        if (marks.landedCells.has(idx)) continue;
        if (elapsed >= timing[idx].landMs) {
          marks.landedCells.add(idx);
          landedNow = true;
        }
      }
      if (landedNow && (marks.lastLandSoundMs == null || elapsed - marks.lastLandSoundMs >= soundGapMs)) {
        marks.lastLandSoundMs = elapsed;
        audio.play('gem_land');
      }
    }

    for (const effect of this._shuffleAudioMarks.keys()) {
      if (!current.has(effect)) this._shuffleAudioMarks.delete(effect);
    }
  }

  _effectConfigKey(effect) {
    switch (effect.type) {
      case 'specialCreate':
        return 'specialCreate';
      case 'specialActivate':
        return `specialActivate_${effect.kind}`;
      case 'comboActivate':
        return `comboActivate_${effect.comboKind}`;
      case 'specialTransform':
        return 'specialTransform';
      case 'shuffle':
        // 시작(§사운드 훅) - scatter/settle은 elapsedMs를 지켜봐야 해서 이 범용 "처음 봤을
        // 때 1번" 경로로는 못 낸다(_advanceShuffleAudio가 따로 처리).
        return 'shuffleStart';
      case 'cellDetonate':
        // cellDetonate 이펙트엔 cause가 없다(core 변경 금지) - cause별로 나누지 않고 단일
        // 키로 묶는다(effects.json의 "_note_cellDetonate" 참고).
        return 'cellDetonate';
      case 'comboChange':
        return 'comboChange';
      case 'comboBreak':
        return 'comboBreak';
      case 'hint':
        return 'hint';
      // 방해요소(§obstacles) - id(crate/stone/timeBomb)별로 과하게 나누지 않고 단일 키로
      // 묶는다(cellDetonate와 같은 이유). 파편 파티클 정도만 내고, 실제 부서짐/폭발 연출은
      // _spawnObstacleFx가 따로 재생하는 스프라이트 애니메이션이 담당한다.
      case 'obstacleDamaged':
        return 'obstacleDamaged';
      case 'obstacleDestroyed':
        return 'obstacleDestroyed';
      case 'obstacleExpire':
        return 'obstacleExpire';
      default:
        return null;
    }
  }

  // comboActivate 색은 effects.json의 events.comboActivate_<kind>.color(= eventCfg.color)에서
  // 읽는다 - Animator.getEffects의 빔/버스트 색과 같은 소스라 한쪽만 바꿔도 어긋나지 않는다.
  _colorForEffect(effect, eventCfg) {
    if (effect.type === 'comboActivate') return eventCfg?.color ?? '#ffffff';
    if (effect.color != null) return GEM_TYPES[effect.color]?.color ?? '#ffffff';
    return '#ffffff';
  }

  _cascadeScale(cascadeIndex, cascadeCfg) {
    const step = cascadeCfg.scalePerStep ?? 0;
    const max = cascadeCfg.maxScale ?? Infinity;
    const idx = Math.max(0, (cascadeIndex ?? 1) - 1);
    return Math.min(max, 1 + step * idx);
  }

  _spawnBurst(boardRect, row, col, params, scaleMul, color) {
    const x = boardRect.x + (col + 0.5) * boardRect.cellSize;
    const y = boardRect.y + (row + 0.5) * boardRect.cellSize;
    this._spawnBurstAt(x, y, params, scaleMul, color);
  }

  // 인덱스 기반 각도 분배(원형으로 고르게 퍼지는 파편) - Math.random 대신 사용. 화면 절대
  // 좌표를 직접 받으므로 보드(퍼즐)/전투 패널 어느 쪽 이벤트에도 똑같이 쓸 수 있다.
  _spawnBurstAt(x, y, params, scaleMul, color, battle = false) {
    const count = Math.max(0, Math.round(params.count * scaleMul));
    const speed = params.speed * scaleMul;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      this._particles.spawn({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: params.life,
        color,
        size: params.size,
        shape: 'rect',
        battle,
      });
    }
  }


  // 특수 잼 생성(§5) - 생성 칸 둘레에서 안쪽(중심)으로 빨려드는 작은 파티클. _spawnBurstAt과
  // 반대로 바깥 링에서 스폰해 중심으로 선형 이동시킨다(수명 끝 = 도착).
  _spawnConvergeBurst(boardRect, row, col, params, color) {
    const cellSize = boardRect.cellSize;
    const cx = boardRect.x + (col + 0.5) * cellSize;
    const cy = boardRect.y + (row + 0.5) * cellSize;
    const count = Math.max(0, Math.round(params.count));
    const radius = cellSize * 0.9;
    const speed = radius / (params.life / 1000);
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const sx = cx + Math.cos(angle) * radius;
      const sy = cy + Math.sin(angle) * radius;
      this._particles.spawn({
        x: sx,
        y: sy,
        vx: -Math.cos(angle) * speed,
        vy: -Math.sin(angle) * speed,
        life: params.life,
        color,
        size: params.size,
        shape: 'rect',
      });
    }
  }

  // ------------------------------------------------------------
  // 전투 이벤트(towerAttack/enemyHit/enemyDie/wallDamaged) -> 파티클/화면흔들림.
  // 퍼즐 쪽 _collectNewEffects와 같은 패턴(config/effects.json의 events, _seenEffects로
  // 중복 스폰 방지)이지만 좌표계가 다르므로(보드 row/col이 아니라 전투 패널 화면 좌표)
  // 별도 메서드로 분리한다.
  // ------------------------------------------------------------

  _collectNewBattleEffects(battleState, battleLayout) {
    if (!battleState || !battleLayout) return;
    const cfg = this.assets?.effectsConfig ?? {};
    const events = cfg.events ?? {};
    const settings = cfg.settings ?? {};
    const cascadeCfg = cfg.cascade ?? {};
    const intensity = settings.intensity ?? 1;

    for (const event of battleState.events) {
      if (this._seenEffects.has(event)) continue;
      this._seenEffects.add(event);

      // 수리 망치: 성벽(전투 길 왼쪽 경계)을 따라 금색 작은 사각 파티클이 위로.
      if (event.type === 'wallHealed') {
        const { track } = battleLayout;
        for (let i = 0; i < 14; i++) {
          this._particles.spawn({
            x: track.x - 4 + ((i * 5) % 7) - 3,
            y: track.y + track.height * ((i + 0.5) / 14),
            vx: 0,
            vy: -40 - (i % 3) * 15,
            life: 600,
            color: '#f2d264',
            size: 2,
            shape: 'rect',
            battle: true,
          });
        }
        continue;
      }

      const eventCfg = events[event.type];
      if (!eventCfg) continue;

      const pos = this._battleEventPosition(event, battleState, battleLayout);
      if (!pos) continue;

      const scale = this._cascadeScale(event.cascadeIndex, cascadeCfg);
      if (eventCfg.particles) {
        this._spawnBurstAt(pos.x, pos.y, eventCfg.particles, intensity * scale, pos.color, true);
      }
      if (eventCfg.shake && settings.screenShake) {
        this._triggerShake(eventCfg.shake.amount * intensity * scale, eventCfg.shake.life);
      }
      if (eventCfg.haptics && settings.haptics) {
        haptics[eventCfg.haptics]?.();
      }
    }
  }

  // 전투 이벤트 타입별로 파티클을 스폰할 화면 좌표 + 색을 구한다. 대상(탑/적)을 찾을 수
  // 없으면(이미 배열에서 빠졌다거나) null을 돌려줘 그 이벤트는 조용히 건너뛴다.
  _battleEventPosition(event, battleState, battleLayout) {
    if (event.type === 'towerAttack') {
      const tower = battleState.towers?.find((t) => t.id === event.towerId);
      const point = this._battleRenderer.towerLaunchPoint(battleLayout.towerArea, battleState.towers ?? [], event.towerId, this.assets);
      if (!point) return null;
      return { ...point, color: this._gemHexColor(tower?.color) };
    }
    if (event.type === 'enemyHit' || event.type === 'enemyDie') {
      const enemy = battleState.enemies?.find((e) => e.id === event.enemyId);
      if (!enemy) return null;
      const point = this._battleRenderer.getEnemyPos(battleLayout.track, enemy);
      return { ...point, color: enemy.color ?? '#ffffff' };
    }
    if (event.type === 'wallDamaged') {
      const { wallBar } = battleLayout;
      return { x: wallBar.x + wallBar.width / 2, y: wallBar.y + wallBar.height / 2, color: '#ff6b6b' };
    }
    if (event.type === 'summonLand') {
      const { towerArea } = battleLayout;
      return { x: towerArea.x + towerArea.width / 2, y: towerArea.y + towerArea.height / 2, color: this._gemHexColor(event.color) };
    }
    return null;
  }

  _gemHexColor(colorId) {
    return GEM_TYPES.find((g) => g.id === colorId)?.color ?? '#ffffff';
  }

  // ------------------------------------------------------------
  // 퍼즐 -> 탑 빛줄기: spawnPuzzleToTowerBeam()으로 쌓인 항목을 매 프레임 진행시키고
  // 그린다. 보드 셀 중심(화면 좌표)에서 시작해 같은 색 탑 위치로 선형 보간하며 이동한다.
  // ------------------------------------------------------------

  _advanceAndDrawPuzzleBeams(ctx, boardRect, battleLayout, battleState, dtMs) {
    if (this._puzzleBeams.length === 0) return;
    const durationMs = this.assets?.effectsConfig?.puzzleToTower?.durationMs ?? 260;

    const next = [];
    for (const beam of this._puzzleBeams) {
      beam.elapsedMs += dtMs;
      if (beam.elapsedMs >= durationMs) continue;
      next.push(beam);

      if (!battleState || !battleLayout) continue;
      const tower = battleState.towers?.find((t) => t.color === beam.color);
      if (!tower) continue;
      const target = this._battleRenderer.towerLaunchPoint(battleLayout.towerArea, battleState.towers, tower.id, this.assets);
      if (!target) continue;

      const sx = boardRect.x + (beam.col + 0.5) * boardRect.cellSize;
      const sy = boardRect.y + (beam.row + 0.5) * boardRect.cellSize;
      const t = beam.elapsedMs / durationMs;
      const x = sx + (target.x - sx) * t;
      const y = sy + (target.y - sy) * t;
      const color = this._gemHexColor(beam.color);

      ctx.save();
      ctx.globalAlpha = 1 - t * 0.3;
      ctx.fillStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    this._puzzleBeams = next;
  }

  _triggerShake(amount, lifeMs) {
    if (!amount || !lifeMs) return;
    // 이미 더 강한 흔들림이 진행 중이면 덮어쓰지 않는다(폭탄 연쇄처럼 겹칠 때 과하게 떨리는
    // 것을 막는다).
    if (amount >= this._shakeAmount || this._shakeRemainingMs <= 0) {
      this._shakeAmount = amount;
      this._shakeTotalMs = lifeMs;
      this._shakeRemainingMs = lifeMs;
    }
  }

  // 각도 주파수를 고정값(37/53ms 주기)으로 둬서 Math.random 없이도 불규칙해 보이는 흔들림을 만든다.
  _updateShake(dtMs, nowMs) {
    if (this._shakeRemainingMs <= 0) {
      this._shakeX = 0;
      this._shakeY = 0;
      return;
    }
    this._shakeRemainingMs -= dtMs;
    if (this._shakeRemainingMs <= 0) {
      this._shakeX = 0;
      this._shakeY = 0;
      return;
    }
    const amp = this._shakeAmount * (this._shakeRemainingMs / this._shakeTotalMs);
    this._shakeX = Math.sin(nowMs / 37) * amp;
    this._shakeY = Math.cos(nowMs / 53) * amp;
  }

  // 최상단 재화 바 - 골드/다이아(아이콘+숫자) + 우측 "+"(상점) 버튼 자리. playerState는 main.js가
  // 넘겨주는 단일 소스 - 저장/상점이 생기면 이 객체 값만 바뀌면 된다.
  _drawCurrencyBar(rect, playerState, goldMul = 1) {
    const { ctx } = this;
    this._drawPanelIron(rect);
    ctx.save();

    const midY = rect.y + rect.height / 2;
    const iconSize = rect.height * 0.4;
    const fontSize = Math.max(10, rect.height * 0.3);
    ctx.font = getFontString(fontSize, true);

    let x = rect.x + 10;
    x = this._drawCurrencyPill(x, midY, iconSize, fontSize, 'icons/gold.png', HUD_CONFIG.currency.gold, playerState?.gold ?? 0, 'circle');
    if (goldMul > 1) {
      // 황금 주화(docs/items.md C2) - 켜진 층 동안 "x2"(데미지 폰트 yellow).
      const fontMeta = this.assets?.uiFont;
      const img = getUiFont(this.assets, 'yellow');
      const text = `x${goldMul}`;
      if (fontMeta?.chars && uiReady(img)) {
        ctx.imageSmoothingEnabled = false;
        let w = 1;
        for (const c of text) w += fontMeta.widths[c] - 1;
        drawDamage(ctx, img.img, fontMeta, text, x + 4 + w, Math.round(midY - fontMeta.cellH), 2);
        x += w * 2 + 8;
      } else {
        ctx.fillStyle = '#f2d264';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        drawText(ctx, text, x + 4, midY);
        x += ctx.measureText(text).width + 8;
      }
    }
    x += 14;
    this._drawCurrencyPill(x, midY, iconSize, fontSize, 'icons/diamond.png', HUD_CONFIG.currency.diamond, playerState?.diamonds ?? 0, 'diamond');

    const btnSize = rect.height * 0.64;
    const btnX = rect.x + rect.width - 10 - btnSize;
    const btnY = midY - btnSize / 2;
    this._drawIconButton('buttons/btn_plus.png', btnX + btnSize / 2, midY, btnSize, '+');

    ctx.restore();
    this.lastLayout.currencyPlusButton = { x: btnX, y: btnY, width: btnSize, height: btnSize };
  }

  // 재화 아이콘(골드/다이아) + 숫자 한 쌍을 그리고, 다음 요소가 시작할 x를 돌려준다. 이미지
  // 로드 실패 시에만 기존 원/다이아몬드 도형으로 폴백한다.
  _drawCurrencyPill(x, midY, iconSize, fontSize, iconPath, colors, value, shape) {
    const { ctx } = this;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const imgSize = 16 * 2; // icons/* 는 16x16 고정, 화면에는 2배
    const drawn = drawFixedImage(ctx, this.assets, iconPath, x + imgSize / 2, midY, 2);
    const usedIconSize = drawn ? imgSize : iconSize;
    if (!drawn) {
      ctx.fillStyle = colors.body;
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = Math.max(1, iconSize * 0.12);
      if (shape === 'diamond') {
        ctx.beginPath();
        ctx.moveTo(x + iconSize / 2, midY - iconSize / 2);
        ctx.lineTo(x + iconSize, midY - iconSize * 0.12);
        ctx.lineTo(x + iconSize / 2, midY + iconSize / 2);
        ctx.lineTo(x, midY - iconSize * 0.12);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x + iconSize / 2, midY, iconSize / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }

    ctx.font = getFontString(fontSize, true);
    // 1,000 형식. 값이 바뀔 때만 문자열을 다시 만든다(매 프레임 포맷 호출 방지).
    const cache = (this._currencyText ??= {});
    let cached = cache[iconPath];
    if (!cached || cached.value !== value) cached = cache[iconPath] = { value, text: fmt(value) };
    const text = cached.text;
    const textWidth = ctx.measureText(text).width;

    // panels/panel_inset(9-slice) - 골드/다이아 숫자 칸(README). 텍스트 폭에 맞춰 크기를
    // 정하고, 안쪽에 숫자를 코드로 그린다(규칙: 숫자는 항상 코드로 그린다).
    const insetPath = 'panels/panel_inset.png';
    const insetState = getUi(this.assets, insetPath);
    const insetMeta = getUiMeta(this.assets, insetPath);
    const padX = 6;
    const insetW = snap(textWidth + padX * 2);
    const insetH = snap(fontSize * 1.4);
    const insetX = x + usedIconSize + 6;
    const insetY = midY - insetH / 2;
    if (uiReady(insetState) && insetMeta?.slice) {
      ctx.imageSmoothingEnabled = false;
      drawNine(ctx, insetState.img, insetMeta.slice, insetX, insetY, insetW, insetH);
    }

    ctx.fillStyle = HUD_CONFIG.text.primary;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    drawText(ctx, text, insetX + padX, midY);
    ctx.restore();

    return insetX + insetW + 4;
  }

  // buttons/btn_plus·btn_pause(16x16 고정, 2배) - 아이콘 버튼 배경. 이미지가 없을 때만
  // 기존 돌출 패널 + 손으로 그린 글자/막대로 폴백한다.
  _drawIconButton(path, cx, cy, btnSize, fallbackGlyph) {
    const { ctx } = this;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const drawn = drawFixedImage(ctx, this.assets, path, cx, cy, 2);
    if (!drawn) {
      const bx = cx - btnSize / 2;
      const by = cy - btnSize / 2;
      ctx.fillStyle = HUD_CONFIG.panel.raised;
      ctx.fillRect(bx, by, btnSize, btnSize);
      ctx.strokeStyle = HUD_CONFIG.panel.raisedBorder;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx + 0.75, by + 0.75, btnSize - 1.5, btnSize - 1.5);
      ctx.fillStyle = HUD_CONFIG.text.primary;
      ctx.font = getFontString(btnSize * 0.6, true);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawText(ctx, fallbackGlyph, cx, cy);
    }
    ctx.restore();
  }

  // 보드 영역 상단 띠 - 점수/연쇄/콤보. 예전엔 캔버스 맨 위(전투 패널과 겹치는 위치)에
  // 그려졌던 것을 퍼즐 영역 안으로 옮긴 것.
  _drawScoreBar(rect, gameState) {
    const { ctx } = this;
    ctx.save();
    ctx.fillStyle = '#15181f';
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = HUD_CONFIG.panel.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(rect.x, rect.y + rect.height - 0.5);
    ctx.lineTo(rect.x + rect.width, rect.y + rect.height - 0.5);
    ctx.stroke();

    const midY = rect.y + rect.height / 2;
    const scoreFont = Math.max(13, rect.height * 0.42);
    ctx.textBaseline = 'middle';

    // panels/panel_inset(9-slice) - 점수 숫자 칸(README: "골드/다이아/점수 숫자 칸").
    // 숫자는 바 기준 폰트보다 작게 - 예전 크기(scoreFont 그대로)는 inset 9-slice 테두리를
    // 넘어가 패널을 덮었다.
    const numberFont = scoreFont * 0.78;
    ctx.font = getFontString(numberFont, true);
    const scoreText = `${gameState.score}`;
    const scoreTextWidth = ctx.measureText(scoreText).width;
    const insetPath = 'panels/panel_inset.png';
    const insetState = getUi(this.assets, insetPath);
    const insetMeta = getUiMeta(this.assets, insetPath);
    const padX = 6;
    let scoreTextX = rect.x + 10;
    if (uiReady(insetState) && insetMeta?.slice) {
      const insetW = snap(scoreTextWidth + padX * 2);
      // 테두리 4px x 2 + drawText 외곽선 2px 여유. 폰트에 비례시키면 작은 화면에서 테두리가 글자를 먹는다.
      const insetH = snap(numberFont + 12);
      ctx.imageSmoothingEnabled = false;
      drawNine(ctx, insetState.img, insetMeta.slice, rect.x + 10, midY - insetH / 2, insetW, insetH);
      scoreTextX = rect.x + 10 + padX;
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8e8e8';
    drawText(ctx, scoreText, scoreTextX, midY);

    // 옛 dim(#8a8296)은 바 배경(#15181f) 위에서 거의 안 보였다 - primary + 조금 크게.
    ctx.fillStyle = HUD_CONFIG.text.primary;
    ctx.font = getFontString(scoreFont * 0.72, true);
    drawText(ctx, t('hud.cascade', { count: gameState.cascadeCount }), rect.x + rect.width * 0.4, midY);

    // 콤보(연속 스트릭)(§10) - 항상 gameState의 현재 값에서 직접 그린다(이벤트로 캐시한 값을
    // 쓰면 프레임 드롭 시 보드와 어긋날 수 있다).
    if (gameState.comboStreak > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#f2d264';
      ctx.font = getFontString(scoreFont * 0.78, true);
      drawText(ctx, t('hud.combo', { count: gameState.comboStreak }), rect.x + rect.width - 10, rect.y + rect.height * 0.32);

      const barWidth = Math.min(80, rect.width * 0.22);
      const barHeight = Math.max(3, rect.height * 0.12);
      const barX = rect.x + rect.width - 10 - barWidth;
      const barY = rect.y + rect.height * 0.62;
      const ratio = Math.max(0, Math.min(1, gameState.comboStreakTimerMs / COMBO_CONFIG.timerMs));
      this._drawComboGauge(barX, barY, barWidth, barHeight, ratio);
    }

    ctx.restore();
    this._drawComboBanners();
  }

  // gauges/combo_frame(3-slice) + combo_fill_anim(또는 combo_fill) - 콤보 타이머 게이지.
  // 이미지가 없으면 기존 2중 사각형(틀+채움)으로 폴백한다.
  _drawComboGauge(barX, barY, barWidth, barHeight, ratio) {
    const { ctx } = this;
    const framePath = 'gauges/combo_frame.png';
    const frameState = getUi(this.assets, framePath);
    const frameMeta = getUiMeta(this.assets, framePath);

    if (uiReady(frameState) && frameMeta?.slice && frameMeta?.fill) {
      const k = 2;
      const w = snap(barWidth, k);
      const h = Math.max(frameState.img.height * k, barHeight);
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      drawNine(ctx, frameState.img, frameMeta.slice, barX, barY, w, h, k);

      const { x: fx, y: fy, h: fh, padRight } = frameMeta.fill;
      const fillX = barX + fx * k;
      const fillY = barY + fy * k;
      const fillH = fh * k;
      const fillW = Math.max(0, (w - fx * k - padRight * k) * ratio);
      if (fillW > 0) {
        const animPath = 'gauges/combo_fill_anim.png';
        const animState = getUi(this.assets, animPath);
        const animMeta = getUiMeta(this.assets, animPath);
        if (uiReady(animState) && animMeta?.frames) {
          const frameMs = animMeta.frameMs ?? 90;
          const frame = Math.floor(performance.now() / frameMs) % animMeta.frames;
          drawImageSnapped(ctx, animState.img, frame * animMeta.frameW, 0, animMeta.frameW, animMeta.frameH, fillX, fillY, fillW, fillH);
        } else {
          const fillState = getUi(this.assets, 'gauges/combo_fill.png');
          if (uiReady(fillState)) {
            drawImageSnapped(ctx, fillState.img, 0, 0, fillState.img.width, fillState.img.height, fillX, fillY, fillW, fillH);
          }
        }
      }
      ctx.restore();
      return;
    }

    ctx.fillStyle = '#3a4150';
    ctx.fillRect(barX, barY, barWidth, barHeight);
    ctx.fillStyle = '#f2d264';
    ctx.fillRect(barX, barY, barWidth * ratio, barHeight);
  }

  // 일시정지/승리/패배/탑 강화 팝업 - 하나만 동시에 뜰 수 있다(우선순위: 일시정지 > 탑 강화 > 전투 결과).
  // 탑 강화가 결과보다 앞인 이유: 클리어 팝업 "다음 층"이 강화 팝업을 띄운다(전투 중엔 강화 팝업이
  // 열려 있는 동안 전투가 멈추므로 결과 팝업과 겹칠 일이 없다).
  // 탑 강화는 레이아웃이 완전히 달라(탭+5줄 목록) 별도 메서드(_drawTowerUpgradePopup)로 그린다.
  // 그 외(일시정지/승리/패배)는 버튼 사각형을 lastLayout.popup.buttons에 저장해 main.js가 클릭 판정에 쓴다.
  _drawPopup(width, height, battleState, paused, clearReward, prepOpen, itemUi = null) {
    let kind = null;
    if (paused) kind = 'pause';
    else if (prepOpen) kind = null; // 정비 팝업(drawPrepPopup)이 main.js에서 따로 위에 그려진다.
    else if (battleState?.status === 'cleared') kind = 'win';
    else if (battleState?.status === 'failed') kind = 'lose';

    if (!kind) {
      this.lastLayout.popup = null;
      return;
    }

    const { ctx } = this;
    const cfg = HUD_CONFIG.popup;
    const cardWidth = Math.min(width * 0.72, 300);
    // 일시정지 팝업에만 효과음/배경음 슬라이더 + 음소거 줄이 더 붙는다(headH = 원래 카드 높이 -
    // 제목/설명/버튼 크기 계산은 그대로 두고 그 사이에 블록만 끼운다).
    const headH = cardWidth * 0.62;
    const audioBlockH = kind === 'pause' ? headH * 0.62 : 0;
    // 일시정지 = 인게임 설정 - 튜토리얼 다시 보기는 비활성 버튼 + 안내만(연습 모드는 메인 메뉴 설정에서, docs/tutorial.md 5장).
    const replayBlockH = kind === 'pause' ? headH * 0.34 : 0;
    // 패배 팝업 버튼(위에서부터): 부활(깃털) / 광고 보고 이어하기(docs/ads.md 2장) / 재도전 - 세로로 쌓는다(카드가 그만큼 길어짐).
    const btnGap = 8;
    const btnHeight = Math.max(32, headH * 0.22);
    const loseButtons = [];
    if (kind === 'lose') {
      if (itemUi?.canRevive) loseButtons.push(['revive', t('popup.button.revive')]);
      if (itemUi?.adContinue) loseButtons.push(['adContinue', t(itemUi.adBusy ? 'popup.button.adLoading' : itemUi.adContinue === 'free' ? 'popup.button.freeContinue' : 'popup.button.adContinue')]);
      loseButtons.push(['restart', t('popup.button.restart')]);
    }
    const stackH = Math.max(0, loseButtons.length - 1) * (btnHeight + btnGap);
    const cardHeight = headH + audioBlockH + replayBlockH + stackH;
    const cardX = (width - cardWidth) / 2;
    const cardY = (height - cardHeight) / 2;

    // 클리어 팝업은 얻은 골드를 본문에 더해 보여준다(docs/balance.md §8).
    const winDesc = clearReward ? t('popup.win.descGold', { total: clearReward.total }) : t('popup.win.desc');
    const TITLES = {
      pause: { text: t('popup.pause.title'), color: cfg.pauseColor, desc: t('popup.pause.desc') },
      win: { text: t('popup.win.title'), color: cfg.winColor, desc: winDesc },
      lose: { text: t('popup.lose.title'), color: cfg.loseColor, desc: performance.now() < (itemUi?.adFailUntil ?? 0) ? t('popup.lose.adFail') : t('popup.lose.desc') },
    };
    // 액션 순서의 첫 항목이 강조(primary) 버튼. 클리어는 "다음 층"을 눌러 진행한다(실패는
    // "다시 하기"로 같은 층을 재도전 - docs/balance.md §1·§3).
    const BUTTONS = {
      pause: [['resume', t('popup.button.resume')], ['restart', t('popup.button.restart')], ['exit', t('popup.button.exit')]],
      win: [['next', t('popup.button.next')]],
      // 부활(docs/items.md C3)·광고 이어하기는 main.js continueState 판정대로.
      lose: loseButtons,
    };

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = cfg.overlayColor;
    ctx.fillRect(screen.full.x, screen.full.y, screen.full.width, screen.full.height); // 블리드까지

    const popupPath = `popups/popup_${kind}.png`;
    const popupState = getUi(this.assets, popupPath);
    const popupMeta = getUiMeta(this.assets, popupPath);
    if (uiReady(popupState) && popupMeta?.slice) {
      ctx.imageSmoothingEnabled = false;
      drawNine(ctx, popupState.img, popupMeta.slice, cardX, cardY, snap(cardWidth), snap(cardHeight));
    } else {
      ctx.fillStyle = cfg.cardBg;
      ctx.fillRect(cardX, cardY, cardWidth, cardHeight);
      ctx.strokeStyle = cfg.cardBorder;
      ctx.lineWidth = 3;
      ctx.strokeRect(cardX + 1.5, cardY + 1.5, cardWidth - 3, cardHeight - 3);
    }

    // popups/emblem_{kind}(24x24) - 팝업 윗변 가운데에 반쯤 걸쳐서(README).
    drawFixedImage(ctx, this.assets, `popups/emblem_${kind}.png`, cardX + cardWidth / 2, cardY, 2);

    const title = TITLES[kind];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = title.color;
    ctx.font = getFontString(Math.max(16, headH * 0.16), true);
    drawText(ctx, title.text, cardX + cardWidth / 2, cardY + headH * 0.28);

    ctx.fillStyle = HUD_CONFIG.text.dim;
    ctx.font = getFontString(Math.max(11, headH * 0.08));
    drawText(ctx, title.desc, cardX + cardWidth / 2, cardY + headH * 0.48);

    const audioRects = audioBlockH > 0 ? this._drawAudioSettings(cardX + 14, cardY + headH * 0.6, cardWidth - 28, audioBlockH) : null;
    if (replayBlockH > 0) this._drawDisabledReplay(cardX + 14, cardY + headH * 0.6 + audioBlockH + 6, cardWidth - 28, replayBlockH - 6);

    const buttons = BUTTONS[kind];
    const vertical = kind === 'lose';
    const btnWidth = vertical ? cardWidth - 24 : (cardWidth - 24 - btnGap * (buttons.length - 1)) / buttons.length;
    const rects = {};

    buttons.forEach(([action, label], i) => {
      const bx = vertical ? cardX + 12 : cardX + 12 + i * (btnWidth + btnGap);
      const btnY = vertical ? cardY + cardHeight - 16 - btnHeight - (buttons.length - 1 - i) * (btnHeight + btnGap) : cardY + cardHeight - 16 - btnHeight;
      const disabled = action === 'adContinue' && itemUi?.adBusy; // 불러오는 중 - 반투명, 터치 판정 없음.
      if (disabled) ctx.globalAlpha = 0.5;
      const isPrimary = i === 0;
      const isGold = action === 'revive'; // 부활은 btn_gold + 깃털 아이콘(docs/items.md C3).

      // buttons/btn_primary·btn_secondary·btn_gold(9-slice) - 팝업 버튼(README). 이미지가 없으면
      // 기존 색 사각형으로 폴백한다.
      const btnPath = isGold ? 'buttons/btn_gold.png' : isPrimary ? 'buttons/btn_primary.png' : 'buttons/btn_secondary.png';
      const btnState = getUi(this.assets, btnPath);
      const btnMeta = getUiMeta(this.assets, btnPath);
      let textColor = isPrimary ? '#ffffff' : HUD_CONFIG.text.primary;
      if (uiReady(btnState) && btnMeta?.slice) {
        ctx.imageSmoothingEnabled = false;
        drawNine(ctx, btnState.img, btnMeta.slice, bx, btnY, snap(btnWidth), snap(btnHeight));
        // 부활만 밝은 글자(다른 btn_gold는 manifest의 어두운 글자 유지).
        textColor = isGold ? '#ffffff' : btnMeta.textColor ?? textColor;
      } else {
        ctx.fillStyle = isGold ? '#c28a20' : isPrimary ? cfg.primary : cfg.ghost;
        ctx.fillRect(bx, btnY, btnWidth, btnHeight);
        ctx.strokeStyle = cfg.cardBorder;
        ctx.lineWidth = 2;
        ctx.strokeRect(bx + 1, btnY + 1, btnWidth - 2, btnHeight - 2);
      }
      let labelX = bx + btnWidth / 2;
      if (isGold) {
        const iconSize = 14 * 2;
        const icon = this.itemAssets?.icons?.get('revive');
        const ix = Math.round(bx + 8);
        const iy = Math.round(btnY + btnHeight / 2 - iconSize / 2);
        ctx.imageSmoothingEnabled = false;
        if (uiReady(icon)) drawImageSnapped(ctx, icon.img, ix, iy, iconSize, iconSize);
        else drawItemIconFallback(ctx, 'revive', ix, iy, iconSize);
        labelX += iconSize / 2;
      } else if (action === 'adContinue' && itemUi.adContinue === 'ad') {
        // 재생 아이콘(새 PNG 없이 코드 삼각형, 팔레트 #f2d264).
        const s = Math.round(btnHeight * 0.36);
        const ix = Math.round(bx + 12);
        const iy = Math.round(btnY + btnHeight / 2);
        ctx.fillStyle = '#f2d264';
        ctx.beginPath();
        ctx.moveTo(ix, iy - s / 2);
        ctx.lineTo(ix + s * 0.87, iy);
        ctx.lineTo(ix, iy + s / 2);
        ctx.closePath();
        ctx.fill();
        labelX += s / 2;
      }
      ctx.fillStyle = textColor;
      ctx.font = getFontString(Math.max(11, btnHeight * 0.32), true);
      drawText(ctx, label, labelX, btnY + btnHeight / 2);
      ctx.globalAlpha = 1;
      if (!disabled) rects[action] = { x: bx, y: btnY, width: btnWidth, height: btnHeight };
    });

    ctx.restore();
    this.lastLayout.popup = { kind, buttons: rects, audio: audioRects };
  }

  // 비활성 "튜토리얼 다시 보기" 버튼(반투명, 터치 판정 없음) + 아래 안내 한 줄.
  _drawDisabledReplay(x, y, width, height) {
    const { ctx } = this;
    const btnH = Math.max(22, height * 0.55);
    const st = getUi(this.assets, 'buttons/btn_secondary.png');
    const meta = getUiMeta(this.assets, 'buttons/btn_secondary.png');
    ctx.save();
    ctx.globalAlpha = 0.45;
    if (uiReady(st) && meta?.slice) drawNine(ctx, st.img, meta.slice, x, y, snap(width), snap(btnH));
    else {
      ctx.fillStyle = HUD_CONFIG.popup.ghost;
      ctx.fillRect(x, y, width, btnH);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = HUD_CONFIG.popup.disabled;
    ctx.font = getFontString(Math.max(10, btnH * 0.42), true);
    drawText(ctx, t('tutorial.replay'), x + width / 2, y + btnH / 2);
    ctx.restore();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = HUD_CONFIG.text.dim;
    ctx.font = getFontString(Math.max(10, height * 0.2));
    drawText(ctx, t('tutorial.replayInGame'), x + width / 2, y + btnH + (height - btnH) / 2);
  }

  // 효과음/배경음 슬라이더 + 음소거 버튼(일시정지 팝업). 전용 UI 에셋이 없어 팝업 버튼의
  // 색 폴백과 같은 사각형으로 그린다. 반환값은 main.js가 터치 판정에 쓰는 사각형들 -
  // 슬라이더는 얇아서 세로로 넉넉한 히트 영역을 따로 돌려준다.
  _drawAudioSettings(x, y, width, height) {
    const { ctx } = this;
    const cfg = HUD_CONFIG.popup;
    const rowH = height / 3;
    const labelW = width * 0.3;
    const trackH = Math.max(6, rowH * 0.22);
    const rects = {};

    ctx.font = getFontString(Math.max(10, rowH * 0.34));
    [['sfx', t('menu.settings.sfx'), audio.sfxVolume], ['bgm', t('menu.settings.bgm'), audio.bgmVolume]].forEach(([channel, label, value], i) => {
      const cy = y + rowH * (i + 0.5);
      ctx.textAlign = 'left';
      ctx.fillStyle = HUD_CONFIG.text.primary;
      drawText(ctx, label, x, cy);

      const tx = x + labelW;
      const tw = width - labelW;
      ctx.fillStyle = cfg.ghost;
      ctx.fillRect(tx, cy - trackH / 2, tw, trackH);
      ctx.fillStyle = audio.muted ? cfg.disabled : cfg.primary;
      ctx.fillRect(tx, cy - trackH / 2, tw * value, trackH);
      const knobW = Math.max(6, trackH);
      ctx.fillStyle = HUD_CONFIG.text.primary;
      ctx.fillRect(tx + tw * value - knobW / 2, cy - trackH, knobW, trackH * 2);
      rects[channel] = { x: tx, y: cy - rowH / 2, width: tw, height: rowH };
    });

    const muteH = Math.max(20, rowH * 0.8);
    const muteY = y + rowH * 2 + (rowH - muteH) / 2;
    ctx.fillStyle = audio.muted ? cfg.primary : cfg.ghost;
    ctx.fillRect(x, muteY, width, muteH);
    ctx.strokeStyle = cfg.cardBorder;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, muteY + 1, width - 2, muteH - 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = HUD_CONFIG.text.primary;
    ctx.font = getFontString(Math.max(10, muteH * 0.42), true);
    drawText(ctx, t(audio.muted ? 'menu.settings.unmute' : 'menu.settings.mute'), x + width / 2, muteY + muteH / 2);
    rects.mute = { x, y: muteY, width, height: muteH };

    ctx.textAlign = 'center';
    return rects;
  }

  get inventoryTab() {
    this._inventoryTab ??= new InventoryTab();
    return this._inventoryTab;
  }

  // ItemBarRenderer 칸·숫자 그리기를 지금 ctx/에셋에 묶어 넘긴다(인벤토리 탭·획득 팝업 공용).
  _slotDrawers() {
    const { ctx, assets } = this;
    const icons = this.itemAssets?.icons;
    return {
      drawSlot: (x, y, id, opts, k = 2) => this.itemBar.drawSlot(ctx, assets, icons, id, Math.round(x), Math.round(y), k, opts),
      drawNumber: (text, right, bottom) => this.itemBar._drawNumber(ctx, assets, text, right, bottom, 2, 'bottomRight'),
    };
  }

  // 정비 팝업(src/render/ui/prepPopup.js) - 전투 화면·메인 메뉴 어느 scene 위에든 덮는다. view에 석상·보관함 그리기를
  // 묶어 넘기고, 판정에 쓸 layout을 prepLayout에 남긴다(main.js hitPrepPopup).
  drawPrepPopup(state, itemUi) {
    const { ctx, cssWidth: width, cssHeight: height } = this;
    if (width === 0 || height === 0) return;
    const layout = layoutPrepPopup(width, height, state.context, state.tab);
    this._prepItemUi = itemUi;
    state.view.drawStatue ??= (c, color, cx, cy, size) => this._battleRenderer.drawTowerIcon(c, this.assets, color, cx, cy, size);
    state.view.drawVault ??= (rect) =>
      this._prepItemUi?.config && this._prepItemUi.inventory ? this.inventoryTab.draw(this.ctx, rect, this.assets, this._prepItemUi, this._slotDrawers(), performance.now()) : null;
    drawPrepPopup(ctx, this.assets, state, layout);
    this.prepLayout = layout;
  }

  // 랭킹 팝업(src/render/ui/rankingPopup.js) - 메인 메뉴 위. ui = src/game/rankingUi.js(그릴 값 + 판정용 layout 보관).
  drawRankingPopup(ui, nowMs) {
    const { ctx, cssWidth: width, cssHeight: height } = this;
    if (width === 0 || height === 0 || !ui.isOpen) return;
    const icons = this.itemAssets?.icons;
    this._rankItemIcon ??= (id) => {
      const st = this.itemAssets?.icons?.get(id);
      return st && st.loaded && !st.failed ? st.img : null;
    };
    const st = ui.view(nowMs, icons ? this._rankItemIcon : null);
    const layout = layoutRankingPopup(width, height, st);
    drawRankingPopup(ctx, this.assets, st, layout);
    ui.afterDraw(layout);
  }

  // 공통 획득 팝업 - 어떤 scene을 그린 뒤든 맨 위에(main.js loop).
  drawRewardPopup(rewardPopup) {
    if (!rewardPopup.active || this.cssWidth === 0) return;
    rewardPopup.draw(this.ctx, this.cssWidth, this.cssHeight, this.assets, this._slotDrawers());
  }

  // 콤보 마일스톤("Great!" 등)/브레이크 peak 문구 - render()가 매 프레임 _advanceComboBanners로
  // 늙힌 로컬 상태만 읽는다(렌더 전용, gameState에 없음).
  _drawComboBanners() {
    if (!this._comboMilestone) return;
    const { ctx } = this;
    const cx = this.cssWidth / 2;
    const cy = this.cssHeight / 3;

    if (this._comboMilestone) {
      const { label, elapsedMs } = this._comboMilestone;
      const t = Math.min(1, elapsedMs / COMBO_CONFIG.milestoneDurationMs);
      const popScale = t < 0.2 ? Math.max(0.01, t / 0.2) : 1;
      const alpha = t > 0.6 ? Math.max(0, 1 - (t - 0.6) / 0.4) : 1;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffe066';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = getFontString(Math.round(32 * popScale));
      drawText(ctx, label, cx, cy);
      ctx.restore();
    }
  }

  // render()가 매 프레임 호출 - 마일스톤/브레이크 배너의 수명을 늙히고 끝나면 지운다.
  _advanceComboBanners(dtMs) {
    if (this._comboMilestone) {
      this._comboMilestone.elapsedMs += dtMs;
      if (this._comboMilestone.elapsedMs >= COMBO_CONFIG.milestoneDurationMs) this._comboMilestone = null;
    }
  }
}
