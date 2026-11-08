// 플레이어가 가진 것(아이템 개수, 장착·예약, 영구 보유) - docs/inventory.md 3장. 보유 수를 바꾸는 곳은
// 이 파일의 grant/spend/buy와 장착·예약 함수뿐이다. 지갑(gold/diamonds)은 wallet(playerState)에 있고
// 번들에 들어 있으면 여기서 넣고 뺀다. 저장은 save 콜백(playerState.save) 한 번.
import {
  ITEM_CAP, HOTBAR_LEN, LOG_MAX, normalizeInv, addCapped, nextSkillLevel, equipInto, swapInto,
} from '../core/inventory/inventory.js';

const OK = Object.freeze({ ok: true, reason: null });
const fail = (reason) => ({ ok: false, reason });

export class Inventory {
  // data = 저장된 inv 묶음(없으면 기본값), wallet = { gold, diamonds }를 가진 객체, clock = 로그 시각(초).
  constructor(data, { wallet = { gold: 0, diamonds: 0 }, save = () => {}, config = null, clock = () => Math.floor(Date.now() / 1000) } = {}) {
    this.data = normalizeInv(data);
    this.wallet = wallet;
    this._save = save;
    this._clock = clock;
    this.config = config; // config/items.json
    this.inFloor = false; // 층 진행 중이면 장착 변경은 pendingHotbar로(4장 4). 저장 안 함.
    this._listeners = [];
    this._hotbarView = [];
    this._refreshView();
  }

  setConfig(itemsConfig) {
    this.config = itemsConfig;
    this._refreshView();
  }

  // ---------- 읽기 ----------
  count(id) {
    return this.data.items[id] ?? 0;
  }

  has(id, n = 1) {
    return this.count(id) >= n;
  }

  skillLevel(key) {
    return this.data.perm.skills[key] ?? 0;
  }

  isUnlocked(flag) {
    return this.data.perm.flags.includes(flag);
  }

  slotCount() {
    const slots = this.config?.slots ?? { base: 3, max: HOTBAR_LEN };
    return Math.min(HOTBAR_LEN, this.isUnlocked('slot4') ? slots.max : slots.base);
  }

  // 지금 하단 바(잠긴 칸 제외). 매 프레임 읽으므로 바뀔 때만 새로 만든 배열을 돌려준다 - 고치지 말 것.
  hotbar() {
    if (this._viewSrc !== this.data.loadout.hotbar) this._refreshView(); // 배열을 통째로 갈아 끼운 경우(대개 테스트).
    return this._hotbarView;
  }

  // 층 진행 중 바꾼 장착(다음 층부터 적용) - 없으면 null.
  pendingHotbar() {
    return this.data.loadout.pendingHotbar?.slice(0, this.slotCount()) ?? null;
  }

  // 목록·상점에 보일 아이템 id(config 순서). unlockFloor 전인 것은 빠지지만 개수는 그대로 남는다.
  visibleItems(bestFloor) {
    const items = this.config?.items ?? {};
    return Object.keys(items).filter((id) => bestFloor >= (items[id].unlockFloor ?? 1));
  }

  reservations() {
    return Object.keys(this.data.loadout.preFloor).filter((id) => this.data.loadout.preFloor[id]);
  }

  // 메뉴 보관함 빨간 점 1: 보관함을 연 뒤로 처음 가진(보이는) 아이템이 있다. 매 프레임 불려서 배열을 만들지 않는다.
  hasUnseenItems(bestFloor) {
    const items = this.config?.items ?? {};
    for (const id in items) {
      if (this.count(id) > 0 && bestFloor >= (items[id].unlockFloor ?? 1) && !this.data.seenItems.includes(id)) return true;
    }
    return false;
  }

  // 메뉴 보관함 빨간 점 2: 빈 장착 칸이 있고, 거기 넣을 수 있는(보유 1개 이상·아직 안 꽂힌 hotbar) 아이템이 있다.
  hasFillableSlot(bestFloor) {
    const bar = this.pendingHotbar() ?? this.hotbar();
    if (!bar.includes(null)) return false;
    const items = this.config?.items ?? {};
    for (const id in items) {
      const c = items[id];
      if (c.group === 'hotbar' && this.count(id) > 0 && bestFloor >= (c.unlockFloor ?? 1) && !bar.includes(id)) return true;
    }
    return false;
  }

