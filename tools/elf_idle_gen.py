"""elf_idle.png 생성 (ART_DIRECTION.md 14항: idle 4프레임, 150ms, loop).
숨쉬기: 머리+몸통(row 0-11)만 1px 아래로 가라앉았다가 복귀. row12(벨트 하단)와
다리/발(row13-15, 활 아래 끝 포함)은 항상 base와 동일하게 고정한다.
base(row0)가 이미 캔버스 맨 위 줄에 닿아있어 위로는 올릴 공간이 없으므로,
"올라간" 상태 = base, "가라앉은" 상태 = 1px dip 로 구현한다.
사용: python3 tools/elf_idle_gen.py
"""
import os
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
BASE_PATH = os.path.join(ROOT, 'assets', 'characters', 'elf', 'elf.png')
SHEET_PATH = os.path.join(ROOT, 'assets', 'characters', 'elf', 'elf_idle.png')
PREVIEW_DIR = os.path.join(ROOT, 'preview')


def make_dip(base):
    w, h = base.size
    bp = base.load()
    dip = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    dp = dip.load()
    for x in range(w):
        dp[x, 0] = (0, 0, 0, 0)          # row0 비움 (위로 올릴 공간 없음 -> 투명)
        for y in range(1, 12):
            dp[x, y] = bp[x, y - 1]      # row1-11 <- base row0-10 (1px 하강)
        for y in range(12, h):
            dp[x, y] = bp[x, y]          # row12(벨트 하단) + 다리/발: base 그대로 고정
    return dip


def main():
    base = Image.open(BASE_PATH).convert('RGBA')
    w, h = base.size
    dip = make_dip(base)
    frames = [base, dip, base, dip]  # rest, 가라앉음, rest, 가라앉음 (오르내림 루프)

    sheet = Image.new('RGBA', (w * len(frames), h), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        sheet.paste(f, (i * w, 0))
    sheet.save(SHEET_PATH)
    print('saved', SHEET_PATH, sheet.size)

    os.makedirs(PREVIEW_DIR, exist_ok=True)
    scale = 8
    big_frames = [f.resize((w * scale, h * scale), Image.NEAREST) for f in frames]
    gif_path = os.path.join(PREVIEW_DIR, 'elf_idle.gif')
    big_frames[0].save(
        gif_path, save_all=True, append_images=big_frames[1:],
        duration=150, loop=0, disposal=2,
    )
    print('saved', gif_path)

    strip_path = os.path.join(PREVIEW_DIR, 'elf_idle_frames.png')
    gap = 8
    strip = Image.new('RGBA', (len(frames) * (w * scale + gap) - gap, h * scale), (0, 0, 0, 0))
    for i, f in enumerate(big_frames):
        strip.paste(f, (i * (w * scale + gap), 0))
    strip.save(strip_path)
    print('saved', strip_path)


if __name__ == '__main__':
    main()
