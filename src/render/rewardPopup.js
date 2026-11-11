// 공통 획득 팝업(docs/inventory.md 5-2): inventory.grant()/buy() 결과(delta)를 아이콘 줄로 보여 준다.
// 보스 첫 처치 보상, 상점 패키지·패스·무료 1개가 전부 이 팝업 하나를 쓴다. 게임·상점 어느 scene 위에서든
// 맨 위에 그린다(main.js). 틀 = ui/menu/popup_menu(9-slice x2), 칸 = items/slot_normal x2, 배경 어둡게 = #0d0a10 체커 디더.
import { drawNine, drawText, drawFixedImage, getUi, getUiMeta, uiReady, snap, pressButton } from './uiKit.js';
import { ditherPattern } from './itemBarRenderer.js';
import { getFontString } from '../config/fonts.js';
import { t } from '../config/i18n.js';
import { HUD_CONFIG } from '../config/hud.js';
import { screen } from './screenFit.js';

const K = 2;
const SLOT = 22 * K;
const GAP = 8;
const DIM = '#0d0a10';
const NOT_ITEMS = new Set(['gold', 'diamonds', 'over', 'skills', 'flags']);

// grant/buy delta -> 보여 줄 것(받은 것만: buy의 비용(음수)은 뺀다). 아무것도 없으면 null.
export function rewardFromDelta(d) {
  if (!d) return null;
  const items = {};
  for (const [k, v] of Object.entries(d)) if (!NOT_ITEMS.has(k) && v > 0) items[k] = v;
  const r = { gold: Math.max(0, d.gold ?? 0), diamonds: Math.max(0, d.diamonds ?? 0), items, skills: { ...d.skills }, flags: [...(d.flags ?? [])] };
  const empty = !r.gold && !r.diamonds && !Object.keys(items).length && !Object.keys(r.skills).length && !r.flags.length;
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
    const lines = [];
    for (const [key, lv] of Object.entries(r.skills)) lines.push(t('reward.skill', { name: t(`shop.skill.${key}.name`), lv }));
    for (const f of r.flags) lines.push(t(`reward.flag.${f}`));

    const cardW = snap(Math.min(width - 32, 320));
    const perRow = Math.max(1, Math.floor((cardW - 32 + GAP) / (SLOT + 16 + GAP)));
    const rows = Math.ceil(cells.length / perRow);
    const cellW = SLOT + 16;
    const cardH = snap(70 + rows * (SLOT + 26) + lines.length * 18 + 16 + SLOT + 16);
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
    drawText(ctx, t('reward.title'), cardX + cardW / 2, cardY + 36);

    let y = cardY + 62;
    for (let row = 0; row < rows; row++) {
      const rowCells = cells.slice(row * perRow, (row + 1) * perRow);
      const rowW = rowCells.length * cellW + (rowCells.length - 1) * GAP;
      let x = Math.round(cardX + (cardW - rowW) / 2);
      for (const c of rowCells) {
        const sx = x + 8;
        if (c.item) drawSlot(sx, y, c.item, { count: c.n });
        else {
          drawSlot(sx, y, null, {});
          drawFixedImage(ctx, assets, c.icon, sx + SLOT / 2, y + SLOT / 2, K);
          drawNumber(String(c.n), sx + SLOT, y + SLOT);
        }
        ctx.fillStyle = HUD_CONFIG.text.primary;
        ctx.font = getFontString(11);
        drawText(ctx, c.label, x + cellW / 2, y + SLOT + 11);
        x += cellW + GAP;
      }
      y += SLOT + 26;
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
