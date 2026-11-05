import { EMPTY, OBSTACLE } from '../core/board.js';
import { GEM_TYPES } from '../config/gems.js';
import { SPECIAL_GEM_CONFIG } from '../config/specialGems.js';
import { HINT_CONFIG } from '../config/hint.js';
import { COMBO_CONFIG } from '../config/combo.js';
import { HUD_CONFIG } from '../config/hud.js';
import { computeLayout } from './layout.js';
import { ParticlePool } from './effects/particlePool.js';
import { BattleRenderer } from './battleRenderer.js';
import { haptics } from '../platform/haptics.js';
import { AudioPlayer } from '../platform/audio.js';
import { drawNine, drawFixedImage, drawText, getUi, getUiMeta, snap, uiReady } from './uiKit.js';
import { t } from '../config/i18n.js';
import { getFontString } from '../config/fonts.js';
import { boltPath, drawPixelBolt } from './effects/pixelBolt.js';

const RAINBOW = ['#e74c3c', '#f1c40f', '#2ecc71', '#3498db', '#9b59b6'];
const DEFAULT_MAX_PARTICLES = 240;

// assets/effects/manifest.json 애니메이션 하나의 프레임 번호를 ageMs로 찾는다.
// frameMs는 숫자(고정 길이, box_soul/color_wisp처럼 loop:true) 또는 배열(프레임마다
// 다른 길이)일 수 있다(README 참고). loop가 아닌데 ageMs가 전체 길이를 넘으면 -1(끝남).
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
    this.dpr = 1;
    this.lastLayout = null;

    // setAssets()로 주입되기 전까지는 null - render()는 이 상태에서도 전부 색/도형
    // fallback으로 그려야 한다.
    this.assets = null;

    this._particles = new ParticlePool(DEFAULT_MAX_PARTICLES);
    this._battleRenderer = new BattleRenderer();
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
    this._lightningCache = new Map();
    this._lightningActiveKeys = new Set();
    this._boxLightningSegments = [];

    // 폭탄 충격파(§3) 대상 effect 참조만 담는 재사용 배열(소스=gameState.effects 항목 그대로).
    this._shockwaveSources = [];
    this._shockwaveScratch = { x: 0, y: 0 };

    // 콤보 마일스톤/브레이크 배너 - 렌더 전용 임시 상태(gameState에 넣지 않는다, §10).
    this._comboMilestone = null; // { label, elapsedMs }
    this._comboBreakDisplay = null; // { streak, elapsedMs }

    this._audioPlayer = new AudioPlayer(null);

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
    this._boltCanvas = null;
    this._boltCtx = null;

    this._lastFrameTime = null;

    // 셔플 연출(§셔플 애니메이션) - 2단계 시작/끝 사운드 훅은 elapsedMs 경계를 지켜봐야 해서
    // _seenEffects의 "처음 봤을 때 1번"으로는 못 낸다. effect 객체 참조를 키로 "scatter를
    // 이미 냈는지"만 들고 있다가, 다음 프레임에 그 effect가 gameState.effects에서 더 이상
    // 안 보이면(= durationMs를 넘어 제거됨) 그 순간 shuffleSettle을 낸다.
    this._shuffleAudioMarks = new Map();
  }

  // assetLoader.loadAssets()의 결과를 주입한다. 호출 전에는 this.assets가 null이라
  // 전부 fallback 도형으로 그려진다.
  setAssets(assets) {
    this.assets = assets;
    const maxParticles = assets?.effectsConfig?.settings?.maxParticles ?? DEFAULT_MAX_PARTICLES;
    if (maxParticles !== this._particles.particles.length) {
      this._particles = new ParticlePool(maxParticles);
    }
    this._audioPlayer.setConfig(assets?.soundsConfig);
  }

  // CSS 픽셀 크기와 devicePixelRatio를 받아 캔버스 실제 해상도를 맞춘다.
  resize(cssWidth, cssHeight, dpr) {
    this.cssWidth = cssWidth;
    this.cssHeight = cssHeight;
    this.dpr = dpr;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // 타이틀 화면(titleScreen.js) - ctx/css 크기만 공유하고 그리기는 TitleScreen이 직접 한다.
  drawTitle(titleScreen, now, dtMs) {
    const { ctx, cssWidth: width, cssHeight: height } = this;
    titleScreen.draw(ctx, width, height, dtMs, now);
  }

  // 메인 메뉴(mainMenuScreen.js) - ctx/css 크기만 공유하고 그리기는 MainMenuScreen이 직접 한다.
  drawMainMenu(mainMenuScreen, playerState, now) {
    const { ctx, cssWidth: width, cssHeight: height } = this;
    mainMenuScreen.draw(ctx, width, height, playerState, now);
  }

  render(gameState, animator, battleState, hintCell = null, playerState = null, paused = false, battleHud = null, clearReward = null, upgradeTowerIndex = null, upgradeTab = 'levelUp') {
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

    ctx.clearRect(0, 0, width, height);

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
    for (const cell of animator.getNewlySettledCells(board)) {
      this._landingSquashes.set(`${cell.row},${cell.col}`, { elapsedMs: 0 });
    }

    const shockwaveSources = this._collectShockwaveSources(gameState);
    const boxLightningSegments = this._collectBoxLightningSegments(gameState);

    ctx.save();
    ctx.translate(this._shakeX, this._shakeY);

    this._drawCurrencyBar(layout.currencyBar, playerState);
    this._drawBattlePanel(layout.battle);
    if (battleState) this._battleRenderer.draw(ctx, layout.battle, battleState, now, this.assets, battleHud, paused);
    this.lastLayout.pauseButton = battleLayout?.pauseButton ?? null;
    this.lastLayout.battle = battleLayout ? { ...layout.battle, towerArea: battleLayout.towerArea } : null;
    this._drawBoard(
      layout.board,
      animator.getDisplayList(board, gameState, this.assets?.effectsConfig),
      animator.getObstacleDisplayList(board),
      animator.getEffects(gameState, this.assets?.effectsConfig),
      shockwaveSources,
      boxLightningSegments,
      now,
      dtMs,
      hintCell,
      gameState.effects.find((e) => e.type === 'shuffle')
    );
    this._drawScoreBar(layout.scoreBar, gameState);
    this._advanceAndDrawPuzzleBeams(ctx, layout.board, battleLayout, battleState, dtMs);
    // 시한폭탄 폭발 후 성벽으로 날아가는 볼트/벽 히트 - 보드 클립 밖(전투 영역)까지 이동하므로
    // _drawBoard 밖(퍼즐->탑 빔과 같은 레이어)에서 그린다.
    this._advanceAndDrawObstacleBombFlights(ctx, layout.board, battleLayout, dtMs);
    this._drawActionBar(layout.actionBar);

    ctx.restore();

    // 팝업(일시정지/승리/패배/탑 강화)은 화면 흔들림 영향을 받지 않도록 shake translate 밖에서 그린다.
    this._drawPopup(width, height, battleState, paused, clearReward, upgradeTowerIndex, upgradeTab, battleHud);
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
        ctx.drawImage(state.img, x, y, slotSize, slotSize);
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

  _drawBoard(rect, displayList, obstacleList, effects, shockwaveSources, boxLightningSegments, nowMs, dtMs, hintCell, shuffleFx) {
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
          ctx.drawImage(tile.img, 0, 0, tile.img.width, tile.img.height, x, y, cellSize, cellSize);
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
    for (const item of displayList) (item.special ? specialItems : normalItems).push(item);
    for (const item of normalItems) this._drawDisplayItem(rect, item, shockwaveSources, shockwaveCfg, nowMs, hintCell);
    for (const item of specialItems) this._drawDisplayItem(rect, item, shockwaveSources, shockwaveCfg, nowMs, hintCell);

    // 잼 터짐 이펙트(assets/effects) - 일반 pop + line/bomb/box/color 발동 스프라이트.
    // 잼을 그린 바로 다음(README "이펙트는 잼보다 나중에").
    this._advanceAndDrawSpecialFx(rect, dtMs, nowMs);

    // occupant(상자·돌) - 잼 다음에 그린다(assets/obstacles/README.md "순서(권장)").
    this._drawOccupants(rect, obstacleList);
    // 시한폭탄 오버레이 + 남은 횟수 숫자 - occupant 다음.
    this._drawTimeBombOverlays(rect, displayList, nowMs);

    this._drawBoxLightning(rect, boxLightningSegments, nowMs);
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
    ctx.drawImage(state.img, cx - imageSize / 2, cy - imageSize / 2, imageSize, imageSize);
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
    ctx.drawImage(anim.state.img, frame * anim.frameW, 0, anim.frameW, anim.frameH, cx - imageSize / 2, cy - imageSize / 2, imageSize, imageSize);
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
    const oy = cy - half * s + (centerY - Math.floor(glyphH / 2)) * s;
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    [...text].forEach((ch, i) => {
      ctx.drawImage(state.img, Number(ch) * glyphW, rowIdx * glyphH, glyphW, glyphH, ox + i * 4 * s, oy, glyphW * s, glyphH * s);
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
    ctx.drawImage(
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

    // 잼 에셋은 48px 이미지(몸통 32px + 효과용 여백 8px씩) - 칸 크기에 맞춰 늘리거나
    // 줄이지 않고, 몸통이 항상 칸 크기와 같아지는 배율로 칸 중심에 맞춰 그린다(README 참고).
    // 그래서 이미지 전체(여백 포함)는 칸보다 커지고, 그 여백은 옆 칸으로 살짝 번진다.
    const tileSize = this.assets?.gemTileSize ?? 48;
    const bodySize = this.assets?.gemBodySize ?? 32;
    const bodyRatio = bodySize / tileSize;
    const baseImageSize = tileSize * (cellSize / bodySize);

    const baseScale = scale * hintScale * armedScale;
    const sizeX = baseImageSize * baseScale * squashX;
    const sizeY = baseImageSize * baseScale * squashY;
    const cx = cellX + cellSize / 2 + armedOffsetX;
    const cy = cellY + cellSize / 2 + armedOffsetY;
    const x = cx - sizeX / 2;
    const y = cy - sizeY / 2;

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
      ctx.drawImage(anim.state.img, frame * anim.frameW, 0, anim.frameW, anim.frameH, x, y, w, h);
      return;
    }

    const staticState = variant === null ? this.assets?.gemColorImage : this.assets?.gemImages?.get(`${colorId}_${variant}`);
    if (staticState && staticState.loaded && !staticState.failed) {
      ctx.drawImage(staticState.img, x, y, w, h);
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
    const phases = cfg?.shuffleAnim?.phases;
    if (!phases) return;

    const elapsed = shuffleFx.elapsedMs;
    let opacity;
    if (elapsed < phases.popMs) {
      opacity = elapsed / phases.popMs;
    } else if (elapsed < phases.scatterMs) {
      opacity = 1;
    } else {
      opacity = 1 - Math.min(1, (elapsed - phases.scatterMs) / Math.max(1, phases.totalMs - phases.scatterMs));
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
  // 박스 잼 체인 라이트닝(§9) - core를 바꾸지 않고 gameState.effects에 이미 있는 필드만으로
  // source->target 쌍을 매 프레임 다시 유도한다(이벤트가 살아있는 동안만 존재 - 보드/화면
  // 어긋남 걱정 없음).
  // ------------------------------------------------------------

  _collectBoxLightningSegments(gameState) {
    const segments = this._boxLightningSegments;
    segments.length = 0;
    const effects = gameState.effects;

    for (const effect of effects) {
      // 단독 박스 발동(specialActivate kind=box)의 번개는 더 이상 여기서 그리지 않는다 -
      // _spawnSpecialFx/_drawBoxFx가 README #4의 픽셀 번개(drawPixelBolt)로 그린다.
      // 조합(box_box/box_line/box_bomb/box_color)의 번개는 이번 작업 범위 밖이라 기존
      // sin/cos 지그재그 라이트닝을 그대로 쓴다.
      if (effect.type === 'comboActivate' && effect.comboKind === 'box_box') {
        for (const cell of effect.affected) segments.push({ source: effect.position, target: cell });
      } else if (
        effect.type === 'comboActivate' &&
        (effect.comboKind === 'box_line' || effect.comboKind === 'box_bomb' || effect.comboKind === 'box_color')
      ) {
        // 변환형 조합: affected엔 스왑한 두 칸만 있다 - 실제 번개 타겟은 같은 cascadeIndex로
        // 같이 push되는 specialTransform.cells(+box_color는 노랜덤 타겟 specialActivate(box))다.
        for (const other of effects) {
          if (other.type === 'specialTransform' && other.cascadeIndex === effect.cascadeIndex) {
            for (const cell of other.cells) segments.push({ source: effect.position, target: cell });
          }
          if (
            effect.comboKind === 'box_color' &&
            other.type === 'specialActivate' &&
            other.kind === 'box' &&
            other.cascadeIndex === effect.cascadeIndex
          ) {
            for (const cell of other.affected) segments.push({ source: effect.position, target: cell });
          }
        }
      }
    }
    return segments;
  }

  _drawBoxLightning(rect, segments, nowMs) {
    if (!segments || segments.length === 0) {
      if (this._lightningCache.size > 0) this._lightningCache.clear();
      return;
    }

    const cfg = this.assets?.effectsConfig?.boxLightning ?? {};
    const recomputeMs = cfg.recomputeMs ?? 70;
    const bucket = Math.floor(nowMs / recomputeMs);
    const { ctx } = this;
    const cellSize = rect.cellSize;
    const wideWidth = Math.max(1, cellSize * (cfg.wideWidthRatio ?? 0.22));
    const thinWidth = Math.max(1, cellSize * (cfg.thinWidthRatio ?? 0.045));
    const color = cfg.color ?? '#8ef7ff';

    const activeKeys = this._lightningActiveKeys;
    activeKeys.clear();

    for (const seg of segments) {
      const key = `${seg.source.row},${seg.source.col}>${seg.target.row},${seg.target.col}`;
      activeKeys.add(key);
      let entry = this._lightningCache.get(key);
      if (!entry) {
        entry = { points: [], lastBucket: -1 };
        this._lightningCache.set(key, entry);
      }
      if (entry.lastBucket !== bucket) {
        this._computeLightningPoints(entry.points, seg.source, seg.target, rect, cfg, bucket);
        entry.lastBucket = bucket;
      }

      this._strokeLightningPath(ctx, entry.points, wideWidth, color, cfg.wideAlpha ?? 0.35);
      this._strokeLightningPath(ctx, entry.points, thinWidth, '#ffffff', 1);
    }

    for (const key of this._lightningCache.keys()) {
      if (!activeKeys.has(key)) this._lightningCache.delete(key);
    }
  }

  // points는 호출부가 들고 있는 flat [x0,y0,x1,y1,...] 배열을 그 자리에서 다시 채운다(매
  // 재계산마다 새 배열을 만들지 않는다). bucket은 nowMs를 recomputeMs로 나눈 정수 - 같은
  // bucket 동안은 항상 같은 점을 돌려줘서(결정적) "재계산 주기와 맞는 살아있는" 느낌을 낸다.
  _computeLightningPoints(points, source, target, rect, cfg, bucket) {
    const { cellSize } = rect;
    const sx = rect.x + (source.col + 0.5) * cellSize;
    const sy = rect.y + (source.row + 0.5) * cellSize;
    const tx = rect.x + (target.col + 0.5) * cellSize;
    const ty = rect.y + (target.row + 0.5) * cellSize;
    const segments = cfg.segments ?? 6;
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const jitterAmp = cellSize * (cfg.jitterRatio ?? 0.18);

    points.length = 0;
    points.push(sx, sy);
    for (let i = 1; i < segments; i++) {
      const t = i / segments;
      const baseX = sx + dx * t;
      const baseY = sy + dy * t;
      // 고정 주파수 sin/cos 조합(Math.random 금지) - bucket이 바뀔 때만 값이 바뀐다.
      const wave = Math.sin(bucket * 0.9 + i * 1.7) + Math.cos(bucket * 1.3 + i * 2.3);
      const offset = jitterAmp * wave * 0.5;
      points.push(baseX + nx * offset, baseY + ny * offset);
    }
    points.push(tx, ty);
  }

  _strokeLightningPath(ctx, points, width, color, alpha) {
    if (points.length < 4) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.stroke();
    ctx.restore();
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

  _spawnSpecialFx(effect, board) {
    const { kind, position, affected } = effect;
    if (kind === 'box' && effect.color != null) return; // box+color 조합 전용 경로 - 손대지 않는다(animator.js 참고).

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
        targets.push({ row: cell.row, col: cell.col, colorId: targetColorId, fireAtMs, seg });
        this._specialFxReserved.add(`${cell.row},${cell.col}`);
      }
      this._specialFx.push({ kind: 'line', direction: effect.direction, row: position.row, col: position.col, colorId, ageMs: 0, totalLifeMs: maxEnd, targets });
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
        targets.push({ row: cell.row, col: cell.col, colorId: targetColorId, fireAtMs: hitMs });
        this._specialFxReserved.add(`${cell.row},${cell.col}`);
      }
      this._specialFx.push({ kind: 'bomb', row: position.row, col: position.col, colorId, ageMs: 0, totalLifeMs: maxEnd, targets });
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
        targets.push({ row: cell.row, col: cell.col, colorId: targetColorId, seed, boltCache: null });
        this._specialFxReserved.add(`${cell.row},${cell.col}`);
      }
      this._specialFx.push({ kind: 'box', row: position.row, col: position.col, colorId, ageMs: 0, totalLifeMs: maxEnd, targets, cfg });
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
        targets.push({ row: cell.row, col: cell.col, colorId: targetColorId, flightMs });
        this._specialFxReserved.add(`${cell.row},${cell.col}`);
      }
      this._specialFx.push({ kind: 'color', row: position.row, col: position.col, ageMs: 0, totalLifeMs: maxEnd, targets, waveStartMs });
    }
  }

  // ageMs 기준으로 한 프레임을 cx,cy(화면 픽셀, 칸 중심 기준 아님 - 이미 중심 좌표로 받는다)에
  // 그린다. 배율은 cellSize/32(README "칸 크기가 64px가 아니면 배율 = 칸 크기/32").
  _drawEffectSpriteAtPx(rect, animKey, ageMs, px, py) {
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
    ctx.drawImage(anim.state.img, frame * anim.frameW, 0, anim.frameW, anim.frameH, cx - w / 2, cy - h / 2, w, h);
    ctx.restore();
    return true;
  }

  // row,col(칸 단위, 소수 가능 - color_wisp 비행 중간 위치 등)을 칸 중심 픽셀로 바꿔 그린다.
  _drawEffectSprite(rect, animKey, ageMs, row, col) {
    return this._drawEffectSpriteAtPx(rect, animKey, ageMs, (col + 0.5) * 32, (row + 0.5) * 32);
  }

  // 아직 터지지 않은 칸의 원래 잼을 흔들림/줄어듦 없이 그대로 그린다(specialFx가 core의
  // clearing/falling보다 그리기를 늦추는 동안 - README 점4, "보드 데이터는 그대로 두고
  // 그리기만 지연시켜"). 그 자리를 완전히 덮으므로 Animator가 그 사이 그린 다른 내용(이미
  // 새로 채워진 잼 등) 위에 그대로 올라간다.
  _drawFrozenGemAt(rect, row, col, colorId, nowMs) {
    const gem = GEM_TYPES.find((g) => g.id === colorId);
    if (!gem) return;
    const { cellSize } = rect;
    const tileSize = this.assets?.gemTileSize ?? 48;
    const bodySize = this.assets?.gemBodySize ?? 32;
    const bodyRatio = bodySize / tileSize;
    const imageSize = tileSize * (cellSize / bodySize);
    const cx = rect.x + (col + 0.5) * cellSize;
    const cy = rect.y + (row + 0.5) * cellSize;
    const { ctx } = this;
    ctx.save();
    ctx.imageSmoothingEnabled = this.assets?.gemImageSmoothing ?? false;
    this._drawGemImage(gem, 'normal', cx - imageSize / 2, cy - imageSize / 2, imageSize, imageSize, nowMs, row, col, bodyRatio);
    ctx.restore();
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
    const colorCfg = this.assets?.effectFxManifest?.box?.colors?.[fx.colorId] ?? {};
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
    ctx.drawImage(this._boltCanvas, 0, 0, w, h, rect.x + minX * scale, rect.y + minY * scale, w * scale, h * scale);
    ctx.restore();

    return head ? { x: head[0] + minX, y: head[1] + minY } : null;
  }

  // 줄 잼 발동(README #2) - 잼(얼려두기) -> pop -> line 세그먼트 -> origin 순으로 그린다.
  _drawLineFx(rect, fx, nowMs) {
    for (const target of fx.targets) {
      if (fx.ageMs < target.fireAtMs) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs);
    }
    const axis = fx.direction === 'vertical' ? 'v' : 'h';
    for (const target of fx.targets) {
      if (fx.ageMs < target.fireAtMs) continue;
      const localAge = fx.ageMs - target.fireAtMs;
      this._drawEffectSprite(rect, `pop_${target.colorId}`, localAge, target.row, target.col);
      this._drawEffectSprite(rect, `line_${axis}_${target.seg}_${target.colorId}`, localAge, target.row, target.col);
    }
    this._drawEffectSprite(rect, `line_${axis}_origin_${fx.colorId}`, fx.ageMs, fx.row, fx.col);
  }

  // 폭탄 발동(README #3) - 잼 -> pop -> 폭탄 스프라이트(폭탄이 pop보다 위) 순.
  _drawBombFx(rect, fx, nowMs) {
    for (const target of fx.targets) {
      if (fx.ageMs < target.fireAtMs) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs);
    }
    for (const target of fx.targets) {
      if (fx.ageMs < target.fireAtMs) continue;
      this._drawEffectSprite(rect, `pop_${target.colorId}`, fx.ageMs - target.fireAtMs, target.row, target.col);
    }
    this._drawEffectSprite(rect, `bomb_${fx.colorId}`, fx.ageMs, fx.row, fx.col);
  }

  // 박스 발동(README #4) - 잼 -> pop/box_origin -> 픽셀 번개 -> box_soul -> box_hit 순.
  _drawBoxFx(rect, fx, nowMs) {
    const { cfg } = fx;
    for (const target of fx.targets) {
      if (fx.ageMs < cfg.hitMs) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs);
    }
    for (const target of fx.targets) {
      if (fx.ageMs < cfg.hitMs) continue;
      this._drawEffectSprite(rect, `pop_${target.colorId}`, fx.ageMs - cfg.hitMs, target.row, target.col);
    }
    this._drawEffectSprite(rect, `box_origin_${fx.colorId}`, fx.ageMs, fx.row, fx.col);
    for (const target of fx.targets) {
      const boltAge = fx.ageMs - cfg.startMs;
      if (boltAge < 0 || boltAge > cfg.durationMs) continue;
      const head = this._drawPixelBolt(rect, fx, target, boltAge);
      if (head) this._drawEffectSpriteAtPx(rect, `box_soul_${fx.colorId}`, fx.ageMs, head.x, head.y);
    }
    for (const target of fx.targets) {
      if (fx.ageMs < cfg.hitMs) continue;
      this._drawEffectSprite(rect, `box_hit_${fx.colorId}`, fx.ageMs - cfg.hitMs, target.row, target.col);
    }
  }

  // 컬러 발동(README #5) - 잼 -> pop -> color_origin -> color_wisp(비행) -> color_mark 순.
  _drawColorFx(rect, fx, nowMs) {
    for (const target of fx.targets) {
      const arriveAtMs = fx.waveStartMs + target.flightMs;
      if (fx.ageMs < arriveAtMs) this._drawFrozenGemAt(rect, target.row, target.col, target.colorId, nowMs);
    }
    for (const target of fx.targets) {
      const arriveAtMs = fx.waveStartMs + target.flightMs;
      if (fx.ageMs < arriveAtMs) continue;
      this._drawEffectSprite(rect, `pop_${target.colorId}`, fx.ageMs - arriveAtMs, target.row, target.col);
    }
    this._drawEffectSprite(rect, 'color_origin', fx.ageMs, fx.row, fx.col);
    if (fx.ageMs >= fx.waveStartMs) {
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
      if (fx.ageMs < arriveAtMs) continue;
      this._drawEffectSprite(rect, `color_mark_${target.colorId}`, fx.ageMs - arriveAtMs, target.row, target.col);
    }
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
      if (fx.kind === 'line') this._drawLineFx(rect, fx, nowMs);
      else if (fx.kind === 'bomb') this._drawBombFx(rect, fx, nowMs);
      else if (fx.kind === 'box') this._drawBoxFx(rect, fx, nowMs);
      else if (fx.kind === 'color') this._drawColorFx(rect, fx, nowMs);

      if (fx.ageMs > fx.totalLifeMs) {
        for (const target of fx.targets) this._specialFxReserved.delete(`${target.row},${target.col}`);
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

  _drawEffects(rect, effects) {
    if (!effects || effects.length === 0) return;
    const { ctx } = this;
    const { cellSize, rows, cols } = rect;

    for (const effect of effects) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, effect.opacity ?? 1);

      if (effect.kind === 'beamRow') {
        // thickness(칸 단위, 기본 1)와 color/glow는 조합 발동(line_line/line_bomb)이
        // 단일 라인 발동보다 "굵고 밝게" 보이도록 쓰인다.
        const thickness = effect.thickness ?? 1;
        const y = rect.y + (effect.row - (thickness - 1) / 2) * cellSize;
        ctx.fillStyle = effect.color ?? '#ffffff';
        if (effect.glow) {
          ctx.shadowColor = effect.color ?? '#ffffff';
          ctx.shadowBlur = cellSize * 0.6;
        }
        ctx.fillRect(rect.x, y, cols * cellSize, thickness * cellSize);
      } else if (effect.kind === 'beamCol') {
        const thickness = effect.thickness ?? 1;
        const x = rect.x + (effect.col - (thickness - 1) / 2) * cellSize;
        ctx.fillStyle = effect.color ?? '#ffffff';
        if (effect.glow) {
          ctx.shadowColor = effect.color ?? '#ffffff';
          ctx.shadowBlur = cellSize * 0.6;
        }
        ctx.fillRect(x, rect.y, thickness * cellSize, rows * cellSize);
      } else if (effect.kind === 'burst') {
        // radiusScale/color는 조합(bomb_bomb)이 단일 폭탄 발동보다 더 크고 다른 색으로
        // 보이도록 쓰인다.
        const cx = rect.x + (effect.col + 0.5) * cellSize;
        const cy = rect.y + (effect.row + 0.5) * cellSize;
        const radius = cellSize * (effect.radiusScale ?? 1.6) * (effect.t ?? 0);
        ctx.strokeStyle = effect.color ?? '#ffd166';
        ctx.lineWidth = Math.max(2, cellSize * 0.1);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.kind === 'wipe') {
        const cx = rect.x + (effect.col + 0.5) * cellSize;
        const cy = rect.y + (effect.row + 0.5) * cellSize;
        const radius = cellSize * 0.5 * (1 + (effect.t ?? 0));
        ctx.strokeStyle = RAINBOW[Math.floor((effect.t ?? 0) * RAINBOW.length) % RAINBOW.length];
        ctx.lineWidth = Math.max(2, cellSize * 0.08);
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.stroke();
      } else if (effect.kind === 'glow') {
        // 특수 잼 생성: 그 칸 위에 짧게 번쩍이는 빛(색은 config/effects.json에서 받음).
        const cx = rect.x + (effect.col + 0.5) * cellSize;
        const cy = rect.y + (effect.row + 0.5) * cellSize;
        const color = effect.color ?? '#ffffff';
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = cellSize * 0.5;
        ctx.beginPath();
        ctx.arc(cx, cy, cellSize * 0.42, 0, Math.PI * 2);
        ctx.fill();
      } else if (effect.kind === 'projectile') {
        // 박스 잼 투사체: 박스 칸 -> 영향 칸으로 가속하며 날아가는 작은 발사체.
        const ease = effect.t * effect.t; // easeInQuad - 가속감(다른 특수 잼보다 튀는 느낌)
        const fromX = rect.x + (effect.fromCol + 0.5) * cellSize;
        const fromY = rect.y + (effect.fromRow + 0.5) * cellSize;
        const toX = rect.x + (effect.toCol + 0.5) * cellSize;
        const toY = rect.y + (effect.toRow + 0.5) * cellSize;
        ctx.fillStyle = '#ffe066';
        ctx.strokeStyle = '#a9690d';
        ctx.lineWidth = Math.max(1, cellSize * 0.04);
        ctx.beginPath();
        ctx.arc(fromX + (toX - fromX) * ease, fromY + (toY - fromY) * ease, cellSize * 0.16, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else if (effect.kind === 'flash') {
        // color_color 조합: 보드 전체를 덮는 큰 플래시(무지개색이 시간에 따라 바뀜). 셔플은
        // 더 이상 이 플래시를 쓰지 않는다(§셔플 애니메이션 - 젬이 직접 소용돌이치며 움직이는
        // 연출로 대체됨, _getShuffleDisplayList/_drawShuffleText 참고).
        const boardWidth = cols * cellSize;
        const boardHeight = rows * cellSize;
        ctx.fillStyle = RAINBOW[Math.floor((effect.t ?? 0) * RAINBOW.length) % RAINBOW.length];
        ctx.globalAlpha = Math.max(0, (effect.opacity ?? 1) * 0.55);
        ctx.fillRect(rect.x, rect.y, boardWidth, boardHeight);
        ctx.globalAlpha = Math.max(0, effect.opacity ?? 1);
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = Math.max(3, cellSize * 0.12);
        ctx.strokeRect(
          rect.x + cellSize * 0.1,
          rect.y + cellSize * 0.1,
          boardWidth - cellSize * 0.2,
          boardHeight - cellSize * 0.2
        );
      }

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
      // 콤보 HUD 배너(§10) - comboChange가 tier 경계값과 정확히 같으면 마일스톤 문구,
      // comboBreak는 끊기기 직전 peak 문구.
      if (effect.type === 'comboChange') {
        const tier = COMBO_CONFIG.tiers.find((t) => t.min === effect.comboStreak);
        if (tier) this._comboMilestone = { label: t(tier.labelKey), elapsedMs: 0 };
      } else if (effect.type === 'comboBreak') {
        this._comboBreakDisplay = { streak: effect.comboStreak, elapsedMs: 0 };
      }

      // 방해요소 부서짐/폭발 스프라이트 애니메이션(파티클/흔들림과 별개 - effects.json
      // 설정 유무와 무관하게 항상 재생 시도한다).
      if (effect.type === 'obstacleDamaged' || effect.type === 'obstacleDestroyed' || effect.type === 'obstacleExpire') {
        this._spawnObstacleFx(effect);
      }
      // 잼 터짐 이펙트(assets/effects) - line/bomb/box(일반)/color 발동마다 스프라이트
      // 재생 일정을 만든다(설정 유무와 무관하게 항상 시도 - obstacleFx와 같은 이유).
      if (effect.type === 'specialActivate') {
        this._spawnSpecialFx(effect, gameState.board);
      }

      const key = this._effectConfigKey(effect);
      if (!key) continue;

      // 사운드(§13)는 effects.json에 particles/shake 항목이 없어도(comboChange/hint 등)
      // 독립적으로 재생을 시도한다 - AudioPlayer가 설정/파일 없음을 조용히 무시한다.
      this._audioPlayer.play(key, { comboStreak: gameState.comboStreak });

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
    for (const cell of newlyClearing) {
      if (this._specialFxReserved.has(`${cell.row},${cell.col}`)) continue;
      const colorId = GEM_TYPES[cell.value]?.id;
      if (colorId) this._simplePops.push({ row: cell.row, col: cell.col, colorId, ageMs: 0 });
    }

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

  // 셔플 사운드 훅(§사운드 훅) + 착지 스쿼시 트리거를 같이 본다(둘 다 같은 "effect별 한 번만"
  // 마크가 필요해서 한 메서드로 묶음). shuffleStart는 _collectNewEffects의 범용 "처음 봤을 때
  // 1번" 경로(_effectConfigKey)가 이미 낸다. 여기서는:
  // - shuffleScatter: 2단계 시작(phases.convergeMs 경계)에서 1번.
  // - 착지 스쿼시: 3단계 시작(phases.scatterMs 경계)에서 모든 도착 칸에 1번씩 - 기존
  //   _landingSquashes(§11 낙하 착지 스쿼시)를 그대로 재사용한다(새 메커니즘 불필요).
  // - shuffleSettle: effect가 gameState.effects에서 사라지는 순간 - core의 _advanceEffects가
  //   durationMs를 넘기면 바로 배열에서 빼버려 "끝난 그 틱"을 여기서 직접 볼 수 없으므로,
  //   "지난 프레임엔 있었는데 이번 프레임엔 없다"로 판정한다.
  // 흔들림/연출 줄이기(settings.reduceMotion)일 땐 소용돌이/정렬 단계가 없으므로 scatter
  // 사운드와 착지 스쿼시 둘 다 건너뛴다.
  _advanceShuffleAudio(gameState) {
    const cfg = this.assets?.effectsConfig;
    const reduced = cfg?.settings?.reduceMotion;
    const phases = cfg?.shuffleAnim?.phases;
    const squashScale = cfg?.shuffleAnim?.land?.squashScale ?? 0.9;
    const current = new Set();

    for (const effect of gameState.effects) {
      if (effect.type !== 'shuffle') continue;
      current.add(effect);
      let marks = this._shuffleAudioMarks.get(effect);
      if (!marks) {
        marks = { scatter: false, landed: false };
        this._shuffleAudioMarks.set(effect, marks);
      }
      if (reduced || !phases) continue;
      if (!marks.scatter && effect.elapsedMs >= phases.convergeMs) {
        marks.scatter = true;
        this._audioPlayer.play('shuffleScatter');
      }
      if (!marks.landed && effect.elapsedMs >= phases.scatterMs) {
        marks.landed = true;
        const durationMs = Math.max(1, phases.totalMs - phases.scatterMs);
        const amount = 1 - squashScale;
        for (const move of effect.moves) {
          if (move.value === EMPTY || move.value === OBSTACLE) continue;
          this._landingSquashes.set(`${move.to.row},${move.to.col}`, { elapsedMs: 0, durationMs, amount });
        }
      }
    }

    for (const effect of this._shuffleAudioMarks.keys()) {
      if (!current.has(effect)) {
        this._audioPlayer.play('shuffleSettle');
        this._shuffleAudioMarks.delete(effect);
      }
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
  _spawnBurstAt(x, y, params, scaleMul, color) {
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

      // 사운드는 effects.json 설정(아래 shake/particles)과 무관하게 독립적으로 재생을
      // 시도한다(_collectNewEffects와 같은 패턴) - sounds.json에 항목/파일이 없으면
      // AudioPlayer가 조용히 무시한다(summonLand의 SFX 훅).
      this._audioPlayer.play(event.type);

      const eventCfg = events[event.type];
      if (!eventCfg) continue;

      const pos = this._battleEventPosition(event, battleState, battleLayout);
      if (!pos) continue;

      const scale = this._cascadeScale(event.cascadeIndex, cascadeCfg);
      if (eventCfg.particles) {
        this._spawnBurstAt(pos.x, pos.y, eventCfg.particles, intensity * scale, pos.color);
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
  _drawCurrencyBar(rect, playerState) {
    const { ctx } = this;
    this._drawPanelIron(rect);
    ctx.save();

    const midY = rect.y + rect.height / 2;
    const iconSize = rect.height * 0.4;
    const fontSize = Math.max(11, rect.height * 0.34);
    ctx.font = getFontString(fontSize, true);

    let x = rect.x + 10;
    x = this._drawCurrencyPill(x, midY, iconSize, fontSize, 'icons/gold.png', HUD_CONFIG.currency.gold, playerState?.gold ?? 0, 'circle');
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
    const text = String(value);
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
    ctx.font = getFontString(scoreFont, true);
    const scoreText = `${gameState.score}`;
    const scoreTextWidth = ctx.measureText(scoreText).width;
    const insetPath = 'panels/panel_inset.png';
    const insetState = getUi(this.assets, insetPath);
    const insetMeta = getUiMeta(this.assets, insetPath);
    const padX = 6;
    let scoreTextX = rect.x + 10;
    if (uiReady(insetState) && insetMeta?.slice) {
      const insetW = snap(scoreTextWidth + padX * 2);
      const insetH = snap(scoreFont * 1.3);
      ctx.imageSmoothingEnabled = false;
      drawNine(ctx, insetState.img, insetMeta.slice, rect.x + 10, midY - insetH / 2, insetW, insetH);
      scoreTextX = rect.x + 10 + padX;
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = '#e8e8e8';
    drawText(ctx, scoreText, scoreTextX, midY);

    ctx.fillStyle = HUD_CONFIG.text.dim;
    ctx.font = getFontString(scoreFont * 0.62);
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
          ctx.drawImage(animState.img, frame * animMeta.frameW, 0, animMeta.frameW, animMeta.frameH, fillX, fillY, fillW, fillH);
        } else {
          const fillState = getUi(this.assets, 'gauges/combo_fill.png');
          if (uiReady(fillState)) {
            ctx.drawImage(fillState.img, 0, 0, fillState.img.width, fillState.img.height, fillX, fillY, fillW, fillH);
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

  // 일시정지/승리/패배/탑 강화 팝업 - 하나만 동시에 뜰 수 있다(우선순위: 일시정지 > 전투 결과 > 탑 강화).
  // 탑 강화는 레이아웃이 완전히 달라(탭+5줄 목록) 별도 메서드(_drawTowerUpgradePopup)로 그린다.
  // 그 외(일시정지/승리/패배)는 버튼 사각형을 lastLayout.popup.buttons에 저장해 main.js가 클릭 판정에 쓴다.
  _drawPopup(width, height, battleState, paused, clearReward, upgradeTowerIndex, upgradeTab, battleHud) {
    let kind = null;
    if (paused) kind = 'pause';
    else if (battleState?.status === 'cleared') kind = 'win';
    else if (battleState?.status === 'failed') kind = 'lose';
    else if (upgradeTowerIndex != null && battleHud) kind = 'towerUpgrade';

    if (!kind) {
      this.lastLayout.popup = null;
      return;
    }

    if (kind === 'towerUpgrade') {
      this._drawTowerUpgradePopup(width, height, battleState, battleHud, upgradeTowerIndex, upgradeTab);
      return;
    }

    const { ctx } = this;
    const cfg = HUD_CONFIG.popup;
    const cardWidth = Math.min(width * 0.72, 300);
    const cardHeight = cardWidth * 0.62;
    const cardX = (width - cardWidth) / 2;
    const cardY = (height - cardHeight) / 2;

    // 클리어 팝업은 얻은 골드를 본문에 더해 보여준다(docs/balance.md §8).
    const winDesc = clearReward ? t('popup.win.descGold', { total: clearReward.total }) : t('popup.win.desc');
    const TITLES = {
      pause: { text: t('popup.pause.title'), color: cfg.pauseColor, desc: t('popup.pause.desc') },
      win: { text: t('popup.win.title'), color: cfg.winColor, desc: winDesc },
      lose: { text: t('popup.lose.title'), color: cfg.loseColor, desc: t('popup.lose.desc') },
    };
    // 액션 순서의 첫 항목이 강조(primary) 버튼. 클리어는 "다음 층"을 눌러 진행한다(실패는
    // "다시 하기"로 같은 층을 재도전 - docs/balance.md §1·§3).
    const BUTTONS = {
      pause: [['resume', t('popup.button.resume')], ['restart', t('popup.button.restart')], ['exit', t('popup.button.exit')]],
      win: [['next', t('popup.button.next')]],
      lose: [['restart', t('popup.button.restart')]],
    };

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = cfg.overlayColor;
    ctx.fillRect(0, 0, width, height);

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
    ctx.font = getFontString(Math.max(16, cardHeight * 0.16), true);
    drawText(ctx, title.text, cardX + cardWidth / 2, cardY + cardHeight * 0.28);

    ctx.fillStyle = HUD_CONFIG.text.dim;
    ctx.font = getFontString(Math.max(11, cardHeight * 0.08));
    drawText(ctx, title.desc, cardX + cardWidth / 2, cardY + cardHeight * 0.48);

    const buttons = BUTTONS[kind];
    const btnGap = 8;
    const btnWidth = (cardWidth - 24 - btnGap * (buttons.length - 1)) / buttons.length;
    const btnHeight = Math.max(32, cardHeight * 0.22);
    const btnY = cardY + cardHeight - 16 - btnHeight;
    const rects = {};

    buttons.forEach(([action, label], i) => {
      const bx = cardX + 12 + i * (btnWidth + btnGap);
      const isPrimary = i === 0;

      // buttons/btn_primary·btn_secondary(9-slice) - 팝업 버튼(README). 이미지가 없으면
      // 기존 색 사각형으로 폴백한다.
      const btnPath = isPrimary ? 'buttons/btn_primary.png' : 'buttons/btn_secondary.png';
      const btnState = getUi(this.assets, btnPath);
      const btnMeta = getUiMeta(this.assets, btnPath);
      let textColor = isPrimary ? '#ffffff' : HUD_CONFIG.text.primary;
      if (uiReady(btnState) && btnMeta?.slice) {
        ctx.imageSmoothingEnabled = false;
        drawNine(ctx, btnState.img, btnMeta.slice, bx, btnY, snap(btnWidth), snap(btnHeight));
        textColor = btnMeta.textColor ?? textColor;
      } else {
        ctx.fillStyle = isPrimary ? cfg.primary : cfg.ghost;
        ctx.fillRect(bx, btnY, btnWidth, btnHeight);
        ctx.strokeStyle = cfg.cardBorder;
        ctx.lineWidth = 2;
        ctx.strokeRect(bx + 1, btnY + 1, btnWidth - 2, btnHeight - 2);
      }
      ctx.fillStyle = textColor;
      ctx.font = getFontString(Math.max(11, btnHeight * 0.32), true);
      drawText(ctx, label, bx + btnWidth / 2, btnY + btnHeight / 2);
      rects[action] = { x: bx, y: btnY, width: btnWidth, height: btnHeight };
    });

    ctx.restore();
    this.lastLayout.popup = { kind, buttons: rects };
  }

  // 타워 강화 팝업(assets/ui/README.md "타워 강화 팝업") - 탭(레벨업/인벤토리) + 장착된 타워
  // 5개 목록. 탭 한 줄의 터치는 main.js가 처리하고(게임이 pause처럼 멈춘 동안), 이 메서드는
  // 그 판정에 쓸 버튼 사각형을 lastLayout.popup에 저장하기만 한다(레벨업/MAX 로직 자체는
  // BattleController/playerState에 있다 - 그리기와 분리).
  _drawTowerUpgradePopup(width, height, battleState, battleHud, selectedIndex, tab) {
    const { ctx } = this;
    const cfg = HUD_CONFIG.popup;
    const cardWidth = Math.min(width * 0.86, 340);
    const cardHeight = Math.min(height * 0.84, 480);
    const cardX = (width - cardWidth) / 2;
    const cardY = (height - cardHeight) / 2;

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = cfg.overlayColor;
    ctx.fillRect(0, 0, width, height);

    const popupPath = 'popups/popup_win.png';
    const popupState = getUi(this.assets, popupPath);
    const popupMeta = getUiMeta(this.assets, popupPath);
    if (uiReady(popupState) && popupMeta?.slice) {
      drawNine(ctx, popupState.img, popupMeta.slice, cardX, cardY, snap(cardWidth), snap(cardHeight));
    } else {
      ctx.fillStyle = cfg.cardBg;
      ctx.fillRect(cardX, cardY, cardWidth, cardHeight);
      ctx.strokeStyle = cfg.cardBorder;
      ctx.lineWidth = 3;
      ctx.strokeRect(cardX + 1.5, cardY + 1.5, cardWidth - 3, cardHeight - 3);
    }

    drawFixedImage(ctx, this.assets, 'upgrade/emblem_upgrade.png', cardX + cardWidth / 2, cardY, 2);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = cfg.upgradeColor;
    ctx.font = getFontString(Math.max(15, cardHeight * 0.05), true);
    drawText(ctx, t('popup.towerUpgrade.title'), cardX + cardWidth / 2, cardY + 24);

    // 닫기 X(upgrade/btn_close, 16x16 고정) - 카드 오른쪽 위 모서리.
    const closeSize = 32; // 16 원본 x 2배
    const closeCx = cardX + cardWidth - 20;
    const closeCy = cardY + 20;
    if (!drawFixedImage(ctx, this.assets, 'upgrade/btn_close.png', closeCx, closeCy, 2)) {
      ctx.fillStyle = cfg.loseColor;
      ctx.beginPath();
      ctx.arc(closeCx, closeCy, closeSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = getFontString(closeSize * 0.5, true);
      drawText(ctx, 'X', closeCx, closeCy);
    }
    const closeButton = { x: closeCx - closeSize / 2, y: closeCy - closeSize / 2, width: closeSize, height: closeSize };

    // 탭 2개(레벨업/인벤토리) - 켜진 탭은 tab_on(아래가 본문과 3px(원본) 겹치게), 나머지는 tab_off.
    const tabY = cardY + 40;
    const tabHeight = 28;
    const tabGap = 6;
    const tabWidth = (cardWidth - 24 - tabGap) / 2;
    const tabRects = {
      levelUp: { x: cardX + 12, y: tabY, width: tabWidth, height: tabHeight },
      inventory: { x: cardX + 12 + tabWidth + tabGap, y: tabY, width: tabWidth, height: tabHeight },
    };
    for (const [key, label] of [['levelUp', t('popup.towerUpgrade.tabLevelUp')], ['inventory', t('popup.towerUpgrade.tabInventory')]]) {
      const r = tabRects[key];
      const active = tab === key;
      const path = active ? 'upgrade/tab_on.png' : 'upgrade/tab_off.png';
      const state = getUi(this.assets, path);
      const meta = getUiMeta(this.assets, path);
      if (uiReady(state) && meta?.slice) {
        drawNine(ctx, state.img, meta.slice, r.x, r.y, snap(r.width), snap(r.height));
      } else {
        ctx.fillStyle = active ? cfg.ghost : cfg.cardBg;
        ctx.fillRect(r.x, r.y, r.width, r.height);
      }
      ctx.fillStyle = active ? HUD_CONFIG.text.primary : HUD_CONFIG.text.dim;
      ctx.font = getFontString(Math.max(11, tabHeight * 0.4), true);
      drawText(ctx, label, r.x + r.width / 2, r.y + r.height / 2);
    }

    // 탭 본문(upgrade/tab_body) - 켜진 탭이 윗변을 3px(원본, 화면 6px) 덮게 그려서 이어지게 한다.
    const overlap = 6;
    const bodyX = cardX + 12;
    const bodyY = tabY + tabHeight - overlap;
    const bodyWidth = cardWidth - 24;
    const bodyHeight = cardY + cardHeight - 16 - bodyY;
    const bodyPath = 'upgrade/tab_body.png';
    const bodyState = getUi(this.assets, bodyPath);
    const bodyMeta = getUiMeta(this.assets, bodyPath);
    if (uiReady(bodyState) && bodyMeta?.slice) {
      drawNine(ctx, bodyState.img, bodyMeta.slice, bodyX, bodyY, snap(bodyWidth), snap(bodyHeight));
    } else {
      ctx.fillStyle = '#15121c';
      ctx.fillRect(bodyX, bodyY, bodyWidth, bodyHeight);
    }

    const pad = 8;
    const contentRect = { x: bodyX + pad, y: bodyY + pad, width: bodyWidth - pad * 2, height: bodyHeight - pad * 2 };

    const rows = tab === 'levelUp' ? this._drawTowerUpgradeLevelTab(contentRect, battleState, battleHud, selectedIndex) : null;
    if (tab === 'inventory') this._drawTowerUpgradeInventoryTab(contentRect, battleState);

    ctx.restore();
    this.lastLayout.popup = { kind: 'towerUpgrade', tab, closeButton, tabs: tabRects, rows, towerIndex: selectedIndex };
  }

  // 레벨업 탭 - 장착된 타워 5개를 한 줄씩(레벨/공격력/강화·MAX 버튼) + 아래에 보유 골드.
  // 각 줄의 강화/MAX 버튼 사각형과 가능 여부를 돌려줘 main.js가 클릭 판정에 쓴다.
  _drawTowerUpgradeLevelTab(rect, battleState, battleHud, selectedIndex) {
    const { ctx } = this;
    const cfg = HUD_CONFIG.popup;
    const towers = battleState?.towers ?? [];
    const footerHeight = 30;
    const rowGap = 3;
    const rowsHeight = rect.height - footerHeight - 6;
    const rowHeight = (rowsHeight - rowGap * 4) / 5;
    const pad = 6;
    const rows = [];

    for (let i = 0; i < 5; i++) {
      const tower = towers[i];
      const rowY = rect.y + i * (rowHeight + rowGap);
      const level = battleHud.towerLevels?.[i] ?? 1;
      const cost = battleHud.towerCosts?.[i] ?? 0;
      const atk = battleHud.towerAttacks?.[i] ?? 0;
      const nextAtk = battleHud.towerNextAttacks?.[i] ?? atk;
      const maxed = level >= (battleHud.maxLevel ?? Infinity);
      const affordable = !maxed && battleHud.gold >= cost;

      // upgrade/card·card_selected(9-slice) - 터치해서 연 타워 줄만 card_selected(금테).
      const cardPath = i === selectedIndex ? 'upgrade/card_selected.png' : 'upgrade/card.png';
      const cardState = getUi(this.assets, cardPath);
      const cardMeta = getUiMeta(this.assets, cardPath);
      if (uiReady(cardState) && cardMeta?.slice) {
        drawNine(ctx, cardState.img, cardMeta.slice, rect.x, rowY, snap(rect.width), snap(rowHeight));
      } else {
        ctx.fillStyle = i === selectedIndex ? '#2a2342' : '#1f1b2b';
        ctx.fillRect(rect.x, rowY, rect.width, rowHeight);
      }

      const iconSize = Math.min(rowHeight * 0.72, 40);
      const iconCx = rect.x + pad + iconSize / 2;
      const iconCy = rowY + rowHeight / 2;
      if (tower) this._battleRenderer.drawTowerIcon(ctx, this.assets, tower.color, iconCx, iconCy, iconSize);

      const textX = rect.x + pad + iconSize + 8;
      const line1Y = rowY + rowHeight * 0.32;
      const line2Y = rowY + rowHeight * 0.68;

      // panels/box_floor(9-slice) - 레벨 배지(README: "레벨 배지는 panels/box_floor").
      // "Lv.N" 글자에 외곽선이 붙으면서 예전 32x16 배지에선 글자가 배지 테두리와 겹쳐
      // 읽기 어려워졌다 - 배지를 키워 그 안에서 여유 있게 보이게 한다.
      const badgeW = 40;
      const badgeH = 22;
      const badgeX = textX;
      const badgeY = line1Y - badgeH / 2;
      const badgePath = 'panels/box_floor.png';
      const badgeState = getUi(this.assets, badgePath);
      const badgeMeta = getUiMeta(this.assets, badgePath);
      if (uiReady(badgeState) && badgeMeta?.slice) {
        drawNine(ctx, badgeState.img, badgeMeta.slice, badgeX, badgeY, badgeW, badgeH);
      } else {
        ctx.fillStyle = HUD_CONFIG.panel.raised;
        ctx.fillRect(badgeX, badgeY, badgeW, badgeH);
      }
      ctx.fillStyle = HUD_CONFIG.text.primary;
      ctx.font = getFontString(Math.max(9, badgeH * 0.56), true);
      ctx.textAlign = 'center';
      drawText(ctx, `Lv.${level}`, badgeX + badgeW / 2, line1Y);

      // 강화(buttons/btn_gold) / MAX(buttons/btn_primary) 버튼 위치 - 이름/공격력 텍스트가
      // 길어도(예: "저주 오벨리스크") 버튼 위로 넘치지 않도록 먼저 구해 클립 폭을 정한다.
      const btnHeight = Math.min(26, rowHeight * 0.42);
      const maxBtnWidth = 40;
      const upgradeBtnWidth = 68;
      const btnGap = 6;
      const btnY = rowY + (rowHeight - btnHeight) / 2;
      const maxBtnX = rect.x + rect.width - pad - maxBtnWidth;
      const upgradeBtnX = maxBtnX - btnGap - upgradeBtnWidth;

      ctx.save();
      ctx.beginPath();
      ctx.rect(textX, rowY, upgradeBtnX - textX - 6, rowHeight);
      ctx.clip();

      ctx.textAlign = 'left';
      ctx.font = getFontString(Math.max(10, rowHeight * 0.19), true);
      ctx.fillStyle = HUD_CONFIG.text.primary;
      drawText(ctx, tower?.name ?? '', badgeX + badgeW + 6, line1Y);

      ctx.font = getFontString(Math.max(9, rowHeight * 0.2));
      ctx.fillStyle = HUD_CONFIG.text.dim;
      drawText(ctx, t('popup.towerUpgrade.attack', { current: Math.round(atk), next: Math.round(nextAtk) }), textX, line2Y);
      ctx.restore();

      const upgradePath = affordable ? 'buttons/btn_gold.png' : 'upgrade/btn_disabled.png';
      const upgradeMeta = getUiMeta(this.assets, upgradePath);
      const upgradeState = getUi(this.assets, upgradePath);
      if (uiReady(upgradeState) && upgradeMeta?.slice) {
        drawNine(ctx, upgradeState.img, upgradeMeta.slice, upgradeBtnX, btnY, upgradeBtnWidth, btnHeight);
      } else {
        ctx.fillStyle = affordable ? cfg.upgradeColor : cfg.disabled;
        ctx.fillRect(upgradeBtnX, btnY, upgradeBtnWidth, btnHeight);
      }
      if (maxed) {
        ctx.fillStyle = upgradeMeta?.textColor ?? HUD_CONFIG.text.dim;
        ctx.font = getFontString(Math.max(10, btnHeight * 0.5), true);
        drawText(ctx, t('popup.towerUpgrade.max'), upgradeBtnX + upgradeBtnWidth / 2, btnY + btnHeight / 2);
      } else {
        const coinCx = upgradeBtnX + 14;
        const coinDrawn = drawFixedImage(ctx, this.assets, 'upgrade/coin_small.png', coinCx, btnY + btnHeight / 2, 1.5);
        ctx.fillStyle = affordable ? (upgradeMeta?.textColor ?? HUD_CONFIG.text.primary) : cfg.loseColor;
        ctx.font = getFontString(Math.max(10, btnHeight * 0.44), true);
        ctx.textAlign = 'left';
        drawText(ctx, String(cost), (coinDrawn ? coinCx + 8 : upgradeBtnX + 6), btnY + btnHeight / 2);
      }

      const maxPath = affordable ? 'buttons/btn_primary.png' : 'upgrade/btn_disabled.png';
      const maxMeta = getUiMeta(this.assets, maxPath);
      const maxState = getUi(this.assets, maxPath);
      if (uiReady(maxState) && maxMeta?.slice) {
        drawNine(ctx, maxState.img, maxMeta.slice, maxBtnX, btnY, maxBtnWidth, btnHeight);
      } else {
        ctx.fillStyle = affordable ? cfg.primary : cfg.disabled;
        ctx.fillRect(maxBtnX, btnY, maxBtnWidth, btnHeight);
      }
      ctx.fillStyle = maxMeta?.textColor ?? '#ffffff';
      ctx.font = getFontString(Math.max(9, btnHeight * 0.4), true);
      ctx.textAlign = 'center';
      drawText(ctx, t('popup.towerUpgrade.max'), maxBtnX + maxBtnWidth / 2, btnY + btnHeight / 2);

      rows.push({
        upgradeButton: { x: upgradeBtnX, y: btnY, width: upgradeBtnWidth, height: btnHeight },
        maxButton: { x: maxBtnX, y: btnY, width: maxBtnWidth, height: btnHeight },
        affordable,
        maxed,
      });
    }

    // 보유 골드(icons/gold + panels/panel_inset) - README: "아래에 보유 골드".
    const footerY = rect.y + rowsHeight + 6;
    const footerMidY = footerY + footerHeight / 2;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const goldIconDrawn = drawFixedImage(ctx, this.assets, 'icons/gold.png', rect.x + 16, footerMidY, 2);
    ctx.font = getFontString(Math.max(11, footerHeight * 0.44), true);
    ctx.fillStyle = HUD_CONFIG.text.primary;
    drawText(ctx, String(battleHud.gold ?? 0), rect.x + (goldIconDrawn ? 34 : 4), footerMidY);

    ctx.textAlign = 'right';
    ctx.font = getFontString(Math.max(9, footerHeight * 0.32));
    ctx.fillStyle = HUD_CONFIG.text.dim;
    drawText(ctx, t('popup.towerUpgrade.holdHint'), rect.x + rect.width, footerMidY);

    return rows;
  }

  // 인벤토리 탭 - 타워별 장착 칸 2개 + 보유 아이템 7x4 칸만 그린다(빈 칸, 동작 없음).
  _drawTowerUpgradeInventoryTab(rect, battleState) {
    const { ctx } = this;
    const towers = battleState?.towers ?? [];
    const slotPath = 'items/slot_normal.png';
    const slotState = getUi(this.assets, slotPath);
    const slotMeta = getUiMeta(this.assets, slotPath);

    const drawSlot = (x, y, size) => {
      if (uiReady(slotState) && slotMeta) {
        ctx.drawImage(slotState.img, 0, 0, slotState.img.width, slotState.img.height, x, y, size, size);
      } else {
        ctx.fillStyle = '#20232e';
        ctx.strokeStyle = '#4a5265';
        ctx.lineWidth = 1;
        ctx.fillRect(x, y, size, size);
        ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
      }
    };

    // 타워 5개 - 아이콘 + 장착 칸 2개(세로).
    const equipHeight = rect.height * 0.3;
    const colWidth = rect.width / 5;
    const iconSize = Math.min(colWidth * 0.6, equipHeight * 0.4);
    const equipSlotSize = Math.min(colWidth * 0.68, equipHeight * 0.26);
    for (let i = 0; i < 5; i++) {
      const cx = rect.x + colWidth * (i + 0.5);
      const iconCy = rect.y + iconSize / 2 + 2;
      const tower = towers[i];
      if (tower) this._battleRenderer.drawTowerIcon(ctx, this.assets, tower.color, cx, iconCy, iconSize);
      for (let s = 0; s < 2; s++) {
        const sy = rect.y + iconSize + 8 + s * (equipSlotSize + 4);
        drawSlot(cx - equipSlotSize / 2, sy, equipSlotSize);
      }
    }

    // 보유 아이템 라벨 + "추후 업데이트".
    const labelY = rect.y + equipHeight + 4;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = HUD_CONFIG.text.primary;
    ctx.font = getFontString(Math.max(10, rect.height * 0.045), true);
    drawText(ctx, t('popup.towerUpgrade.inventoryTitle'), rect.x, labelY);
    ctx.textAlign = 'right';
    ctx.fillStyle = HUD_CONFIG.text.dim;
    ctx.font = getFontString(Math.max(9, rect.height * 0.035));
    drawText(ctx, t('popup.towerUpgrade.comingSoon'), rect.x + rect.width, labelY);

    // 보유 아이템 7x4 빈 칸.
    const gridY = labelY + 10;
    const gridHeight = rect.y + rect.height - gridY;
    const cols = 7;
    const gridRows = 4;
    const gap = 3;
    const cellSize = Math.max(8, Math.min((rect.width - gap * (cols - 1)) / cols, (gridHeight - gap * (gridRows - 1)) / gridRows));
    const gridWidth = cellSize * cols + gap * (cols - 1);
    const gridX = rect.x + (rect.width - gridWidth) / 2;
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < cols; c++) {
        drawSlot(gridX + c * (cellSize + gap), gridY + r * (cellSize + gap), cellSize);
      }
    }
  }

  // 콤보 마일스톤("Great!" 등)/브레이크 peak 문구 - render()가 매 프레임 _advanceComboBanners로
  // 늙힌 로컬 상태만 읽는다(렌더 전용, gameState에 없음).
  _drawComboBanners() {
    if (!this._comboMilestone && !this._comboBreakDisplay) return;
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

    if (this._comboBreakDisplay) {
      const { streak, elapsedMs } = this._comboBreakDisplay;
      const progress = Math.min(1, elapsedMs / COMBO_CONFIG.breakDisplayDurationMs);
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - progress);
      ctx.fillStyle = '#ff6b6b';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = getFontString(22);
      drawText(ctx, t('hud.comboBreak', { count: streak }), cx, cy + 36);
      ctx.restore();
    }
  }

  // render()가 매 프레임 호출 - 마일스톤/브레이크 배너의 수명을 늙히고 끝나면 지운다.
  _advanceComboBanners(dtMs) {
    if (this._comboMilestone) {
      this._comboMilestone.elapsedMs += dtMs;
      if (this._comboMilestone.elapsedMs >= COMBO_CONFIG.milestoneDurationMs) this._comboMilestone = null;
    }
    if (this._comboBreakDisplay) {
      this._comboBreakDisplay.elapsedMs += dtMs;
      if (this._comboBreakDisplay.elapsedMs >= COMBO_CONFIG.breakDisplayDurationMs) this._comboBreakDisplay = null;
    }
  }
}
