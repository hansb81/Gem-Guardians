import { ko } from './locales/ko.js';
import { en } from './locales/en.js';

// 로케일 사전 등록부 - 언어를 추가할 때는 locales/에 같은 키 구조의 파일을 만들고
// 여기에만 등록하면 된다(호출부 수정 불필요).
const LOCALES = { ko, en };
const DEFAULT_LOCALE = 'ko';

let currentLocale = DEFAULT_LOCALE;

export function setLocale(locale) {
  if (LOCALES[locale]) currentLocale = locale;
}

export function getLocale() {
  return currentLocale;
}

// key: 'popup.pause.title' 같은 점 표기 경로. params에 담긴 값으로 '{name}' 플레이스홀더를 치환한다.
// 키가 없으면(번역 누락) 키 문자열 자체를 돌려줘 화면에서 바로 눈에 띄게 한다.
export function t(key, params) {
  const dict = LOCALES[currentLocale] ?? LOCALES[DEFAULT_LOCALE];
  const value = key.split('.').reduce((obj, part) => obj?.[part], dict) ?? key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, name) => params[name] ?? '');
}
