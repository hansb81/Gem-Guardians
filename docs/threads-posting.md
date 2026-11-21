# 게임 화면 → Threads 업로드 계획 (Claude Code에서)

2026-11-19 · 대상: Meta **Threads** 본인 계정
쑹의 결정: 긴 일지가 아니라 **게임플레이 화면/GIF + 짧은 글** 포스팅 · **올리기 전 반드시 확인** · **Claude Code 안에서 처리** (GitHub Actions 안 씀)

---

## 1. 한 줄 요약

Claude Code에게 **"이 화면 스레드에 올릴 글 써줘"** → Claude Code가 미디어를 준비하고 글 초안을 보여 줌 → 쑹이 **"올려"**라고 하면 → `npm run threads:post`로 업로드하고 게시물 링크를 알려 줌.

- 비용: **0원** (Threads API 무료, Supabase Storage 무료 플랜 안)
- 앱 심사: **필요 없음** (내 계정을 "Threads 테스터"로 등록)
- 토큰은 내 PC의 `.env.threads`(git 제외)에만 저장

---

## 2. 흐름

```
쑹: "오늘 보스전 GIF 스레드에 올릴 글 써줘"  (파일 경로나 화면 녹화 첨부)
   │
   ▼ Claude Code
1) 미디어 준비: GIF → MP4 변환, 작은 이미지는 픽셀 깨짐 없이 확대
2) 최근 커밋을 참고해 짧은 글 초안 2~3개 작성 (STYLE.md 말투)
3) threads/posts/2026-11-19-boss.md 로 저장하고 채팅에 미리보기
   │  쑹: "2번으로, 이모지 빼고"  → 수정
   │  쑹: "올려"
   ▼
4) npm run threads:post -- threads/posts/2026-11-19-boss.md
   - 미디어 → Supabase 공개 버킷 업로드 (Threads는 공개 URL만 받음)
   - Threads API: 컨테이너 생성 → 처리 대기 → 발행
   - 게시물 링크를 파일에 기록, 채팅에 링크 출력
```

**안전장치:** 스크립트는 `--yes` 없이 실행하면 미리보기만 하고 멈춥니다. Claude Code는 쑹이 채팅에서 "올려"라고 한 뒤에만 `--yes`를 붙입니다 (CLAUDE.md 규칙). 한 번 올라간 글은 지울 수는 있어도 이미 본 사람이 있을 수 있으니까요.

---

## 3. Threads API 핵심 사실 (2026-11 공식 문서)

| 항목 | 내용 |
|---|---|
| 주소 | `https://graph.threads.net/v1.0/` |
| 발행 | ① `POST /{user-id}/threads` 컨테이너 생성 → ② 상태가 `FINISHED` 될 때까지 대기(평균 30초) → ③ `POST /{user-id}/threads_publish` |
| 글자 수 | **500자** (이모지는 더 차지). 길면 답글(`reply_to_id`)로 이어 쓰기 |
| 이미지 | JPEG/PNG, 8MB 이하, 가로 320~1440px |
| 영상 | MP4/MOV, H.264, **23~60fps**, 최대 5분, 1GB |
| **GIF** | **직접 업로드 불가** → MP4로 변환해서 올림 (영상처럼 자동 반복 재생) |
| 여러 장 | 캐러셀 2~20장 (이미지·영상 섞기 가능) |
| 미디어 주소 | **공개 URL 필수** (Threads 서버가 직접 내려받음) |
| 해시태그 | `topic_tag` 1개 (예: `인디게임`) |
| 한도 | 24시간에 250개 (신경 쓸 일 없음) |
| 토큰 | **60일**짜리. 24시간 이상 지난 토큰은 갱신하면 다시 60일. **60일 넘기면 처음부터 재발급** → 스크립트가 올릴 때마다 남은 기간을 확인하고 30일 이하면 자동 갱신해서 `.env.threads`에 저장 |
| 권한 | `threads_basic`, `threads_content_publish` (+ 답글용 `threads_manage_replies`) |

### 픽셀 아트 처리
- 가로 320px 미만이면 거절되므로 **정수 배율 nearest-neighbor**로 확대 (뭉개짐 없음)
- GIF → MP4: `ffmpeg -i in.gif -vf "scale=iw*4:ih*4:flags=neighbor,fps=30,format=yuv420p" -c:v libx264 -crf 18 -movflags +faststart out.mp4`
- 실제 플레이 녹화(휴대폰 화면 녹화, OBS 등) MP4는 그대로 올려도 됨. 5분·1GB 넘으면 Claude Code가 잘라 줌

---

