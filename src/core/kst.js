// 한국 시각(KST = UTC+9 고정, 서머타임 없음) 날짜 계산 - 클라이언트는 전부 여기서. 순수 계산(시각 ms는 호출부가 넘긴다).
// 서버는 server/supabase/functions/_shared/kst.ts, 관리 화면은 admin/src(같은 규칙, 런타임이 달라 따로 둔다).
export const KST_OFFSET_MS = 9 * 3600e3;
export const DAY_MS = 24 * 3600e3;

// ms -> KST 날짜 'YYYY-MM-DD'.
export const kstDate = (ms) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10);

// 'YYYY-MM-DD' 두 날짜 사이 일수(to - from). 날짜만 다루므로 시각대와 무관.
export const daysBetween = (from, to) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

// 'YYYY-MM-DD' + n일.
export const addDays = (day, n) => new Date(Date.parse(day) + n * DAY_MS).toISOString().slice(0, 10);
