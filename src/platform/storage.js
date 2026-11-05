// 저장소 인터페이스: load(key) -> value|null, save(key, value) -> void. 지금은 localStorage로
// 구현한다. 나중에 Capacitor Preferences로 교체할 때는 이 파일만 바꾸면 된다(호출부는
// storage.load/save만 사용 - localStorage를 직접 건드리지 않는다).
export const storage = {
  load(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? null : JSON.parse(raw);
    } catch {
      return null;
    }
  },
  save(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // 저장 실패(용량 초과, 프라이버시 모드 등)는 조용히 무시 - 진행은 메모리상으로 계속된다.
    }
  },
};
