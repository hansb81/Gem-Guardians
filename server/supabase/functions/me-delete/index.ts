// POST /me-delete -> 출석·지급·랭킹 기록·닉네임 삭제, players.deleted_at 표시(docs/server.md §14-3).
// purchases는 5년 보관 - 지우지 않고 player_id 연결만 끊는다(S2 마이그레이션의 me_delete, §14-2).
import { handle, must } from "../_shared/http.ts";

handle("me-delete", async ({ uid, db }) => {
  must(await db.rpc("me_delete", { p_player: uid }));
  await db.from("server_log").insert({ source: "me-delete", level: "info", body: { uid } });
  return { ok: true };
});
