// POST /claims-pending -> 서버에 기록됐지만 기기가 아직 지급 확인 안 한 것들(앱이 중간에 죽은 경우 복구).
import { handle, must } from "../_shared/http.ts";

handle("claims-pending", async ({ uid, db }) => {
  const list = must(await db.from("claims").select("tx_id, kind, bundle").eq("player_id", uid).is("granted_at", null).limit(100));
  return { ok: true, claims: (list ?? []).map((c) => ({ txId: c.tx_id, kind: c.kind, bundle: c.bundle })) };
});
