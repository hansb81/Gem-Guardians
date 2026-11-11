import { GEM_TYPES } from '../config/gems.js';
import { TOWER_LAYOUT_CONFIG } from '../config/towerLayout.js';
import { FRAME_NATIVE_W, snapPx } from './screenFit.js';
import { HUD_CONFIG } from '../config/hud.js';
import { pickBackgroundSheetName } from '../config/backgroundSheet.js';
import { drawNine, drawDamage, drawFixedImage, drawText, getUi, getUiFont, getUiMeta, snap, uiReady } from './uiKit.js';
import { t, tOr } from '../config/i18n.js';
import { getFontString } from '../config/fonts.js';
import { pickSummonFrame } from '../battle/summon.js';
import { ditherPattern, drawItemIconFallback } from './itemBarRenderer.js';
import { SkillFx } from './skillFx.js';
import { MonsterFx, isBigMonster } from './monsterFx.js';

// tower.color 값('red'|'blue'|'yellow'|'green'|'purple')은 GEM_TYPES의 id와 같은 이름을
// 쓰므로 그대로 색상표로 재사용한다(하드코딩 회피).
const GEM_COLOR_BY_ID = new Map(GEM_TYPES.map((g) => [g.id, g.color]));

// 스프라이트가 없는 적(기사·마법사 등, config/enemies.json 기준)은 색 도형 + 이름 첫 글자로
// 대신한다(docs/balance.md §4). 색은 종류 이름을 결정적으로 해시해서 고른다(Math.random 금지 -
// CLAUDE.md 규칙, hashLane/hashOffset과 같은 패턴).
const ENEMY_FALLBACK_PALETTE = ['#8aa6c1', '#c17f5a', '#7fae6b', '#b07fc1', '#c1a35a'];

// 엘리트/보스 표시(docs/balance.md §4): 엘리트는 스프라이트 1.25배 + 보라 외곽, 보스는
// 붉은 외곽(1px 테두리를 그림자로 대신 그린다 - shadowBlur 없이 또렷하게) + 이미지가
// 작으면(enemySpriteRules.bossScaleIfSmall) 그때만 확대 - 크기는 _rankScale()이 실제
// 프레임 높이를 보고 정한다.
const RANK_OUTLINE = {
  elite: '#a855f7',
  boss: '#ef4444',
};

const ENEMY_LANE_COUNT = 3;
// 지속 피해 틱(enemyHit.source) - 밀림 없이 번쩍임만. 화상 같은 새 지속 피해가 생기면 여기에 추가.
const DOT_SOURCES = new Set(['poison']);
// assets/gems/palette.hex의 색 단계 - 분노의 북 중 투사체를 "한 단계 밝은 색"으로 그릴 때 각 픽셀을 다음 단계로 바꾼다
// (마지막 단계는 그대로). 회색 5단계 + 파랑/보라/빨강/금/초록 4단계씩.
const PALETTE_RAMPS = [
  ['0d0a10', '221c2b', '3b3347', '655a74', 'e8dcc0'],
  ['0c1838', '1c3a76', '386cbc', '8cc4ee'],
  ['220e38', '48206e', '7a3cae', 'c48ce6'],
  ['3a0814', '741426', 'b82a3c', 'ec6a6a'],
  ['3a2808', '7a5212', 'c28a20', 'f2d264'],
  ['0c2814', '1c5228', '3a8a3c', '9cd872'],
];
const PALETTE_LIGHTER = new Map();
for (const ramp of PALETTE_RAMPS) ramp.forEach((hex, i) => PALETTE_LIGHTER.set(parseInt(hex, 16), parseInt(ramp[Math.min(i + 1, ramp.length - 1)], 16)));
const SHIELD_BLINK_FRAMES = 2; // 결계 테두리 색 교대 주기(프레임)
const DAMAGE_FLOAT_PX = 26;

// assets/backgrounds/manifest.json 로딩 실패 시 쓰는 기본값(manifest.json 기준 고정값).
const DEFAULT_BG_FRAME_W = 150;
// 150폭 층 배경 -> 180폭 frame 가로에 꽉(1.2 x s). 180폭 배경이 들어오면 1로.
const BG_FRAME_SCALE = 1.2;
const DEFAULT_BG_FRAME_H = 80;
const DEFAULT_BG_FRAMES = 8;
const DEFAULT_BG_FRAME_MS = 200;
const BG_FALLBACK_FILL = '#0d0a10';
const DEFAULT_PLINTH_FRAME_W = 23;
const DEFAULT_PLINTH_FRAME_H = 12;
const DEFAULT_PLINTH_FRAMES = 8;
// 받침 위치(assets/backgrounds/manifest.json plinth.anchor) - 석상 이미지(16x20 네이티브)
// 왼쪽 위 기준 오프셋.
const PLINTH_OFFSET_NATIVE = { x: -3, y: 14 };

// assets/towers/manifest.json 로딩 실패 시 쓰는 기본값(README/manifest.json 기준 고정값).
const DEFAULT_TOWER_FRAME_W = 16;
const DEFAULT_TOWER_FRAME_H = 20;
const DEFAULT_TOWER_DRAW_SCALE = 3;
const DEFAULT_TOWER_MUZZLE = { x: 8, y: 5 };
const DEFAULT_ATTACK_FRAMES = 6;
const DEFAULT_ATTACK_FRAME_MS = 80;
const DEFAULT_ATTACK_FIRE_FRAME = 3;
const DEFAULT_IDLE_FRAMES = 4;
const DEFAULT_IDLE_FRAME_MS = 150;
const DEFAULT_PROJECTILE_SPEED = 480;

// 탑 5개 배치 순서(config/balance.json tower.towers 순서 = red,blue,yellow,green,purple)의 열.
// 왼쪽 열 = 1·3·5번째(3개), 오른쪽 열 = 2·4번째(2개) - 지그재그(assets/towers/README.md).
const TOWER_SLOTS = ['left', 'right', 'left', 'right', 'left'];

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

// 문자열을 lane 인덱스로 안정적으로 매핑한다(배열 순서가 바뀌어도 같은 적 id는 같은 lane).
function hashLane(id, laneCount) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % laneCount;
}

// 탑 id -> 고정 ms 오프셋(대기 애니메이션 시작 시점을 어긋나게 함). Math.random 금지 -
// 결정적 해시만 사용(docs 규칙, core 밖이라도 동일하게 적용).
function hashOffset(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 10000;
}

// 전투 패널(상단 1/3) 내부 - 성벽 + 탑 5개 디펜스 화면을 그린다. battleState를 읽기만 하고
// 바꾸지 않는다. battleState.events는 core의 GameState.effects와 같은 패턴(elapsedMs가
// 늘고 durationMs를 넘으면 battleState가 알아서 치운다)이라 여기서는 매 프레임 그대로
// 읽어 t = elapsedMs/durationMs로 애니메이션만 표현한다(별도 타이머/풀 불필요).
export class BattleRenderer {
  constructor() {
    // 탑 id -> { mode: 'idle'|'attack', attackStartMs, firedProjectile, idleOffsetMs,
    // targetEnemyId, fallbackTargetPos }. draw()가 매 프레임 갱신한다(렌더 전용 상태,
    // battleState는 발사 "시점"만 이벤트로 알려줄 뿐 애니메이션 진행은 모른다).
    this._towerAnimStates = new Map();
    // towerAttack 이벤트(객체 참조) 단위 처리 여부 - CanvasRenderer._seenEffects와 같은
    // 패턴(WeakSet이라 이벤트가 battleState.events에서 빠지면 자동으로 사라짐).
    this._seenTowerAttacks = new WeakSet();
    // 화면에 날아가는 중인 투사체 스프라이트 목록. towerAttack 발사 시점이 아니라 공격
    // 애니메이션의 fireFrame에서 스폰된다(README 규칙).
    this._towerProjectiles = [];

    // 탑 탭 레벨업 연출(렌더 전용 임시 상태) - towerId -> { shakeUntilMs, flashUntilMs,
    // levelUpText, levelUpStartMs }. main.js가 BattleController.tryLevelUpTower() 결과를
    // triggerTowerTapFx()로 넘겨주면 다음 draw()부터 반영된다.
    this._towerTapFx = new Map();

    // 층 시작 연출(docs/balance.md §4 "지역 이름을 보여줘") - hud.floor가 바뀐 순간 지역 이름을
    // 트랙 위에 잠깐 띄운다. floorLabel 배지는 "10층 보스 1/2"만 넣기에도 좁아 별도 배너로 둔다.
    this._lastHudFloor = null;
    this._floorBannerText = '';
    this._floorBannerUntilMs = 0;

    // 젬 기술 v3 이펙트(skillCast/effectImmune/적 effects). particles/shake는 CanvasRenderer가 꽂는다
    // (파티클 풀 하나, 기존 화면 흔들림 재사용).
    this._skillFx = new SkillFx();
    this.particles = null;
    this.shake = null;
    this._frame = 0; // 결계 테두리 2프레임 교대용 카운터
    this._brightProjectiles = new Map(); // color -> 한 단계 밝은 투사체 시트(캔버스), 북 버프 중 사용
    this._seenRevives = new WeakSet(); // 이미 파편을 뿌린 wallRevived 이벤트
    this._monsterFx = new MonsterFx(); // 몬스터 타격·사망(assets/effects/monster)
    this._fxBattle = null; // 새 전투면 남은 사망 연출을 버린다
  }

