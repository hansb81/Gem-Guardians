// POST /ad-claim {placement, nonce?} -> claims 'ad:{배치}:{KST날짜}:{n}' { ok, txId, bundle, left } | reason
// 'notYet'(SSV 콜백 아직 - 기기가 잠시 뒤 다시) | 'limit' | 'already' | 'needSsv' | 'unknownPlacement'.
// 자격: nonce에 SSV 도착 / 광고 제거 결제 보유(광고 없이 바로).
// 토스 '기기 판정'(players.platform === 'toss')은 2026-11-26에 껐다: platform·tossKey는 hello가 기기가 보낸 값 그대로 저장해서
// 아무 기기나 platform:'toss'를 보내면 광고 없이 보상을 받을 수 있었다. 서버가 토스 사용자를 확인할 방법이 생기면 다시 연다.
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
  if (!via) return fail("needSsv");
  return must(await db.rpc("ad_claim", {
    p_player: uid, p_placement: placement, p_nonce: nonce, p_via: via, p_today: kstDate(), p_bundle: cfg.bundle, p_per_day: cfg.perDay,
  }));
});
