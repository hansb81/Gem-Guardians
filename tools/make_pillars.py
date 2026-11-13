"""보드 양옆 기둥(assets/ui/panels/pillar_left.png, pillar_right.png) - 돌 기둥 + 타이틀 룬 줄.

색은 패널 색만 쓰고, 룬은 title_base.png의 왼쪽 룬 줄(x 31~38, y 127~196)에서 파란 픽셀만 가져온다.
위·아래 6줄은 기둥머리·받침(9-slice 고정), 가운데는 몸통. 다시 뽑은 뒤 python tools/optimize_png.py.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
W, H = 11, 159  # 보드 틀 높이(원본 px) - 보드 틀 왼쪽 빈 칸 폭
D0, D1, D2, D3 = (13, 10, 16), (34, 28, 43), (59, 51, 71), (101, 90, 116)
G1, G2 = (120, 84, 24), (200, 150, 50)


def pillar(mirror):
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    put = lambda x, y, c: im.putpixel((x, y), c + (255,))
    line = lambda x0, x1, y, c: [put(x, y, c) for x in range(x0, x1 + 1)]
    sx0, sx1 = 2, W - 3
    for y in range(6, H - 6):
        for x in range(sx0, sx1 + 1):
            t = (x - sx0) / (sx1 - sx0)
            if mirror:
                t = 1 - t
            c = D3 if t < 0.2 else D2 if t < 0.75 else D1
            put(x, y, D1 if (x - sx0) % 3 == 2 else c)  # 세로 홈
        put(sx0 - 1, y, D0)
        put(sx1 + 1, y, D0)
        if y % 24 == 0:
            line(sx0, sx1, y, D1)  # 돌 이음
    for i, (a, b, c) in enumerate([(0, W - 1, D2), (1, W - 2, D3), (0, W - 1, D2), (1, W - 2, D1)]):
        line(a, b, i, c)  # 기둥머리
        line(a, b, H - 1 - i, c)  # 받침
    line(1, W - 2, 4, G2)
    line(2, W - 3, 5, G1)
    line(1, W - 2, H - 5, G2)
    line(2, W - 3, H - 6, G1)
    strip = Image.open(ROOT / "assets/title/title_base.png").convert("RGB").crop((31, 127, 39, 197))
    cx = (sx0 + sx1) // 2 - strip.width // 2
    y0 = (H - strip.height) // 2
    for yy in range(strip.height):
        for xx in range(strip.width):
            c = strip.getpixel((xx, yy))
            if c[2] > c[0] + 40 and c[2] > 90 and 0 <= cx + xx < W:  # 파란 룬 픽셀만
                put(cx + xx, y0 + yy, c)
    return im


pillar(False).save(ROOT / "assets/ui/panels/pillar_left.png")
pillar(True).save(ROOT / "assets/ui/panels/pillar_right.png")
