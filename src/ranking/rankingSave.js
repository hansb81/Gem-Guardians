// 저장(save)의 ranking 블록(docs/ranking.md 7-1). 순수 - 시각·id는 호출부가 넘긴다.
export const STATUE_COLORS = ['red', 'blue', 'yellow', 'green', 'purple'];
export const NICKNAME_RE = /^[가-힣A-Za-z0-9]{2,10}$/;
export const isValidNickname = (s) => typeof s === 'string' && NICKNAME_RE.test(s);

export function defaultRanking() {
  return {
    profile: { playerId: '', nickname: '', statue: '' },
    normal: { bestFloor: 0, reachedAt: 0 }, // 클리어한 가장 높은 층 + 그 층에 처음 닿은 시각(ms)
    comp: {
      seasonId: '',
      best: { points: 0, floor: 0, at: 0 }, // 이번 주 최고 1판
      runs: 0,
      pending: null, // 받기 전 결과 { seasonId, rank, pct, tierId, points, rewards, seen }
      history: [], // 최근 8개 { seasonId, points, rank, pct, tierId }
    },
    lastTab: 'normal',
  };
}

const num = (v, d = 0) => (Number.isFinite(v) ? v : d);

// 저장된 블록에서 빠진 칸만 채운다. 블록이 아예 없으면(saveVersion 2 이하) 마이그레이션:
// 일반 모드 기록 = 저장된 최고 도달 층(bestFloor)에서 클리어한 층(bestFloor - 1), 도달 시각을 모르니 nowMs.
export function normalizeRanking(r, { bestFloor = 1, nowMs = 0 } = {}) {
  const d = defaultRanking();
  if (!r || typeof r !== 'object') {
    const cleared = Math.max(0, Math.floor(num(bestFloor, 1)) - 1);
    d.normal = { bestFloor: cleared, reachedAt: cleared > 0 ? nowMs : 0 };
    return d;
  }
  const p = r.profile ?? {};
  const n = r.normal ?? {};
  const c = r.comp ?? {};
  return {
    profile: {
      playerId: typeof p.playerId === 'string' ? p.playerId : '',
      nickname: isValidNickname(p.nickname) ? p.nickname : '',
      statue: STATUE_COLORS.includes(p.statue) ? p.statue : '',
    },
    normal: { bestFloor: num(n.bestFloor), reachedAt: num(n.reachedAt) },
    comp: {
      seasonId: typeof c.seasonId === 'string' ? c.seasonId : '',
      best: { points: num(c.best?.points), floor: num(c.best?.floor), at: num(c.best?.at) },
      runs: num(c.runs),
      pending: c.pending && typeof c.pending === 'object' ? { ...c.pending } : null,
      history: Array.isArray(c.history) ? c.history.slice(0, 8) : [],
    },
    lastTab: r.lastTab === 'comp' ? 'comp' : 'normal',
  };
}
