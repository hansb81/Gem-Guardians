// 잼 종류 설정. 새 종류를 추가하려면 이 배열에 항목을 추가하고 assets/manifest.json의
// gems에 같은 id로 이미지 경로를 추가하면 된다(코드 수정 불필요).
// 이미지가 없거나 로드에 실패하면 렌더러가 color로 도형을 그려 대체한다.
export const GEM_TYPES = [
  { id: 'red', name: '빨강', color: '#e74c3c' },
  { id: 'blue', name: '파랑', color: '#3498db' },
  { id: 'yellow', name: '노랑', color: '#f1c40f' },
  { id: 'green', name: '녹색', color: '#2ecc71' },
  { id: 'purple', name: '보라', color: '#9b59b6' },
];
