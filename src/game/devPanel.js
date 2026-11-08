import { playerState } from './playerState.js';

// 개발용 패널(?dev=1에서만 생성) - 밸런스를 직접 확인하려고 쓰는 것(docs/balance.md §5).
// 층 이동, 골드 +10000, 탑 레벨 일괄 설정, 2배속. 캔버스가 아니라 평범한 DOM 오버레이로
// 만든다(디버그 전용이라 스타일을 들일 필요가 없다).
// 조합 10종(assets/effects/combos) - [라벨, 왼쪽 잼, 오른쪽 잼]. 왼쪽/오른쪽을 보드에 심고
// 스왑하면 core가 조합 종류를 알아서 판정한다(src/core/specials.js resolveSpecialCombo).
const COMBO_PAIRS = [
  ['라인+라인', 'line', 'line'],
  ['라인+폭탄', 'line', 'bomb'],
  ['폭탄+폭탄', 'bomb', 'bomb'],
  ['컬러+라인', 'color', 'line'],
  ['컬러+폭탄', 'color', 'bomb'],
  ['컬러+컬러', 'color', 'color'],
  ['박스+박스', 'box', 'box'],
  ['박스+라인', 'box', 'line'],
  ['박스+폭탄', 'box', 'bomb'],
  ['박스+컬러', 'box', 'color'],
];

const SKILL_COLORS = ['red', 'blue', 'yellow', 'green', 'purple'];
// [라벨, specialType] - config/skills.json specialGemToSkill 키.
const SKILL_BUTTONS = [
  ['가시', 'line_h'],
  ['용암탄', 'bomb'],
  ['영혼 불꽃', 'box'],
  ['궁극기', 'color'],
  ['대폭발', 'color_color'],
];

