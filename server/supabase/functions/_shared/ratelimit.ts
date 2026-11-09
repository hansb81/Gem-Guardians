// 플레이어당 함수별 분당 호출 제한(docs/server.md §15, §19-11). 카운트는 rate_calls 표(1시간 지난 줄은 cron이 지움).
import { db } from "./auth.ts";

export const PER_MINUTE = 30;

export async function overLimit(uid: string, fn: string): Promise<boolean> {
  const { data, error } = await db.rpc("rate_hit", { p_player: uid, p_fn: fn, p_limit: PER_MINUTE });
  return !error && data === false; // 카운트 실패는 막지 않는다(제한 표 문제로 결제 확인이 멈추면 안 됨)
}
