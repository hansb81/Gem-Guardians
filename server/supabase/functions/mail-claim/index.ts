// POST /mail-claim {id} -> { ok, txId, bundle } | reason 'already' | 'notFound'.
import { fail, handle, must } from "../_shared/http.ts";

handle("mail-claim", async ({ uid, body, db }) => {
  const id = Number(body.id);
  if (!Number.isSafeInteger(id) || id <= 0) return fail("badRequest");
  return must(await db.rpc("mail_claim", { p_player: uid, p_mail: id }));
});
