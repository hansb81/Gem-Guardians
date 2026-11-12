"""배경 base(180x320)에서 블리드 그림(300x448, base는 가운데)을 만든다 - frame 밖 띠를 채우는 그림.

- 바닥(floorTop 아래 줄): 벽돌 주기(period)만큼 평행 이동해 옆으로 잇고, 맨 아래 띠는 마지막 bottomRows 줄을 거울 반사로 반복.
- 바위(그 위 + 위쪽 띠): base의 바위 영역(rockSrc)에서 BLOCK px 조각을 골라 채운다. 이미 채운 주변(base 포함)과
  겹치는 OVERLAP 테두리가 가장 비슷한 조각을 고른다(간단한 텍스처 퀼팅). 새 색 없음.
base를 다시 뽑으면 다시 돌린다:  python tools/make_bleed.py  ->  python tools/optimize_png.py
"""
import random
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
BLEED_W, BLEED_H = 300, 448  # Z Fold 펼침 + 배너(가로 1.64배, 세로 1.38배)까지 덮는 크기
BLOCK = 12
OVERLAP = 4
TRIES = 600  # 조각 후보 표본 수(전부 비교하면 느리다)

JOBS = [
    {
        "base": "assets/title/title_base.png",
        "out": "assets/title/title_bleed.png",
        "floorTop": 262,
        "period": 14,
        "bottomRows": 16,
        "rockSrc": [(0, 0, 30, 258), (150, 0, 180, 258)],  # (x0, y0, x1, y1) 룬·장식 없는 바위
    },
    {
        "base": "assets/menu/menu_base.png",
        "out": "assets/menu/menu_bleed.png",
        "floorTop": 228,
        "period": 14,
        "bottomRows": 16,
        "rockSrc": [(0, 0, 180, 42)],  # 기둥 머리 위 바위
    },
]


def reflect(k, c):
    m = k % (2 * c)
    return m if m < c else 2 * c - 1 - m


def lum(c):
    return c[0] * 3 + c[1] * 6 + c[2]


def make(job):
    base = Image.open(ROOT / job["base"]).convert("RGBA")
    w, h = base.size
    ox, oy = (BLEED_W - w) // 2, (BLEED_H - h) // 2
    src = base.load()
    out = [[None] * BLEED_W for _ in range(BLEED_H)]
    for y in range(h):
        for x in range(w):
            out[y + oy][x + ox] = src[x, y]

    # 바닥: 가로는 벽돌 주기 평행 이동, 아래 띠는 마지막 줄들 반사
    ft, p, br = job["floorTop"], job["period"], job["bottomRows"]
    for Y in range(BLEED_H):
        y = Y - oy
        if y < ft:
            continue
        sy = y if y < h else h - 1 - reflect(y - h, br)
        for X in range(BLEED_W):
            x = X - ox
            if 0 <= x < w and 0 <= y < h:
                continue
            sx = x % p if x < 0 else (x if x < w else w - p + (x - w) % p)
            out[Y][X] = src[sx, sy]

    # 바위: 퀼팅. 후보 = rockSrc 안에 (BLOCK + 2*OVERLAP) 창이 다 들어가는 위치.
    win = BLOCK + 2 * OVERLAP
    cands = [(x, y) for (x0, y0, x1, y1) in job["rockSrc"] for y in range(y0, y1 - win + 1) for x in range(x0, x1 - win + 1)]
    rng = random.Random(1)
    rock_bottom = ft + oy  # 이 줄부터는 바닥이 이미 채움
    for by in range(0, rock_bottom, BLOCK):
        for bx in range(0, BLEED_W, BLOCK):
            cells = [(X, Y) for Y in range(by, min(by + BLOCK, rock_bottom)) for X in range(bx, min(bx + BLOCK, BLEED_W)) if out[Y][X] is None]
            if not cells:
                continue
            ring = [(X, Y) for Y in range(by - OVERLAP, by + BLOCK + OVERLAP) for X in range(bx - OVERLAP, bx + BLOCK + OVERLAP)
                    if 0 <= X < BLEED_W and 0 <= Y < BLEED_H and out[Y][X] is not None]
            best, best_err = None, None
            for cx, cy in rng.sample(cands, min(TRIES, len(cands))):
                dx, dy = cx + OVERLAP - bx, cy + OVERLAP - by
                err = 0
                for X, Y in ring:
                    err += abs(lum(src[X + dx, Y + dy]) - lum(out[Y][X]))
                    if best_err is not None and err >= best_err:
                        break
                if best_err is None or err < best_err:
                    best, best_err = (dx, dy), err
            dx, dy = best
            for X, Y in cells:
                out[Y][X] = src[X + dx, Y + dy]

    img = Image.new("RGBA", (BLEED_W, BLEED_H))
    img.putdata([c for row in out for c in row])
    assert img.crop((ox, oy, ox + w, oy + h)).tobytes() == base.tobytes()  # 가운데는 base 그대로
    assert set(img.getdata()) <= set(base.getdata())  # 새 색 없음
    img.save(ROOT / job["out"])
    print(f"{job['out']}: {BLEED_W}x{BLEED_H}, base at ({ox},{oy})")


if __name__ == "__main__":
    for job in JOBS:
        make(job)
