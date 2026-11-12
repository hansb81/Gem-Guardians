// 게임 정보 화면(설정 > 게임 정보)에 보이는 버전이자 Android versionName(version)·versionCode(build)의 원본(android/app/build.gradle이 읽는다). 스토어에 올릴 때마다 build를 올린다.
export const GAME_INFO = {
  version: '0.1.0',
  build: 6,
  // 게임 정보 본문의 { link } 버튼이 여는 주소. privacy = docs/privacy.html(GitHub Pages) - 스토어 등록 양식에도 같은 주소를 적는다.
  links: { privacy: 'https://hansb81.github.io/Gem-Guardians/privacy.html' },
};
