// manifest.json(이미지 경로) + effects.json(이펙트 파라미터)을 읽어 Image들을 로드한다.
// 잼 이미지는 assets/gems/manifest.json(별도 패키지, assets/gems/README.md 참고) 기준.
// 모든 fetch/파싱 실패도 throw하지 않고 빈 설정으로 계속 진행한다 -
// CanvasRenderer는 이 결과가 비어있어도(this.assets===null과 동일하게) 색 도형으로
// fallback해서 그릴 수 있어야 한다.
import { audio } from '../audio/AudioManager.js';

async function fetchJson(path) {
  try {
    const res = await fetch(path);
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

// 스프라이트의 투명 여백(원본 크기 기준, top/left/right px). 몬스터마다 캔버스 안에서
// 실제 그림이 차지하는 영역이 달라 1) 이름/HP 바가 들쭉날쭉하고 2) 성벽 충돌 시 중심
// 기준이라 그림이 벽에 끼어 보이던 문제 - 실제로 그려지는 픽셀의 경계를 찾아 렌더러가
// 그 기준으로 맞출 수 있게 한다. getImageData 실패(CORS 등) 시 전부 0(기존 동작 유지).
function computeSpriteTrim(img) {
  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return { top: 0, left: 0, right: 0 };
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, w, h);
    let top = 0;
    let foundTop = false;
    let minX = w;
    let maxX = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] <= 10) continue;
        if (!foundTop) {
          top = y;
          foundTop = true;
        }
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
      }
    }
    if (maxX < 0) return { top: 0, left: 0, right: 0 };
    return { top, left: minX, right: w - 1 - maxX };
  } catch {
    return { top: 0, left: 0, right: 0 };
  }
}

// 성공/실패 모두 "처리됨"으로 resolve한다(실패해도 진행률이 멈추지 않도록).
// export: titleScreen.js도 같은 패턴으로 개별 이미지를 로드한다.
export function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    const state = { img, loaded: false, failed: false, topTrim: 0, leftTrim: 0, rightTrim: 0 };
    img.onload = () => {
      state.loaded = true;
      const trim = computeSpriteTrim(img);
      state.topTrim = trim.top;
      state.leftTrim = trim.left;
      state.rightTrim = trim.right;
      resolve(state);
    };
    img.onerror = () => {
      state.failed = true;
      resolve(state);
    };
    img.src = src;
  });
}

const GEM_VARIANTS = ['normal', 'line_h', 'line_v', 'bomb', 'box'];

