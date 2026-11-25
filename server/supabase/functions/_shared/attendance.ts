// config/attendance.json "days"·"streak"와 같은 값 - 바꿀 때 둘 다 고친다(tests/attendance.test.js가 비교).
export const ATTENDANCE_DAYS = [
  { diamonds: 10 },
  { items: { repair: 1 } },
  { diamonds: 15 },
  { items: { hourglass: 1 } },
  { diamonds: 20 },
  { items: { scythe_h: 2 } },
  { diamonds: 50, items: { rainbow: 1 }, spiritStones: 5 },
];

// 연속 출석: 연속 일수가 goal의 배수인 날 bonus를 그날 출석 보상에 더한다(att_claim).
export const ATTENDANCE_STREAK = { goal: 7, bonus: { diamonds: 30, items: { revive: 1 }, spiritStones: 5 } };
