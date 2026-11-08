// 현금 결제 인터페이스: purchase(productId) -> Promise<{ ok, productId, receiptId?, reason? }>.
// receiptId = 스토어 영수증(주문) id - 호출부가 inventory txId 'iap:상품:영수증'으로 중복 지급을 막는다.
// 지금은 가짜 결제 - 개발 모드에서 바로 성공 처리한다. Capacitor 포팅 단계에서 이 파일만
// 스토어 결제(Google Play Billing / StoreKit 플러그인)로 바꾼다: 상품 조회, 결제 창, 영수증 검증,
// 구매 내역 복원(restore)이 여기 들어온다. 호출부(src/render/shopScreen.js)는 이 함수만 쓴다.
export async function purchase(productId) {
  // shortcut: 실제 결제가 없다(항상 성공) - 스토어 플러그인을 붙일 때 이 줄을 교체한다.
  return { ok: true, productId, receiptId: `dev-${Date.now()}` };
}
