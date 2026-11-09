// POST /att-status -> 이번 판 진행·오늘 받았는지·보상표.
import { handle, must } from "../_shared/http.ts";
import { kstDate } from "../_shared/kst.ts";
import { ATTENDANCE_DAYS } from "../_shared/attendance.ts";

handle("att-status", async ({ uid, db }) => {
  const today = kstDate();
  const a = must(await db.from("attendance").select("days, last_date").eq("player_id", uid).maybeSingle());
  const claimedToday = a?.last_date === today;
  const days = a && !(a.days >= 7 && !claimedToday) ? a.days : 0; // 7칸 다 받고 날이 바뀌면 새 판
  return { ok: true, today, days, claimedToday, rewards: ATTENDANCE_DAYS };
});
