// 개발용 가짜 결제(옛 src/shop/iap.js의 dev 영수증). ?dev=1일 때만 web 어댑터 위에 덮어쓴다(src/platform/index.js).
// shortcut: 결제가 항상 즉시 성공한다 - 취소/실패/미지급 복구를 시험하려면 여기에 분기를 추가한다.
export function withDev(base) {
  return {
    ...base,
    dev: true, // 상점이 마켓 상품 id 없이도 현금 상품을 보여 준다.
    caps: { ...base.caps, iap: true },
    iap: {
      ...base.iap,
      purchase: async (productKey, onGrant) => {
        const orderId = `dev-${Date.now()}`;
        return { ok: !!(await onGrant(productKey, orderId)), productKey, orderId };
      },
    },
  };
}
