// 정령 도감 그리기(docs/spirits.md 7장) - 정령 탭 목록의 안 가진 정령 칸과 그 설명(예전 상점 정령 레일의 격자·설명 칸을 옮긴 것).
// 좌표는 호출부(정비 팝업)의 basis 그대로. 칸은 등급 테두리 + 그림(가진 정령 = 밝게, 없는 정령 = #221c2b 실루엣).
import { t } from '../../config/i18n.js';
import { HUD_CONFIG } from '../../config/hud.js';
import { spiritEffectText } from '../shopText.js';
import { drawSpirit, drawSpiritPortrait, SPIRIT_GRADE_COLOR, SPIRIT_SIZE } from '../spiritSprite.js';
import { nine, label } from './prepPopup.js';

const C = { title: HUD_CONFIG.text.title, text: HUD_CONFIG.text.primary, sub: HUD_CONFIG.text.dim, outline: '#0d0a10', white: '#ffffff', owned: '#8cc4ee' };
const rect = (x, y, width, height) => ({ x, y, width, height });

function frame(ctx, r, color, w = 2) {
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.width, w);
  ctx.fillRect(r.x, r.y + r.height - w, r.width, w);
  ctx.fillRect(r.x, r.y, w, r.height);
  ctx.fillRect(r.x + r.width - w, r.y, w, r.height);
}

// 도감 칸 하나: 10x10을 칸에 맞는 정수배로 가운데. selected = 지금 설명을 연 정령(흰 테).
export function drawDexCell(ctx, assets, r, cfg, id, owned, selected, nowMs) {
  const sp = cfg.spirits[id];
  nine(ctx, assets, 'menu/inset.png', r, C.outline);
  frame(ctx, r, SPIRIT_GRADE_COLOR[sp.grade]); // 안 가진 정령도 등급 테두리(그림만 실루엣)
  if (selected) frame(ctx, rect(r.x + 2, r.y + 2, r.width - 4, r.height - 4), C.white);
  const k = Math.max(1, Math.floor((Math.min(r.width, r.height) - 8) / SPIRIT_SIZE));
  const s = SPIRIT_SIZE * k;
  drawSpirit(ctx, assets, id, sp.element, Math.round(r.x + (r.width - s) / 2), Math.round(r.y + (r.height - s) / 2), k, nowMs, owned ? null : 'silhouette');
}

// 설명 칸: 초상 + 이름 + 등급·속성·역할 + 효과(가진 정령은 지금 레벨·별, 없는 정령은 1레벨 1별, 공명 제외) + 보유 레벨·별.
// 반환 = 설명 글이 끝난 y(아래 버튼 자리 계산용).
export function drawDexInfo(ctx, assets, r, cfg, id, own, nowMs) {
  const sp = cfg.spirits[id];
  const P = 10;
  const box = rect(r.x + P, r.y + P, 80, 80);
  ctx.fillStyle = '#15121c';
  ctx.fillRect(box.x, box.y, box.width, box.height);
  frame(ctx, box, own ? SPIRIT_GRADE_COLOR[sp.grade] : C.outline);
  drawSpiritPortrait(ctx, assets, id, sp.element, box.x + 4, box.y + 4, 72, nowMs, own ? null : 'silhouette');
  const tx = box.x + box.width + 12;
  const tw = r.x + r.width - P - tx - 40; // 오른쪽 위 닫기 X 자리(정령 탭)
  label(ctx, t(`spirit.name.${id}`), rect(tx, r.y + P, tw, 22), C.title, 16, true, 'left');
  label(ctx, `${t(`spirit.grade.${sp.grade}`)} · ${t(`spirit.element.${sp.element}`)} · ${t(`spirit.role.${sp.role}`)}`, rect(tx, r.y + P + 24, tw, 18), sp.grade === 'common' ? C.sub : SPIRIT_GRADE_COLOR[sp.grade], 12, true, 'left');
  label(ctx, own ? t('spirit.ownedLv', own) : t('spirit.notOwned'), rect(tx, r.y + P + 44, tw, 18), own ? C.owned : C.sub, 12, false, 'left');
  const ey = box.y + box.height + 8;
  label(ctx, spiritEffectText(cfg, id, own ?? { lv: 1, star: 1 }), rect(r.x + P, ey, r.width - P * 2, 18), C.text, 12, true, 'left');
  return ey + 18;
}
