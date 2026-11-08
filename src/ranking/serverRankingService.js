// 서버 랭킹 - 아직 구현하지 않음(빈 껍데기). 부를 API는 docs/ranking.md 13장 "13-3. API" 표:
//   POST /rank/profile, POST /rank/normal, POST /rank/comp/start, POST /rank/comp/finish,
//   GET /rank/top, GET /rank/me, GET /rank/result, POST /rank/claim
// 함수 모양은 LocalRankingService(./rankingService.js 맨 위 주석)와 같다. 지금은 모두 { offline: true }.
// 바꿀 때는 rankingService.js의 createRankingService만 이 클래스로 돌린다(13-6).
export class ServerRankingService {
  constructor({ baseUrl = '' } = {}) {
    this.baseUrl = baseUrl;
  }

  async submit(_mode, _run) {
    return { offline: true }; // normal -> POST /rank/normal, comp -> POST /rank/comp/finish (runId는 /rank/comp/start에서)
  }

  async top(_mode, _opts) {
    return { offline: true }; // GET /rank/top?mode&season&limit=100
  }

  async me(_mode, _opts) {
    return { offline: true }; // GET /rank/me?mode&season
  }

  async settle(_seasonId) {
    return { offline: true }; // GET /rank/result?season, 받기는 POST /rank/claim
  }

  async saveProfile(_profile) {
    return { offline: true }; // POST /rank/profile
  }
}
