// POST /att-status -> 이번 판 진행·오늘 받았는지·보상표. (시작 때는 hello에 같이 온다 - 팝업 새로고침용)
import { handle } from "../_shared/http.ts";
import { attStatus } from "../_shared/start.ts";

handle("att-status", ({ uid, db }) => attStatus(db, uid));