export function setupDevPanel(controller, { setTimeScale, getTimeScale, triggerSpecialFx, triggerCombo, triggerShuffle, ranking = null }) {
  const panel = document.createElement('div');
  panel.style.cssText =
    'position:fixed;top:0;left:0;z-index:9999;background:rgba(0,0,0,0.75);color:#fff;' +
    'font:11px monospace;padding:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap;max-width:100vw;';

  const floorInput = document.createElement('input');
  floorInput.type = 'number';
  floorInput.min = '1';
  floorInput.style.width = '4em';
  floorInput.value = String(controller.floor);
  const floorGo = document.createElement('button');
  floorGo.textContent = '층 이동';
  floorGo.onclick = () => controller.devSetFloor(Number(floorInput.value) || 1);

  const goldBtn = document.createElement('button');
  goldBtn.textContent = '+10000G';
  goldBtn.onclick = () => controller.devAddGold(10000);

  const itemsBtn = document.createElement('button');
  itemsBtn.textContent = '아이템 전부 +5';
  itemsBtn.onclick = () => controller.devAddAllItems(5);

  const levelInput = document.createElement('input');
  levelInput.type = 'number';
  levelInput.min = '1';
  levelInput.style.width = '4em';
  levelInput.value = '1';
  const levelGo = document.createElement('button');
  levelGo.textContent = '탑 레벨 일괄';
  levelGo.onclick = () => controller.devSetAllTowerLevels(Number(levelInput.value) || 1);

  const speedLabel = document.createElement('label');
  const speedCheck = document.createElement('input');
  speedCheck.type = 'checkbox';
  speedCheck.checked = getTimeScale() !== 1;
  speedCheck.onchange = () => setTimeScale(speedCheck.checked ? 2 : 1);
  speedLabel.append(speedCheck, '2x');
  const slowLabel = document.createElement('label');
  const slowCheck = document.createElement('input');
  slowCheck.type = 'checkbox';
  slowCheck.onchange = () => setTimeScale(slowCheck.checked ? 0.25 : 1);
  slowLabel.append(slowCheck, '0.25x');

  // 2차 아이템 연출 확인용 - 북 버프(남은 스왑 99), 부활 연출(실패 없이 이벤트+정지만).
  const drumBtn = document.createElement('button');
  drumBtn.textContent = '북 버프 켜기';
  drumBtn.onclick = () => {
    const items = controller.items;
    const cfg = controller.itemsConfig?.items.drum;
    if (!items || !cfg) return;
    items.buff = { id: 'drum', swapsLeft: 99, lastSwapCount: items.gameState?.validSwapCount ?? 0 };
    controller.battleState.setAtkBuff(cfg.mul);
  };
  const reviveBtn = document.createElement('button');
  reviveBtn.textContent = '부활 연출 재생';
  reviveBtn.onclick = () => {
    const bs = controller.battleState;
    const cfg = controller.itemsConfig?.items.revive;
    bs._pushEvent('wallRevived', { amount: bs.wallHealth, remainingHealth: bs.wallHealth });
    bs.freezeEnemies(cfg?.freezeSec ?? 2, cfg?.bossMul ?? 1);
  };

  // 인벤토리(docs/inventory.md) - 최근 지급·차감 로그 50건 보기, 저장을 v1 형식으로 되돌린 뒤 새로고침해 마이그레이션 재실행.
  const logPre = document.createElement('pre');
  logPre.style.cssText = 'display:none;width:100%;max-height:40vh;overflow:auto;margin:0;font:10px monospace;';
  const logBtn = document.createElement('button');
  logBtn.textContent = '인벤토리 로그';
  logBtn.onclick = () => {
    const show = logPre.style.display === 'none';
    logPre.style.display = show ? 'block' : 'none';
    if (!show) return;
    const lines = playerState.inventory.data.log.map((e) => `${new Date(e.t * 1000).toLocaleString()} ${e.src}${e.tx ? ` [${e.tx}]` : ''} ${JSON.stringify(e.d)}`);
    logPre.textContent = lines.reverse().join('\n') ||'(비어 있음)';
  };
  const v1Btn = document.createElement('button');
  v1Btn.textContent = '저장 v1로 되돌려 마이그레이션';
  v1Btn.onclick = () => {
    playerState.devRevertSaveToV1();
    location.reload(); // 새로고침 전에 다른 save()가 덮어쓰지 않게 바로.
  };

  panel.append(floorInput, floorGo, goldBtn, itemsBtn, levelInput, levelGo, speedLabel, slowLabel, drumBtn, reviveBtn, logBtn, v1Btn);

  // assets/effects 스프라이트 확인용 - 보드 가운데 칸에서 line/bomb/box/color 발동을
  // 하나씩 강제로 재생해본다(core 매치 규칙 없이, CanvasRenderer._spawnSpecialFx만 확인).
  if (triggerSpecialFx) {
    for (const [label, kind] of [['라인 터뜨리기', 'line'], ['폭탄 터뜨리기', 'bomb'], ['박스 터뜨리기', 'box'], ['컬러 터뜨리기', 'color']]) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.onclick = () => triggerSpecialFx(kind);
      panel.append(btn);
    }
  }

  // 조합 연출(manifest.combo) 확인용 - 보드 가운데에 두 특수 잼을 심고 실제로 스왑한다.
  if (triggerCombo) {
    for (const [label, kindA, kindB] of COMBO_PAIRS) {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.onclick = () => triggerCombo(kindA, kindB);
      panel.append(btn);
    }
  }

  // 셔플 연출(§셔플 애니메이션) 확인용 - 가능한 수가 있어도 강제로 셔플을 한 번 재생한다.
  if (triggerShuffle) {
    const shuffleBtn = document.createElement('button');
    shuffleBtn.textContent = '셔플 테스트';
    shuffleBtn.onclick = () => triggerShuffle();
    panel.append(shuffleBtn);
  }

  // 젬 기술 v3 이펙트(assets/skills) 확인용 - 현재 전투에 기술/색 효과/면역을 직접 건다.
  const colorSelect = document.createElement('select');
  for (const c of SKILL_COLORS) colorSelect.append(new Option(c, c));
  panel.append(colorSelect);
  for (const [label, specialType] of SKILL_BUTTONS) {
    const btn = document.createElement('button');
    btn.textContent = label;
    // count 0 = 기본 사격 없이 기술만(applyGemClear 설명). 무지개는 고른 색을 chosenColor로.
    btn.onclick = () => controller.battleState?.applyGemClear(colorSelect.value, 0, 1, true, specialType, colorSelect.value);
    panel.append(btn);
  }
  const effectsBtn = document.createElement('button');
  effectsBtn.textContent = '색 효과 5종 걸기';
  effectsBtn.onclick = () => {
    const bs = controller.battleState;
    for (const e of bs?.enemies ?? []) {
      if (e.state !== 'alive') continue;
      for (const c of SKILL_COLORS) bs._applyColorEffect(e, c, 10); // dev 전용 - core 내부 함수 직접 호출.
    }
  };
  const immuneBtn = document.createElement('button');
  immuneBtn.textContent = '보스 면역 토글';
  // 살아 있는 적 전부: 면역 = 고른 색, 약점 = 다음 색. 다시 누르면 해제.
  immuneBtn.onclick = () => {
    const alive = (controller.battleState?.enemies ?? []).filter((e) => e.state === 'alive');
    const on = !alive.some((e) => e.immune.length > 0);
    const c = colorSelect.value;
    const weak = SKILL_COLORS[(SKILL_COLORS.indexOf(c) + 1) % SKILL_COLORS.length];
    for (const e of alive) {
      e.immune = on ? [c] : [];
      e.weak = on ? [weak] : [];
    }
  };
  panel.append(effectsBtn, immuneBtn, logPre);
  if (ranking) appendRankingDev(panel, ranking);

  document.body.appendChild(panel);
}

// 랭킹(docs/ranking.md) - 가짜 명단 켜기/끄기, 경쟁 탭 상태 1~4, 시각 앞당기기(정산 대기·초기화), 지난 시즌 결과, 닉네임 초기화.
// ranking = RankingUi.dev(). 메뉴에서 원석을 눌러 확인한다.
function appendRankingDev(panel, ranking) {
  const btn = (text, fn) => {
    const b = document.createElement('button');
    b.textContent = text;
    b.onclick = () => fn(b);
    panel.append(b);
    return b;
  };
  btn('랭킹 가짜명단 끄기', (b) => {
    b.textContent = ranking.toggleFake() ? '랭킹 가짜명단 끄기' : '랭킹 가짜명단 켜기';
  });
  const state = document.createElement('select');
  [['0', '경쟁탭 자동'], ['1', '1 평소'], ['2', '2 정산 대기'], ['3', '3 잠김'], ['4', '4 기록 없음']].forEach(([v, l]) => state.append(new Option(l, v)));
  state.onchange = () => ranking.setCompState(state.value);
  panel.append(state);
  btn('시각 +1시간', () => ranking.advance(3600e3));
  btn('정산 대기로', () => ranking.advance('settle'));
  btn('시즌 초기화 5초 전', () => ranking.advance('reset'));
  btn('지난 시즌 결과', () => ranking.showLastResult());
  btn('닉네임 초기화', () => ranking.resetNickname());
}