  // 투사체 시트를 팔레트 한 단계 밝은 색으로 바꾼 캔버스(처음 한 번만 만들어 캐시).
  _brightSheet(color, img) {
    let c = this._brightProjectiles.get(color);
    if (c) return c;
    c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const cctx = c.getContext('2d');
    cctx.drawImage(img, 0, 0);
    const data = cctx.getImageData(0, 0, c.width, c.height);
    const px = data.data;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] === 0) continue;
      const to = PALETTE_LIGHTER.get((px[i] << 16) | (px[i + 1] << 8) | px[i + 2]);
      if (to == null) continue;
      px[i] = to >> 16;
      px[i + 1] = (to >> 8) & 255;
      px[i + 2] = to & 255;
    }
    cctx.putImageData(data, 0, 0);
    this._brightProjectiles.set(color, c);
    return c;
  }

  // hud = { floor, remainingEnemies, totalEnemies, tag('normal'|'elite'|'boss'), towerLevels[],
  // towerCosts[], gold }. tag/레벨·비용 표시는 docs/balance.md §2·§6, battle.md §3 요구사항
  // (상단 바 + 탑 아래 레벨/비용 표시) 때문에 battleState 자체가 아니라 BattleController/
  // playerState가 쥔 진행도 정보를 별도로 받는다(BattleState는 그 숫자들을 모른다).
  // itemIcons = 아이템 아이콘(Map<id, imgState>) - 모래시계 상태 아이콘용.
  draw(ctx, rect, battleState, now, assets, hud, paused = false, itemIcons = null) {
    if (!battleState) return;
    this._frame += 1;
    if (battleState !== this._fxBattle) {
      this._fxBattle = battleState;
      this._monsterFx.reset();
    }

    // 모래시계 정지 중 - 걷기 프레임을 정지 시작 시각에 고정한다(멈춘 적만).
    const frozen = !!battleState.frozen;
    if (!frozen || this._freezeNow == null) this._freezeNow = now;

    // 일시정지 중에는 배경 프레임만 멈춘다(탑 공격/대기 애니메이션은 기존처럼 now를 그대로 씀) -
    // paused가 풀리는 순간의 now로 다시 흐르기 시작하도록 멈춘 시점만 기억한다.
    if (!paused || this._bgFrozenNow == null) this._bgFrozenNow = now;
    const bgNow = paused ? this._bgFrozenNow : now;

    if (hud?.floor != null && hud.floor !== this._lastHudFloor) {
      this._lastHudFloor = hud.floor;
      if (hud.chapter) {
        this._floorBannerText = hud.chapter;
        this._floorBannerUntilMs = now + 2200;
      }
    }

    const layout = this._computeLayout(rect);
    const towers = battleState.towers || [];
    this._dev = { layout, assets, now }; // devShoot용(마지막 프레임)

    const bg = this._drawBackground(ctx, layout.bgRect, assets, bgNow, hud?.floor ?? 1);

    this._drawFloorLabel(ctx, layout.floorLabel, hud, assets);
    this._drawWallHealthBar(ctx, layout.wallBar, battleState, assets);
    this._drawPauseButton(ctx, layout.pauseButton, assets);
    this._drawTrack(ctx, layout.track);
    this._drawEnemies(ctx, layout.track, battleState.enemies || [], battleState.events || [], towers, assets, now, battleState);
    this._skillFx.update(battleState, layout.track, assets, now, this.particles, this.shake);
    this._skillFx.draw(ctx, battleState, layout.track, assets, now);
    if (battleState.wallShieldSec > 0) {
      this._drawWallShield(ctx, layout.track, battleState.events || []);
      this._drawStatusIcon(ctx, layout.wallBar, itemIcons, 'barrier', String(Math.ceil(battleState.wallShieldSec)), frozen ? 1 : 0, assets);
    }
    this._spawnReviveParticles(layout.track, battleState.events || []);
    if (frozen) {
      // 회색 틴트 - 불투명 픽셀 체커 디더(반투명 알파 없음), 적이 걷는 길 위.
      ctx.fillStyle = ditherPattern(ctx, '#6a6672');
      ctx.fillRect(layout.track.x, layout.track.y, layout.track.width, layout.track.height);
      this._drawStatusIcon(ctx, layout.wallBar, itemIcons, 'hourglass', String(Math.ceil(Math.max(battleState._freeze?.normal ?? 0, battleState._freeze?.boss ?? 0))), 0, assets);
    }
    this._updateTowerAnimations(battleState, layout, towers, assets, now);
    this._drawTowers(ctx, layout.towerArea, towers, assets, now, hud, bg, battleState.summon, rect);
    this._drawTowerProjectiles(ctx, assets, now, battleState);
    this._monsterFx.drawSprites(ctx, assets, now, assets?.enemySpriteRules?.displayScale ?? 2);
    this._drawEventOverlays(ctx, layout, battleState, assets);
    this._drawFloorStartBanner(ctx, layout.track, now);
  }

  // 결계 두루마리(docs/items.md B3, 7장 "성벽 앞 코드 사각형") - 방어선(track.x)에 세로 테두리. 적 공격이
  // 막힌 프레임(wallBlocked elapsedMs 0 = 이번 틱에 생긴 이벤트)엔 1프레임 밝게 번쩍인다.
  // #386cbc/#8cc4ee 2프레임 교대 깜빡임(fillRect 픽셀 테두리, 원본 1px = 화면 2px), 막힌 프레임은 밝은 색으로.
  _drawWallShield(ctx, track, events) {
    const flash = events.some((e) => e.type === 'wallBlocked' && e.elapsedMs === 0);
    const bright = flash || Math.floor(this._frame / SHIELD_BLINK_FRAMES) % 2 === 1;
    const x = Math.round(track.x) - 4;
    const y = Math.round(track.y) + 1;
    const w = 8;
    const h = Math.round(track.height) - 2;
    const b = 2;
    ctx.save();
    ctx.fillStyle = bright ? '#8cc4ee' : '#386cbc';
    ctx.fillRect(x, y, w, b);
    ctx.fillRect(x, y + h - b, w, b);
    ctx.fillRect(x, y, b, h);
    ctx.fillRect(x + w - b, y, b, h);
    ctx.restore();
  }

  // 성벽 HP 바 오른쪽 위 상태 아이콘(14x14 x2) + 남은 초(ui/font white). index = 오른쪽부터 몇 번째(모래시계와 겹치지 않게).
  _drawStatusIcon(ctx, wallBar, itemIcons, id, text, index, assets) {
    const size = 14 * 2;
    const fontMeta = assets?.uiFont;
    const fontState = getUiFont(assets, 'white');
    const hasFont = !!(fontMeta?.chars && uiReady(fontState));
    // 아이콘 + 숫자 묶음이 바 오른쪽 끝(일시정지 버튼 앞)에서 끝나게 - 숫자 폭은 폰트 widths로 계산.
    let textW = 14;
    if (hasFont) {
      textW = 1;
      for (const c of text) textW += fontMeta.widths[c] - 1;
      textW *= 2;
    }
    const groupW = size + 4 + textW;
    const x = Math.round(wallBar.x + wallBar.width - 4 - groupW - index * (groupW + 8)); // 일시정지 버튼과 4px 띄움
    const y = Math.round(wallBar.y - size / 2);
    const icon = itemIcons?.get(id);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    if (uiReady(icon)) ctx.drawImage(icon.img, x, y, size, size);
    else drawItemIconFallback(ctx, id, x, y, size);
    if (hasFont) {
      drawDamage(ctx, fontState.img, fontMeta, text, x + size + 4 + textW / 2, Math.round(y + size / 2 - fontMeta.cellH), 2);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = getFontString(12, true);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      drawText(ctx, text, x + size + 2, y + size / 2);
    }
    ctx.restore();
  }

  // 부활(docs/items.md C3) - 새 wallRevived 이벤트마다 한 번, 성벽(방어선) 앞에 금색 빛 파편(#f2d264/#c28a20, 흰색 없음).
  // 이벤트는 입력(팝업 탭) 시점에 생겨 렌더 전에 이미 한 틱 늙어 있으므로 elapsedMs 대신 WeakSet으로 "처음 본" 것을 가린다.
  _spawnReviveParticles(track, events) {
    if (!this.particles) return;
    for (const e of events) {
      if (e.type !== 'wallRevived' || this._seenRevives.has(e)) continue;
      this._seenRevives.add(e);
      const n = 36;
      for (let i = 0; i < n; i++) {
        const angle = (i / n) * Math.PI * 2;
        const speed = 90 + (i % 3) * 40;
        this.particles.spawn({
          x: track.x,
          y: track.y + track.height * ((i + 0.5) / n),
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed - 40,
          life: 520 + (i % 4) * 60,
          color: i % 2 === 0 ? '#f2d264' : '#c28a20',
          size: 4 + (i % 3),
          shape: 'rect',
          battle: true,
        });
      }
    }
  }

  // 지역 이름 배너 - 2.2초 보이고 마지막 0.4초 동안 페이드아웃.
  _drawFloorStartBanner(ctx, track, now) {
    const remaining = this._floorBannerUntilMs - now;
    if (remaining <= 0) return;
    const fadeMs = 400;
    const alpha = clamp(remaining / fadeMs, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(13, 10, 16, 0.55)';
    const barH = Math.max(18, track.height * 0.22);
    const barY = track.y + track.height / 2 - barH / 2;
    ctx.fillRect(track.x, barY, track.width, barH);
    ctx.fillStyle = '#f0e6ff';
    ctx.font = getFontString(Math.max(11, barH * 0.5), true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawText(ctx, this._floorBannerText, track.x + track.width / 2, barY + barH / 2);
    ctx.restore();
  }

  // CanvasRenderer가 탑/적 화면 좌표를 구해 파티클·빔 이펙트를 그릴 때 쓰는 공개 래퍼.
  getLayout(rect) {
    return this._computeLayout(rect);
  }

  // 전투 영역 화면 좌표(x,y)가 탑 5개 중 하나의 발판 위면 그 인덱스, 아니면 null - 보드
  // 드래그/탭과 안 섞이게 main.js가 "전투 영역 안의 탭만" 호출한다(docs/balance.md §4).
  hitTestTower(towerArea, towers, assets, x, y) {
    const { frameW, frameH } = this._towerFrameSize(assets, towerArea);
    const feet = this._computeTowerFootPositions(towerArea, frameH);
    for (let i = 0; i < towers.length; i++) {
      const foot = feet[i];
      if (!foot) continue;
      if (x >= foot.x - frameW / 2 && x <= foot.x + frameW / 2 && y >= foot.y - frameH && y <= foot.y) return i;
    }
    return null;
  }

  // main.js가 BattleController.tryLevelUpTower(index)의 결과(성공/실패)를 넘겨준다 -
  // 성공하면 반짝임 + "Lv N" 뜨는 글자, 실패(골드 부족)하면 짧게 흔들림.
  triggerTowerTapFx(towerId, success, now, newLevel) {
    let fx = this._towerTapFx.get(towerId);
    if (!fx) {
      fx = {};
      this._towerTapFx.set(towerId, fx);
    }
    if (success) {
      fx.flashUntilMs = now + 500;
      fx.levelUpText = `Lv ${newLevel}`;
      fx.levelUpStartMs = now;
      fx.levelUpEndMs = now + 700;
    } else {
      fx.shakeUntilMs = now + 220;
    }
  }

  // 작은 탑 아이콘(강화 팝업 카드 등 전투 화면 밖에서도 재사용) - idle 애니메이션 0프레임을
  // 정지 그림으로 그린다. 로드 실패 시 _drawTowerFallback과 같은 색 도형으로 대신한다.
  // 석상 원본은 왼쪽을 본다(assets/statues/README.md) - 전투 화면 탑과 같은 방향(오른쪽)을
  // 보도록 여기서도 좌우 반전한다(_drawTowers의 ctx.scale(-1,1)과 같은 패턴).
  drawTowerIcon(ctx, assets, color, cx, cy, size) {
    const animData = assets?.towerAnims?.get(`tower_idle_${color}`);
    if (animData && animData.state.loaded && !animData.state.failed) {
      const scale = size / animData.frameH;
      const w = animData.frameW * scale;
      const h = animData.frameH * scale;
      ctx.save();
      ctx.translate(cx, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(animData.state.img, 0, 0, animData.frameW, animData.frameH, -w / 2, cy - h / 2, w, h);
      ctx.restore();
    } else {
      this._drawTowerFallback(ctx, { x: cx, y: cy + size / 2 }, size * 0.8, size, color);
    }
  }

  getEnemyPos(track, enemy) {
    return this._enemyPixelPos(track, enemy);
  }

  _computeLayout(rect) {
    const barHeight = Math.max(14, rect.height * 0.09);
    const rowY = rect.y + 6;
    const gap = 6;

    // 한 줄에 왼쪽부터 층 표시 - 성벽 HP 바 - 일시정지 버튼(docs 요청: 그 아래 HUD).
    // 층 배지는 box_floor(9-slice) 테두리가 위아래 5px씩 고정으로 먹어서 barHeight 그대로면
    // 글자가 테두리를 덮는다 - 배지만 더 높게 잡고 줄 높이를 거기에 맞춘다(탑 영역은 그만큼 내려간다).
    const floorHeight = barHeight + 12;
    const barY = rowY + (floorHeight - barHeight) / 2;
    // 폭은 "120층☠"(3자리 + 보스 마커)가 테두리 안에 들어갈 만큼(docs/balance.md §4·§6).
    const floorLabel = { x: rect.x + 6, y: rowY, width: Math.max(90, rect.width * 0.24), height: floorHeight };
    const pauseButton = { x: rect.x + rect.width - 6 - barHeight, y: barY, width: barHeight, height: barHeight };
    const wallBarX = floorLabel.x + floorLabel.width + gap;
    const wallBar = { x: wallBarX, y: barY, width: pauseButton.x - gap - wallBarX, height: barHeight };

    const contentY = rowY + floorHeight + 6;
    const contentHeight = rect.y + rect.height - contentY - 6;

    // 왼쪽 약 30% = 성벽 + 탑 5개, 나머지 = 적이 걷는 길(docs/battle.md §3).
    const towerAreaWidth = rect.width * 0.3;
    const towerArea = {
      x: rect.x + 6,
      y: contentY,
      width: towerAreaWidth - 14,
      height: contentHeight,
    };
    // 성벽은 더 이상 코드로 따로 그리지 않는다 - 배경 시트(신단 영역)에 이미 그려져 있다.
    // track.x가 towerArea 바로 오른쪽(8px 벽 폭 + 여백)에서 시작해 그 경계를 그대로 쓴다.
    const track = {
      x: rect.x + towerAreaWidth + 4,
      y: contentY,
      width: rect.width - towerAreaWidth - 10,
      height: contentHeight,
    };
    // towerArea + 벽 영역 + track을 합친 영역(HUD 줄 아래, 양쪽 6px 여백) - 층별 배경을
    // 그 안쪽에 그린다(manifest.json의 신단(0~46)/길(46~150) 레이아웃이 이 폭 기준).
    const content = { x: rect.x + 6, y: contentY, width: rect.width - 12, height: contentHeight };
    // 층 배경은 패널(= frame) 가로 끝까지, 세로는 content만큼(_drawBackground).
    const bgRect = { x: rect.x, y: contentY, width: rect.width, height: contentHeight };

    return { floorLabel, wallBar, pauseButton, towerArea, track, content, bgRect };
  }

  // assets/backgrounds - 전투 패널 안쪽에 가장 먼저 그리는 층별 배경. manifest.json이나 해당
  // 층 시트가 없으면 아무것도 안 그려 기존 단색 패널(_drawBattlePanel)이 그대로 보이게 둔다.
  // 그려졌으면 {theme, frame}을 돌려줘서 _drawTowers가 같은 프레임으로 받침을 그리게 한다.
  _drawBackground(ctx, rect, assets, now, floor) {
    const manifest = assets?.bgManifest;
    if (!manifest?.sheets) return null;
    const { theme, name } = pickBackgroundSheetName(manifest, floor);
    const sheetState = assets?.bgSheets?.get(name);
    if (!sheetState?.loaded || sheetState.failed) return null;

    const frameW = manifest.frameW ?? DEFAULT_BG_FRAME_W;
    const frameH = manifest.frameH ?? DEFAULT_BG_FRAME_H;
    const frames = manifest.frames ?? DEFAULT_BG_FRAMES;
    const frameMs = manifest.frameMs ?? DEFAULT_BG_FRAME_MS;
    const frame = Math.floor(now / frameMs) % frames;

    // 배율 = BG_FRAME_SCALE x s(frame 배율) 고정 - 레이아웃이 basis 고정 px라 모든 기기에서 같은 모양,
    // 세로는 같은 양(80 중 아래 약 12.5px)만 잘린다. 위쪽(뒷벽) 기준, 좌표는 기기 px로 스냅.
    const dpr = this.dpr ?? 1;
    const scale = (rect.width / FRAME_NATIVE_W) * BG_FRAME_SCALE;
    const drawW = snapPx(frameW * scale, dpr);
    const drawH = snapPx(frameH * scale, dpr);
    const offsetX = snapPx(rect.x, dpr);
    const offsetY = snapPx(rect.y, dpr);

    ctx.save();
    ctx.fillStyle = BG_FALLBACK_FILL;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sheetState.img, frame * frameW, 0, frameW, frameH, offsetX, offsetY, drawW, drawH);
    ctx.restore();

    return { theme, frame };
  }

  // panels/box_floor(9-slice) - 층수 표시 박스(README). 숫자는 계속 코드로 그린다. 보스층은
  // 해골, 엘리트층은 보라 다이아몬드 마커를 층수 옆에 붙인다(docs/balance.md §4·§6).
  _drawFloorLabel(ctx, rect, hud, assets) {
    ctx.save();
    const path = 'panels/box_floor.png';
    const state = getUi(assets, path);
    const meta = getUiMeta(assets, path);
    if (uiReady(state) && meta?.slice) {
      ctx.imageSmoothingEnabled = false;
      drawNine(ctx, state.img, meta.slice, rect.x, rect.y, snap(rect.width), snap(rect.height));
    } else {
      ctx.fillStyle = HUD_CONFIG.panel.raised;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = HUD_CONFIG.panel.raisedBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
    }

    const tag = hud?.tag;
    const marker = tag === 'boss' ? '☠' : tag === 'elite' ? '✦' : '';
    const floorText = `${t('battle.floor', { floor: hud?.floor ?? 1 })}${marker}`;

    ctx.fillStyle = tag === 'boss' ? '#ff6b6b' : tag === 'elite' ? '#c58cff' : HUD_CONFIG.text.primary;
    // 테두리(5px x2)를 넘지 않게 - 3자리 층 + 마커나 더 긴 번역 문구에서 글자가 박스를 덮었다.
    const maxTextWidth = rect.width - 14;
    const fontPx = Math.max(9, rect.height * 0.42);
    ctx.font = getFontString(fontPx, true);
    const textWidth = ctx.measureText(floorText).width;
    if (textWidth > maxTextWidth) {
      ctx.font = getFontString(Math.max(9, (fontPx * maxTextWidth) / textWidth), true);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawText(ctx, floorText, rect.x + rect.width / 2, rect.y + rect.height / 2);
    ctx.restore();
  }

  // buttons/btn_pause(16x16 고정, 2배) - 일시정지 버튼(README). 이미지가 없으면 기존
  // 돌출 패널 + 막대 두 개(||) 도형으로 폴백한다.
  _drawPauseButton(ctx, rect, assets) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const drawn = drawFixedImage(ctx, assets, 'buttons/btn_pause.png', cx, cy, 2);
    if (!drawn) {
      ctx.fillStyle = HUD_CONFIG.panel.raised;
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      ctx.strokeStyle = HUD_CONFIG.panel.raisedBorder;
      ctx.lineWidth = 1;
      ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);

      ctx.fillStyle = HUD_CONFIG.text.primary;
      const barW = Math.max(2, rect.width * 0.14);
      const barH = rect.height * 0.5;
      const gap = rect.width * 0.12;
      ctx.fillRect(cx - gap / 2 - barW, cy - barH / 2, barW, barH);
      ctx.fillRect(cx + gap / 2, cy - barH / 2, barW, barH);
    }
    ctx.restore();
  }

  // icons/wall(16x16 고정) + gauges/hp_frame(가로 3-slice) + fill_red/yellow/green(README).
  // HP 숫자는 계속 코드로 그린다. 이미지가 없으면 기존 2중 사각형 폴백.
  _drawWallHealthBar(ctx, barRect, battleState, assets) {
    const max = battleState.wallMaxHealth || 1;
    let cur = clamp(battleState.wallHealth ?? max, 0, max);
    // 수리 망치 - 회복량만큼 비운 상태에서 이벤트 길이 동안 차오르는 트윈(ease-out).
    // 수리 망치 회복 / 부활(0 -> 50%) 모두 같은 트윈.
    const healed = battleState.events?.find((e) => e.type === 'wallHealed' || e.type === 'wallRevived');
    if (healed?.durationMs) {
      const p = clamp(healed.elapsedMs / healed.durationMs, 0, 1);
      cur = clamp(cur - healed.amount * (1 - p) * (1 - p), 0, max);
    }
    const ratio = cur / max;

    ctx.save();
    ctx.imageSmoothingEnabled = false;

    const iconSize = 16 * 2;
    const iconCx = barRect.x + iconSize / 2;
    const iconDrawn = drawFixedImage(ctx, assets, 'icons/wall.png', iconCx, barRect.y + barRect.height / 2, 2);
    const gaugeX = iconDrawn ? barRect.x + iconSize + 4 : barRect.x;
    const gaugeWidth = iconDrawn ? barRect.width - iconSize - 4 : barRect.width;

    const framePath = 'gauges/hp_frame.png';
    const frameState = getUi(assets, framePath);
    const frameMeta = getUiMeta(assets, framePath);
    if (uiReady(frameState) && frameMeta?.slice && frameMeta?.fill) {
      const k = 2;
      const w = snap(gaugeWidth, k);
      const h = Math.max(frameState.img.height * k, barRect.height);
      drawNine(ctx, frameState.img, frameMeta.slice, gaugeX, barRect.y, w, h, k);

      const { x: fx, y: fy, h: fh, padRight } = frameMeta.fill;
      const fillColorPath = ratio > 0.5 ? 'gauges/fill_green.png' : ratio > 0.2 ? 'gauges/fill_yellow.png' : 'gauges/fill_red.png';
      const fillState = getUi(assets, fillColorPath);
      const fillW = Math.max(0, (w - fx * k - padRight * k) * ratio);
      if (uiReady(fillState) && fillW > 0) {
        ctx.drawImage(fillState.img, 0, 0, fillState.img.width, fillState.img.height, gaugeX + fx * k, barRect.y + fy * k, fillW, fh * k);
      }
    } else {
      ctx.fillStyle = '#2a2f3a';
      ctx.fillRect(gaugeX, barRect.y, gaugeWidth, barRect.height);
      ctx.fillStyle = ratio > 0.5 ? '#2ecc71' : ratio > 0.2 ? '#f1c40f' : '#e74c3c';
      ctx.fillRect(gaugeX, barRect.y, gaugeWidth * ratio, barRect.height);
      ctx.strokeStyle = '#55606f';
      ctx.lineWidth = 1;
      ctx.strokeRect(gaugeX + 0.5, barRect.y + 0.5, gaugeWidth - 1, barRect.height - 1);
    }

    ctx.fillStyle = '#ffffff';
    ctx.font = getFontString(Math.max(9, barRect.height * 0.45));
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    drawText(ctx, `${Math.ceil(cur)} / ${max}`, gaugeX + gaugeWidth / 2, barRect.y + barRect.height / 2);
    ctx.restore();
  }

  // 탑 5개의 발 기준(bottom-center) 좌표. 왼쪽/오른쪽 2열 지그재그(TOWER_SLOTS), 위에서부터
  // 채운다(가운데 정렬이 아니라 위쪽 정렬 - 영역이 좁을 때 양 끝이 영역 밖으로 밀려나는 것을
  // 막는다). band는 가장 빽빽한 열(왼쪽 3개) 기준 1칸 - _towerFrameSize가 이 band를 꽉 채우는
  // 크기로 스프라이트를 맞춰 돌려준다(사용자 확인: 빈틈없이 꽉 차 보여도 된다).
  _computeTowerFootPositions(towerArea, frameH) {
    const band = towerArea.height / 3;
    const y0 = towerArea.y + frameH; // 맨 위 탑 발 - 스프라이트가 영역 위쪽 경계에 맞물리게
    const leftX = towerArea.x + towerArea.width * TOWER_LAYOUT_CONFIG.columns.left;
    const rightX = towerArea.x + towerArea.width * TOWER_LAYOUT_CONFIG.columns.right;

    let leftN = 0;
    let rightN = 0;
    return TOWER_SLOTS.map((col) => {
      if (col === 'left') return { x: leftX, y: y0 + leftN++ * band };
      // 오른쪽 열은 왼쪽 열 사이사이(반 칸 어긋남)에 와야 지그재그가 된다.
      return { x: rightX, y: y0 + (rightN++ + 0.5) * band };
    });
  }

  // 전투 영역이 좁으면(모바일 고정 비율 캔버스 등) 탑 5개 + 상태 라벨이 영역을 벗어나거나
  // 겹치지 않는 선에서 최대한 크게 그린다. 가장 빽빽한 열(왼쪽, 3개)이 세로 공간을 3등분해
  // 빈틈없이 채우는 크기가 기준 - 사용자 확인: 그 열이 꽉 차 보이는 정도는 괜찮음.
  _towerFrameSize(assets, towerArea) {
    const manifest = assets?.towerManifest;
    const frameW0 = manifest?.frameW ?? DEFAULT_TOWER_FRAME_W;
    const frameH0 = manifest?.frameH ?? DEFAULT_TOWER_FRAME_H;
    const manifestScale = manifest?.drawScale ?? DEFAULT_TOWER_DRAW_SCALE;

    let scale = manifestScale;
    if (towerArea) {
      const band = towerArea.height / 3;
      // 발 밑에 레벨/비용 2줄을 적을 자리(약 32%)를 비워둔다 - 안 그러면 다음 칸 탑과 겹친다.
      const labelReserve = 0.32;
      const fitScale = band > 0 ? (band * (1 - labelReserve)) / frameH0 : 0.5;
      scale = Math.max(0.5, Math.min(manifestScale, fitScale));
    }
    return { frameW: frameW0 * scale, frameH: frameH0 * scale, scale };
  }

  // 탑 index의 발사 위치(muzzle) - manifest.muzzle(원본 좌표) × drawScale + 발 기준 탑
  // 왼쪽 위(assets/towers/README.md). 투사체 스폰과 towerLaunchPoint(빔/파티클 목적지) 둘
  // 다 이 메서드로 좌표를 구한다.
  _towerMuzzlePosition(towerArea, index, assets) {
    const { frameW, frameH, scale } = this._towerFrameSize(assets, towerArea);
    const muzzle = assets?.towerManifest?.muzzle ?? DEFAULT_TOWER_MUZZLE;
    const foot = this._computeTowerFootPositions(towerArea, frameH)[index];
    if (!foot) return null;
    return {
      x: foot.x - frameW / 2 + muzzle.x * scale,
      y: foot.y - frameH + muzzle.y * scale,
    };
  }

  // 투사체(탑 공격)의 출발점. towerId로 찾은 탑의 muzzle 좌표를 돌려준다 - 전투 이벤트
  // 오버레이(파티클)와 퍼즐->탑 빔 둘 다 이 메서드로 목적지를 구한다.
  towerLaunchPoint(towerArea, towers, towerId, assets) {
    const index = towers.findIndex((t) => t.id === towerId);
    if (index < 0) return null;
    return this._towerMuzzlePosition(towerArea, index, assets);
  }

  _drawTowers(ctx, towerArea, towers, assets, now, hud, bg, summon, panelRect) {
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const { frameW, frameH, scale } = this._towerFrameSize(assets, towerArea);
    const feet = this._computeTowerFootPositions(towerArea, frameH);
    const summonReady = summon?.active && this._summonAssetsReady(assets);
    const summonCfg = summonReady ? { staggerMs: assets.summonManifest.staggerMs, frameMs: assets.summonManifest.frameMs } : null;

    for (let i = 0; i < towers.length; i++) {
      const tower = towers[i];
      const foot = feet[i];
      if (!foot) continue;
      const anim = this._ensureTowerAnim(tower.id);
      const fx = this._towerTapFx.get(tower.id);

      let shakeX = 0;
      if (fx?.shakeUntilMs > now) {
        const remain = fx.shakeUntilMs - now;
        shakeX = Math.sin(remain * 0.9) * 2.5;
      }
      const drawX = foot.x + shakeX;

      const slot = summonCfg ? pickSummonFrame(summon.elapsedMs, i, summonCfg) : null;

      if (slot && !slot.started) {
        // 시작 전 슬롯 - 받침만 그린다(석상도 기둥도 아직 없음, README).
        ctx.save();
        ctx.translate(drawX, 0);
        ctx.scale(-1, 1);
        this._drawPlinth(ctx, assets, bg, tower.color, -frameW / 2, foot.y - frameH, scale);
        ctx.restore();
      } else if (slot && !slot.done && this._summonColorReady(assets, tower.color)) {
        this._drawSummonSlot(ctx, panelRect, assets, bg, tower.color, drawX, foot, frameW, frameH, scale, slot.frame);
      } else {
        // 소환 연출이 끝났거나(slot.done), 연출이 없거나(에셋 로딩 실패) - 기존 idle/attack.
        // 석상은 공격 프레임이 없다(assets/statues/README.md) - tower_attack_{색}가 로드돼
        // 있을 때만 쓰고, 없으면 attack 모드에서도 idle을 그린다(네온만 맥동, 몸은 안 움직임).
        const attackKey = `tower_attack_${tower.color}`;
        const isAttackAnim = anim.mode === 'attack' && assets?.towerAnims?.has(attackKey);
        const animData = assets?.towerAnims?.get(isAttackAnim ? attackKey : `tower_idle_${tower.color}`);

        ctx.save();
        if (fx?.flashUntilMs > now) {
          ctx.shadowColor = '#ffe066';
          ctx.shadowBlur = frameW * 0.6;
        }
        if (animData && animData.state.loaded && !animData.state.failed) {
          const frame = this._towerFrameIndex(anim, animData, now, isAttackAnim);
          // 석상 원본은 왼쪽을 보고 있다(assets/statues/README.md) - 적은 오른쪽에서 오므로
          // 좌우 반전해서 적을 보게 한다(ctx.scale(-1,1), 기존 적 스프라이트 반전과 같은 패턴).
          ctx.translate(drawX, 0);
          ctx.scale(-1, 1);
          this._drawPlinth(ctx, assets, bg, tower.color, -frameW / 2, foot.y - frameH, scale);
          ctx.drawImage(
            animData.state.img,
            frame * animData.frameW,
            0,
            animData.frameW,
            animData.frameH,
            -frameW / 2,
            foot.y - frameH,
            frameW,
            frameH
          );
        } else {
          this._drawTowerFallback(ctx, { x: drawX, y: foot.y }, frameW, frameH, tower.color);
        }
        ctx.restore();
      }

      this._drawTowerLevelLabel(ctx, foot, frameW, hud, i);
      if (fx?.levelUpEndMs > now) this._drawTowerLevelUpFloat(ctx, foot, frameW, fx, now);
    }
    ctx.restore();
  }

  // assets/summon/manifest.json이 로드돼 있고(frameMs 배열 존재) 타이밍 계산에 쓸 수 있으면
  // true - 실패(fetch 실패로 {})했으면 false라 _drawTowers가 연출 없이 idle로 바로 그린다.
  _summonAssetsReady(assets) {
    return !!assets?.summonManifest?.frameMs?.length;
  }

  // 색 하나의 pillar_back/statue_summon/pillar_front 세 시트가 모두 로드됐는지 - 하나라도
  // 실패했으면 그 탑만 idle로 바로 보여준다(README "로딩 실패하면 연출 없이").
  _summonColorReady(assets, color) {
    return ['pillar_back', 'statue_summon', 'pillar_front'].every((prefix) => {
      const a = assets?.summonAnims?.get(`${prefix}_${color}`);
      return a?.state?.loaded && !a.state.failed;
    });
  }

  // 소환 연출 한 슬롯: 받침 → pillar_back → statue_summon → pillar_front(README 그리기 순서).
  // 빛기둥은 석상 왼쪽 위 기준 (-8,-24) 네이티브 px(x 배율)에 그리고, 전투 패널(panelRect)
  // 밖으로 넘치면 clip한다. drawX/foot은 _drawTowers가 이미 구한 발 좌표를 그대로 쓴다.
  _drawSummonSlot(ctx, panelRect, assets, bg, color, drawX, foot, frameW, frameH, scale, frame) {
    const pillarCfg = assets.summonManifest.pillarFrame ?? {};
    const offset = pillarCfg.offsetFromStatue ?? { x: -8, y: -24 };
    const pillarW = (pillarCfg.w ?? 32) * scale;
    const pillarH = (pillarCfg.h ?? 48) * scale;
    const statueLocalX = -frameW / 2;
    const statueLocalY = foot.y - frameH;
    const pillarLocalX = statueLocalX + offset.x * scale;
    const pillarLocalY = statueLocalY + offset.y * scale;

    ctx.save();
    ctx.beginPath();
    ctx.rect(panelRect.x, panelRect.y, panelRect.width, panelRect.height);
    ctx.clip();
    ctx.translate(drawX, 0);
    ctx.scale(-1, 1);

    this._drawPlinth(ctx, assets, bg, color, statueLocalX, statueLocalY, scale);
    this._drawSummonFrame(ctx, assets.summonAnims.get(`pillar_back_${color}`), frame, pillarLocalX, pillarLocalY, pillarW, pillarH);
    this._drawSummonFrame(ctx, assets.summonAnims.get(`statue_summon_${color}`), frame, statueLocalX, statueLocalY, frameW, frameH);
    this._drawSummonFrame(ctx, assets.summonAnims.get(`pillar_front_${color}`), frame, pillarLocalX, pillarLocalY, pillarW, pillarH);

    ctx.restore();
  }

  _drawSummonFrame(ctx, animEntry, frame, x, y, w, h) {
    if (!animEntry?.state?.loaded || animEntry.state.failed) return;
    ctx.drawImage(animEntry.state.img, frame * animEntry.frameW, 0, animEntry.frameW, animEntry.frameH, x, y, w, h);
  }

  // assets/backgrounds/plinths/{theme}_{color}.png - 석상 발밑 받침. 배경이 안 그려졌으면(bg
  // null) 테마를 모르니 그리지 않는다. statueLocalX/Y는 호출자가 이미 적용한 좌우 반전 변환
  // 안의 석상 왼쪽 위 좌표이므로, 오프셋도 같은 변환 안에서 그대로 더해 반전을 같이 받는다.
  _drawPlinth(ctx, assets, bg, color, statueLocalX, statueLocalY, scale) {
    if (!bg) return;
    const plinthState = assets?.bgPlinths?.get(`${bg.theme}_${color}`);
    if (!plinthState?.loaded || plinthState.failed) return;

    const plinthCfg = assets?.bgManifest?.plinth ?? {};
    const srcFrameW = plinthCfg.frameW ?? DEFAULT_PLINTH_FRAME_W;
    const srcFrameH = plinthCfg.frameH ?? DEFAULT_PLINTH_FRAME_H;
    const frames = plinthCfg.frames ?? DEFAULT_PLINTH_FRAMES;
    const frame = bg.frame % frames;

    const dx = statueLocalX + PLINTH_OFFSET_NATIVE.x * scale;
    const dy = statueLocalY + PLINTH_OFFSET_NATIVE.y * scale;
    ctx.drawImage(plinthState.img, frame * srcFrameW, 0, srcFrameW, srcFrameH, dx, dy, srcFrameW * scale, srcFrameH * scale);
  }

  // 탑 발 아래에 "Lv N / 다음 비용"을 작게 표시한다. 골드가 모자라면 비용을 붉게
  // (docs/balance.md §2 - 탭하면 바로 레벨업, 확인 창 없음, 비용은 코드로 그린다).
  _drawTowerLevelLabel(ctx, foot, frameW, hud, index) {
    const level = hud?.towerLevels?.[index];
    if (level == null) return;

    const lineH = Math.max(8, frameW * 0.3);
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = getFontString(lineH, true);
    ctx.fillStyle = '#e8e8e8';
    drawText(ctx, `Lv${level}`, foot.x, foot.y + 1);
    ctx.restore();
  }

  _drawTowerLevelUpFloat(ctx, foot, frameW, fx, now) {
    const t = Math.min(1, (now - fx.levelUpStartMs) / (fx.levelUpEndMs - fx.levelUpStartMs));
    ctx.save();
    ctx.globalAlpha = 1 - t;
    ctx.fillStyle = '#ffe066';
    ctx.font = getFontString(Math.max(11, frameW * 0.5), true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawText(ctx, fx.levelUpText, foot.x, foot.y - frameW * 0.8 - t * 14);
    ctx.restore();
  }

  // mode==='attack'이고 attack 애니메이션이 실제로 로드돼 있으면(isAttackAnim) 6프레임을
  // fireFrame마다 한 번 재생(루프 없음). 그 외(idle, 또는 attack 프레임이 없는 석상)는 4프레임을
  // 탑마다 어긋난 오프셋(idleOffsetMs)으로 계속 루프한다.
  _towerFrameIndex(anim, animData, now, isAttackAnim) {
    if (isAttackAnim) {
      const frameMs = animData.frameMs ?? DEFAULT_ATTACK_FRAME_MS;
      const frames = animData.frames ?? DEFAULT_ATTACK_FRAMES;
      const frame = Math.floor((now - anim.attackStartMs) / frameMs);
      return Math.min(frames - 1, Math.max(0, frame));
    }
    const frameMs = animData.frameMs ?? DEFAULT_IDLE_FRAME_MS;
    const frames = animData.frames ?? DEFAULT_IDLE_FRAMES;
    return Math.floor((now + anim.idleOffsetMs) / frameMs) % frames;
  }

  _drawTowerFallback(ctx, foot, frameW, frameH, color) {
    const radius = Math.min(frameW, frameH) * 0.4;
    const cx = foot.x;
    const cy = foot.y - frameH * 0.5;
    ctx.fillStyle = '#5a5f6b';
    ctx.beginPath();
    ctx.ellipse(cx, foot.y - radius * 0.2, radius * 1.1, radius * 0.45, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = GEM_COLOR_BY_ID.get(color) ?? '#cccccc';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  _ensureTowerAnim(towerId) {
    let anim = this._towerAnimStates.get(towerId);
    if (!anim) {
      anim = {
        mode: 'idle',
        attackStartMs: 0,
        firedProjectile: false,
        idleOffsetMs: hashOffset(towerId),
        targetEnemyId: null,
        hitEvent: null,
        fallbackTargetPos: null,
      };
      this._towerAnimStates.set(towerId, anim);
    }
    return anim;
  }

  // 새로 발생한 towerAttack 이벤트마다 그 탑의 공격 애니메이션을 처음부터 재생한다(이미
  // 공격 중이어도 덮어써서 "처음부터 다시" 되게 한다). 이후 매 프레임, 공격 중인 탑의
  // 애니메이션 진행을 보고 fireFrame에 도달한 순간 투사체를 스폰하고, 끝나면 idle로 되돌린다.
  _updateTowerAnimations(battleState, layout, towers, assets, now) {
    const { towerArea, track } = layout;
    const enemies = battleState.enemies || [];

    for (const event of battleState.events || []) {
      if (event.type !== 'towerAttack' || this._seenTowerAttacks.has(event)) continue;
      this._seenTowerAttacks.add(event);

      const towerIndex = towers.findIndex((t) => t.id === event.towerId);
      if (towerIndex < 0) continue;
      const tower = towers[towerIndex];
      const anim = this._ensureTowerAnim(tower.id);
      // 연쇄로 같은 탑이 연달아 쏘면 이전 공격이 아직 fireFrame에 닿기 전일 수 있다.
      // 애니메이션을 처음부터 다시 돌리기 전에 그 한 발을 지금 바로 발사해 잃지 않게 한다.
      if (anim.mode === 'attack' && !anim.firedProjectile && anim.hitEvent) {
        const prevEnemy = enemies.find((e) => e.id === anim.targetEnemyId);
        const prevPos = prevEnemy ? this._enemyPixelPos(track, prevEnemy) : anim.fallbackTargetPos;
        const prevMuzzle = this._towerMuzzlePosition(towerArea, towerIndex, assets);
        if (prevPos && prevMuzzle) this._spawnTowerProjectile(tower, prevMuzzle, prevPos, now, anim.hitEvent);
      }
      anim.mode = 'attack';
      anim.attackStartMs = now;
      anim.firedProjectile = false;
      anim.targetEnemyId = event.targetEnemyId;
      anim.hitEvent = event;
      const enemy = enemies.find((e) => e.id === event.targetEnemyId);
      anim.fallbackTargetPos = enemy ? this._enemyPixelPos(track, enemy) : null;
    }

    for (let i = 0; i < towers.length; i++) {
      const tower = towers[i];
      const anim = this._ensureTowerAnim(tower.id);
      if (anim.mode !== 'attack') continue;

      const attackData = assets?.towerAnims?.get(`tower_attack_${tower.color}`);
      const frameMs = attackData?.frameMs ?? DEFAULT_ATTACK_FRAME_MS;
      const frames = attackData?.frames ?? DEFAULT_ATTACK_FRAMES;
      const fireFrame = attackData?.fireFrame ?? DEFAULT_ATTACK_FIRE_FRAME;
      const frame = Math.floor((now - anim.attackStartMs) / frameMs);

      if (frame >= fireFrame && !anim.firedProjectile) {
        anim.firedProjectile = true;
        const enemy = enemies.find((e) => e.id === anim.targetEnemyId);
        const targetPos = enemy ? this._enemyPixelPos(track, enemy) : anim.fallbackTargetPos;
        const muzzle = this._towerMuzzlePosition(towerArea, i, assets);
        if (targetPos && muzzle) this._spawnTowerProjectile(tower, muzzle, targetPos, now, anim.hitEvent);
      }

      if (frame >= frames) anim.mode = 'idle';
    }
  }

  // 개발용(?dev=1 H/K 키): 맨 앞 몬스터에게 석상 투사체 1발 - 실제 사격과 같은 투사체 -> resolveTowerAttack 경로.
  // kill이면 남은 HP만큼, 아니면 1. 석상 색은 쏠 때마다 차례로 바꾼다.
  devShoot(battleState, kill = false) {
    const d = this._dev;
    const target = battleState?.enemies?.filter((e) => e.state === 'alive').sort((a, b) => b.progress - a.progress)[0];
    const towers = battleState?.towers ?? [];
    if (!d || !target || towers.length === 0) return false;
    this._devTurn = ((this._devTurn ?? -1) + 1) % towers.length;
    const tower = towers[this._devTurn];
    const from = this.towerLaunchPoint(d.layout.towerArea, towers, tower.id, d.assets);
    const st = this._skillFx.enemyState(target);
    const to = { x: st.frontX ?? this._enemyPixelPos(d.layout.track, target).x, y: st.bodyY ?? this._enemyPixelPos(d.layout.track, target).y };
    if (!from) return false;
    this._spawnTowerProjectile(tower, from, to, d.now, {
      targetEnemyId: target.id, towerId: tower.id, color: tower.color, damage: kill ? Math.ceil(target.currentHealth) : 1, fromModifier: true,
    });
    return true;
  }

  _spawnTowerProjectile(tower, from, to, now, hitEvent) {
    const speed = tower.stats?.projectileSpeed ?? DEFAULT_PROJECTILE_SPEED;
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const durationMs = Math.max(80, (dist / speed) * 1000);
    this._towerProjectiles.push({
      color: tower.color,
      buffed: !!hitEvent?.buffed, // 분노의 북 - 한 단계 밝은 시트
      fromX: from.x,
      fromY: from.y,
      toX: to.x,
      toY: to.y,
      startMs: now,
      durationMs,
      hitEvent,
    });
  }

  // projectile_{색} 시트(8x8, 4프레임, 루프)를 중심 기준 drawScale배로 그린다. 로딩 실패
  // 시에만 기존 색 점으로 폴백한다(assets/towers/README.md). 투사체가 목표에 도달하는
  // 순간(t>=1) battleState.resolveTowerAttack을 호출해 실제 피해를 적용한다 - 피해는
  // 공격 시점이 아니라 투사체 충돌 시점에 들어가야 하기 때문(core는 이 타이밍을 모른다).
  _drawTowerProjectiles(ctx, assets, now, battleState) {
    if (this._towerProjectiles.length === 0) return;
    const scale = assets?.towerManifest?.drawScale ?? DEFAULT_TOWER_DRAW_SCALE;
    const next = [];
    for (const p of this._towerProjectiles) {
      const t = (now - p.startMs) / p.durationMs;
      if (t >= 1) {
        if (p.hitEvent) {
          // 맞은 점 = 몬스터 앞쪽 가장자리·몸 가운데(지난 프레임 위치). 이미 죽은 목표면 아무것도 안 그린다.
          const target = battleState.enemies?.find((e) => e.id === p.hitEvent.targetEnemyId && e.state === 'alive');
          if (target) {
            const st = this._skillFx.enemyState(target);
            this._monsterFx.hit(p.color, st.frontX ?? p.toX, st.bodyY ?? p.toY, now);
          }
          this._skillFx.onTowerHit(battleState, p.hitEvent, now);
          battleState.resolveTowerAttack(p.hitEvent);
        }
        continue;
      }
      next.push(p);

      const x = p.fromX + (p.toX - p.fromX) * t;
      const y = p.fromY + (p.toY - p.fromY) * t;
      const projData = assets?.towerProjectiles?.get(p.color);

      ctx.save();
      if (projData && projData.state.loaded && !projData.state.failed) {
        ctx.imageSmoothingEnabled = false;
        const w = projData.frameW * scale;
        const h = projData.frameH * scale;
        const frame = Math.floor((now - p.startMs) / projData.frameMs) % projData.frames;
        const sheet = p.buffed ? this._brightSheet(p.color, projData.state.img) : projData.state.img;
        ctx.drawImage(sheet, frame * projData.frameW, 0, projData.frameW, projData.frameH, x - w / 2, y - h / 2, w, h);
      } else {
        ctx.fillStyle = GEM_COLOR_BY_ID.get(p.color) ?? '#ffffff';
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    this._towerProjectiles = next;
  }

  _drawTrack(ctx, track) {
    ctx.save();
    // 방어선: 성벽과 맞닿는 트랙 왼쪽 끝.
    ctx.strokeStyle = '#ff5555';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(track.x, track.y);
    ctx.lineTo(track.x, track.y + track.height);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  _enemyPixelPos(track, enemy) {
    const progress = clamp(enemy.progress ?? 0, 0, 1);
    const x = track.x + track.width * (1 - progress);
    const lane = hashLane(String(enemy.id), ENEMY_LANE_COUNT);
    const y = track.y + (lane + 0.5) * (track.height / ENEMY_LANE_COUNT);
    return { x, y };
  }

  // enemy.rank별 그리기 배율. 엘리트는 늘 spriteRules.eliteScale, 보스는 "이미지가 작으면만
  // 키운다"(docs/balance.md §4) - frameH는 실제 로드된 프레임의 네이티브 높이(px).
  _rankScale(rank, frameH, rules) {
    if (rank === 'elite') return rules.eliteScale ?? 1.5;
    if (rank === 'boss') {
      const small = rules.bossScaleIfSmall;
      if (small && frameH != null && frameH <= small.maxFrameH) return small.scale;
      return 1;
    }
    return 1;
  }

  _drawEnemies(ctx, track, enemies, events, towers, assets, now, battleState = null) {
    const laneSize = track.height / ENEMY_LANE_COUNT;
    const baseShapeSize = Math.min(laneSize * 0.6, 40);
    const rules = assets?.enemySpriteRules ?? {};
    const displayScale = rules.displayScale ?? 2;
    const walkFrameMs = rules.frameMs?.walk ?? 110;
    const knockMs = assets?.skillManifest?.skills?.line?.knockbackMs ?? 120;
    const hitFx = assets?.monsterFxManifest?.hit ?? {};
    const flashMs = hitFx.flashMs ?? 70;
    const hitKnockMs = hitFx.knockbackMs ?? 80;
    const hitKnockPx = (hitFx.knockbackPx ?? 1) * displayScale; // 원본 1px = 화면 배율만큼

    this._monsterFx.drawDying(ctx, assets, now); // 죽어 가는 몸은 살아 있는 몬스터 뒤에

    for (const enemy of enemies) {
      const pos = this._enemyPixelPos(track, enemy);
      const outline = RANK_OUTLINE[enemy.rank];

      const dead = enemy.state === 'dead'; // 로직은 이미 처리됨 - 그림만 MonsterFx로 넘기고 여기선 안 그린다
      const hitEvent = events.find((e) => e.type === 'enemyHit' && e.enemyId === enemy.id);
      const wallHitEvent = events.find((e) => e.type === 'wallDamaged' && e.sourceEnemyId === enemy.id);

      // 피격 = 원본 1px 뒤로 밀렸다 knockbackMs에 복귀(README) - 지속 피해 틱(독)은 번쩍임만. 성벽 공격 = 앞으로 2px 튀어나갔다 복귀.
      let shiftX = 0;
      if (hitEvent && !dead && !DOT_SOURCES.has(hitEvent.source)) shiftX += Math.round(hitKnockPx * Math.max(0, 1 - hitEvent.elapsedMs / hitKnockMs));
      if (wallHitEvent) shiftX -= 2 * Math.sin(clamp(wallHitEvent.elapsedMs / wallHitEvent.durationMs, 0, 1) * Math.PI);
      const fxState = this._skillFx.enemyState(enemy);
      const knockX = this._skillFx.knockOffset(fxState, now, knockMs); // 가시 넉백(렌더 오프셋만).
      shiftX += knockX;
      const baseDrawX = pos.x + shiftX;

      const frames = assets?.enemySprites?.get(enemy.type);
      const loadedFrames = frames?.filter((f) => f && f.loaded && !f.failed);
      // 경직(옐로우) 중에도 걷기 프레임을 경직 시작 시각에 고정한다.
      if (enemy.effects?.stun.time > 1e-9) fxState.stunNow ??= now;
      else fxState.stunNow = null;
      const walkNow = battleState?.isEnemyFrozen?.(enemy) ? this._freezeNow : fxState.stunNow ?? now;
      const frame = loadedFrames && loadedFrames.length > 0 ? loadedFrames[Math.floor((walkNow + hashOffset(String(enemy.id))) / walkFrameMs) % loadedFrames.length] : null;

      let visualHeight;
      let drawX = baseDrawX;
      let uiCenterX = pos.x; // 이름/HP 바의 중심 x - 기본은 적 논리 위치 그대로(폴백 도형은 여기에 대칭).
      ctx.save();
      if (frame) {
        const frameW = frame.img.naturalWidth;
        const frameH = frame.img.naturalHeight;
        const scale = this._rankScale(enemy.rank, frameH, rules) * displayScale;
        const w = frameW * scale;
        const h = frameH * scale;
        // 이름/HP 바는 투명 여백을 뺀 실제 그림 범위에 맞춘다 - 걷는 프레임마다 포즈가 달라
        // 트림이 흔들리므로(상하/좌우로 들썩이는 원인), 항상 첫 프레임 기준으로 고정해서 쓴다.
        const uiFrame = loadedFrames[0];
        const uiScale = this._rankScale(enemy.rank, uiFrame.img.naturalHeight, rules) * displayScale;
        const uiW = uiFrame.img.naturalWidth * uiScale;
        visualHeight = uiFrame.img.naturalHeight * uiScale - (uiFrame.topTrim ?? 0) * uiScale;
        const pack = enemy.anim?.pack ?? 'other';
        const facing = rules.facing?.[pack] ?? rules.facing?.other ?? 'right';
        const flip = facing === 'right'; // 원본이 오른쪽을 보면 왼쪽으로 걷는 적은 반전해야 함.
        // 성벽에 닿는 지점은 화면상 왼쪽(걸어오는 방향의 앞쪽) - 원본 이미지 좌우 폭이 아니라
        // 실제로 그려지는(투명 아닌) 앞쪽 가장자리가 벽면에 닿도록 중심을 뒤로 밀어준다.
        const frontTrim = (flip ? frame.rightTrim : frame.leftTrim) ?? 0;
        drawX = baseDrawX + (w / 2 - frontTrim * scale);
        // 그 보정 때문에 몸체는 pos.x(앞쪽 가장자리)부터 뒤쪽으로만 그려져 더 이상 pos.x 기준
        // 대칭이 아니다 - 이름/HP 바는 실제 보이는 몸통 폭(안정된 첫 프레임 기준)의 중앙에 맞춘다.
        const uiFrontTrim = (flip ? uiFrame.rightTrim : uiFrame.leftTrim) ?? 0;
        const uiBackTrim = (flip ? uiFrame.leftTrim : uiFrame.rightTrim) ?? 0;
        const visibleWidth = Math.max(0, uiW - (uiFrontTrim + uiBackTrim) * uiScale);
        uiCenterX = pos.x + visibleWidth / 2;
        if (dead) {
          // 마지막 프레임 그대로(반전 포함) 재 흩어짐 - 위치는 밀림을 뺀 자리.
          const restX = drawX - shiftX + knockX;
          this._monsterFx.die(enemy, {
            id: enemy.id, img: frame.img, flip, scale, sx: Math.round(restX - w / 2), sy: Math.round(pos.y - h),
            footX: uiCenterX + knockX, footY: pos.y, bodyY: pos.y - visualHeight / 2, big: isBigMonster(frameW, frameH, enemy.rank),
          }, now, assets);
        } else {
          if (outline) {
            ctx.shadowColor = outline;
            ctx.shadowBlur = Math.max(2, h * 0.04);
          }
          ctx.imageSmoothingEnabled = false;
          ctx.translate(drawX, pos.y);
          if (flip) ctx.scale(-1, 1);
          // 맞은 직후 flashMs 동안 번쩍 버전(flashMap, 프레임별 캐시).
          const img = hitEvent && hitEvent.elapsedMs < flashMs ? this._monsterFx.flashImage(frame.img, assets) : frame.img;
          ctx.drawImage(img, -w / 2, -h, w, h); // anchor: feet(아래 가운데) - pos.y가 발 위치.
        }
      } else {
        const shapeSize = baseShapeSize * this._rankScale(enemy.rank, null, rules);
        visualHeight = shapeSize;
        if (dead) {
          this._monsterFx.die(enemy, { id: enemy.id, img: null, footX: drawX, footY: pos.y, bodyY: pos.y - shapeSize / 2, big: enemy.rank === 'boss' }, now, assets);
        } else {
          if (outline) {
            ctx.shadowColor = outline;
            ctx.shadowBlur = Math.max(2, shapeSize * 0.08);
          }
          this._drawEnemyFallback(ctx, enemy, drawX, pos.y - shapeSize / 2, shapeSize);
        }
      }
      ctx.restore();
      uiCenterX += knockX;
      fxState.frontX = pos.x + shiftX; // 투사체가 맞는 점(앞쪽 가장자리)
      fxState.footX = uiCenterX;
      fxState.footY = pos.y;
      fxState.bodyX = uiCenterX;
      fxState.bodyY = pos.y - visualHeight / 2;
      fxState.headY = pos.y - visualHeight;

      if (!dead) {
        const isBoss = enemy.rank === 'boss';
        const barBottomY = pos.y - visualHeight - 2; // README: 바 아래쪽이 머리보다 화면 2px 위.
        const barWidth = baseShapeSize * (isBoss ? 1.8 : 1.3);
        const barTopY = this._drawEnemyHealthBar(ctx, uiCenterX, barBottomY, barWidth, enemy, assets, isBoss);
        const iconTopY = this._skillFx.drawStatusIcons(ctx, assets, enemy, uiCenterX, barTopY - 2);
        const nameY = iconTopY - 2;
        const name = tOr(`names.monster.${enemy.type}`, enemy.name ?? enemy.type ?? '');
        ctx.save();
        ctx.fillStyle = isBoss ? '#ff8a8a' : '#e8e8e8';
        ctx.font = getFontString(isBoss ? 13 : 10, isBoss);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        drawText(ctx, name, uiCenterX, nameY);
        // 면역·약점 아이콘(보스) - 이름 오른쪽, 아이콘 18px 높이를 이름 아랫줄에 맞춘다.
        if (enemy.immune?.length || enemy.weak?.length) {
          this._skillFx.drawBossIcons(ctx, assets, enemy, uiCenterX + ctx.measureText(name).width / 2 + 3, nameY - 18);
        }
        ctx.restore();
      }

      if (hitEvent) {
        const t = clamp(hitEvent.elapsedMs / hitEvent.durationMs, 0, 1);
        // 데미지 숫자는 "쏜 탑 색" 폰트로 그린다(README) - enemyHit 이벤트가 직접 들고 있는
        // towerId로 바로 찾는다.
        // 독 틱은 작은(1배) 보라 숫자.
        const poison = hitEvent.source === 'poison';
        const tower = towers.find((t2) => t2.id === hitEvent.towerId);
        this._drawFloatingNumber(ctx, pos.x, pos.y - visualHeight, `-${hitEvent.damage}`, t, '#ff6b6b', assets, hitEvent.buffed ? 'crit' : poison ? 'purple' : tower?.color ?? 'white', poison ? 1 : 2);
      }
    }
  }

  // 스프라이트가 없는(로딩 실패) 적용 임시 표시: 이름 해시로 고른 색 원 + 이름 첫 글자
  // (docs/balance.md §4). x/y는 해당 도형의 좌상단이 아니라 중심(원래 _drawEnemies가
  // pos.y - shapeSize/2를 넘겨 중심을 맞춘다).
  _drawEnemyFallback(ctx, enemy, x, y, size) {
    if (size <= 0) return;
    const label = enemy.name ?? enemy.type ?? '';
    const color = ENEMY_FALLBACK_PALETTE[hashLane(enemy.type ?? label, ENEMY_FALLBACK_PALETTE.length)];
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, size / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0d0a10';
    ctx.font = getFontString(Math.max(9, size * 0.5), true);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawText(ctx, label.slice(0, 1), x, y + 1);
  }

  // enemy/bar_normal·bar_elite·bar_boss(README "몬스터 HP 게이지") - 가로 3-slice, 2배로 그린다.
  // cx = 적 중심 x(치우치지 않게 가운데 정렬), bottomY = 바 아래쪽이 올 화면 y. 이미지가 없으면
  // 기존 사각형 폴백. 반환값 = 바 윗변 y(이름을 그 위에 이어 그리기 위해).
  _drawEnemyHealthBar(ctx, cx, bottomY, width, enemy, assets, isBoss = false) {
    const max = enemy.maxHealth || 1;
    const ratio = clamp((enemy.currentHealth ?? max) / max, 0, 1);
    const isElite = enemy.rank === 'elite';
    const framePath = isBoss ? 'enemy/bar_boss.png' : isElite ? 'enemy/bar_elite.png' : 'enemy/bar_normal.png';
    const frameState = getUi(assets, framePath);
    const frameMeta = getUiMeta(assets, framePath);
    const k = 2;

    if (uiReady(frameState) && frameMeta?.slice && frameMeta?.fill) {
      const w = snap(Math.max(width, frameState.img.width * k), k);
      const h = frameState.img.height * k;
      const x = cx - w / 2;
      const y = bottomY - h;
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      drawNine(ctx, frameState.img, frameMeta.slice, x, y, w, h, k);
      const { x: fx, y: fy, h: fh, padRight } = frameMeta.fill;
      const fillState = getUi(assets, isBoss ? 'gauges/fill_red.png' : 'enemy/fill_red.png');
      const fillW = Math.max(0, (w - fx * k - padRight * k) * ratio);
      if (uiReady(fillState) && fillW > 0) {
        ctx.drawImage(fillState.img, 0, 0, fillState.img.width, fillState.img.height, x + fx * k, y + fy * k, fillW, fh * k);
      }
      ctx.restore();
      return y;
    }

    const height = isBoss ? 7 : 4;
    const x = cx - width / 2;
    const y = bottomY - height;
    ctx.save();
    if (isBoss) {
      ctx.strokeStyle = '#0d0a10';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 0.5, y - 0.5, width + 1, height + 1);
    }
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = ratio > 0.5 ? '#2ecc71' : ratio > 0.2 ? '#f1c40f' : '#e74c3c';
    ctx.fillRect(x, y, width * ratio, height);
    ctx.restore();
    return y;
  }

  // font/damage_{variant}(README의 drawDamage) - 쏜 탑 색(red/blue/yellow/green/purple)
  // 또는 성벽 피해(red)/기본(white), 북 버프 중 피해(crit 색, 크기는 평소 2배)에 쓴다. 진짜 치명타(3배)는 scale 3으로 - 지금 게임에 크리티컬
  // 판정 자체가 없어 호출되지 않는다 - 헬퍼만 준비해 둔다. 이미지가 없으면 기존 코드 텍스트로
  // 폴백한다.
  _drawFloatingNumber(ctx, x, y, text, t, color, assets, variant = 'white', scale = 2) {
    const floatY = y - DAMAGE_FLOAT_PX * t;
    const fontMeta = assets?.uiFont;
    const fontState = getUiFont(assets, variant);

    ctx.save();
    ctx.globalAlpha = 1 - t;
    if (fontMeta?.chars && uiReady(fontState)) {
      ctx.imageSmoothingEnabled = false;
      const k = scale;
      drawDamage(ctx, fontState.img, fontMeta, text, x, Math.round(floatY - (fontMeta.cellH * k) / 2), k);
    } else {
      ctx.fillStyle = color;
      ctx.font = getFontString(12);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      drawText(ctx, text, x, floatY);
    }
    ctx.restore();
  }

  // wallDamaged(피해 숫자+플래시) / enemyReachLine(방어선 경고)처럼 특정 적/탑 그리기
  // 루프에 속하지 않는 전역 이벤트 연출. towerAttack의 투사체는 _drawTowerProjectiles가
  // 공격 애니메이션 fireFrame 시점에 맞춰 별도로 그린다(이 메서드에서 다루지 않음).
  _drawEventOverlays(ctx, layout, battleState, assets) {
    const { track, wallBar } = layout;
    const enemies = battleState.enemies || [];
    const events = battleState.events || [];

    for (const event of events) {
      if (event.type === 'enemyReachLine') {
        const enemy = enemies.find((e) => e.id === event.enemyId);
        if (!enemy) continue;
        const pos = this._enemyPixelPos(track, enemy);
        const t = clamp(event.elapsedMs / event.durationMs, 0, 1);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#ff3b3b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(track.x, pos.y, 8 + t * 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      } else if (event.type === 'wallDamaged') {
        const t = clamp(event.elapsedMs / event.durationMs, 0, 1);
        ctx.save();
        ctx.globalAlpha = (1 - t) * 0.5;
        ctx.fillStyle = '#ff0000';
        ctx.fillRect(wallBar.x, wallBar.y, wallBar.width, wallBar.height);
        ctx.restore();
        this._drawFloatingNumber(
          ctx,
          wallBar.x + wallBar.width / 2,
          wallBar.y + wallBar.height + 12,
          `-${event.amount}`,
          t,
          '#ff6b6b',
          assets,
          'red'
        );
      }
    }
  }

}
