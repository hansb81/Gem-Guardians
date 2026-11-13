// POST /claims-pending -> 서버에 기록됐지만 기기가 아직 지급 확인 안 한 것들(앱이 중간에 죽은 경우 복구).
// 새 앱은 시작 때 hello의 claims를 쓴다 - 옛 앱 버전·지급 재시도용으로 남김.
import { handle } from "../_shared/http.ts";
import { claimsPending } from "../_shared/start.ts";

handle("claims-pending", ({ uid, db }) => claimsPending(db, uid));
