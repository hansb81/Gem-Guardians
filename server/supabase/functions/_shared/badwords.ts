// 닉네임 금칙어(짧은 기본 목록). 소문자로 바꾼 닉네임에 이 글자가 들어 있으면 거절.
export const BADWORDS = [
  "운영자", "관리자", "admin", "official", "gemguardians",
  "시발", "씨발", "씨빨", "병신", "븅신", "좆", "존나", "개새", "새끼", "미친", "지랄", "엿먹",
  "섹스", "보지", "자지", "fuck", "shit", "bitch", "sex", "porn", "nigger", "cunt", "dick",
];
export const hasBadword = (s: string) => {
  const low = s.toLowerCase();
  return BADWORDS.some((w) => low.includes(w));
};
