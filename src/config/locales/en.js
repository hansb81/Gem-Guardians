// 영어 번역 사전. 키 구조는 locales/ko.js와 동일하게 맞춘다.
export const en = {
  loading: {
    default: 'Loading...',
    progress: 'Loading... {loaded}/{total}',
  },
  title: {
    subtitle: 'The Forgotten Shrine',
    tap: 'TAP TO START',
  },
  menu: {
    play: 'Play',
    icon: { attendance: 'Attend', event: 'Event', settings: 'Settings', shop: 'Shop' },
    mode: { title: 'Select Mode', normal: 'Normal Mode', competitive: 'Competitive Mode', locked: 'Locked — unlock condition TBD' },
    settings: { title: 'Settings', sfx: 'SFX', bgm: 'BGM', mute: 'Mute', unmute: 'Unmute', help: 'Help', about: 'Game Info' },
    shop: { title: 'Shop', body: 'Item list placeholder (empty)' },
    attendance: { title: 'Daily Attendance', body: 'Content placeholder (TBD)' },
    event: { title: 'Event', body: 'Content placeholder (TBD)' },
  },
  hud: {
    cascade: 'Chain x {count}',
    combo: 'COMBO x {count}',
    comboBreak: 'Combo x {count} Break!',
  },
  puzzle: {
    shuffle: 'SHUFFLE',
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
    floor: 'Floor {floor}',
  },
  popup: {
    pause: { title: 'Paused', desc: 'Battle and puzzle are paused.' },
    win: { title: 'FLOOR CLEAR', desc: 'All enemies on this floor defeated.', descGold: '+{total} Gold!' },
    lose: { title: 'DEFEATED', desc: 'The wall has fallen.' },
    towerUpgrade: {
      title: 'Tower Upgrade',
      tabLevelUp: 'Level Up',
      tabInventory: 'Inventory',
      attack: 'ATK {current} -> {next}',
      gold: 'Gold {gold}',
      holdHint: 'Hold for repeat upgrade',
      max: 'MAX',
      inventoryTitle: 'Items',
      comingSoon: 'Coming soon',
    },
    button: {
      resume: 'Resume',
      restart: 'Restart',
      exit: 'Exit',
      next: 'Next Floor',
    },
  },
};
