// POST /me-delete -> 계정 삭제(docs/auth.md §6): 기록 삭제·결제 익명화(5년 보관, §14-2) -> RevenueCat 고객 삭제 -> auth 사용자 삭제.
// 본문은 _shared/account.ts deleteAccount. 끝나면 이 토큰은 더 이상 통과하지 않는다(기기는 새 게스트로 다시 시작).
import { handle } from "../_shared/http.ts";
import { deleteAccount } from "../_shared/account.ts";

handle("me-delete", ({ uid, db }) => deleteAccount(db, uid, { rcSecret: Deno.env.get("REVENUECAT_SECRET_KEY") ?? "" }));
