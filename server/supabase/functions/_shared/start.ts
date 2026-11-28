// 시작 정보(docs/auth.md §1-E 1번): att-status·mail-list·claims-pending·event-list 본문 + save 메타.
// 각 함수와 hello가 같은 코드를 쓴다 - hello 한 번으로 시작 호출을 4~5번에서 1번으로.
import { must } from "./result.ts";
import { kstDate } from "./kst.ts";
import { ATTENDANCE_DAYS, ATTENDANCE_STREAK } from "./attendance.ts";
import { visibleMail } from "./mail.ts";
import { saveMeta } from "./save.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

// 이번 판 진행·오늘 받았는지·보상표 + 연속 출석(표시용: 어제·오늘 받은 게 아니면 끊긴 것 = 0).
export async function attStatus(db: Db, uid: string) {
  const today = kstDate();
  const a = must(await db.from("attendance").select("days, last_date, streak").eq("player_id", uid).maybeSingle()) as
    | { days: number; last_date: string | null; streak?: number }
    | null;
  const claimedToday = a?.last_date === today;
  const days = a && !(a.days >= 7 && !claimedToday) ? a.days : 0; // 7칸 다 받고 날이 바뀌면 새 판
  const alive = claimedToday || a?.last_date === kstDate(Date.now() - 86400e3);
  const saved = a?.streak ?? 0;
  return {
    ok: true, today, days, claimedToday, rewards: ATTENDANCE_DAYS,
    streak: alive ? saved : 0,
    streakBroken: !!a?.last_date && !alive && saved > 0, // 그저께 이전에 끊김 - 오늘 받으면 1일부터
    streakGoal: ATTENDANCE_STREAK.goal,
    streakBonus: ATTENDANCE_STREAK.bonus,
  };
}

// 우편 목록(최근 50, 받은 것도 claimed로 표시).
export async function mailList(db: Db, uid: string) {
  return {
    ok: true,
    mail: (await visibleMail(db, uid)).map((m) => ({
      id: m.id, title: { ko: m.title_ko, en: m.title_en }, bundle: m.bundle,
      expiresAt: m.expires_at ? Date.parse(m.expires_at) : null, claimed: m.claimed,
    })),
  };
}

// 서버에 기록됐지만 기기가 아직 지급 확인 안 한 것들(앱이 중간에 죽은 경우 복구).
export async function claimsPending(db: Db, uid: string) {
  const list = must(await db.from("claims").select("tx_id, kind, bundle").eq("player_id", uid).is("granted_at", null).limit(100)) as
    | { tx_id: string; kind: string; bundle: unknown }[]
    | null;
  return { ok: true, claims: (list ?? []).map((c) => ({ txId: c.tx_id, kind: c.kind, bundle: c.bundle })) };
}

// 지금 보이는 이벤트 목록(docs/events.md) - SQL event_list.
export async function eventList(db: Db, uid: string) {
  return { ok: true, events: (must(await db.rpc("event_list", { p_player: uid })) as unknown[] | null) ?? [] };
}

// hello에 붙이는 묶음. events는 옛 앱이 모르는 키라 무시한다.
export async function startInfo(db: Db, uid: string) {
  const [att, mail, claims, save, events] = await Promise.all([
    attStatus(db, uid), mailList(db, uid), claimsPending(db, uid), saveMeta(db, uid), eventList(db, uid),
  ]);
  return { att, mail, claims, save, events };
}
