// 출석·우편 서비스(docs/server.md §6, §8). 판정은 서버, 지급은 인벤토리 grant(txId로 중복 방지).
// 돌려주는 모양: { ok, reason?, delta? } - reason 'offline' | 'already' | 'notFound' | ...
import { call, net, syncClaims } from './api.js';
import { storage } from '../platform/storage.js';

const MAIL_DELETED_KEY = 'mailDeleted'; // 받은 뒤 지운 우편 id - 서버엔 그대로 있어 기기에서 가린다

// 서버 응답 {txId, bundle} -> 기기 지급 -> claims-granted(실패해도 다음 실행 때 claims-pending으로 다시 옴).
function grantClaim(inventory, res, src, callFn = call) {
  const g = inventory.grant(res.bundle, { src, txId: res.txId });
  if (g.ok || g.reason === 'duplicate') callFn('claims-granted', { txIds: [res.txId] });
  return { ok: true, delta: g.ok ? g.delta : null };
}

export class AttendanceService {
  // api = { call, syncClaims } - 테스트가 가짜로 바꿔 끼운다.
  constructor(inventory, api = { call, syncClaims }) {
    this.inventory = inventory;
    this.api = api;
    // null = 아직 모름 | { ok:true, today, days, claimedToday, rewards, streak, streakBroken, streakGoal, streakBonus(보상표) } | { ok:false, reason }
    this.status = null;
    this.busy = false;
  }

  canClaim() {
    return !!this.status?.ok && !this.status.claimedToday;
  }

  async refresh() {
    if (!net.on) this.status = { ok: false, reason: 'offline' };
    else this.status = await call('att-status');
    return this.status;
  }

  async claim() {
    if (this.busy) return { ok: false, reason: 'busy' };
    this.busy = true;
    try {
      const res = await this.api.call('att-claim');
      if (!res.ok) {
        // 이미 받음: 응답이 끊겨 못 받은 지급이 있을 수 있다 - pending으로 복구.
        if (res.reason === 'already') await this.api.syncClaims(this.inventory);
        if (res.reason !== 'offline') await this.refresh();
        return res;
      }
      // streakBonus(응답) = 이번에 받은 연속 보너스 bundle | null. status.streakBonus는 보상표라 다른 이름(streakBonusGot)에 둔다.
      const streakBonus = res.streakBonus ?? null;
      if (this.status?.ok) {
        Object.assign(this.status, { days: res.day, claimedToday: true, streakBonusGot: streakBonus });
        if (res.streak != null) Object.assign(this.status, { streak: res.streak, streakBroken: false }); // 옛 서버는 streak 없음
      }
      return { ...grantClaim(this.inventory, res, 'attendance', this.api.call), streakBonus };
    } finally {
      this.busy = false;
    }
  }
}

export class MailService {
  constructor(inventory) {
    this.inventory = inventory;
    this.list = null; // null = 아직 모름 | [{ id, title:{ko,en}, bundle, expiresAt, claimed }]
    this.reason = null; // 마지막 실패 이유('offline' 등)
    this.busy = false;
  }

  unread() {
    return this.list ? this.list.filter((m) => !m.claimed).length : 0;
  }

  async refresh() {
    const res = net.on ? await call('mail-list') : { ok: false, reason: 'offline' };
    this.reason = res.ok ? null : res.reason;
    if (res.ok) this.setList(res.mail);
    return res;
  }

  // 지운 우편을 빼고 넣는다. 목록에서 사라진(만료·회수) id는 기록에서도 지운다.
  setList(mail) {
    const ids = new Set(mail.map((m) => m.id));
    const deleted = (storage.load(MAIL_DELETED_KEY) ?? []).filter((id) => ids.has(id));
    storage.save(MAIL_DELETED_KEY, deleted);
    this.list = mail.filter((m) => !deleted.includes(m.id));
  }

  // 받은 우편만 지운다(이 기기 목록에서).
  remove(id) {
    const m = this.list?.find((x) => x.id === id);
    if (!m?.claimed) return;
    this.list = this.list.filter((x) => x !== m);
    storage.save(MAIL_DELETED_KEY, [...(storage.load(MAIL_DELETED_KEY) ?? []), id]);
  }

  async claim(id) {
    if (this.busy) return { ok: false, reason: 'busy' };
    this.busy = true;
    try {
      const res = await call('mail-claim', { id });
      if (!res.ok) {
        if (res.reason === 'already') await syncClaims(this.inventory);
        if (res.reason !== 'offline') await this.refresh();
        return res;
      }
      const m = this.list?.find((x) => x.id === id);
      if (m) m.claimed = true;
      return grantClaim(this.inventory, res, 'mail');
    } finally {
      this.busy = false;
    }
  }
}

// 쿠폰 코드 정규화(docs/coupon.md §2, 서버 coupon_normalize와 같은 규칙): NFKC -> 대문자 -> 영문·숫자 말고 제거. 4~20자 아니면 null.
export function normalizeCoupon(s) {
  const v = String(s ?? '').normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return v.length >= 4 && v.length <= 20 ? v : null;
}

// 쿠폰 입력(docs/coupon.md). 판정은 서버, 지급은 출석·우편과 같은 grantClaim(txId 'coupon:{campaign}').
// api = { call, syncClaims } - 테스트가 가짜로 바꿔 끼운다.
export class CouponService {
  constructor(inventory, api = { call, syncClaims }) {
    this.inventory = inventory;
    this.api = api;
    this.busy = false;
  }

  // -> { ok:true, delta, title:{ko,en} } | { ok:false, reason }
  async redeem(code) {
    if (this.busy) return { ok: false, reason: 'busy' };
    if (!normalizeCoupon(code)) return { ok: false, reason: 'badCode' };
    this.busy = true;
    try {
      const res = await this.api.call('coupon-redeem', { code });
      if (!res.ok) {
        // 이미 받음: 응답이 끊겨 못 받은 지급이 있을 수 있다 - pending으로 복구.
        if (res.reason === 'already') await this.api.syncClaims(this.inventory);
        return res;
      }
      return { ...grantClaim(this.inventory, res, 'coupon', this.api.call), title: res.title ?? null };
    } finally {
      this.busy = false;
    }
  }
}

// 결제 서버 확인(docs/server.md §7). verify 결과 { ok, txId?, reason? } - reason 'offline' | 'notFound' | 'owner' | ...
// RevenueCat 반영 지연으로 notFound면 retryMs 뒤 한 번 더(구매 직후만; 다음 실행의 재확인은 바로 한 번).
export const IapService = {
  async verify(store, productKey, orderId, { retryMs = 10000 } = {}) {
    let res = await call('iap-verify', { store, productKey, orderId });
    if (res.reason === 'notFound' && retryMs > 0) {
      await new Promise((r) => setTimeout(r, retryMs));
      res = await call('iap-verify', { store, productKey, orderId });
    }
    return res;
  },
  // bundle = 기기가 실제로 지급한 것(inventory delta, 첫 구매 2배 반영). 모르면 null.
  granted(txId, bundle) {
    return call('iap-granted', { txId, bundle });
  },
};
