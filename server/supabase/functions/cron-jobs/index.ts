// POST /cron-jobs {job} - pg_cron(public.cron_call)만 부른다. JWT 없음(config.toml verify_jwt=false),
// 헤더 x-cron-secret == CRON_SECRET 확인. 결과는 server_log(source 'cron-<job>')에 한 줄.
//   onestore : 지난 2일 원스토어 환불(voided) 목록 -> purchases refunded          (매일 04:00 KST)
//   toss     : 최근 30일 토스 주문을 1초 간격으로 다시 조회 -> REFUNDED면 refunded   (매시, 한 번에 100건)
//   settle   : 끝난 경쟁 시즌 정산 -> season_results                                (일 15:31 UTC)
import { db } from "../_shared/auth.ts";
import { json } from "../_shared/http.ts";
import { onestoreVoided, verifyToss } from "../_shared/stores.ts";
import { RANKING } from "../_shared/ranking.ts";
import FLOOR_GOLD from "../_shared/floor_gold.json" with { type: "json" };

const DAY = 86400e3;
const TOSS_BATCH = 100; // 1초 간격 x 100 = 약 100초 - Edge Function 무료 구간 제한(150초) 안
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function onestore() {
  const tokens = await onestoreVoided(Date.now() - 2 * DAY);
  const { data, error } = await db.rpc("iap_mark_refunded", { p_store: "onestore", p_order_ids: tokens });
  if (error) throw new Error(JSON.stringify(error));
  return { voided: tokens.length, marked: data };
}

// shortcut: 30일 주문이 하루 2,400건(100건 x 24회)을 넘으면 하루 안에 다 못 돈다 - 그때는 배치·간격을 늘린다.
async function toss() {
  const { data: rows, error } = await db.from("purchases").select("id, order_id, store_product_id")
    .eq("store", "toss").in("status", ["verified", "granted"])
    .gt("purchased_at", new Date(Date.now() - 30 * DAY).toISOString())
    .or(`rechecked_at.is.null,rechecked_at.lt.${new Date(Date.now() - 20 * 3600e3).toISOString()}`)
    .order("rechecked_at", { ascending: true, nullsFirst: true }).limit(TOSS_BATCH);
  if (error) throw new Error(JSON.stringify(error));
  const refunded: string[] = [];
  let failed = 0;
  for (const [i, p] of (rows ?? []).entries()) {
    if (i) await sleep(1000);
    try {
      const r = await verifyToss(p.order_id, p.store_product_id);
      if (r.status === "refunded") refunded.push(p.order_id);
      await db.from("purchases").update({ rechecked_at: new Date().toISOString() }).eq("id", p.id);
    } catch (e) {
      failed++;
      if (String(e).includes("4095")) break; // 요청 한도 초과 - 다음 시간에
    }
  }
  const { data } = refunded.length
    ? await db.rpc("iap_mark_refunded", { p_store: "toss", p_order_ids: refunded })
    : { data: 0 };
  return { checked: rows?.length ?? 0, refunded: data, failed };
}

async function settle() {
  const { data, error } = await db.rpc("comp_settle_due", { p_tiers: RANKING.tiers, p_floor_gold: FLOOR_GOLD.gold });
  if (error) throw new Error(JSON.stringify(error));
  return data;
}

const JOBS: Record<string, () => Promise<unknown>> = { onestore, toss, settle };

Deno.serve(async (req) => {
  const secret = Deno.env.get("CRON_SECRET");
  if (!secret || req.headers.get("x-cron-secret") !== secret) return new Response("unauthorized", { status: 401 });
  const job = String((await req.json().catch(() => ({})))?.job ?? "");
  if (!JOBS[job]) return json({ ok: false, reason: "badJob" }, 400);
  try {
    const result = await JOBS[job]();
    await db.from("server_log").insert({ source: `cron-${job}`, level: "info", body: result });
    return json({ ok: true, result });
  } catch (e) {
    await db.from("server_log").insert({ source: `cron-${job}`, level: "error", body: { msg: String(e) } });
    return json({ ok: false, reason: "error" }, 500);
  }
});