## 4. 미디어 공개 URL: Supabase Storage `threads-media` 공개 버킷

저장소가 비공개라 GitHub 주소는 Threads가 못 읽습니다. 이미 쓰는 Supabase(GemGuardians, ref `jzpjqfbpqzghprqbqexp`)에 **공개 버킷 하나만** 추가합니다. 게임 데이터와 분리, 무료 1GB. 업로드는 service_role 키로만 가능. (Routory 프로젝트는 절대 건드리지 않음)

---

## 5. 쑹이 한 번만 할 준비 (약 20~30분)

### 5-1. Meta 앱
1. https://developers.facebook.com/apps → **앱 만들기**
2. 사용 사례 **"Threads API 액세스"** 선택, 앱 이름 예: `Gem Guardians Posting`
3. **사용 사례 → 맞춤 설정**에서 권한 `threads_basic`, `threads_content_publish`, `threads_manage_replies` 추가
4. 리디렉션 URL 칸이 필수면 `https://localhost/`
5. **앱 역할 → 역할 → 사람 추가 → Threads 테스터**로 내 Threads 계정 추가
6. Threads 앱 → **설정 → 계정 → 웹사이트 권한 → 초대**에서 **수락**

### 5-2. 토큰
1. 앱 대시보드 **사용 사례 → Threads API → 설정**의 **User Token Generator**에서 **토큰 생성** → 복사 (60일 토큰)
   - 안 보이면 Claude Code에서 `npm run threads:auth` (프롬프트 B에 포함)
2. 저장소 루트에 `.env.threads` 만들기 (Claude Code가 틀을 만들어 줌), 값 붙여 넣기:
   ```
   THREADS_ACCESS_TOKEN=...
   SUPABASE_URL=https://jzpjqfbpqzghprqbqexp.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...
   ```
   user id는 스크립트가 `/me`로 알아서 찾습니다.

> 토큰·키는 **Claude Code 채팅창에도 붙이지 말고** 파일에 직접 붙여 넣으세요. 이 파일은 `.gitignore`에 들어갑니다.

### 5-3. 계정 선택 (결정 필요)
Threads 계정은 Instagram 계정 기반입니다. **게임 전용 계정**을 추천해요 (홍보용으로 깔끔, 나중에 팀원 생겨도 넘기기 쉬움). 개인 계정으로 할 거면 그대로 진행.

---

## 6. 글 파일 형식 `threads/posts/YYYY-MM-DD-slug.md`
```markdown
---
status: draft          # draft → posted (실패 시 failed)
topic_tag: 인디게임
media:                 # 0~20개
  - media/threads/wall_hit.gif
# 발행 후 자동 기록: threads_id, permalink, posted_at
---
몬스터가 성벽을 때리면 이제 번쩍! 🧱⚡
작은 몬스터, 큰 몬스터, 막혔을 때가 다 다르게 보여.
어떤 게 제일 시원해 보여?
```
본문에서 `---` 줄로 나누면 둘째 조각부터 답글(타래)로 이어 붙습니다.

---

## 7. 말투 기본값 (`threads/STYLE.md`, 쑹이 고치면 됨)
- 개발자가 근황을 툭 털어놓는 반말 혼잣말, 짧은 줄 (2~5줄, 400자 이하)
- 첫 줄은 지금 한 일·화면을 그냥 말함, 이모지는 0~1개
- 기술 용어 대신 느낀 점·재미·삽질
- 끝맺음은 글에 맞게: 반응이 궁금하면 가벼운 질문, 근황·푸념이면 혼잣말 (억지 질문 금지)
- **금지**: 키·토큰·서버 주소, 결제 상품 가격·매출, 미공개 밸런스 수치, 버그 악용법, 테스터 개인정보, 사업자 정보

---

## 8. 진행 순서
| 단계 | 내용 | 누가 |
|---|---|---|
| 0 | 5장 준비 (Meta 앱, 토큰, `.env.threads`) | 쑹 |
| A | 업로드 스크립트 + 버킷 + CLAUDE.md 규칙 + STYLE.md | Claude Code (프롬프트 A) |
| B | (토큰 생성기 못 쓸 때만) `threads:auth` | Claude Code (프롬프트 B) |
| C | 첫 글: "이 GIF 스레드에 올릴 글 써줘" → 확인 → "올려" | 쑹 + Claude Code |

## 9. 나중에 생각할 것
- 같은 글을 X·인스타그램에도 (인스타는 같은 Meta 앱으로 확장 가능)
- 예약 발행이 필요해지면 그때 GitHub Actions 추가 (지금은 안 함)
