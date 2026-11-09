// KST(UTC+9 고정) 날짜 'YYYY-MM-DD'. 출석·하루 한 번 판정은 전부 이 값(서버 시각) 기준.
export const KST_OFFSET_MS = 9 * 3600e3;
export const kstDate = (ms: number = Date.now()) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);
