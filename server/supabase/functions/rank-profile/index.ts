// POST /rank-profile {nickname, statue} -> 닉네임 2~10자 한글/영문/숫자, 금칙어 'badword', 중복 'taken'.
import { fail, handle, isBanned } from "../_shared/http.ts";
import { hasBadword } from "../_shared/badwords.ts";

const NICKNAME_RE = /^[가-힣A-Za-z0-9]{2,10}$/; // src/ranking/rankingSave.js와 같음
const STATUES = ["red", "blue", "yellow", "green", "purple"];

handle("rank-profile", async ({ uid, body, db }) => {
  const { nickname, statue } = body as { nickname: string; statue: string };
  if (typeof nickname !== "string" || !NICKNAME_RE.test(nickname)) return fail("nickname");
  if (!STATUES.includes(statue)) return fail("statue");
  if (hasBadword(nickname)) return fail("badword");
  if (await isBanned(uid)) return fail("banned");
  const { error } = await db.from("players").update({ nickname, statue }).eq("id", uid);
  if (error?.code === "23505") return fail("taken");
  if (error) throw new Error(error.message);
  return { ok: true };
});
