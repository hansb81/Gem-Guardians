// config/*.json + sim.json 로더, CLI 인자 파서. 브라우저 API 없음(fetch 대신 readFileSync) -
// loadBalanceData.js/loadBattleData.js와 같은 데이터를 Node에서 그대로 읽는다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..');
const CFG = join(ROOT, 'config');

function loadJson(absPath) {
  return JSON.parse(readFileSync(absPath, 'utf8'));
}

export function loadConfigs() {
  const balance = loadJson(join(CFG, 'balance.json'));
  const enemies = loadJson(join(CFG, 'enemies.json'));
  const obstacles = loadJson(join(CFG, 'obstacles.json'));
  const floorsData = loadJson(join(CFG, 'floors.json'));
  const sim = loadJson(join(CFG, 'sim.json'));
  const battleEffects = loadJson(join(ROOT, 'src', 'config', 'battle.json'));
  const skills = loadJson(join(CFG, 'skills.json'));
  const items = loadJson(join(CFG, 'items.json'));
  const shop = loadJson(join(CFG, 'shop.json'));
  const attendance = loadJson(join(CFG, 'attendance.json'));
  let summon = null;
  try {
    const manifest = loadJson(join(ROOT, 'assets', 'summon', 'manifest.json'));
    if (manifest.frameMs?.length) {
      summon = { staggerMs: manifest.staggerMs ?? 0, frameMs: manifest.frameMs, landFrame: manifest.landFrame ?? 0 };
    }
  } catch {
    summon = null;
  }
  return { balance, enemies, obstacles, floorsData, sim, battleEffects, summon, skills, items, shop, attendance };
}

function parseList(str) {
  return str.split(',').map((s) => s.trim()).filter(Boolean);
}

function parseFloorRange(str, fallback) {
  if (!str) return fallback;
  const m = /^(\d+)(?:-(\d+))?$/.exec(str.trim());
  if (!m) return fallback;
  const from = Number(m[1]);
  const to = m[2] ? Number(m[2]) : from;
  return { from, to };
}

const ALL_TESTS = ['t1', 't2', 't2s', 't3', 't4', 't5', 't6', 't7'];
export const SKILL_MODES = ['shop', 'shop-free', 'none', 'color', 'special', 'all', 'all+boss'];
export const SKILL_BUY = ['none', 'balanced', 'max'];
export const EMPTY_SPAWN = ['off', 'on', 'predict'];
// --emptySpawn=off|on|predict (없으면 null = 기본값)
function emptySpawnArg(v) {
  if (v != null && !EMPTY_SPAWN.includes(v)) throw new Error(`--emptySpawn은 ${EMPTY_SPAWN.join('|')}: ${v}`);
  return v ?? null;
}
export const ITEM_POLICIES = ['none', 'boss', 'always'];
const ALL_PLAYERS = ['fast', 'normal', 'slow', 'worst'];

