// 클라우드 저장(docs/auth.md §3-2). save-get·save-put·hello(메타)가 같이 쓴다. 판정은 SQL save_put.
import { fail, must } from "./result.ts";
import { submitNormal } from "./ranking.ts";
import products from "./products.json" with { type: "json" };

// deno-lint-ignore no-explicit-any
type Db = any;

const ms = (t: string | null) => (t ? Date.parse(t) : null);
type SaveRow = { rev: number; data: unknown; summary: unknown; updated_at: string | null; device_id: string | null; platform: string | null };

// 결제 이상치 판정용 상품별 다이아 상한 = grant 다이아 x2(다이아 묶음 첫 구매 2배까지).
const DIA_BY_KEY = Object.fromEntries(
  Object.entries(products as Record<string, { grant?: { diamonds?: number } }>)
    .filter(([k, p]) => !k.startsWith("_") && p?.grant?.diamonds)
    .map(([k, p]) => [k, p.grant!.diamonds! * 2]),
);

export async function saveGet(db: Db, uid: string) {
  const s = must(await db.from("saves").select("rev, data, summary, updated_at, device_id, platform").eq("player_id", uid).maybeSingle()) as
    | SaveRow
    | null;
  return {
    ok: true,
    save: s
      ? { rev: Number(s.rev), data: s.data, summary: s.summary, updatedAt: ms(s.updated_at), deviceId: s.device_id, platform: s.platform }
      : null,
  };
}

// hello용 - data 없이 메타만.
export async function saveMeta(db: Db, uid: string) {
  const s = must(await db.from("saves").select("rev, updated_at, device_id").eq("player_id", uid).maybeSingle()) as SaveRow | null;
  return s ? { rev: Number(s.rev), updatedAt: ms(s.updated_at), deviceId: s.device_id } : null;
}

const optStr = (v: unknown, max: number) => v == null || (typeof v === "string" && v.length <= max);

// body { baseRev, data, deviceId, appVersion, force?, reason?: 'rewind', localRev?, rank?: { bestFloor, reachedAt } }
export async function savePut(db: Db, uid: string, body: Record<string, unknown>) {
  const { baseRev, data, deviceId, appVersion, force, reason, localRev, rank } = body;
  if (
    !Number.isInteger(baseRev) || (baseRev as number) < 0 ||
    !data || typeof data !== "object" || Array.isArray(data) ||
    !optStr(deviceId, 64) || !optStr(appVersion, 32) ||
    (force != null && typeof force !== "boolean") ||
    (reason != null && reason !== "rewind") || (localRev != null && !Number.isInteger(localRev)) ||
    (rank != null && (typeof rank !== "object" || Array.isArray(rank)))
  ) return fail("badRequest");
  const player = must(await db.from("players").select("platform").eq("id", uid).maybeSingle()) as { platform: string | null } | null;
  const res = must(await db.rpc("save_put", {
    p_player: uid, p_base_rev: baseRev, p_data: data, p_device: deviceId ?? null, p_platform: player?.platform ?? null,
    p_app: appVersion ?? null, p_force: force === true, p_dia_by_key: DIA_BY_KEY,
    p_reason: reason ?? null, p_local_rev: localRev ?? null,
  })) as Record<string, unknown>;
  // 새 최고 층(§1-E 2번): save 결과와 상관없이 rank-normal과 같은 판정. 기기 reachedAt은 안 씀(서버 시각).
  if (rank != null) {
    const r = await submitNormal(db, uid, Number((rank as { bestFloor?: unknown }).bestFloor));
    return { ...res, rank: r.ok ? { ok: true } : { ok: false, reason: r.reason } };
  }
  return res;
}
