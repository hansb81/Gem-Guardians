// 개발용 가짜 결제(옛 src/shop/iap.js의 dev 영수증)·가짜 광고. ?dev=1일 때만 web 어댑터 위에 덮어쓴다(src/platform/index.js).
// shortcut: 결제가 항상 즉시 성공한다 - 취소/실패/미지급 복구를 시험하려면 여기에 분기를 추가한다.
// 광고(docs/ads.md): 보상형 = 2초 검은 화면 "TEST AD" 뒤 보상. ?adfail=1 = 못 띄움(shown:false), ?adclose=1 = 중간에 닫음(보상 없음).
// 이벤트 팝업 배너 = 게임이 넘긴 좌표에 회색 div(위치 확인용).
const FAKE_AD_MS = 2000;

function fakeRewarded() {
  const q = new URLSearchParams(location.search);
  if (q.get('adfail') === '1') return new Promise((r) => setTimeout(() => r({ shown: false, rewarded: false }), 500));
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;font:24px sans-serif';
    el.textContent = 'TEST AD (2s)';
    document.body.appendChild(el);
    setTimeout(() => {
      el.remove();
      resolve({ shown: true, rewarded: q.get('adclose') !== '1' });
    }, FAKE_AD_MS);
  });
}

let bannerEl = null;

export function withDev(base) {
  return {
    ...base,
    dev: true, // 상점이 마켓 상품 id 없이도 현금 상품을 보여 준다.
    adTesting: true,
    caps: { ...base.caps, iap: true, rewarded: true, popupBanner: true },
    iap: {
      ...base.iap,
      purchase: async (productKey, onGrant) => {
        const orderId = `dev-${Date.now()}`;
        return { ok: !!(await onGrant(productKey, orderId)), productKey, orderId };
      },
    },
    ads: {
      ...base.ads,
      showRewarded: fakeRewarded,
      showPopupBanner({ x, y, width, height }) {
        if (!bannerEl) {
          bannerEl = document.createElement('div');
          bannerEl.textContent = 'TEST BANNER 320x50';
          document.body.appendChild(bannerEl);
        }
        bannerEl.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${width}px;height:${height}px;z-index:9998;background:#888;color:#111;`
          + 'display:flex;align-items:center;justify-content:center;font:12px sans-serif;pointer-events:none';
      },
      hidePopupBanner() {
        bannerEl?.remove();
        bannerEl = null;
      },
    },
  };
}
