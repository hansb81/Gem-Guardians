// 공통 획득 팝업(docs/inventory.md 5-2): inventory.grant()/buy() 결과(delta)를 아이콘 줄로 보여 준다.
// 보스 첫 처치 보상, 상점 패키지·패스·무료 1개가 전부 이 팝업 하나를 쓴다. 게임·상점 어느 scene 위에서든
// 맨 위에 그린다(main.js). 틀 = ui/menu/popup_menu(9-slice x2), 칸 = items/slot_normal x2, 배경 어둡게 = #0d0a10 체커 디더.
import { drawNine, drawText, drawFixedImage, getUi, getUiMeta, uiReady, snap, pressButton } from './uiKit.js';
import { ditherPattern } from './itemBarRenderer.js';
import { getFontString } from '../config/fonts.js';
import { t } from '../config/i18n.js';
import { HUD_CONFIG } from '../config/hud.js';
import { screen } from './screenFit.js';
import { drawSpirit, drawSpiritStone, SPIRIT_GRADE_COLOR } from './spiritSprite.js';

const K = 2;
const SLOT = 22 * K;
const GAP = 8;
const DIM = '#0d0a10';
const NOT_ITEMS = new Set(['gold', 'diamonds', 'over', 'skills', 'flags', 'spiritStones', 'spirits']);

// 칸 이름이 칸 폭(maxW)을 넘으면 띄어쓰기에서 두 줄로 나눈다(두 줄의 긴 쪽이 가장 짧아지는 자리). 띄어쓰기가 없으면 그대로 한 줄.
export function splitName(text, maxW, measure) {
  if (measure(text) <= maxW) return [text];
  let best = null;
  for (let i = text.indexOf(' '); i > 0; i = text.indexOf(' ', i + 1)) {
    const parts = [text.slice(0, i), text.slice(i + 1)];
    const w = Math.max(measure(parts[0]), measure(parts[1]));
    if (!best || w < best.w) best = { w, parts };
  }
  return best ? best.parts : [text];
}

// grant/buy delta -> 보여 줄 것(받은 것만: buy의 비용(음수)은 뺀다). 아무것도 없으면 null.
export function rewardFromDelta(d) {
  if (!d) return null;
  const items = {};
  for (const [k, v] of Object.entries(d)) if (!NOT_ITEMS.has(k) && v > 0) items[k] = v;
  const r = { gold: Math.max(0, d.gold ?? 0), diamonds: Math.max(0, d.diamonds ?? 0), items, skills: { ...d.skills }, flags: [...(d.flags ?? [])] };
  if (d.spiritStones > 0) r.spiritStones = d.spiritStones; // 출석·우편 등 grant의 정령석(보스 정령은 main.js가 따로 붙인다)
  const empty = !r.gold && !r.diamonds && !r.spiritStones && !Object.keys(items).length && !Object.keys(r.skills).length && !r.flags.length;
  return empty ? null : r;
}

export class RewardPopup {
  constructor() {
    this._queue = [];
    this._layout = null;
  }

  get active() {
    return this._queue.length > 0;
  }

  show(reward) {
    if (reward) this._queue.push(reward);
  }

  // 뒤로가기 = 확인과 같다(다음 것/닫기).
  dismiss() {
    this._queue.shift();
  }

  // 팝업이 떠 있으면 입력을 전부 먹는다. 확인 버튼(또는 카드 밖) = 다음 것/닫기.
  handlePointerDown(x, y) {
    if (!this.active) return false;
    const L = this._layout;
    const inCard = L && x >= L.card.x && x < L.card.x + L.card.width && y >= L.card.y && y < L.card.y + L.card.height;
    if (!L || pressButton(x, y, L.ok) || !inCard) this._queue.shift();
    return true;
  }

