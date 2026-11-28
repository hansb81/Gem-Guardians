// POST /event-claim {eventId} -> { ok, txId, bundle, title:{ko,en} } | reason 'banned' | 'notFound' | 'notStarted' | 'expired'
// | 'platform' | 'already' (docs/events.md). 판정은 전부 SQL event_claim.
import { fail, handle, must } from "../_shared/http.ts";

handle("event-claim", async ({ uid, body, db }) => {
  const id = body.eventId;
  if (typeof id !== "string" || !id || id.length > 40) return fail("notFound");
  return must(await db.rpc("event_claim", { p_player: uid, p_event: id }));
});