// onProgress(loadedCount, totalCount)를 받아 로드 진행률을 알려준다.
// 반환값: CanvasRenderer.setAssets()에 그대로 꽂아 쓸 수 있는 형태.
export async function loadAssets(onProgress) {
  const [manifest, gemManifest, effectsConfig, sfxManifest, towerManifest, statueManifest, uiManifest, menuUiManifest, uiFont, obstacleManifest, effectFxManifest, bgManifest, enemiesConfig, summonManifest] = await Promise.all([
    fetchJson('assets/manifest.json'),
    fetchJson('assets/gems/manifest.json'),
    fetchJson('src/config/effects.json'),
    fetchJson('assets/sfx/manifest.json'),
    fetchJson('assets/towers/manifest.json'),
    fetchJson('assets/statues/manifest.json'),
    fetchJson('assets/ui/manifest.json'),
    fetchJson('assets/ui/menu/manifest.json'),
    fetchJson('assets/ui/font/font.json'),
    fetchJson('assets/obstacles/manifest.json'),
    fetchJson('assets/effects/manifest.json'),
    fetchJson('assets/backgrounds/manifest.json'),
    fetchJson('config/enemies.json'),
    fetchJson('assets/summon/manifest.json'),
  ]);

  const jobs = [];
  // 효과음(assets/sfx) - 이미지와 같은 jobs/bucket 패턴으로 프리로더 진행률에 포함시킨다.
  // 디코드 실패는 AudioManager가 흡수한다(그 소리만 무음, 게임은 계속).
  audio.setManifest(sfxManifest);
  for (const file of audio.fileNames()) jobs.push({ bucket: 'sfx', file });

  for (const [color, variants] of Object.entries(gemManifest.gems ?? {})) {
    for (const variant of GEM_VARIANTS) {
      const src = variants?.[variant];
      if (src) jobs.push({ bucket: 'gem', key: `${color}_${variant}`, src: `assets/gems/${src}` });
    }
  }
  if (gemManifest.color?.static) {
    jobs.push({ bucket: 'gemColor', key: null, src: `assets/gems/${gemManifest.color.static}` });
  }
  for (const [key, anim] of Object.entries(gemManifest.anims ?? {})) {
    jobs.push({ bucket: 'gemAnim', key, src: `assets/gems/${anim.sheet}`, anim });
  }
  // 적 스프라이트(assets/enemies) - enemies.json monsters[id].anim.walk 패턴의 {i}를 frames
  // 값으로 바꿔 .png 프레임 여러 장을 로드한다(몬스터마다 파일이 따로 - 한 장짜리 시트가
  // 아니다). 전투 중 적은 항상 걷거나 성벽을 때리는 중이라 idle은 쓰지 않는다
  // (shortcut: 대기 상태가 생기면 anim.idle 패턴으로 이 루프를 한 번 더 돌리면 됨).
  const enemyFrameCounts = new Map();
  const spriteDir = enemiesConfig.spriteDir ?? 'assets/enemies/';
  for (const [mid, m] of Object.entries(enemiesConfig.monsters ?? {})) {
    const pattern = m.anim?.walk;
    const frames = m.anim?.frames ?? [0];
    if (!pattern) continue;
    enemyFrameCounts.set(mid, frames.length);
    frames.forEach((i, order) => {
      jobs.push({ bucket: 'enemyFrame', key: mid, order, src: `${spriteDir}${pattern.replace('{i}', i)}.png` });
    });
  }

  // 탑 그림(assets/statues) - 받침 위 잼 대신 보석 석상을 그린다(assets/statues/README.md).
  // towerAnims 키는 기존 렌더러(battleRenderer.js)가 찾는 이름(tower_idle_{색})을 그대로
  // 쓴다 - 공격 프레임은 없으므로(README) tower_attack_{색}는 로드하지 않고, 렌더러가 attack
  // 모드에서도 idle로 그린다. 투사체는 기존 assets/towers 쪽을 그대로 쓴다(그림만 교체,
  // 공격 로직/투사체는 유지).
  for (const [color, statue] of Object.entries(statueManifest.statues ?? {})) {
    jobs.push({ bucket: 'towerImage', key: color, src: `assets/statues/${statue.file}` });
  }
  for (const color of statueManifest.colors ?? []) {
    const anim = statueManifest.anims?.[`statue_idle_${color}`];
    if (anim) jobs.push({ bucket: 'towerAnim', key: `tower_idle_${color}`, src: `assets/statues/${anim.sheet}`, anim });
  }
  // towerManifest가 fetch 실패로 {}이면 아래 Object.entries가 빈 객체를 돌려주므로
  // towerProjectiles가 빈 Map으로 남고, 렌더러는 기존 색 점으로 fallback한다(assets/towers/README.md).
  for (const [color, proj] of Object.entries(towerManifest.projectiles ?? {})) {
    jobs.push({ bucket: 'towerProjectile', key: color, src: `assets/towers/${proj.sheet}`, anim: proj });
  }

  // 인게임 UI(assets/ui) - manifest.json에 나열된 모든 파일을 키(예: "icons/gold.png")
  // 그대로 Map 키로 써서 로드한다. font.json의 변형(variants)은 색상별 데미지 숫자 폰트.
  for (const path of Object.keys(uiManifest.assets ?? {})) {
    jobs.push({ bucket: 'ui', key: path, src: `assets/ui/${path}` });
  }
  // 메인 메뉴 UI(assets/ui/menu)는 manifest가 따로지만 규격이 같아, "menu/<파일>" 경로를
  // 키로 같은 uiImages/uiManifest에 합쳐 넣는다 - uiKit의 getUi/getUiMeta/drawNine을 그대로 쓴다.
  uiManifest.assets ??= {};
  for (const meta of Object.values(menuUiManifest.assets ?? {})) {
    const path = `menu/${meta.file}`;
    uiManifest.assets[path] = meta;
    jobs.push({ bucket: 'ui', key: path, src: `assets/ui/${path}` });
  }
  for (const [variant, relPath] of Object.entries(uiFont.variants ?? {})) {
    jobs.push({ bucket: 'uiFont', key: variant, src: `assets/ui/${relPath}` });
  }

  // 퍼즐 방해요소(assets/obstacles) - manifest.obstacles의 각 종류별 정지 이미지(image) +
  // hp별 이미지(hpImages)를 obstacleImages에, manifest.anims의 8개 스프라이트 시트를
  // obstacleAnims에 담는다(잼/탑 로더와 같은 jobs 배열 + bucket 패턴, README 참고).
  for (const [id, cfg] of Object.entries(obstacleManifest.obstacles ?? {})) {
    if (cfg.image) jobs.push({ bucket: 'obstacleImage', key: id, src: `assets/obstacles/${cfg.image}` });
    for (const [hp, img] of Object.entries(cfg.hpImages ?? {})) {
      jobs.push({ bucket: 'obstacleImage', key: `${id}_hp${hp}`, src: `assets/obstacles/${img}` });
    }
    if (cfg.digits?.sheet) jobs.push({ bucket: 'obstacleImage', key: `${id}_digits`, src: `assets/obstacles/${cfg.digits.sheet}` });
  }
  for (const [key, anim] of Object.entries(obstacleManifest.anims ?? {})) {
    jobs.push({ bucket: 'obstacleAnim', key, src: `assets/obstacles/${anim.sheet}`, anim });
  }

  // 잼 터짐 이펙트(assets/effects) - obstacleAnims와 같은 jobs/bucket 패턴. 타이밍 규칙
  // (line.stepMs, bomb.hitMs, box.*, color.*)은 effectFxManifest로 그대로 넘긴다
  // (assets/effects/README.md 참고).
  for (const [key, anim] of Object.entries(effectFxManifest.anims ?? {})) {
    jobs.push({ bucket: 'effectAnim', key, src: `assets/effects/${anim.sheet}`, anim });
  }

  // 층별 전투 배경(assets/backgrounds) - sheets/*(층 시트)와 plinths/*(테마별 석상 받침)를
  // manifest.json에 나열된 그대로 키(시트 이름 / "{theme}_{color}")로 로드한다. 프레임 크기 등은
  // manifest.json 최상위/plinth 값이 공통이므로 bgManifest를 그대로 battleRenderer에 넘긴다.
  for (const [name, cfg] of Object.entries(bgManifest.sheets ?? {})) {
    jobs.push({ bucket: 'bgSheet', key: name, src: `assets/backgrounds/${cfg.file}` });
  }
  for (const [key, cfg] of Object.entries(bgManifest.plinths ?? {})) {
    jobs.push({ bucket: 'bgPlinth', key, src: `assets/backgrounds/${cfg.file}` });
  }

  // 석상 소환 빛기둥(assets/summon) - pillar_back/pillar_front/statue_summon 시트를 색마다
  // 로드한다(assets/summon/README.md). 로딩 실패(이 fetchJson이 {}를 돌려주거나 개별
  // 이미지가 실패)해도 battleRenderer가 연출 없이 석상을 바로 보여주면 되므로 별도 처리 없이
  // 그대로 진행한다(잼/탑 로더와 같은 jobs/bucket 패턴).
  for (const [key, anim] of Object.entries(summonManifest.anims ?? {})) {
    jobs.push({ bucket: 'summonAnim', key, src: `assets/summon/${anim.sheet}`, anim });
  }

  const gemImages = new Map();
  const gemAnims = new Map();
  const enemySprites = new Map(); // monster id -> 프레임 state[](순서대로, 로드 완료 순서가 아니라 anim.frames 순서).
  const towerImages = new Map();
  const towerAnims = new Map();
  const towerProjectiles = new Map();
  const uiImages = new Map();
  const uiFontImages = new Map();
  const obstacleImages = new Map();
  const obstacleAnims = new Map();
  const effectAnims = new Map();
  const bgSheets = new Map();
  const bgPlinths = new Map();
  const summonAnims = new Map();
  let gemColorImage = null;

  const total = jobs.length;
  let loaded = 0;
  onProgress?.(0, total);

  await Promise.all(
    jobs.map(async (job) => {
      if (job.bucket === 'sfx') {
        await audio.loadFile(job.file);
        loaded += 1;
        onProgress?.(loaded, total);
        return;
      }
      const state = await loadImage(job.src);
      loaded += 1;
      onProgress?.(loaded, total);
      if (job.bucket === 'gem') gemImages.set(job.key, state);
      else if (job.bucket === 'gemColor') gemColorImage = state;
      else if (job.bucket === 'gemAnim') {
        gemAnims.set(job.key, {
          state,
          frameW: job.anim.frameW,
          frameH: job.anim.frameH,
          frames: job.anim.frames,
          frameMs: job.anim.frameMs,
        });
      } else if (job.bucket === 'enemyFrame') {
        let arr = enemySprites.get(job.key);
        if (!arr) {
          arr = new Array(enemyFrameCounts.get(job.key)).fill(null);
          enemySprites.set(job.key, arr);
        }
        arr[job.order] = state;
      } else if (job.bucket === 'towerImage') towerImages.set(job.key, state);
      else if (job.bucket === 'towerAnim') {
        towerAnims.set(job.key, {
          state,
          frameW: job.anim.frameW,
          frameH: job.anim.frameH,
          frames: job.anim.frames,
          frameMs: job.anim.frameMs,
          loop: job.anim.loop,
          fireFrame: job.anim.fireFrame,
        });
      } else if (job.bucket === 'towerProjectile') {
        towerProjectiles.set(job.key, {
          state,
          frameW: job.anim.frameW,
          frameH: job.anim.frameH,
          frames: job.anim.frames,
          frameMs: job.anim.frameMs,
          loop: job.anim.loop,
        });
      } else if (job.bucket === 'ui') uiImages.set(job.key, state);
      else if (job.bucket === 'uiFont') uiFontImages.set(job.key, state);
      else if (job.bucket === 'obstacleImage') obstacleImages.set(job.key, state);
      else if (job.bucket === 'obstacleAnim') {
        obstacleAnims.set(job.key, {
          state,
          frameW: job.anim.frameW,
          frameH: job.anim.frameH,
          frames: job.anim.frames,
          frameMs: job.anim.frameMs,
          loop: job.anim.loop,
          facing: job.anim.facing,
          pivot: job.anim.pivot,
        });
      } else if (job.bucket === 'effectAnim') {
        effectAnims.set(job.key, {
          state,
          frameW: job.anim.frameW,
          frameH: job.anim.frameH,
          frames: job.anim.frames,
          frameMs: job.anim.frameMs,
          loop: job.anim.loop,
        });
      } else if (job.bucket === 'bgSheet') bgSheets.set(job.key, state);
      else if (job.bucket === 'bgPlinth') bgPlinths.set(job.key, state);
      else if (job.bucket === 'summonAnim') {
        summonAnims.set(job.key, { state, frameW: job.anim.frameW, frameH: job.anim.frameH, frames: job.anim.frames });
      }
    })
  );

  return {
    gemImages,
    gemAnims,
    gemColorImage,
    gemImageSmoothing: gemManifest.imageSmoothing ?? false,
    // 이미지 48px(잼 몸통 32px + 효과용 여백 8px씩) - 렌더러는 이 둘의 비율로 칸 크기에 맞는
    // 그리기 배율을 구한다(assets/gems/README.md 참고). manifest 로드 실패 시에도 fallback
    // 도형만 그리면 되므로 기본값(48/32)을 그대로 둔다.
    gemTileSize: gemManifest.tileSize ?? 48,
    gemBodySize: gemManifest.bodySize ?? 32,
    enemySprites,
    enemySpriteRules: enemiesConfig.spriteRules ?? {},
    towerImages,
    towerAnims,
    towerProjectiles,
    // battleRenderer가 frameW/frameH/drawScale/muzzle을 읽는 곳 - 그림을 석상으로 바꿨으니
    // 이 수치도 statueManifest 기준(투사체 발사 위치 등)으로 맞춘다.
    towerManifest: statueManifest,
    uiImages,
    uiManifest,
    uiFont,
    uiFontImages,
    obstacleImages,
    obstacleAnims,
    obstacleManifest,
    effectAnims,
    effectFxManifest,
    bgManifest,
    bgSheets,
    bgPlinths,
    // 석상 소환 연출(assets/summon) - battleRenderer가 pillarFrame/statueFrame 오프셋,
    // staggerMs/frameMs(BattleState.summon.elapsedMs와 같은 pickSummonFrame 계산용),
    // landFrame 등을 이 manifest에서 그대로 읽는다. fetch 실패 시 {}라 frameMs가 없고,
    // 렌더는 그 경우 연출 없이 statue_idle로 바로 그린다.
    summonManifest,
    summonAnims,
    // manifest.tileSize/bodySize/drawScale은 잼과 같은 규격(assets/obstacles/README.md) -
    // manifest 로드 실패 시에도 fallback 도형만 그리면 되므로 기본값을 그대로 둔다.
    obstacleTileSize: obstacleManifest.tileSize ?? 48,
    obstacleBodySize: obstacleManifest.bodySize ?? 32,
    obstacleDrawScale: obstacleManifest.drawScale ?? 2,
    effectsConfig,
  };
}
