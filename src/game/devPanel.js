// 개발용 패널(?dev=1에서만 생성) - 밸런스를 직접 확인하려고 쓰는 것(docs/balance.md §5).
// 층 이동, 골드 +10000, 탑 레벨 일괄 설정, 2배속. 캔버스가 아니라 평범한 DOM 오버레이로
// 만든다(디버그 전용이라 스타일을 들일 필요가 없다).
export function setupDevPanel(controller, { setTimeScale, getTimeScale, triggerSpecialFx, triggerShuffle }) {
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

  panel.append(floorInput, floorGo, goldBtn, levelInput, levelGo, speedLabel);

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

  // 셔플 연출(§셔플 애니메이션) 확인용 - 가능한 수가 있어도 강제로 셔플을 한 번 재생한다.
  if (triggerShuffle) {
    const shuffleBtn = document.createElement('button');
    shuffleBtn.textContent = '셔플 테스트';
    shuffleBtn.onclick = () => triggerShuffle();
    panel.append(shuffleBtn);
  }

  document.body.appendChild(panel);
}
