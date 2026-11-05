// 일정 시간 입력이 없을 때 보여주는 힌트(가능한 수 한 칸을 확대/축소) 설정.
export const HINT_CONFIG = {
  idleMs: 5000, // 입력이 없는 채로 이만큼 지나면 힌트가 시작된다.
  pulse: { periodMs: 700, amount: 0.18 }, // 힌트 칸의 확대/축소 사인파 주기·강도.
  glow: { color: '#ffffff', blurRatio: 0.45 }, // pulse와 같은 위상으로 은은하게 빛나는 정도.
};
