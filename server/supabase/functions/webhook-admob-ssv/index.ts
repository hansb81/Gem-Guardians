// GET /webhook-admob-ssv (Google AdMob이 부름, JWT 없음 - config.toml verify_jwt=false). 서명 확인 -> ad_views 기록.
// custom_data = ad-nonce가 준 nonce, user_id = 플레이어 id. 같은 transaction_id는 한 번만. 서명이 틀리면 400.
import { db } from "../_shared/auth.ts";
import { verifySsv } from "../_shared/ads.ts";

Deno.serve(async (req) => {
  const q = new URL(req.url).search.slice(1);
  let p: URLSearchParams | null = null;
  try {
    p = await verifySsv(q);
  } catch (e) {
    await db.from("server_log").insert({ source: "webhook-admob-ssv", level: "error", body: { msg: String(e) } });
    return new Response("error", { status: 500 }); // 키를 못 받음 - Google이 다시 보낸다
  }
  if (!p) {
    await db.from("server_log").insert({ source: "webhook-admob-ssv", level: "warn", body: { msg: "badSignature", q: q.slice(0, 500) } });
    return new Response("bad signature", { status: 400 });
  }
  const nonce = p.get("custom_data") ?? null;
  const { data: n } = nonce
    ? await db.from("ad_nonces").select("player_id, placement").eq("nonce", nonce).maybeSingle()
    : { data: null };
  const { error } = await db.from("ad_views").upsert({
    transaction_id: p.get("transaction_id"), player_id: n?.player_id ?? null, nonce, placement: n?.placement ?? null,
    ad_unit: p.get("ad_unit"), reward_item: p.get("reward_item"), reward_amount: Number(p.get("reward_amount")) || null,
  }, { onConflict: "transaction_id", ignoreDuplicates: true });
  if (error) return new Response("error", { status: 500 });
  return new Response("ok");
});
