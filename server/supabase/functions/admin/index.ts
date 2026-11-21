// POST /admin {action, ...} -> 관리자 페이지 전용(docs/admin.md §5-2). 입구 검사(관리자 CORS·aal2·admins·role·분당 제한)는
// _shared/admin.ts adminHandle, action 표는 actions.ts.
import { adminHandle } from "../_shared/admin.ts";
import { db } from "../_shared/auth.ts";
import { ACTIONS } from "./actions.ts";

adminHandle(ACTIONS, db);
