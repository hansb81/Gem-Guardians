# assets/ui/auth

| 파일 | 출처 | 비고 |
|---|---|---|
| `google_g_light_square.svg` | Google "Sign in with Google" 브랜드 자료 `signin-assets.zip` (https://developers.google.com/static/identity/images/signin-assets.zip, 2026-11-13 받음) — `Android + Web/SVG/Light/Theme=Light, Show text=No, Shape=Square, Platform=Android+Web.svg` | 원본 그대로(보관용). conic-gradient foreignObject를 써서 canvas에는 PNG를 그린다 |
| `google_g_light_square.png` | 같은 zip의 `PNG @4x/Light/…Square…@4x.png` (160×160) | `tools/optimize_png.py`만 거침(픽셀 동일) |

사용 규칙: Google 브랜드 가이드(https://developers.google.com/identity/branding-guidelines) — 로고를 바꾸거나 다시 그리지 않는다. 버튼은 흰 바탕·회색 테두리(#747775)·글자 #1F1F1F, "Google로 로그인"/"Sign in with Google".
