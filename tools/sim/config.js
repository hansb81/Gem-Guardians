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
  let summon = null;
  try {
    const manifest = loadJson(join(ROOT, 'assets', 'summon', 'manifest.json'));
    if (manifest.frameMs?.length) {
      summon = { staggerMs: manifest.staggerMs ?? 0, frameMs: manifest.frameMs, landFrame: manifest.landFrame ?? 0 };
    }
  } catch {
    summon = null;
  }
  return { balance, enemies, obstacles, floorsData, sim, battleEffects, summon, skills, items, shop };
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

  return { tests, players, seeds, floors, mods, out: args.out, skills, itemPolicies, set: args.set ?? null };
}

// --set=a.b.c=1.2;x.y=3 : balance.json을 메모리에서만 덮어쓴다(제안 값 전/후 비교용, 파일은 그대로).
// HP 배율(enemyHpMul, bossMul.hpMulByFloor)은 unitStats가 매번 balance에서 읽어 floors.json 재생성 없이 반영된다.
// shortcut: hpGrowth처럼 floors.json에 미리 계산된 값은 1~100층에 반영 안 됨 - 그런 키는 T5 withBalanceOverride 방식 필요.
export function applySets(balance, setStr) {
  if (!setStr) return [];
  const done = [];
  for (const pair of setStr.split(';').map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.lastIndexOf('=');
    const keys = pair.slice(0, eq).split('.');
    const value = Number(pair.slice(eq + 1));
    if (eq < 0 || !Number.isFinite(value)) throw new Error(`--set 형식: 경로=숫자 (${pair})`);
    let obj = balance;
    for (const k of keys.slice(0, -1)) {
      if (obj[k] == null || typeof obj[k] !== 'object') throw new Error(`--set 경로 없음: ${pair}`);
      obj = obj[k];
    }
    done.push(`${keys.join('.')}: ${obj[keys.at(-1)]} -> ${value}`);
    obj[keys.at(-1)] = value;
  }
  return done;
}

export { ALL_TESTS, ALL_PLAYERS };
