// 수호의 제단 수호자 탭의 무대 칸(assets/ui/upgrade/stage) 안 수호자 - 등급 시트를 전투처럼 좌우 반전해 x3로.
// 레벨 구간 이펙트(guardianFx.js)는 강화 연출 동안만 전투와 같은 순서로 같이 그린다(anim.tier > 0, 칸 밖으로 넘쳐도 둔다).
import { lookAnimKey, FX_SLOT_STAGGER_MS, drawGuardianFxBack, drawGuardianFxBehind, drawGuardianFxFront, drawGuardianOutline } from '../guardianFx.js';

export const STAGE_K = 3;
const FLASH_FILL = [0xe8, 0xdc, 0xc0];
const OUTLINE = [0x0d, 0x0a, 0x10]; // 번쩍여도 외곽선은 그대로

const ready = (a) => a && a.state.loaded && !a.state.failed;

// 공격 시트 -> [통칠, 체크무늬(x+y 짝수만)] 캔버스. 시트 이미지가 색·등급마다 달라 이미지가 곧 캐시 키.
const flashCache = new WeakMap();
function flashSheets(img) {
  let out = flashCache.get(img);
  if (out) return out;
  const w = img.width;
  const h = img.height;
  const mk = () => Object.assign(document.createElement('canvas'), { width: w, height: h });
  const sctx = mk().getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const src = sctx.getImageData(0, 0, w, h).data;
  out = [false, true].map((checker) => {
    const c = mk();
    const cctx = c.getContext('2d');
    const id = cctx.createImageData(w, h);
    const d = id.data;
    d.set(src);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] === 0 || (checker && (x + y) & 1)) continue; // frameW가 짝수라 시트 x로 봐도 프레임 안 x와 홀짝이 같다
        if (d[i] === OUTLINE[0] && d[i + 1] === OUTLINE[1] && d[i + 2] === OUTLINE[2]) continue;
        d[i] = FLASH_FILL[0];
        d[i + 1] = FLASH_FILL[1];
        d[i + 2] = FLASH_FILL[2];
      }
    }
    cctx.putImageData(id, 0, 0);
    return c;
  });
  flashCache.set(img, out);
  return out;
}

// (x, y) = 무대 왼쪽 위(팝업 basis 좌표). anim = { row(줄 번호 - idle 어긋남), atk(공격 시작 ms), flash(번쩍임 시작 ms), tier(지금 그릴 레벨 이펙트 tier, 0 = 없음) }.
// 공격 시트를 1번 재생한 뒤 idle. 번쩍임은 시작 후 1프레임 통칠 + 1프레임 체크무늬를 그 순간의 공격 프레임에 입힌다.
export function drawStageGuardian(ctx, assets, color, look, x, y, now, anim) {
  const anims = assets?.towerAnims;
  const atk = anims?.get(lookAnimKey(anims, 'attack', color, look));
  const age = now - anim.atk;
  const attacking = ready(atk) && age >= 0 && age < atk.frames * atk.frameMs;
  const a = attacking ? atk : anims?.get(lookAnimKey(anims, 'idle', color, look));
  if (!ready(a)) return;
  const frame = attacking ? Math.floor(age / a.frameMs) : (Math.floor(now / a.frameMs) + anim.row) % a.frames;
  let img = a.state.img;
  const flashAge = now - anim.flash;
  if (attacking && flashAge >= 0 && flashAge < a.frameMs * 2) img = flashSheets(img)[flashAge < a.frameMs ? 0 : 1];
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  // 프레임 왼쪽 위가 무대 (3, 3) - 발이 받침(y 28)에 1px 박힌다. 원점 = 발 가운데(프레임 아래 가운데), 원본 1px = 1.
  ctx.translate(x + (3 + a.frameW / 2) * STAGE_K, y + (3 + a.frameH) * STAGE_K);
  ctx.scale(STAGE_K, STAGE_K);
  const tier = assets.guardianFxManifest ? anim.tier : 0;
  const t = now + anim.row * FX_SLOT_STAGGER_MS;
  if (tier) {
    drawGuardianFxBack(ctx, assets, color, tier, 0, 0, 1, t);
    drawGuardianFxBehind(ctx, assets, color, tier, 0, 0, 1, t);
  }
  ctx.save();
  ctx.scale(-1, 1); // 원본은 왼쪽을 보므로 반전
  if (tier) drawGuardianOutline(ctx, assets, a, tier, frame, -a.frameW / 2, -a.frameH, 1, t, 0, true); // 연출 동안 계속 밝게
  ctx.drawImage(img, frame * a.frameW, 0, a.frameW, a.frameH, -a.frameW / 2, -a.frameH, a.frameW, a.frameH);
  ctx.restore();
  if (tier) drawGuardianFxFront(ctx, assets, color, tier, 0, 0, 1, t);
  ctx.restore();
}

// 공격 시트 한 번 재생 길이(ms) - 연속 강화 때 "재생 중이면 이어서" 판단에 쓴다. 시트가 없으면 0.
export function stageAttackMs(assets, color, look) {
  const anims = assets?.towerAnims;
  const atk = anims?.get(lookAnimKey(anims, 'attack', color, look));
  return ready(atk) ? atk.frames * atk.frameMs : 0;
}
