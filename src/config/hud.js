// 재화 바/전투 상태줄/점수바/팝업에 쓰는 색·크기. 지금은 도형+이 색만으로 그리고,
// 나중에 이미지로 바꿀 때도 draw 쪽 fallback 분기와 이 파일만 건드리면 되게 분리한다.
export const HUD_CONFIG = {
  panel: { bg: '#1b1f2a', border: '#3a4150', raised: '#272c3a', raisedBorder: '#4a5265' },
  text: { primary: '#e8dcc0', dim: '#8a8296' },

  currency: {
    gold: { body: '#f2d264', border: '#c28a20' },
    diamond: { body: '#8cc4ee', border: '#386cbc' },
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
    upgradeColor: '#9fd98c',
    disabled: '#5a6072',
  },
};
