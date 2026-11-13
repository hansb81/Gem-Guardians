// POST /save-get -> { ok, save: null | { rev, data, summary, updatedAt, deviceId, platform } } (docs/auth.md §3-2).
// 기기는 hello의 save 메타가 기기보다 새것일 때만 부른다.
import { handle } from "../_shared/http.ts";
import { saveGet } from "../_shared/save.ts";

handle("save-get", ({ uid, db }) => saveGet(db, uid));
