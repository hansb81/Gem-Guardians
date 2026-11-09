// POST /ad-claim {placement, nonce?} -> claims 'ad:{배치}:{KST날짜}:{n}' { ok, txId, bundle, left } | reason
// 'notYet'(SSV 콜백 아직 - 기기가 잠시 뒤 다시) | 'limit' | 'already' | 'needSsv' | 'unknownPlacement'.
// 자격: nonce에 SSV 도착 / 광고 제거 결제 보유(광고 없이 바로) / 토스 사용자(광고 서버 확인 없음 -> 기기 판정 + 하루 한도).
import { fail, handle, must } from "../_shared/http.ts";
import { AD_PLACEMENTS } from "../_shared/ads.ts";
import { ADFREE_KEYS } from "../_shared/iap.ts";
import { kstDate } from "../_shared/kst.ts";

handle("ad-claim", async ({ uid, body, db }) => {
  const placement = body.placement as string;
  const cfg = typeof placement === "string" ? AD_PLACEMENTS[placement] : null;
  if (!cfg) return fail("unknownPlacement");
  const nonce = typeof body.nonce === "string" && body.nonce.length <= 64 ? body.nonce : null;
  let via = nonce ? "ssv" : null;
  if (!via) {
    const { count } = await db.from("purchases").select("id", { count: "exact", head: true })
      .eq("player_id", uid).in("product_key", ADFREE_KEYS).in("status", ["verified", "granted"]);
    if (count) via = "adfree";
  }
  if (!via) {
    const p = must(await db.from("players").select("platform, toss_key_hash").eq("id", uid).maybeSingle());
    if (p?.platform === "toss" && p.toss_key_hash) via = "device";
  }
  if (!via) return fail("needSsv");
  return must(await db.rpc("ad_claim", {
    p_player: uid, p_placement: placement, p_nonce: nonce, p_via: via, p_today: kstDate(), p_bundle: cfg.bundle, p_per_day: cfg.perDay,
  }));
});
