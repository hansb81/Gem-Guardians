// POST /claims-granted {txIds[]} -> 기기 지급 완료 기록. 'iap:' tx(관리자 결제 복구)는 그 결제도 지급됨으로(SQL claims_granted).
import { fail, handle, must } from "../_shared/http.ts";

handle("claims-granted", async ({ uid, body, db }) => {
  const ids = body.txIds;
  if (!Array.isArray(ids) || ids.length > 100 || !ids.every((s) => typeof s === "string")) return fail("badRequest");
  if (ids.length) {
    must(await db.rpc("claims_granted", { p_player: uid, p_tx_ids: ids }));
  }
  return { ok: true };
});