  // 보관함을 열면 지금 보이는 보유 아이템을 전부 본 것으로(빨간 점 1 끔). 바뀐 게 있을 때만 저장.
  markItemsSeen(bestFloor) {
    if (!this.hasUnseenItems(bestFloor)) return;
    const items = this.config?.items ?? {};
    for (const id in items) {
      if (this.count(id) > 0 && bestFloor >= (items[id].unlockFloor ?? 1) && !this.data.seenItems.includes(id)) this.data.seenItems.push(id);
    }
    this._commit(null, null);
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      this._listeners = this._listeners.filter((f) => f !== fn);
    };
  }

  // ---------- 쓰기 ----------
  // bundle = { gold?, diamonds?, items?: {id:n}, skills?: {key: 레벨|'+1'}, flags?: [] }
  // txId는 문자열 또는 배열(여러 지급을 한 번에 - 하나라도 이미 받았으면 duplicate).
  grant(bundle, { src, txId = null } = {}) {
    const txs = txId == null ? [] : [].concat(txId);
    if (txs.some((tx) => this.data.grantedTx.includes(tx))) return fail('duplicate');
    const d = this._applyBundle(bundle);
    this.data.grantedTx.push(...txs);
    this._commit(src, d, txId);
    return { ...OK, delta: d };
  }

  // 부족하면 하나도 안 뺀다. 사용·예약 소모는 log에 남기지 않는다(log = 지급·구매·마이그레이션만).
  spend(id, n = 1) {
    if (!(n > 0) || !this.has(id, n)) return fail('noStock');
    this.data.items[id] -= n;
    this._commit(null, null);
    return OK;
  }

  // 옛 'start' 한 줄 기록을 아이템별 start:{id}로 푼다(ids = 그때의 config 아이템). 없으면 아무것도 안 함.
  expandStartTx(ids) {
    const tx = this.data.grantedTx;
    const i = tx.indexOf('start');
    if (i < 0) return;
    tx.splice(i, 1, ...ids.map((id) => `start:${id}`).filter((t) => !tx.includes(t)));
    this._commit('migrate', { startTx: ids.length });
  }

  // 재화 차감 + 지급을 한 번에. 검사를 먼저 다 하고 나서 바꾸므로 실패하면 아무것도 안 바뀐다.
  // cost = { gold?, diamonds? }. 상한을 넘는 아이템 구매는 돈을 버리게 되므로 'cap'으로 거절.
  buy({ cost = {}, bundle, src, txId = null }) {
    if (txId != null && this.data.grantedTx.includes(txId)) return fail('duplicate');
    const gold = cost.gold ?? 0;
    const diamonds = cost.diamonds ?? 0;
    if (this.wallet.gold < gold || this.wallet.diamonds < diamonds) return fail('noMoney');
    for (const [id, n] of Object.entries(bundle.items ?? {})) if (this.count(id) + n > ITEM_CAP) return fail('cap');
    this.wallet.gold -= gold;
    this.wallet.diamonds -= diamonds;
    const d = this._applyBundle(bundle);
    if (gold) d.gold = (d.gold ?? 0) - gold;
    if (diamonds) d.diamonds = (d.diamonds ?? 0) - diamonds;
    if (txId != null) this.data.grantedTx.push(txId);
    this._commit(src, d, txId);
    return { ...OK, delta: d };
  }

  equip(slot, id) {
    return this._editHotbar((bar) => equipInto(bar, this.slotCount(), slot, id, this.config, this.count(id)));
  }

  unequip(slot) {
    return this._editHotbar((bar) => {
      if (!Number.isInteger(slot) || slot < 0 || slot >= this.slotCount()) return fail('locked');
      bar[slot] = null;
      return OK;
    });
  }

  swapSlots(a, b) {
    return this._editHotbar((bar) => swapInto(bar, this.slotCount(), a, b));
  }

  // 다음 층 예약 켜기/끄기 - 켤 때는 개수 확인만(소모는 consumeReservations).
  setReserve(id, on) {
    if (this.config?.items[id]?.group !== 'preFloor') return fail('notEquipable');
    if (on && !this.has(id)) return fail('noStock');
    this.data.loadout.preFloor[id] = !!on;
    this._commit(null, null);
    return OK;
  }

  // 층이 실제로 시작될 때만. 켜 둔 예약을 1개씩 소모하고 쓴 id 목록(config 순서)을 돌려준다.
  // 1회 예약: 소모하든 0개라 못 쓰든 예약은 꺼진다.
  consumeReservations() {
    const used = [];
    const pre = this.data.loadout.preFloor;
    for (const id of Object.keys(this.config?.items ?? pre)) {
      if (!pre[id]) continue;
      pre[id] = false;
      if (!this.has(id)) continue;
      this.data.items[id] -= 1;
      used.push(id);
    }
    this._commit(null, null);
    return used;
  }

  // 층 전투 시작 - 층 중에 바꾼 장착을 이제 적용하고, 이후 변경은 다음 층으로 미룬다.
  beginFloor() {
    this.inFloor = true;
    this._applyPending();
  }

  // 층 끝(클리어 팝업, 메뉴 복귀·재도전 대기) - 이제부터 장착 변경은 즉시. 패배 팝업은 층 진행 중으로 친다.
  endFloor() {
    this.inFloor = false;
    this._applyPending();
  }

  // ---------- 내부 ----------
  _applyPending() {
    const lo = this.data.loadout;
    if (!lo.pendingHotbar) return;
    lo.hotbar = lo.pendingHotbar;
    lo.pendingHotbar = null;
    this._commit(null, null);
  }

  _editHotbar(fn) {
    const lo = this.data.loadout;
    const bar = this.inFloor ? (lo.pendingHotbar ?? lo.hotbar).slice() : lo.hotbar;
    const res = fn(bar);
    if (!res.ok) return res;
    if (this.inFloor) lo.pendingHotbar = bar;
    this._commit(null, null);
    return this.inFloor ? { ...res, pending: true } : res;
  }

  // 번들을 실제로 넣고 log용 변화량 d를 돌려준다. 넘친 아이템은 d.over에.
  _applyBundle(bundle = {}) {
    const d = {};
    if (bundle.gold) {
      this.wallet.gold += bundle.gold;
      d.gold = bundle.gold;
    }
    if (bundle.diamonds) {
      this.wallet.diamonds += bundle.diamonds;
      d.diamonds = bundle.diamonds;
    }
    const firstTime = [];
    for (const [id, n] of Object.entries(bundle.items ?? {})) {
      if (!(id in this.data.items)) firstTime.push(id);
      const { added, over } = addCapped(this.data.items, id, n);
      d[id] = (d[id] ?? 0) + added;
      if (over) (d.over ??= {})[id] = over;
    }
    for (const [key, v] of Object.entries(bundle.skills ?? {})) {
      const lv = nextSkillLevel(this.skillLevel(key), v);
      this.data.perm.skills[key] = lv;
      (d.skills ??= {})[key] = lv;
    }
    for (const flag of bundle.flags ?? []) {
      if (this.isUnlocked(flag)) continue;
      this.data.perm.flags.push(flag);
      (d.flags ??= []).push(flag);
    }
    if (d.flags) this._refreshView();
    // 4장 5: 처음 얻은 hotbar 아이템은 빈 칸이 있으면 자동 장착(층 중이면 다음 층부터).
    for (const id of firstTime) {
      if (this.config?.items[id]?.group !== 'hotbar' || this.count(id) < 1) continue;
      const lo = this.data.loadout;
      const bar = this.inFloor ? (lo.pendingHotbar ?? lo.hotbar).slice() : lo.hotbar;
      const empty = bar.indexOf(null);
      if (empty < 0 || empty >= this.slotCount() || bar.includes(id)) continue;
      bar[empty] = id;
      if (this.inFloor) lo.pendingHotbar = bar;
    }
    return d;
  }

  // src가 있으면 log 1줄(최근 LOG_MAX건). 그 다음 화면 갱신 + 저장.
  _commit(src, d, txId = null) {
    if (src != null && d) {
      const entry = { t: this._clock(), src, d };
      if (txId != null) entry.tx = txId;
      this.data.log.push(entry);
      if (this.data.log.length > LOG_MAX) this.data.log.splice(0, this.data.log.length - LOG_MAX);
    }
    this._refreshView();
    for (const fn of this._listeners) fn(this);
    this._save();
  }

  _refreshView() {
    this._viewSrc = this.data.loadout.hotbar;
    this._hotbarView = this._viewSrc.slice(0, this.slotCount());
  }
}
