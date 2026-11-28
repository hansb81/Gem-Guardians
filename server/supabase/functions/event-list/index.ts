// POST /event-list -> { ok, events:[{id, kind, title, body, banner, bannerUrl, bundle, startsAt, endsAt, claimed}] } (docs/events.md).
// 시작 때는 hello에 같이 온다 - 이벤트 팝업을 열 때 새로고침용.
import { handle } from "../_shared/http.ts";
import { eventList } from "../_shared/start.ts";

handle("event-list", ({ uid, db }) => eventList(db, uid));
