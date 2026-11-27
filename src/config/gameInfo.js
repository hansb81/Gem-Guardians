// 게임 정보 화면(설정 > 게임 정보)에 보이는 버전이자 Android versionName(version)·versionCode(build)의 원본(android/app/build.gradle이 읽는다). 스토어에 올릴 때마다 build를 올린다.
export const GAME_INFO = {
  version: '1.0.1',
  build: 10,
  // 환불 안내 팝업의 문의 이메일 - docs/legal-src/company.json email을 tools/legal_fill.mjs가 채운다(빈 값 = [이메일] 표시).
  contactEmail: 'hankan.studio81@gmail.com',
  // 게임 정보 본문의 { link } 버튼·상점 약관/환불 팝업이 여는 주소. docs/*.html(GitHub Pages) - 스토어 등록 양식에도 같은 주소를 적는다.
  links: {
    privacy: 'https://hansb81.github.io/Gem-Guardians/privacy.html',
    terms: 'https://hansb81.github.io/Gem-Guardians/terms.html',
    refund: 'https://hansb81.github.io/Gem-Guardians/refund.html',
  },
};
