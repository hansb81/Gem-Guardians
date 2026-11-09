# Gem Guardians 스토어 아트 v1 (2026-11-08)

`python art/store/build_store_art.py` 로 전부 다시 만들 수 있어요(아트는 native로 그리고 정수배 nearest로만 키움).
스크린샷 캡처는 `node art/store/capture_screens.cjs http://127.0.0.1:8123 art/store/captures` (저장소 루트에서 정적 서버 띄운 뒤, ?dev=1 훅 사용).

## 파일과 쓰는 곳

| 파일 | 크기 | 쓰는 곳 |
|---|---|---|
| `icon_1024.png` | 1024×1024, 알파 없음 | App Store, 토스 콘솔 |
| `icon_512.png` | 512×512, 알파 없음 | Google Play, 원스토어 |
| `capacitor-assets/icon-only.png` | 1024 | `@capacitor/assets` 입력 (iOS + 안드 레거시) |
| `capacitor-assets/icon-foreground.png` | 1024, 투명 | 안드 적응형 전경 (아이콘 전체를 가운데 640px로) |
| `capacitor-assets/icon-background.png` | 1024 | 안드 적응형 배경 (#2a0a14 단색) |
| `capacitor-assets/splash.png`, `splash-dark.png` | 2732×2732 | 스플래시 (로고 912px, 세로 폰에서 잘려도 로고는 안 잘림) |
| `feature_1024x500.png` | 1024×500, 알파 없음 | Google Play 피처 그래픽 |
| `screenshots/play_1080x1920/*.png` | 1080×1920 | Google Play, 원스토어 (5장) |
| `screenshots/ios69_1320x2868/*.png` | 1320×2868 | App Store 6.9인치 (5장) |
| `native/*.png` | 64 / 256×125 | 원본 픽셀(수정용) |

## 적용 (쑹의 Claude Code)

1. 저장소에 `store/` 폴더를 만들어 이 묶음을 넣기 (**assets/ 아래는 금지** - 게임 에셋 아님).
2. 아이콘/스플래시: `art/store/build_store_art.py`가 만든 android res(mipmap-*, drawable*)를 `android/app/src/main/res/`에 덮어쓰기. `@capacitor/assets`는 축소 보간으로 흐려져서 쓰지 않음.
3. iOS는 Xcode에서 **iPhone 전용**(TARGETED_DEVICE_FAMILY=1)으로 두기 → iPad 스크린샷(13인치) 요구를 피함.
4. store/ 는 `tools/optimize_png.py` 대상이 아님(제출용 원본 유지 - 스크립트가 store/ 경로를 건너뜀).

## 메모

- 앱 아이콘 = 쑹이 준 그림(가운데 루비 + 네 보석 + 십자 빛줄기, native 128 ×8). 원본 `icons/icon_128.png`, 26색.
- 피처 그래픽은 타이틀 장면(봉인문, 룬 기둥)과 로고, 다섯 석상을 합쳐 31색(전부 기존 팔레트). 스토어 홍보용이라 16색 제한의 예외로 둠.
- 스크린샷 캡션은 Galmuri11 11px를 정수배(Play ×5, iOS ×6)로 키운 것. 문구는 `build_store_art.py`의 `CAPTIONS`에서 바꾸면 됨.
- 스크린샷은 dev 훅으로 34층/40층(보스), 탑 레벨 14로 찍음. 영어 스토어용은 locale을 en으로 바꿔 다시 캡처 필요.
- 토스·원스토어 콘솔의 정확한 이미지 규격은 확인 못 함 → 위 파일로 먼저 시도하고 거절되면 알려 주기.
