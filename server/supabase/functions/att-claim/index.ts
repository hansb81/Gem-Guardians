// POST /att-claim -> { ok, day, txId, bundle } | { ok:false, reason:'already' }. 판정은 Postgres 함수 한 트랜잭션.
import { handle, must } from "../_shared/http.ts";
import { kstDate } from "../_shared/kst.ts";
import { ATTENDANCE_DAYS } from "../_shared/attendance.ts";

handle("att-claim", async ({ uid, db }) =>
  must(await db.rpc("att_claim", { p_player: uid, p_today: kstDate(), p_bundles: ATTENDANCE_DAYS })));
