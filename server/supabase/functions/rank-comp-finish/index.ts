// POST /rank-comp-finish {runId, points, floor, log?} -> { ok, updated, seasonId } | reason 'seasonClosed'|'held'|'already'|'notFound'.
// 점수 상한(_shared/ranking.ts, 임시)을 넘으면 기록만 남기고 순위에 안 넣는다(verified=false, server_log warn).
import { fail, handle, must } from "../_shared/http.ts";
import { compScoreOk } from "../_shared/ranking.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOG_MAX = 64 * 1024;

handle("rank-comp-finish", async ({ uid, body, db }) => {
  const { runId } = body as Record<string, string>;
  const points = Number(body.points);
  const floor = Number(body.floor);
  const log = body.log ?? null;
  if (typeof runId !== "string" || !UUID.test(runId) || !Number.isInteger(points) || points < 0 || points > 2e9 ||
      !Number.isInteger(floor) || floor < 0 || floor > 9999 || JSON.stringify(log).length > LOG_MAX) {
    return fail("badRequest");
  }
  const run = must(await db.from("comp_runs").select("started_at").eq("run_id", runId).eq("player_id", uid).maybeSingle());
  if (!run) return fail("notFound");
  const ok = compScoreOk(points, floor, (Date.now() - Date.parse(run.started_at)) / 1000);
  if (!ok) await db.from("server_log").insert({ source: "rank-comp-finish", level: "warn", body: { uid, runId, points, floor } });
  return must(await db.rpc("comp_finish", { p_player: uid, p_run: runId, p_points: points, p_floor: floor, p_log: log, p_ok: ok }));
});
