// 특수 잼 종류별 표시 설정(이름/idle 애니메이션). 키는 src/core/specials.js의 SPECIAL_KIND
// 값과 맞춰야 한다('line' | 'bomb' | 'color' | 'box'). 이미지 경로는 assets/manifest.json에서 읽고
// (없거나 로드 실패하면 렌더러가 임시 도형으로 그린다), idle은 가만히 있을 때의 미세 애니메이션.
// idle.type: 'shimmer'(약한 회전 하이라이트)만 남음 - 확대/축소(pulse)는 힌트 전용으로
// 옮겨졌다(src/config/hint.js, canvasRenderer._drawGem의 hintScale 참고).
export const SPECIAL_GEM_CONFIG = {
  line: { name: '라인', idle: null },
  bomb: { name: '폭탄', idle: null },
  color: { name: '컬러', idle: { type: 'shimmer', periodMs: 1400 } },
  box: { name: '박스', idle: null },
};