// --key=value 형태만 지원한다(이 도구 전용 CLI라 그 이상은 필요 없음).
export function parseArgs(argv, sim) {
  const args = {};
  for (const raw of argv) {
    const m = /^--([^=]+)=(.*)$/.exec(raw);
    if (m) args[m[1]] = m[2];
  }

  const testArg = args.test ?? 'all';
  const tests = testArg === 'all' ? ALL_TESTS : parseList(testArg).map((s) => s.toLowerCase());

  const playerArg = args.player ?? 'all';
  const players = playerArg === 'all' ? ALL_PLAYERS : parseList(playerArg);

  const seeds = args.seeds ? Number(args.seeds) : sim.seeds;
  const floors = parseFloorRange(args.floors, { from: 1, to: 100 });
  const mods = args.mod ? parseList(args.mod) : null; // null이면 테스트별 기본값을 쓴다.
  // --skills=none|color|special|all|all+boss: 실제 젬 기술(config/skills.json). shop = 게임 그대로(all+boss + A안 해금 일정, 진행에선 해금 골드 차감, 기본). shop-free = 해금 골드 없이. all+boss = 전부 열림(v9 기준, 비교용).
  const skills = args.skills ?? 'shop';
  if (!SKILL_MODES.includes(skills)) throw new Error(`--skills는 ${SKILL_MODES.join('|')} 중 하나: ${skills}`);
  // --items=none,boss,always (T6 구매 정책 목록).
  const itemPolicies = args.items ? parseList(args.items) : ITEM_POLICIES;

  // S2 스킬 레벨 구매(T4 진행, --skills=shop에서만): none | balanced(누적 수입의 skillshare 미만일 때만) | max(스킬 먼저).
  const skillBuy = args.skillbuy ?? 'balanced';
  if (!SKILL_BUY.includes(skillBuy)) throw new Error(`--skillbuy는 ${SKILL_BUY.join('|')}: ${skillBuy}`);
  // --skillgate=N: 최대 Lv = base + floor(최고 층/N), off = 상한 maxLevel. 없으면 shop.json skills.maxLevelByFloor(있을 때), 없으면 off.
  const skillGate = args.skillgate == null ? null : args.skillgate === 'off' ? 'off' : Number(args.skillgate);
  const skillShare = args.skillshare != null ? Number(args.skillshare) : 0.15;
  // S3 다이아·광고: --dia=none|f2p(출석 다이아로 보스 패배 시 깃털), --ads=on|off(패배 시 광고 이어하기), --minutesPerDay=30.
  const dia = args.dia ?? 'none';
  const ads = args.ads ?? 'off';
  if (!['none', 'f2p'].includes(dia) || !['on', 'off'].includes(ads)) throw new Error('--dia=none|f2p, --ads=on|off');
  const minutesPerDay = Number(args.minutesPerDay ?? 30);
  // --strategy=even,byUse : T4/T3 레벨업 전략 목록(없으면 sim.json levelStrategies.list).
  const strategies = args.strategy ? parseList(args.strategy) : null;
  // --towerbuy=always(기본, 층이 끝날 때마다 탑 레벨업) | onfail(실패했을 때만 - v12-6까지의 방식, 참고용). T4와 T4 진행을 쓰는 T3·T5·T6·T7.
  const towerBuy = args.towerbuy ?? 'always';
  if (!['always', 'onfail'].includes(towerBuy)) throw new Error(`--towerbuy는 always|onfail: ${towerBuy}`);
  return { towerBuy, tests, players, seeds, floors, mods, out: args.out, skills, itemPolicies, set: args.set ?? null, skillBuy, skillGate, skillShare, dia, ads, minutesPerDay, strategies, skillLvAll: args.skilllv ? Number(args.skilllv) : null, flight: args.flight === 'on', emptySpawn: emptySpawnArg(args.emptySpawn) };
}

// --set=a.b.c=1.2;x.y=3 : config를 메모리에서만 덮어쓴다(제안 값 전/후 비교용, 파일은 그대로).
// 첫 칸이 파일 이름(balance/shop/skills/items/enemies/obstacles/sim)이면 그 config, 아니면 balance.json.
// 배열은 번호 또는 원소의 id/item 값으로 찾는다(shop.goldExchange.small.floors, shop.itemBundles.hammer.dia).
// 값 = 숫자 또는 숫자 배열(JSON, 예: shop.skills.levelCost=[0.75,0.75,0.75,0.75]). 없는 경로·키는 에러.
// HP 배율(enemyHpMul, bossMul.hpMulByFloor)은 unitStats가 매번 balance에서 읽어 floors.json 재생성 없이 반영된다.
// shortcut: hpGrowth처럼 floors.json에 미리 계산된 값은 1~100층에 반영 안 됨 - 그런 키는 T5 withBalanceOverride 방식 필요.
export const SET_FILES = ['balance', 'shop', 'skills', 'items', 'enemies', 'obstacles', 'sim'];
export function applySets(configs, setStr) {
  if (!setStr) return [];
  const done = [];
  for (const pair of setStr.split(';').map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.lastIndexOf('=');
    if (eq < 0) throw new Error(`--set 형식: 경로=값 (${pair})`);
    let keys = pair.slice(0, eq).split('.');
    let value;
    try {
      value = JSON.parse(pair.slice(eq + 1));
    } catch {
      value = NaN;
    }
    const ok = (v) => typeof v === 'number' && Number.isFinite(v);
    if (!(ok(value) || (Array.isArray(value) && value.every(ok)))) throw new Error(`--set 값은 숫자 또는 숫자 배열: ${pair}`);
    const file = SET_FILES.includes(keys[0]) && keys.length > 1 ? keys[0] : 'balance';
    if (file === keys[0]) keys = keys.slice(1);
    const step = (obj, k) => (Array.isArray(obj) && !/^\d+$/.test(k) ? obj.find((e) => e?.id === k || e?.item === k) : obj?.[k]);
    let obj = configs[file];
    for (const k of keys.slice(0, -1)) {
      obj = step(obj, k);
      if (obj == null || typeof obj !== 'object') throw new Error(`--set 경로 없음: ${pair}`);
    }
    const last = keys.at(-1);
    if (!(last in obj)) throw new Error(`--set 키 없음: ${pair}`);
    done.push(`${file}.${keys.join('.')}: ${JSON.stringify(obj[last])} -> ${JSON.stringify(value)}`);
    obj[last] = value;
  }
  return done;
}

export { ALL_TESTS, ALL_PLAYERS };
