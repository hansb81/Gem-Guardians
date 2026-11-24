// 경쟁 랭킹 공통. ranking.json = config/ranking.json 사본(tests/ranking-server.test.js가 같은지 본다).
// 구간 규칙은 src/ranking/tiers.js와 같다(SQL comp_tier도 같은 규칙).
import ranking from "./ranking.json" with { type: "json" };
import limits from "./comp_limits.json" with { type: "json" };

type Tier = { id: string; rank?: number; pct?: number; rewards: Record<string, unknown>; frame?: string };
export const RANKING = ranking as unknown as { rewardsEnabled: boolean; topLimit: number; tiers: Tier[]; comp: { dailyEntries: number; modifier: unknown } };
const LIMITS = limits as { cum: number[] };

export const pctOf = (rank: number, total: number) => Math.max(1, Math.ceil((rank * 100) / total));
export function tierOf(rank: number, total: number): Tier | null {
  if (!(rank >= 1) || !(total >= rank)) return null;
  return RANKING.tiers.find((t) => (t.rank != null ? rank <= t.rank : rank <= Math.ceil((total * t.pct!) / 100))) ?? null;
}

// 경쟁 모드 점수 상한(docs/ranking.md 5장): 웨이브 n까지 (1000 + 성벽 보너스 만점 + 그 웨이브 최대 처치 점수)의 합.
// 표 = comp_limits.json(tools/gen_comp_limits.mjs), 표보다 긴 판은 마지막 두 칸 차이로 늘린다. 넘으면 순위에 안 넣고 보류(verified=false).
// 웨이브 하나에 최소 minSecPerWave초(소환 간격상 그보다 빠를 수 없음 - 넉넉하게).
// TODO(서버 재계산): comp_runs.log(시드 + 입력 기록)로 판을 다시 돌려 점수를 맞춰 보는 검증은 아직 없다(구조만 - log 저장).
export const COMP_LIMIT = { minSecPerWave: 5 };
export function compMaxPoints(wave: number) {
  const c = LIMITS.cum;
  if (wave <= 0) return 0;
  if (wave <= c.length) return c[wave - 1];
  return c[c.length - 1] + (c[c.length - 1] - c[c.length - 2]) * (wave - c.length);
}
export const compScoreOk = (points: number, wave: number, elapsedSec: number) =>
  points <= compMaxPoints(Math.max(1, wave)) && elapsedSec >= COMP_LIMIT.minSecPerWave * (wave - 1);

// 정산할 기록이 있는 시즌인지(comp_settle_due는 comp_best가 있는 시즌만 정산 - 빈 시즌을 "정산 중"으로 두지 않게).
// deno-lint-ignore no-explicit-any
export async function hasEntries(db: any, seasonId: string) {
  const { count } = await db.from("comp_best").select("player_id", { count: "exact", head: true }).eq("season_id", seasonId);
  return (count ?? 0) > 0;
}

// 일반 모드 최고 층 제출(rank-normal과 save-put body.rank가 같이 씀). 이전보다 높을 때만 갱신 -> { ok, updated }.
// 도달 시각은 서버 시각(기기 시각은 안 믿음).
// shortcut: 층 상승 속도 상한(docs/server.md §9 hidden)은 없음 - 서버 랭킹을 일반 사용자에게 공개하기 전에 추가(쑹 2026-11-09).
// deno-lint-ignore no-explicit-any
export async function submitNormal(db: any, uid: string, floor: number) {
  if (!Number.isInteger(floor) || floor < 1 || floor > 9999) return { ok: false, reason: "badRequest" };
  const p = await db.from("players").select("banned").eq("id", uid).maybeSingle();
  if (p.error) throw new Error(JSON.stringify(p.error));
  if (p.data?.banned) return { ok: false, reason: "banned" };
  const r = await db.rpc("rank_normal_submit", { p_player: uid, p_floor: floor });
  if (r.error) throw new Error(JSON.stringify(r.error));
  return r.data;
}
