// 연출 타이밍 JSON(effectDurationsMs)만 읽는다. 탑 정체성(색/이름/투사체 모양)과 모든
// 밸런스 숫자는 config/balance.json 하나에 있다(docs/balance.md §2·§12, loadBalanceData.js가
// 읽음) - towersBaseData는 balanceData.balance.tower.towers를 그대로 쓰면 된다. 실패하면
// null - main.js는 null이면 전투를 아예 띄우지 않고 퍼즐만 정상 동작시킨다.
async function fetchJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

// assets/summon/manifest.json - 석상 소환 연출의 타이밍(staggerMs/frameMs/landFrame)만
// BattleState(core/battle 쪽)가 읽는다(이미지 로딩은 render/assetLoader.js가 따로 함).
// 실패해도(없거나 fetch 에러) 전투 전체를 막으면 안 되므로 null로 돌려주고, BattleState는
// summon이 null이면 연출 없이 즉시 비활성 처리한다(에셋 로더의 "로딩 실패 시 바로 보여주기"
// 와 같은 원칙).
async function fetchSummonConfig() {
  try {
    const res = await fetch('assets/summon/manifest.json');
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.frameMs?.length) return null;
    return { staggerMs: json.staggerMs ?? 0, frameMs: json.frameMs, landFrame: json.landFrame ?? 0 };
  } catch {
    return null;
  }
}

export async function loadBattleData() {
  try {
    const battleJson = await fetchJson('src/config/battle.json');
    const summon = await fetchSummonConfig();
    return { effectDurationsMs: battleJson.effectDurationsMs, summon };
  } catch {
    return null;
  }
}
