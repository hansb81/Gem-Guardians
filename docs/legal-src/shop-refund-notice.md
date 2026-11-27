# 상점 구매 화면 환불 안내 문구 (ko / en)

게임 안 상점에 넣을 짧은 문구입니다. 전자상거래법상 **청약철회가 제한되는 상품은 구매 전에 그 사실을 잘 보이게 표시**해야 해서, 상품별 한 줄(②)이 특히 중요합니다. 키 이름은 예시이니 코드의 i18n 구조에 맞춰 바꾸세요.

## ① 상점 맨 아래 작은 글씨 (모든 유료 탭 공통)

| 키 | ko | en |
|---|---|---|
| shop.notice.refund | 구매 후 7일 안에 쓰지 않은 부분은 청약철회(환불)할 수 있어요. 이미 쓴 다이아·아이템과, 이미 적용되어 쓴 상품(광고 제거·4번째 슬롯)은 철회가 제한돼요. 결제·환불은 각 마켓 정책을 함께 따릅니다. | You may cancel the unused part within 7 days. Diamonds and items already used, and products already applied and used (Ad Removal, 4th Slot), cannot be cancelled. Store refund policies also apply. |
| shop.notice.minor | 만 19세 미만은 부모님 등 법정대리인의 동의를 받고 구매해 주세요. 동의 없는 결제는 취소할 수 있어요. | Users under 19 need consent from a parent or guardian. Purchases made without consent can be cancelled. |
| shop.notice.guest | 게스트 계정은 앱을 지우거나 기기를 바꾸면 아이템이 사라질 수 있어요. 구매 전에 계정 연결을 권해요. | Guest data may be lost if you delete the app or change devices. Link an account before purchasing. |
| shop.link.terms | 이용약관 | Terms of Service |
| shop.link.refund | 환불 안내 | Refund Policy |
| shop.link.restore | 구매 내역 복원 | Restore Purchases |

## ② 상품 카드/구매 확인 팝업의 한 줄 (상품별)

| 상품 | ko | en |
|---|---|---|
| 다이아 dia_0~5 | 쓴 다이아는 청약철회할 수 없어요. 쓰지 않은 만큼은 7일 안에 환불돼요. | Used diamonds cannot be cancelled. The unused part is refundable within 7 days. |
| 다이아 첫 구매 배지 | 첫 구매 2배! 환불 시 보너스도 함께 회수되고 다시 받을 수 없어요. | First purchase ×2! The bonus is reclaimed on refund and is not granted again. |
| 스타터/보스/챕터 팩 | 쓴 구성품은 청약철회할 수 없어요. 쓰지 않은 구성품만큼은 7일 안에 환불돼요. | Used items cannot be cancelled. Unused items in the pack are refundable within 7 days. |
| 4번째 슬롯 팩 | 구매 즉시 적용돼요. 슬롯을 전투에서 쓰거나 무지개를 쓰면 청약철회할 수 없어요. | Applied instantly. Cannot be cancelled once the slot is used in battle or a rainbow is used. |
| 광고 제거 | 구매 즉시 적용돼요. 광고 없이 보상을 한 번 받거나 다이아를 쓰면 청약철회할 수 없어요. | Applied instantly. Cannot be cancelled once you claim an ad-free reward or use the diamonds. |
| 주간/월간 패스 | 보상을 받기 시작하면 청약철회는 안 되고, 남은 일수만큼 해지 환불(위약금 10%)을 신청할 수 있어요. | Once you start claiming rewards, you can't cancel, but you may terminate for a pro-rated refund of the remaining days (10% fee). |
| 주간/월간 패스 설명(shop.pass.missed) | 접속하지 못한 날의 보상은 다음에 받을 때 합산됩니다(종료 후 3일까지). | Missed days add up on your next claim (up to 3 days after it ends). |

## ③ "환불 안내" 팝업 (링크를 누르면 나오는 짧은 버전, 끝에 전문 링크)

**ko**
> **환불 안내**
> • 구매 후 7일 안에 쓰지 않은 부분은 환불돼요(하나도 안 썼다면 전액).
> • 환불되는 만큼의 다이아·아이템·보너스를 회수해요.
> • 패스는 받기 시작한 뒤에도 남은 일수만큼 해지 환불할 수 있어요.
> • 신청 방법
>   – Google Play: 48시간 안에는 Google Play에서, 그 뒤에는 아래 이메일로
<!-- 마켓 보류: >   – 원스토어: 원스토어 구매내역 또는 아래 이메일로 -->
<!-- 마켓 보류: >   – App Store: Apple(reportaproblem.apple.com)에 직접 -->
<!-- 토스 보류: >   – 토스: 아래 이메일로 -->
> • 보내 주실 것: 회원 번호(이 화면 아래), 마켓 주문 번호, 구매 날짜, 상품명
> • 문의: [이메일]
> 회원 번호: {playerId}　　[전문 보기]

**en**
> **Refund Policy**
> • Within 7 days the unused part is refunded (in full if nothing was used).
> • A refund reclaims the refunded diamonds, items and bonuses.
> • Passes can be terminated for a pro-rated refund of the remaining days.
> • How to request
>   – Google Play: via Google Play within 48 hours, by email after that
<!-- 마켓 보류: >   – ONE store: ONE store purchase history or by email -->
<!-- 마켓 보류: >   – App Store: directly with Apple (reportaproblem.apple.com) -->
<!-- 토스 보류: >   – Toss: by email -->
> • Please include: player ID (below), store order number, purchase date, product
> • Contact: [email]
> Player ID: {playerId}　　[Full policy]

## ④ 구현 메모 (쑹의 Claude Code에 같이 넘길 것)
- 상점 하단에 ① + 링크 3개, 각 상품 카드 또는 구매 확인 팝업에 ②를 표시. 다이아 첫 구매 배지 옆 ② 두 번째 줄.
- ③ 팝업에 회원 번호를 **복사 버튼**과 함께 보여 주면 문의가 쉬워져요.
- 약관/환불 전문은 웹 URL(예: 웹 배포의 `/terms.html`, `/refund.html`)로 두고 앱에서는 외부 브라우저로 열기. **원스토어 빌드는 다른 마켓 링크 금지**라서 ③에서 Google Play·App Store 줄을 빼고, 토스 빌드는 토스 줄만 남기는 식으로 마켓별로 해당 줄만 보여 주세요.
- 웹 빌드(caps.iap=false)에서는 ②·③ 불필요, 약관 링크만.
