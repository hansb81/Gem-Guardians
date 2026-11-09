"""도움말 설명용 그림(assets/ui/help/*.png)을 기존 게임 에셋을 합성해 만든다.

모든 팩이 drawScale 2(원본 1px = 화면 2px)라서 원본 크기 그대로 한 캔버스에 붙인다
(보드 칸 = tile 32px, 젬 48px 캔버스 가운데). 게임에서도 2배로 그린다(mainMenuScreen HELP).
글자는 넣지 않는다(언어마다 그림을 따로 둘 필요가 없게). 다시 뽑은 뒤에는
`python tools/optimize_png.py`를 돌린다.

사용: python tools/make_help_images.py
"""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
A = ROOT / 'assets'
OUT = A / 'ui' / 'help'
TILE = 32

_cache = {}


def img(rel):
    if rel not in _cache:
        _cache[rel] = Image.open(A / rel).convert('RGBA')
    return _cache[rel]


def frame(rel, i, fw, fh=None):
    sheet = img(rel)
    fh = fh or sheet.height
    return sheet.crop((i * fw, 0, (i + 1) * fw, fh))


def paste(canvas, im, x, y):
    canvas.alpha_composite(im, (int(x), int(y)))


def flip(im):
    return im.transpose(Image.FLIP_LEFT_RIGHT)


_skills = json.loads((A / 'skills' / 'manifest.json').read_text(encoding='utf-8'))
MASK = [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in _skills['tint']['maskColors']]
RAMPS = {k: [tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) for c in v] for k, v in _skills['tint']['ramps'].items()}


def mini(color):
    """gem_mini(7x7 회색 마스크)를 그 색 ramp로 칠한다(게임의 tintSheet와 같은 규칙)."""
    src = img('skills/sheets/gem_mini.png')
    out = src.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a and (r, g, b) in MASK:
                px[x, y] = RAMPS[color][MASK.index((r, g, b))] + (a,)
    return out


def board(canvas, x0, y0, rows):
    """rows: 문자열 목록. 글자 = 칸의 젬 (r b y g p = 일반, 대문자 = 강조 없음 동일), '.' = 빈 타일."""
    names = {'r': 'red', 'b': 'blue', 'y': 'yellow', 'g': 'green', 'p': 'purple'}
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            paste(canvas, img(f"ui/board/tile_{'a' if (r + c) % 2 == 0 else 'b'}.png"), x0 + c * TILE, y0 + r * TILE)
            if ch in names:
                gem(canvas, x0 + c * TILE, y0 + r * TILE, 'normal', names[ch])


def gem(canvas, cx, cy, kind, color):
    """칸 왼쪽 위 (cx, cy)에 젬(48px 캔버스, 칸 가운데)."""
    rel = 'gems/color/color.png' if kind == 'color' else f'gems/{kind}/{color}.png'
    paste(canvas, img(rel), cx - 8, cy - 8)


def tiles(canvas, x0, y0, n, pitch):
    for i in range(n):
        paste(canvas, img(f"ui/board/tile_{'a' if i % 2 == 0 else 'b'}.png"), x0 + i * pitch, y0)


def save(name, canvas):
    OUT.mkdir(parents=True, exist_ok=True)
    canvas = canvas.crop(canvas.getbbox())
    canvas.save(OUT / name)
    print(name, canvas.size)


