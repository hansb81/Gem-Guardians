// POST /save-put { baseRev, data, deviceId, appVersion, force?, rank? } -> { ok, rev } | { ok:false, reason:'conflict', server } |
// tooBig | badData | badRequest (docs/auth.md §3-2). platform은 기기 입력 말고 players.platform. 분당 6회(_shared/ratelimit.ts).
import { handle } from "../_shared/http.ts";
import { savePut } from "../_shared/save.ts";

handle("save-put", ({ uid, body, db }) => savePut(db, uid, body));
