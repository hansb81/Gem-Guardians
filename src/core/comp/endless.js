// 경쟁 모드 무한 웨이브와 점수(docs/ranking.md 5장). 브라우저 API 금지 - 데이터는 전부 인자로 받는다.
// 웨이브 n = 층 생성기(genFloor)로 만든 "난이도 층" waveFloor(n)의 적 구성 하나(주간 시드로 섞음).
// 성벽은 웨이브 사이에 초기화되지 않고 healPct만 회복한다 - 웨이브가 갈수록 강해져 언젠가 무너진다.
import { genFloor, resolveFloorSpawns } from '../balance/floorGen.js';

// cfg = config/ranking.json comp. 난이도 층 = startFloor + floor((n-1) x floorsPerWave), rampFrom 웨이브부터는 x rampMul 빠르게.
export function waveFloor(cfg, n) {
  const e = cfg.endless;
  const slow = Math.min(n, e.rampFrom ?? Infinity) - 1;
  const fast = Math.max(0, n - (e.rampFrom ?? Infinity));
  return e.startFloor + Math.floor(slow * e.floorsPerWave + fast * e.floorsPerWave * (e.rampMul ?? 1));
}

// data = { balance, enemies, obstacles }. 반환 = battleState nextWave 모양 + floor(장애물·성벽용).
export function makeWave(data, cfg, seed, n) {
  const floor = genFloor(data.balance, data.enemies, data.obstacles, waveFloor(cfg, n), (seed ^ Math.imul(n, 0x9e3779b1)) >>> 0 || 1);
  const bm = cfg.endless.bossHpMul ?? 1; // 보스 웨이브가 넘을 수 없는 벽이 되지 않게(T8)
  const spawns = resolveFloorSpawns(data.balance, data.enemies, floor).map((st) => (st.rank === 'boss' && bm !== 1 ? { ...st, hp: Math.round(st.hp * bm) } : st));
  return { floor, spawns, spawnAt: floor.spawnAt.slice(), healPct: cfg.endless.wallHealPct };
}

// BattleState resolvedFloor - 1웨이브 + 이후 웨이브 생성기. 성벽 = 1웨이브 난이도 층의 성벽.
export function endlessFloor(data, cfg, seed, base = {}) {
  const w1 = makeWave(data, cfg, seed, 1);
  return {
    floor: w1.floor,
    resolved: { ...base, wallHp: w1.floor.wallHp, interval: w1.floor.spawnInterval, spawnAt: w1.spawnAt, spawns: w1.spawns, waveGapSec: cfg.endless.waveGapSec, nextWave: (n) => makeWave(data, cfg, seed, n) },
  };
}

// 처치 점수: 역할별 표(보스는 boss), 엘리트는 x eliteMul.
export function killPoints(cfg, enemies, type, rank) {
  const kp = cfg.score.killPoints;
  if (rank === 'boss') return kp.boss;
  const p = kp[enemies.monsters[type]?.role] ?? 0;
  return rank === 'elite' ? p * cfg.score.eliteMul : p;
}

// 판 점수 누적기. 게임·시뮬이 battleState 이벤트를 넘긴다.
export function createScore(cfg, enemies) {
  const s = { wave: 1, kills: 0, wallBonus: 0 };
  return {
    s,
    onKill(type, rank) {
      s.kills += killPoints(cfg, enemies, type, rank);
    },
    // 새 웨이브 시작 = 앞 웨이브를 버텼다: 그때 남은 성벽 비율 x wallBonus.
    onWave(wave, wallRatio) {
      s.wave = wave;
      s.wallBonus += Math.round(Math.max(0, Math.min(1, wallRatio)) * cfg.score.wallBonus);
    },
    get total() {
      return s.wave * cfg.score.perWave + s.kills + s.wallBonus;
    },
  };
}

// 웨이브 n의 최대 점수(도달 + 그 웨이브 적 전부 처치 + 성벽 보너스 만점). 서버 상한 표(tools/gen_comp_limits.mjs)가 쓴다.
export function waveMaxPoints(data, cfg, seed, n) {
  const w = makeWave(data, cfg, seed, n);
  let kills = 0;
  for (const st of w.spawns) kills += killPoints(cfg, data.enemies, st.type, st.rank);
  return cfg.score.perWave + cfg.score.wallBonus + kills;
}

// 판 입력 기록(rank-comp-finish log) - 서버 재계산 검증(TODO)에 쓸 원본. t = 판 시작 후 ms(전투 시계).
// s = 스왑 [t, r1, c1, r2, c2], i = 아이템 [t, id, target]. 서버 LOG_MAX(64KB)를 넘지 않게 MAX_INPUTS개에서 자르고 truncated 표시.
export const MAX_INPUTS = 2500;
export function createInputLog(seed) {
  const log = { v: 1, seed, s: [], i: [], truncated: false };
  return {
    log,
    add(kind, tSec, data) {
      if (log.s.length + log.i.length >= MAX_INPUTS) {
        log.truncated = true;
        return;
      }
      log[kind].push([Math.round(tSec * 1000), ...data]);
    },
  };
}

// 경쟁 모드 입구 잠금(메뉴 모드 버튼·랭킹 탭 경쟁 항목이 같은 판정을 쓴다 - main.js compStatus).
// rankingCfg = config/ranking.json. compUnlocked가 true가 아니면 출시 전이라 항상 잠김(층·연결과 상관없이).
// 반환 = null(열림 조건 통과) 또는 { hint: 문구 키, params }.
export function compLock(rankingCfg, bestFloor, online) {
  if (!rankingCfg?.comp || rankingCfg.compUnlocked !== true) return { hint: 'comp.soon', params: null };
  const floor = rankingCfg.comp.unlockBestFloor ?? 20;
  if (bestFloor < floor) return { hint: 'comp.lockedFloor', params: { floor } };
  if (!online) return { hint: 'comp.offline', params: null };
  return null;
}
