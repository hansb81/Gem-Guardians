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
  let summon = null;
  try {
    const manifest = loadJson(join(ROOT, 'assets', 'summon', 'manifest.json'));
    if (manifest.frameMs?.length) {
      summon = { staggerMs: manifest.staggerMs ?? 0, frameMs: manifest.frameMs, landFrame: manifest.landFrame ?? 0 };
    }
  } catch {
    summon = null;
  }
  return { balance, enemies, obstacles, floorsData, sim, battleEffects, summon };
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

const ALL_TESTS = ['t1', 't2', 't3', 't4', 't5'];
const ALL_PLAYERS = ['fast', 'normal', 'casual'];

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

  return { tests, players, seeds, floors, mods };
}

export { ALL_TESTS, ALL_PLAYERS };
