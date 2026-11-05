// 한국어 번역 사전. 새 언어를 추가할 때는 이 파일과 같은 구조(키 동일)로
// locales/xx.js를 만들고 src/config/i18n.js의 LOCALES에 등록한다.
export const ko = {
  loading: {
    default: 'Loading...',
    progress: 'Loading... {loaded}/{total}',
  },
  title: {
    subtitle: '잊혀진 지하 신단',
    tap: '화면을 터치하세요',
  },
  menu: {
    play: '플레이',
    icon: { attendance: '출석', event: '이벤트', settings: '설정', shop: '상점' },
    mode: { title: '모드 선택', normal: '일반 모드', competitive: '경쟁 모드', locked: '잠김 — 해금 조건 추가 예정' },
    settings: { title: '설정', sfx: '효과음', bgm: '배경음', mute: '음소거', unmute: '음소거 해제', help: '도움말', about: '게임 정보' },
    shop: { title: '상점', body: '상품 목록 자리 (빈 목록)' },
    attendance: { title: '출석 체크', body: '콘텐츠 자리 (추후 결정)' },
    event: { title: '이벤트', body: '콘텐츠 자리 (추후 결정)' },
  },
  hud: {
    cascade: '연쇄 x {count}',
    combo: 'COMBO x {count}',
    comboBreak: 'Combo x {count} Break!',
  },
  puzzle: {
    shuffle: '섞는 중',
  },
  combo: {
    tier: {
      good: 'Good!',
      great: 'Great!',
      amazing: 'Amazing!',
      incredible: 'Incredible!',
    },
  },
  battle: {
    floor: '{floor}층',
  },
  popup: {
    pause: { title: '일시정지', desc: '전투와 퍼즐이 멈춘 상태입니다.' },
    win: { title: 'FLOOR CLEAR', desc: '층의 적을 모두 처치했습니다.', descGold: '골드 {total} 획득!' },
    lose: { title: 'DEFEATED', desc: '성벽이 무너졌습니다.' },
    towerUpgrade: {
      title: '타워 강화',
      tabLevelUp: '레벨업',
      tabInventory: '인벤토리',
      attack: '공격 {current} → {next}',
      gold: '보유 골드 {gold}',
      holdHint: '꾹 누르면 연속 강화',
      max: 'MAX',
      inventoryTitle: '보유 아이템',
      comingSoon: '추후 업데이트',
    },
    button: {
      resume: '계속하기',
      restart: '다시 하기',
      exit: '나가기',
      next: '다음 층',
    },
  },
};
