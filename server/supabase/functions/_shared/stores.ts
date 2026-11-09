// 원스토어·토스 서버 조회 자리(docs/server.md §7-2, §7-3). S3/S4에서 채운다 - 지금은 iap-verify가 notImplemented로 답한다.

// TODO(S3): client_id/secret(Supabase Secrets)로 POST /v7/oauth/token(1시간 캐시) ->
//   GET /v7/apps/{clientId}/purchases/inapp/products/{productId}/{purchaseToken} -> purchaseState==0 이면 verified.
export async function verifyOneStore(_productId: string, _purchaseToken: string): Promise<{ status: string; raw?: unknown }> {
  return { status: "notImplemented" };
}

// TODO(S4): mTLS(안 되면 §7-4 Worker)로 POST .../order/get-order-status {orderId} ->
//   resultType SUCCESS 이고 PURCHASED|PAYMENT_COMPLETED 면 verified, REFUNDED 면 refunded.
export async function verifyToss(_orderId: string): Promise<{ status: string; raw?: unknown }> {
  return { status: "notImplemented" };
}
