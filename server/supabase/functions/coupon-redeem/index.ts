// POST /coupon-redeem {code} -> { ok, txId, bundle, title:{ko,en} } | reason 'badCode' | 'notFound' | 'already' | 'notStarted'
// | 'expired' | 'platform' | 'soldOut' | 'tooMany' | 'banned' (docs/coupon.md §3). 판정은 전부 SQL coupon_redeem.
import { fail, handle, must } from "../_shared/http.ts";

handle("coupon-redeem", async ({ uid, body, db }) => {
  const code = body.code;
  if (typeof code !== "string" || code.length > 40) return fail("badCode");
  return must(await db.rpc("coupon_redeem", { p_player: uid, p_code: code }));
});