  // drawSlot(x, y, id, opts) / drawNumber(text, right, bottom) = ItemBarRenderer 바인딩(칸 + ui/font 숫자).
  draw(ctx, width, height, assets, { drawSlot, drawNumber }) {
    const r = this._queue[0];
    if (!r) {
      this._layout = null;
      return;
    }
    const cells = [];
    if (r.gold) cells.push({ icon: 'icons/gold.png', n: r.gold, label: t('reward.gold') });
    if (r.diamonds) cells.push({ icon: 'icons/diamond.png', n: r.diamonds, label: t('reward.diamonds') });
    for (const [id, n] of Object.entries(r.items)) cells.push({ item: id, n, label: t(`item.name.${id}`) });
    // 정령(보스 첫 처치·소급 지급): 칸마다 이름 + 새로 얻음 / 별 +1 / 정령석 변환, 그 뒤에 정령석 합계.
    for (const s of r.spirits ?? []) cells.push({ spirit: s, label: t(`spirit.name.${s.id}`), sub: t(`spirit.got.${s.kind}`, { n: s.stones }) });
    if (r.spiritStones) cells.push({ stone: true, n: r.spiritStones, label: t('spirit.stone') });
    const subH = cells.some((c) => c.sub) ? 12 : 0; // 정령 칸의 둘째 줄
    // 긴 이름(정령·아이템 공통)은 두 줄 - 옆 칸 이름과 붙지 않게 칸 폭 + 간격 안에서.
    ctx.font = getFontString(11);
    for (const c of cells) c.lines = splitName(c.label, SLOT + 16 + GAP - 4, (s) => ctx.measureText(s).width);
    const nameH = cells.some((c) => c.lines.length > 1) ? 12 : 0;
    const lines = [];
    for (const [key, lv] of Object.entries(r.skills)) lines.push(t('reward.skill', { name: t(`shop.skill.${key}.name`), lv }));
    for (const f of r.flags) lines.push(t(`reward.flag.${f}`));
    if (r.notes) lines.push(...r.notes); // 안내 줄(광산 해금 등)

    const cardW = snap(Math.min(width - 32, 320));
    const perRow = Math.max(1, Math.floor((cardW - 32 + GAP) / (SLOT + 16 + GAP)));
    const rows = Math.ceil(cells.length / perRow);
    const cellW = SLOT + 16;
    const cardH = snap(70 + rows * (SLOT + 26 + subH + nameH) + lines.length * 18 + 16 + SLOT + 16);
    const cardX = Math.round((width - cardW) / 2);
    const cardY = Math.round((height - cardH) / 2);

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = ditherPattern(ctx, DIM);
    ctx.fillRect(screen.full.x, screen.full.y, screen.full.width, screen.full.height); // 블리드까지
    const frame = getUi(assets, 'menu/popup_menu.png');
    const meta = getUiMeta(assets, 'menu/popup_menu.png');
    if (uiReady(frame) && meta?.slice) drawNine(ctx, frame.img, meta.slice, cardX, cardY, cardW, cardH, K);
    else {
      ctx.fillStyle = HUD_CONFIG.popup.cardBg;
      ctx.fillRect(cardX, cardY, cardW, cardH);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f2d264';
    ctx.font = getFontString(18, true);
    drawText(ctx, r.title ?? t('reward.title'), cardX + cardW / 2, cardY + 36);

    let y = cardY + 62;
    for (let row = 0; row < rows; row++) {
      const rowCells = cells.slice(row * perRow, (row + 1) * perRow);
      const rowW = rowCells.length * cellW + (rowCells.length - 1) * GAP;
      let x = Math.round(cardX + (cardW - rowW) / 2);
      for (const c of rowCells) {
        const sx = x + 8;
        if (c.item) drawSlot(sx, y, c.item, { count: c.n });
        else if (c.spirit) {
          drawSlot(sx, y, null, {});
          ctx.strokeStyle = SPIRIT_GRADE_COLOR[c.spirit.grade] ?? DIM;
          ctx.lineWidth = 2;
          ctx.strokeRect(sx + 1, y + 1, SLOT - 2, SLOT - 2);
          drawSpirit(ctx, assets, c.spirit.id, c.spirit.element, sx + (SLOT - 30) / 2, y + (SLOT - 30) / 2, 3, performance.now());
        } else if (c.stone) {
          drawSlot(sx, y, null, {});
          drawSpiritStone(ctx, assets, sx + SLOT / 2, y + SLOT / 2, K);
          drawNumber(String(c.n), sx + SLOT, y + SLOT);
        } else {
          drawSlot(sx, y, null, {});
          drawFixedImage(ctx, assets, c.icon, sx + SLOT / 2, y + SLOT / 2, K);
          drawNumber(String(c.n), sx + SLOT, y + SLOT);
        }
        ctx.fillStyle = HUD_CONFIG.text.primary;
        ctx.font = getFontString(11);
        c.lines.forEach((line, i) => drawText(ctx, line, x + cellW / 2, y + SLOT + 11 + i * 12));
        if (c.sub) {
          ctx.fillStyle = '#9cd872';
          ctx.font = getFontString(10);
          drawText(ctx, c.sub, x + cellW / 2, y + SLOT + 12 + c.lines.length * 12);
        }
        x += cellW + GAP;
      }
      y += SLOT + 26 + subH + nameH;
    }
    ctx.font = getFontString(12, true);
    ctx.fillStyle = '#9cd872';
    for (const line of lines) {
      drawText(ctx, line, cardX + cardW / 2, y + 8);
      y += 18;
    }

    const ok = { x: Math.round(cardX + cardW / 2 - 60), y: cardY + cardH - 16 - SLOT, width: 120, height: SLOT };
    const btn = getUi(assets, 'buttons/btn_primary.png');
    const bmeta = getUiMeta(assets, 'buttons/btn_primary.png');
    if (uiReady(btn) && bmeta?.slice) drawNine(ctx, btn.img, bmeta.slice, ok.x, ok.y, ok.width, ok.height, K);
    else {
      ctx.fillStyle = HUD_CONFIG.popup.primary;
      ctx.fillRect(ok.x, ok.y, ok.width, ok.height);
    }
    ctx.fillStyle = bmeta?.textColor ?? '#ffffff';
    ctx.font = getFontString(13, true);
    drawText(ctx, t('reward.ok'), ok.x + ok.width / 2, ok.y + ok.height / 2);
    ctx.restore();
    this._layout = { card: { x: cardX, y: cardY, width: cardW, height: cardH }, ok };
  }
}
