#!/usr/bin/env python3
"""정령 낱장을 게임용 시트로 합친다. 순서 = art/spirits/build_spirits.py의 GRID 순서(전투·초상 공통).
- 전투: art/spirits/out/{id}.png(40x10) -> assets/spirits/spirits.png (40 x 10*N, 정령마다 한 줄)
- 초상: art/spirits/out/portrait/{id}.png(24x24) -> assets/spirits/portraits.png (6열, 칸 번호 = 줄*6 + 열)
- 정령석: art/spirits/out/stone.png -> assets/ui/icons/spirit_stone.png (재화 아이콘 폴더, assets/ui/manifest.json에 등록돼 있다)
manifest.json에 id -> 줄 번호(spirits), id -> 칸 번호(portraits)를 쓴다.

    python art/spirits/build_spirits.py && python art/spirits/build_portraits.py && python tools/pack_spirits.py
    python tools/optimize_png.py assets/spirits assets/ui/icons
"""
import importlib.util
import json
import os
import shutil

from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
SRC = os.path.join(ROOT, "art/spirits")
DST = os.path.join(ROOT, "assets/spirits")
FRAME, FRAMES, FRAME_MS = 10, 4, 200
PORTRAIT, PORTRAIT_COLS = 24, 6

spec = importlib.util.spec_from_file_location("build_spirits", os.path.join(SRC, "build_spirits.py"))
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)  # main()은 돌지 않는다(GRID만 읽는다)
ids = [fn.__name__ for row in build.GRID for fn in row]

os.makedirs(DST, exist_ok=True)
sheet = Image.new("RGBA", (FRAME * FRAMES, FRAME * len(ids)), (0, 0, 0, 0))
for row, i in enumerate(ids):
    im = Image.open(os.path.join(SRC, "out", i + ".png")).convert("RGBA")
    assert im.size == (FRAME * FRAMES, FRAME), (i, im.size)
    sheet.paste(im, (0, row * FRAME))
sheet.save(os.path.join(DST, "spirits.png"))
portraits = Image.new("RGBA", (PORTRAIT * PORTRAIT_COLS, PORTRAIT * -(-len(ids) // PORTRAIT_COLS)), (0, 0, 0, 0))
for cell, i in enumerate(ids):
    im = Image.open(os.path.join(SRC, "out", "portrait", i + ".png")).convert("RGBA")
    assert im.size == (PORTRAIT, PORTRAIT), (i, im.size)
    portraits.paste(im, (cell % PORTRAIT_COLS * PORTRAIT, cell // PORTRAIT_COLS * PORTRAIT))
portraits.save(os.path.join(DST, "portraits.png"))
shutil.copyfile(os.path.join(SRC, "out", "stone.png"), os.path.join(ROOT, "assets/ui/icons/spirit_stone.png"))
manifest = {
    "version": 3, "imageSmoothing": False, "sheet": "spirits.png",
    "frameW": FRAME, "frameH": FRAME, "frames": FRAMES, "frameMs": FRAME_MS,
    "note": "정령마다 한 줄(대기 4프레임 가로). spirits[id] = 줄 번호. 오른쪽을 본다. 위아래 둥실은 코드가 한다. 원본 = art/spirits/build_spirits.py, 합치기 = tools/pack_spirits.py",
    "spirits": {i: row for row, i in enumerate(ids)},
    "portraitSheet": "portraits.png", "portraitW": PORTRAIT, "portraitH": PORTRAIT, "portraitCols": PORTRAIT_COLS,
    "portraits": {i: cell for cell, i in enumerate(ids)},
}
with open(os.path.join(DST, "manifest.json"), "w", encoding="utf-8", newline="\n") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)
    f.write("\n")
print(f"{len(ids)} spirits -> spirits.png {sheet.size[0]}x{sheet.size[1]}, portraits.png {portraits.size[0]}x{portraits.size[1]}, ui/icons/spirit_stone.png")
