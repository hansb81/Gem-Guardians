// 시작 정보(docs/auth.md §1-E 1번): att-status·mail-list·claims-pending 본문 + save 메타.
// 각 함수와 hello가 같은 코드를 쓴다 - hello 한 번으로 시작 호출을 4~5번에서 1번으로.
import { must } from "./result.ts";
import { kstDate } from "./kst.ts";
import { ATTENDANCE_DAYS } from "./attendance.ts";
import { visibleMail } from "./mail.ts";
import { saveMeta } from "./save.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

// 이번 판 진행·오늘 받았는지·보상표.
export async function attStatus(db: Db, uid: string) {
  const today = kstDate();
  const a = must(await db.from("attendance").select("days, last_date").eq("player_id", uid).maybeSingle()) as
    | { days: number; last_date: string }
    | null;
  const claimedToday = a?.last_date === today;
  const days = a && !(a.days >= 7 && !claimedToday) ? a.days : 0; // 7칸 다 받고 날이 바뀌면 새 판
  return { ok: true, today, days, claimedToday, rewards: ATTENDANCE_DAYS };
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

// hello에 붙이는 묶음.
export async function startInfo(db: Db, uid: string) {
  const [att, mail, claims, save] = await Promise.all([attStatus(db, uid), mailList(db, uid), claimsPending(db, uid), saveMeta(db, uid)]);
  return { att, mail, claims, save };
}
