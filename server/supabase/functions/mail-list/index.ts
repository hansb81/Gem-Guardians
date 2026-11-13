// POST /mail-list -> 우편 목록(최근 50, 받은 것도 claimed로 표시). (시작 때는 hello에 같이 온다 - 팝업 새로고침용)
import { handle } from "../_shared/http.ts";
import { mailList } from "../_shared/start.ts";

handle("mail-list", ({ uid, db }) => mailList(db, uid));
