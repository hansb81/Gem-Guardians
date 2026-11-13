// POST /rank-normal {floor} -> 이전보다 높을 때만 갱신 { ok, updated }. 도달 시각은 서버 시각.
// 새 앱은 새 최고 층을 save-put body.rank로 실어 보낸다 - 이건 랭킹 팝업을 열 때(rank-me 보정)·클라우드 저장이 꺼졌을 때.
import { handle } from "../_shared/http.ts";
import { submitNormal } from "../_shared/ranking.ts";

handle("rank-normal", ({ uid, body, db }) => submitNormal(db, uid, Number(body.floor)));
