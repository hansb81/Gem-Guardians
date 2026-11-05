// 여러 독립된 난수 스트림(보드 RNG / 봇 결정 RNG / 후보 평가용 clone RNG)을 같은 기본
// seed에서 서로 간섭 없이 파생시키기 위한 해시. createRng(seed)에 그대로 넘긴다.
export function deriveSeed(...parts) {
  let s = 0x9e3779b9;
  for (const p of parts) {
    s = Math.imul(s ^ (p >>> 0), 2654435761) >>> 0;
  }
  return s >>> 0;
}
