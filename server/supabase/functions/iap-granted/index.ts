// POST /iap-granted {txId, bundle} -> 기기 지급 완료: purchases.granted_at + granted_bundle(기기가 실제로 준 것,
// 첫 구매 2배 반영 - 문의 때 "몇 개 받았나" 확인용, docs/server.md §20-3). verified -> granted.
import { fail, handle, must } from "../_shared/http.ts";

handle("iap-granted", async ({ uid, body, db }) => {
  const { txId, bundle } = body;
  const ok = typeof txId === "string" && txId.length <= 300 &&
    (bundle == null || (typeof bundle === "object" && JSON.stringify(bundle).length <= 4000));
  if (!ok) return fail("badRequest");
  must(await db.rpc("iap_granted", { p_player: uid, p_tx_id: txId, p_bundle: bundle ?? null }));
  return { ok: true };
});
