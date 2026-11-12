// config/items.json "items" 키와 같은 목록 - 바꿀 때 셋 다 고친다: 이 파일, migrations/20261112000000_coupons.sql의
// coupon_bundle_ok(item_ids), config/items.json. tests/coupon.test.js가 config와 비교하고, server/supabase/tests/coupon_test.ts가 SQL과 비교한다.
export const ITEM_IDS = [
  "hammer", "scythe_h", "scythe_v", "rainbow", "glove", "repair", "hourglass", "dye",
  "shuffle", "barrier", "defuse", "drum", "booster_line", "booster_bomb", "gold_coin", "revive",
];
