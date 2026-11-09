// POST /claims-granted {txIds[]} -> 기기 지급 완료 기록.
import { fail, handle, must } from "../_shared/http.ts";

handle("claims-granted", async ({ uid, body, db }) => {
  const ids = body.txIds;
  if (!Array.isArray(ids) || ids.length > 100 || !ids.every((s) => typeof s === "string")) return fail("badRequest");
  if (ids.length) {
    must(await db.from("claims").update({ granted_at: new Date().toISOString() })
      .eq("player_id", uid).in("tx_id", ids).is("granted_at", null));
  }
  return { ok: true };
});
