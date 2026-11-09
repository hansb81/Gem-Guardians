// POST /ad-nonce {placement} -> { nonce, userId, left }. 광고 요청의 SSV custom_data = nonce, user_id = userId.
// 오늘 한도를 다 썼으면 광고를 보여 주기 전에 'limit'.
import { fail, handle, must } from "../_shared/http.ts";
import { AD_PLACEMENTS } from "../_shared/ads.ts";
import { kstDate } from "../_shared/kst.ts";

handle("ad-nonce", async ({ uid, body, db }) => {
  const placement = body.placement as string;
  const cfg = typeof placement === "string" ? AD_PLACEMENTS[placement] : null;
  if (!cfg) return fail("unknownPlacement");
  const { count } = await db.from("claims").select("tx_id", { count: "exact", head: true })
    .eq("player_id", uid).eq("kind", "ad").like("tx_id", `ad:${placement}:${kstDate()}:%`);
  const left = cfg.perDay - (count ?? 0);
  if (left <= 0) return fail("limit");
  const nonce = crypto.randomUUID();
  must(await db.from("ad_nonces").insert({ nonce, player_id: uid, placement }));
  return { ok: true, nonce, userId: uid, left };
});
