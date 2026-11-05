// "순차 폭발 타이밍" 설정. 특수 잼이 발동할 때 영향 범위의 각 칸이 즉시 한꺼번에 사라지는
// 대신, 거리/등장 순서에 따라 지연(armedMs)을 받고 그만큼 'armed' 상태로 대기한 뒤 지워진다.
// 모든 지연 값은 "한 발동" 단위로 maxDetonationMs를 넘지 않게 선형으로 스케일된다(gameState.js의
// armed 스케줄링 참고).
export const DETONATION_CONFIG = {
  lineStepMs: 40, // 라인 발동: origin에서 1차원 거리(칸) * 이 값.
  bombStepMs: 30, // 폭탄 발동: origin에서 체비셰프 거리(칸) * 이 값.
  boxStepMs: 150, // 박스 발동: 랜덤 대상들이 등장 순서대로 터지는 간격.
  transformStepMs: 40, // 변환 조합: 변환 대상들이 등장 순서대로 바뀌는 간격.
  chainArmMs: 200, // 체인으로 캐치된 특수 잼이 자기 효과를 시작하기 전 추가로 기다리는 시간.
  maxDetonationMs: 2000, // 한 발동 안에서 가장 긴 지연이 이 값을 넘지 않도록 캡.
};
