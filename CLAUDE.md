# Gem Guardians

Match-3 퍼즐 + 방치형 디펜스 게임. HTML/CSS/JS(ES Modules, 빌드 도구 없음), Canvas 렌더링.
향후 Capacitor로 Android/iOS 포팅 예정.

## 구조
- src/core: 게임 로직(보드, 매치, 특수 잼, 조합). 브라우저 API(window, document, canvas, localStorage) 사용 금지.
- src/render: Canvas 그리기와 애니메이션. core의 이벤트를 받아 표현만 한다.
- src/input: Pointer Events로 마우스·터치 통합.
- src/config: 잼 종류, 색, 이미지 경로, 보드 크기 등 교체 가능한 설정.
- tests: Node로 실행하는 core 테스트.

## 규칙
- 로직과 UI를 섞지 않는다. core는 상태 변화를 이벤트로 내보내고 render가 소비한다.
- 난수는 seed 기반 RNG만 사용한다.
- 잼 종류·리소스는 하드코딩하지 않고 config에서 읽는다.
- 화면: 상단 1/3 전투 영역, 하단 2/3 6x6 보드. 반응형, devicePixelRatio 대응.
- 모바일 성능 우선: 매 프레임 객체 생성 최소화, 불필요한 전체 다시 그리기 지양.
- 기획과 단계별 계획은 docs/plan.md docs/battle.md를 따른다. 기획에 없는 결정은 임의로 확정하지 말고 보고한다.

## Serena MCP 사용
코드 탐색과 수정은 파일 전체를 읽기보다 Serena의 심볼 단위 도구를 우선 사용한다.

- 처음 파일 구조를 파악할 때: get_symbols_overview로 클래스·함수 목록을 먼저 보고, 필요한 심볼만 find_symbol(include_body)로 읽는다.
- 함수·클래스를 수정하기 전에: find_referencing_symbols로 호출하는 곳을 확인한다. 특히 src/core의 이벤트·API를 바꿀 때는 render/input/tests의 사용처를 모두 확인한다.
- 함수 단위 수정: replace_symbol_body, insert_after_symbol / insert_before_symbol을 사용한다. 몇 줄만 고칠 때는 일반 Edit도 괜찮다.
- 이름이나 문자열 검색(예: Math.random, window., document. 사용 여부 점검): search_for_pattern.
- 새 세션에서 프로젝트가 활성화되지 않았으면 activate_project로 이 저장소를 활성화한다.
- Serena 메모리(write_memory / read_memory)에는 코드 구조 요약만 남기고, 기획과 규칙은 docs/plan.md와 이 파일을 기준으로 한다.
- Serena가 응답하지 않으면 기본 도구(Read, Grep, Edit)로 진행한다.