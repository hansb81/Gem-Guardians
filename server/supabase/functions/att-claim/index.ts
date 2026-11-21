// POST /att-claim -> { ok, day, txId, bundle, streak, streakBonus } | { ok:false, reason:'already', streak }. 판정은 Postgres 함수 한 트랜잭션.
import { handle, must } from "../_shared/http.ts";
import { kstDate } from "../_shared/kst.ts";
import { ATTENDANCE_DAYS, ATTENDANCE_STREAK } from "../_shared/attendance.ts";

handle("att-claim", async ({ uid, db }) =>
  must(await db.rpc("att_claim", { p_player: uid, p_today: kstDate(), p_bundles: ATTENDANCE_DAYS, p_streak: ATTENDANCE_STREAK })));
