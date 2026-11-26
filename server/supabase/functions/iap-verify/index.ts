// POST /iap-verify - 본문은 _shared/iap_verify.ts(테스트가 가짜 db로 부른다).
import { handle } from "../_shared/http.ts";
import { iapVerify } from "../_shared/iap_verify.ts";

handle("iap-verify", iapVerify);