# ---- 1. 퍼즐 기본: 노랑과 빨강을 바꾸면 빨강 3개 ----
def puzzle():
    c = Image.new('RGBA', (192, 104))
    board(c, 0, 0, ['bygpbr', 'grryrb', 'pbgbgy'])
    # 바꿀 두 칸 테두리 + 맞바꿈 화살표 + 손
    frame_cells(c, 3 * TILE, TILE, 2, 1)
    arrow = img('ui/tutorial/swap_arrow.png')
    paste(c, arrow, 4 * TILE - arrow.width // 2, TILE + TILE // 2 - arrow.height // 2)
    paste(c, frame('ui/tutorial/hand.png', 0, 16), 4 * TILE - 4, 2 * TILE - 4)  # hand.png = 16px 2프레임
    return c


def frame_cells(canvas, x, y, w, h):
    """hl_frame(16x16, 9-slice 6)을 w x h 칸에 맞게 늘린다."""
    src = img('ui/tutorial/hl_frame.png')
    W, H = w * TILE, h * TILE
    s = 6
    out = Image.new('RGBA', (W, H))
    m = 16 - 2 * s
    parts = [(0, 0, s, s, 0, 0, s, s), (16 - s, 0, 16, s, W - s, 0, s, s), (0, 16 - s, s, 16, 0, H - s, s, s), (16 - s, 16 - s, 16, 16, W - s, H - s, s, s),
             (s, 0, s + m, s, s, 0, W - 2 * s, s), (s, 16 - s, s + m, 16, s, H - s, W - 2 * s, s),
             (0, s, s, s + m, 0, s, s, H - 2 * s), (16 - s, s, 16, s + m, W - s, s, s, H - 2 * s)]
    for sx0, sy0, sx1, sy1, dx, dy, dw, dh in parts:
        out.alpha_composite(src.crop((sx0, sy0, sx1, sy1)).resize((dw, dh), Image.NEAREST), (dx, dy))
    canvas.alpha_composite(out, (x, y))


# ---- 2. 특수 젬: 모양(작은 젬) -> 화살표 -> 생기는 특수 젬, 2x2 ----
def specials():
    c = Image.new('RGBA', (216, 104))
    shapes = [
        (['rrrr'], 'line_h', 'red'),
        (['b..', 'b..', 'bbb'], 'bomb', 'blue'),
        (['gg', 'gg'], 'box', 'green'),
        (['yyyyy'], 'color', None),
    ]
    arrow = img('ui/tutorial/arrow.png').transpose(Image.ROTATE_90)  # 아래 화살표 -> 오른쪽
    for i, (rows, kind, color) in enumerate(shapes):
        ox, oy = (i % 2) * 112, (i // 2) * 56
        sw, sh = len(rows[0]) * 8, len(rows) * 8
        sx, sy = ox + 44 - sw, oy + 24 - sh // 2
        for r, row in enumerate(rows):
            for col, ch in enumerate(row):
                if ch != '.':
                    paste(c, mini({'r': 'red', 'b': 'blue', 'g': 'green', 'y': 'yellow'}[ch]), sx + col * 8, sy + r * 8)
        paste(c, arrow, ox + 50, oy + 24 - arrow.height // 2)
        paste(c, img('ui/board/tile_a.png'), ox + 68, oy + 8)
        gem(c, ox + 68, oy + 8, kind, color)
    return c


# ---- 3. 특수 젬 조합: 두 특수 젬 + 지워지는 범위(작은 5x5) ----
def combos():
    c = Image.new('RGBA', (216, 104))
    pairs = [
        (('line_h', 'red'), ('line_v', 'blue'), lambda r, k: r == 2 or k == 2),
        (('bomb', 'yellow'), ('bomb', 'purple'), lambda r, k: 1 <= r <= 4 and 1 <= k <= 4),  # specials.js bombComboCells = 4x4
        (('color', None), ('color', None), lambda r, k: True),
    ]
    arrow = img('ui/tutorial/swap_arrow.png')
    for i, (a, b, hit) in enumerate(pairs):
        ox = i * 74
        tiles(c, ox, 0, 2, TILE)
        gem(c, ox, 0, *a)
        gem(c, ox + TILE, 0, *b)
        paste(c, arrow, ox + TILE - arrow.width // 2, 40)
        for r in range(5):
            for k in range(5):
                m = mini('yellow' if hit(r, k) else 'purple')
                if not hit(r, k):
                    m = dim(m)
                paste(c, m, ox + 12 + k * 8, 56 + r * 8)
    return c


def dim(im):
    """범위 밖 칸: 바탕색(#3b3347) 실루엣으로."""
    out = Image.new('RGBA', im.size, (0x3b, 0x33, 0x47, 0))
    out.putalpha(im.getchannel('A'))
    return out


# ---- 4. 석상과 전투: 석상 5개가 쏘고, 적이 왼쪽으로 걸어온다 ----
def battle():
    c = Image.new('RGBA', (216, 60))
    colors = ['red', 'blue', 'yellow', 'green', 'purple']
    back, front = [(0, 'red'), (1, 'yellow'), (2, 'purple')], [(0, 'blue'), (1, 'green')]
    for i, col in back:
        paste(c, frame(f'statues/sheets/statue_idle_{col}.png', 0, 16), 2 + i * 18, 14)
    for i, col in front:
        paste(c, frame(f'statues/sheets/statue_idle_{col}.png', 0, 16), 11 + i * 18, 34)
    for x, y, col in [(66, 22, 'red'), (92, 40, 'blue'), (120, 28, 'yellow')]:
        paste(c, frame(f'towers/sheets/projectile_{col}.png', 1, 8), x, y)
    for x, rel in [(140, 'enemies/goblin_run_anim_f1.png'), (166, 'enemies/masked_orc_idle_anim_f0.png'), (192, 'enemies/goblin_run_anim_f3.png')]:
        e = flip(img(rel))
        paste(c, e, x, 54 - e.height)
    del colors
    return c


# ---- 5. 젬 기술: 가시 / 용암탄 / 영혼 불꽃 / 궁극기 ----
def skills():
    c = Image.new('RGBA', (216, 84))
    ground = 80
    # 가시: 적 발밑에서 솟는 프레임
    e = flip(img('enemies/goblin_idle_anim_f0.png'))
    paste(c, e, 10, ground - e.height)
    paste(c, frame('skills/sheets/spike_red.png', 3, 32), 0, ground - 34)
    # 용암탄: 떨어지는 불덩이(1프레임) + 바닥 착탄(6프레임), 가운데만 잘라서
    paste(c, frame('skills/sheets/meteor_red.png', 6, 96).crop((20, 40, 76, 80)), 44, ground - 40)
    for x in (52, 70):
        e = flip(img('enemies/goblin_run_anim_f1.png'))
        paste(c, e, x, ground - e.height - 4)
    paste(c, frame('skills/sheets/meteor_red.png', 1, 96).crop((20, 0, 76, 40)), 44, ground - 76)
    # 영혼 불꽃: 불꽃 2개가 단단한 적에게
    e = flip(img('enemies/masked_orc_idle_anim_f0.png'))
    paste(c, e, 150, ground - e.height)
    paste(c, frame('effects/sheets/box_soul_purple.png', 1, 16), 116, 46)
    paste(c, frame('effects/sheets/box_soul_purple.png', 2, 16), 128, 62)
    # 궁극기: 빛기둥
    e = flip(img('enemies/goblin_idle_anim_f0.png'))
    paste(c, e, 190, ground - e.height)
    paste(c, frame('skills/sheets/light_pillar.png', 3, 24), 186, ground - 64)
    return c


# ---- 6. 방해요소: 나무상자, 돌덩이, 금 간 돌덩이, 시한폭탄 붙은 젬 ----
def obstacles():
    c = Image.new('RGBA', (180, 40))
    tiles(c, 0, 4, 4, 44)
    for i, rel in enumerate(['obstacles/crate.png', 'obstacles/stone.png', 'obstacles/stone_cracked.png']):
        paste(c, img(rel), i * 44 - 8, 4 - 8)
    gem(c, 3 * 44, 4, 'normal', 'blue')
    paste(c, img('obstacles/time_bomb.png'), 3 * 44 - 8, 4 - 8)
    return c


# ---- 7. 아이템 칸: 장착 3칸 + 잠긴 4번째 칸 ----
def items():
    c = Image.new('RGBA', (110, 26))
    for i, item in enumerate(['hammer', 'scythe_h', 'hourglass', None]):
        x = i * 27
        if item:
            paste(c, img('ui/items/slot_normal.png'), x, 2)
            paste(c, img(f'items/{item}.png'), x + 4, 6)
        else:
            paste(c, img('ui/items/slot_locked.png'), x, 2)
    return c


if __name__ == '__main__':
    for name, fn in [('puzzle.png', puzzle), ('specials.png', specials), ('combos.png', combos), ('battle.png', battle),
                     ('skills.png', skills), ('obstacles.png', obstacles), ('items.png', items)]:
        save(name, fn())
