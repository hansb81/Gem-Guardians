// 경쟁 모드 시즌(docs/ranking.md 5-1). 순수 계산 - 시각(ms)은 호출부가 넘긴다.
// 시즌 = 매주 resetDay(1=월) resetHourKst시 KST에 시작. 한국은 서머타임이 없어 UTC+9 고정.
// id = 그 시작 시각을 "월요일 00:00"으로 옮겨 잰 ISO 주차(목요일이 속한 해) - 기본값이면 KST 달력의 ISO 주차 그대로.
const HOUR = 3600e3;
const DAY = 24 * HOUR;
export const KST_OFFSET_MS = 9 * HOUR;

// 기본 시각(월 00:00)에서 실제 초기화 시각까지의 차이.
const shiftOf = (cfg = {}) => (((cfg.resetDay ?? 1) + 6) % 7) * DAY + (cfg.resetHourKst ?? 0) * HOUR;

// ms가 속한 시즌 = { id: '2026-W45', year, week, start, end } (start/end = UTC ms, end는 다음 시즌 시작).
export function seasonAt(ms, cfg) {
  const shift = shiftOf(cfg);
  const d = new Date(ms + KST_OFFSET_MS - shift);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const monday = dayStart - ((d.getUTCDay() + 6) % 7) * DAY;
  const thu = monday + 3 * DAY;
  const year = new Date(thu).getUTCFullYear();
  const week = 1 + Math.floor((thu - Date.UTC(year, 0, 1)) / (7 * DAY));
  const start = monday - KST_OFFSET_MS + shift;
  return { id: `${year}-W${String(week).padStart(2, '0')}`, year, week, start, end: start + 7 * DAY };
}

// '2026-W45' -> 그 시즌. 형식이 틀리면 null.
export function seasonFromId(id, cfg) {
  const m = /^(\d{4})-W(\d{2})$/.exec(id ?? '');
  if (!m) return null;
  const jan4 = Date.UTC(Number(m[1]), 0, 4); // ISO 1주차는 1월 4일이 든 주
  const week1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY;
  return seasonAt(week1 + (Number(m[2]) - 1) * 7 * DAY - KST_OFFSET_MS + shiftOf(cfg) + HOUR, cfg);
}

export const prevSeason = (season, cfg) => seasonAt(season.start - 1, cfg);
export const remainingMs = (ms, season) => Math.max(0, season.end - ms);
// 종료 warnMin분 전부터 끝날 때까지 "정산 대기".
export const isSettling = (ms, season, warnMin) => ms < season.end && season.end - ms <= warnMin * 60e3;

// 남은 시간 -> { days, h, m, s }
export function splitRemain(ms) {
  const r = Math.max(0, Math.floor(ms / 1000));
  return { days: Math.floor(r / 86400), h: Math.floor(r / 3600) % 24, m: Math.floor(r / 60) % 60, s: r % 60 };
}
