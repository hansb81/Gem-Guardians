// 재화 바/전투 상태줄/점수바/팝업에 쓰는 색·크기. 지금은 도형+이 색만으로 그리고,
// 나중에 이미지로 바꿀 때도 draw 쪽 fallback 분기와 이 파일만 건드리면 되게 분리한다.
export const HUD_CONFIG = {
  panel: { bg: '#1b1f2a', border: '#3a4150', raised: '#272c3a', raisedBorder: '#4a5265' },
  // dim = UI 보조 글자(어두운 바탕 대비 4.5:1, palette 밖 글자 전용), title = 팝업 제목 금색.
  text: { primary: '#e8dcc0', dim: '#a59cb2', title: '#f2d264' },

  currency: {
    gold: { body: '#f2d264', border: '#c28a20' },
    diamond: { body: '#8cc4ee', border: '#386cbc' },
    // 인게임 재화 바: 아이콘 배율(16px 그림 x iconScale 논리 px), 숫자 폰트 = 바 높이 x fontRatio(최소 fontMin).
    iconScale: 1.5,
    fontRatio: 0.25,
    fontMin: 8,
  },

  popup: {
    overlayColor: 'rgba(8, 6, 12, 0.72)',
    cardBg: '#1b1f2a',
    cardBorder: '#0d0a10',
    primary: '#7a3cae',
    ghost: '#272c3a',
    winColor: '#f2d264',
    loseColor: '#ec6a6a',
    pauseColor: '#e8dcc0',
    upgradeColor: '#9cd872', // palette 녹 4단계(옛 #9fd98c는 팔레트 밖)
    disabled: '#5a6072',
    // 정비 팝업(석상/토템/보관함, docs/upgrade-popup.md 1) - 540 폭 기준 여백. 긴 폰이면 본문만 길어진다.
    sheet: { marginX: 12, top: 96, bottom: 48 },
  },
  // 토템 탭 - 잠겨 있으면 안내 화면만. false로 바꾸고 본문을 채우면 열린다.
  totemTab: { locked: true },
};
