import { db } from "./auth.ts";
import { must } from "./http.ts";

// 나에게 보이는 우편(내 것 + 전체 발송, 안 지난 것, 최근 50) + 받았는지.
export async function visibleMail(uid: string) {
  const now = new Date().toISOString();
  const mail = must(
    await db.from("mail").select("id, title_ko, title_en, bundle, expires_at, created_at")
      .or(`player_id.is.null,player_id.eq.${uid}`).or(`expires_at.is.null,expires_at.gt."${now}"`) // 값에 . : 가 있어 따옴표
      .order("id", { ascending: false }).limit(50),
  ) ?? [];
  const txs = mail.map((m) => `mail:${m.id}`);
  const got = txs.length
    ? new Set((must(await db.from("claims").select("tx_id").eq("player_id", uid).in("tx_id", txs)) ?? []).map((c) => c.tx_id))
    : new Set<string>();
  return mail.map((m) => ({ ...m, claimed: got.has(`mail:${m.id}`) }));
}
