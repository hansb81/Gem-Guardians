"""preview/_battle.png(shoot_ingame.mjs) 위에 정령을 수호자 바깥쪽 자리에 게임 배율로 올린다 -> preview/in_game.png"""
import json
import os
import sys
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
BY_COLOR = {"red": "fire_wisp", "blue": "snow_fairy", "green": "seedling", "purple": "venom_moth", "yellow": "spark_fly"}
GAP = 1  # 수호자 프레임과 정령 사이(원본 px)

meta = json.load(open(os.path.join(HERE, "preview/_feet.json")))
d = meta["dpr"]
mid = sum(f["x"] for f in meta["feet"]) / len(meta["feet"])


def compose(sprite_dir, left_gap):
    shot = Image.open(os.path.join(HERE, "preview/_battle.png")).convert("RGBA")
    for f in meta["feet"]:
        s = f["scale"] * d  # 화면 픽셀 / 원본 픽셀 (수호자와 같은 배율)
        size = round(10 * s)
        spr = Image.open(os.path.join(sprite_dir, BY_COLOR[f["color"]] + ".png")).crop((0, 0, 10, 10)).resize((size, size), Image.NEAREST)
        side = -1 if f["x"] < mid else 1  # 왼쪽 줄은 왼쪽 바깥, 오른쪽 줄은 오른쪽 바깥
        gap = left_gap if side < 0 else GAP
        cx = f["x"] * d + side * (10 + gap + 5) * s  # 수호자 반폭 10px + 간격 + 정령 반폭 5px
        cy = f["y"] * d - 14 * s  # 수호자(26px) 가슴 높이
        shot.alpha_composite(spr, (round(cx - size / 2), round(cy - size / 2)))
    return shot.convert("RGB")


after = compose(os.path.join(HERE, "out"), GAP - 1)  # 왼쪽 줄은 화면 테두리에서 1px 안쪽으로
after.save(os.path.join(HERE, "preview/in_game.png"))
if len(sys.argv) > 1:  # python compose_ingame.py <고치기 전 스프라이트 폴더> -> 전투 영역만 잘라 전·후 나란히
    ys = [f["y"] * d for f in meta["feet"]]
    box = (0, int(min(ys) - 260), 520, int(max(ys) + 60))
    a, b = compose(sys.argv[1], GAP).crop(box), after.crop(box)
    pair = Image.new("RGB", (a.width * 2 + 12, a.height), (255, 255, 255))
    pair.paste(a, (0, 0))
    pair.paste(b, (a.width + 12, 0))
    pair.save(os.path.join(HERE, "preview/in_game_before_after.png"))
