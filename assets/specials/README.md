# 특수 잼 오버레이 이미지

경로는 `assets/manifest.json`에서 읽는다.

- `specialOverlays.line_h` / `line_v`: 라인 잼의 가로/세로 오버레이. 하나의 이미지를
  회전시키지 않고 방향마다 별도 파일로 둔다(방향이 명확히 보여야 하므로). 색 잼 이미지
  위에 겹쳐서 합성된다.
- `specialOverlays.bomb`: 폭탄 잼 오버레이. 마찬가지로 색 잼 이미지 위에 겹쳐진다.
- `specialOverlays.box`: 박스 잼 오버레이. 2x2 격자 느낌의 흰 틀. 마찬가지로 색 잼 이미지
  위에 겹쳐진다.
- `color`: 컬러 잼 전용 단일 이미지(오버레이가 아니라 그 자체로 완성된 이미지).
- `specialPerColor`(`assets/manifest.json`의 선택 항목): `"${colorId}_${overlayKey}"`
  (예: `red_bomb`, `red_line_h`) 키로 색별 전용 특수 잼 이미지를 지정할 수 있다. 지정돼
  있으면 오버레이 합성 대신 그 이미지를 그대로 쓴다. 지금은 비어있다.

파일이 없거나 로드에 실패하면 렌더러가 기존 색 도형(링/막대)으로 대체한다.

현재 들어있는 파일(임시 SVG):

- line_h.svg
- line_v.svg
- bomb.svg
- box.svg
- color.svg
