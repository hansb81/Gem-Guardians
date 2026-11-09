"""앱 아이콘 도트 시안 → art/icons/preview/ (1024x1024 PNG + preview.png 모아보기).
전부 작은 격자(32/64/128)에 그린 뒤 정수 배율 NEAREST로 키운다(스무딩 없음). 빛 번짐도 디더(Bayer 4x4)로
찍어 도트 느낌을 유지한다. 게임 에셋(젬 48px, 석상 16x20, 타이틀 로고, 엠블럼)을 그대로 쓴다.
    python art/icons/gen_app_icons.py && python tools/optimize_png.py art/icons/preview
"""
import os, random, math
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'art', 'icons', 'preview')
A = lambda *p: os.path.join(ROOT, 'assets', *p)
N = 1024
H = lambda s, a=255: tuple(int(s[i:i + 2], 16) for i in (0, 2, 4)) + (a,)

# 보석 팔레트(assets/gems/palette.hex) 4단(어둠→하이라이트) + 공용 어둠색.
P = {
    'bg0': '0d0a10', 'bg1': '221c2b', 'bg2': '3b3347', 'bg3': '655a74', 'bone': 'e8dcc0',
    'red': ['3a0814', '741426', 'b82a3c', 'ec6a6a'], 'blue': ['0c1838', '1c3a76', '386cbc', '8cc4ee'],
    'purple': ['220e38', '48206e', '7a3cae', 'c48ce6'], 'yellow': ['3a2808', '7a5212', 'c28a20', 'f2d264'],
    'green': ['0c2814', '1c5228', '3a8a3c', '9cd872'],
}
BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def sprite(*path):
    return Image.open(A(*path)).convert('RGBA')


def gem(color, k=1):
    """젬 스프라이트(48 캔버스 안 30x30 본체)를 본체만 잘라 k배."""
    g = sprite('gems', 'normal', color + '.png')
    g = g.crop(g.getbbox())
    return g.resize((g.width * k, g.height * k), Image.NEAREST)


def up(im, k):
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def dither_glow(im, cx, cy, r, ramp, bg=None):
    """중심에서 r까지 ramp[0](밝음)→ramp[-1](어둠)을 디더로 찍는다. bg를 주면 가장자리 밖은 bg."""
    px = im.load()
    n = len(ramp) - 1
    for y in range(im.height):
        for x in range(im.width):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r
            if d >= 1:
                if bg: px[x, y] = H(bg)
                continue
            v = d * n
            i = int(v)
            if i < n and (v - i) * 16 > BAYER[y % 4][x % 4]: i += 1
            px[x, y] = H(ramp[i])


def bricks(w, h, seed=1, dark='0d0a10', mid='221c2b', hi='3b3347'):
    im = Image.new('RGBA', (w, h), H(mid))
    d = ImageDraw.Draw(im)
    rnd = random.Random(seed)
    for row, y in enumerate(range(0, h, 8)):
        off = 8 if row % 2 else 0
        d.line([0, y, w, y], fill=H(dark))
        for x in range(-off, w, 16):
            d.line([x, y, x, y + 8], fill=H(dark))
            if rnd.random() < 0.35:
                d.point((x + rnd.randint(2, 6), y + rnd.randint(2, 4)), fill=H(hi))
    return im


def frame(d, w, h, color=P['yellow'][2], dark=P['yellow'][0]):
    d.rectangle([0, 0, w - 1, h - 1], outline=H(P['bg0']))
    d.rectangle([1, 1, w - 2, h - 2], outline=H(color))
    d.rectangle([2, 2, w - 3, h - 3], outline=H(dark))


def sparkle(d, x, y, r, color='ffffff'):
    d.line([x - r, y, x + r, y], fill=H(color))
    d.line([x, y - r, x, y + r], fill=H(color))


def paste_center(im, sp, cx, cy):
    im.alpha_composite(sp, (int(cx - sp.width / 2), int(cy - sp.height / 2)))


# 1. 큰 젬: 64 격자, 디더 빛 번짐 + 젬 본체 2배(60px). 멀리서도 '빨간 보석' 하나로 읽힌다.
def gem_big():
    im = Image.new('RGBA', (64, 64))
    dither_glow(im, 32, 32, 46, [P['red'][1], P['red'][0], '2a0a14', P['bg0']], bg=P['bg0'])
    paste_center(im, gem('red', 2), 32, 32)
    d = ImageDraw.Draw(im)
    sparkle(d, 55, 9, 3); sparkle(d, 8, 54, 2); d.point((52, 56), fill=H('ffffff'))
    return up(im, 16)


# 2. 살아있는 젬: 32 격자, 빛나는 눈이 달린 루비 = '보석 수호자' 그 자체.
def gem_eyes():
    im = Image.new('RGBA', (32, 32))
    dither_glow(im, 16, 16, 24, [P['red'][0], '2a0a14', P['bg0']], bg=P['bg0'])
    d = ImageDraw.Draw(im)
    c = P['red']
    oct_ = [(9, 3), (22, 3), (28, 9), (28, 22), (22, 28), (9, 28), (3, 22), (3, 9)]
    d.polygon(oct_, fill=H(c[2]), outline=H(P['bg0']))
    d.polygon([(9, 4), (22, 4), (27, 9), (16, 16), (4, 9)], fill=H(c[3]))  # 윗면(밝음)
    d.polygon([(27, 10), (27, 22), (22, 27), (9, 27), (16, 16)], fill=H(c[1]))  # 아랫면(어둠)
    d.polygon([(4, 10), (16, 16), (9, 27), (4, 22)], fill=H(c[2]))
    d.rectangle([7, 6, 9, 7], fill=H(P['bone']))
    for ex in (9, 18):  # 눈: 검은 홈 + 금빛 동공
        d.rectangle([ex, 13, ex + 4, 18], fill=H(P['bg0']))
        d.rectangle([ex + 1, 14, ex + 3, 17], fill=H(P['yellow'][2]))
        d.rectangle([ex + 1, 14, ex + 2, 15], fill=H(P['yellow'][3]))
        d.line([ex - 1, 12, ex + 5, 12], fill=H(c[0]))  # 눈썹 그늘
    d.point((21, 24), fill=H(c[3])); d.point((24, 20), fill=H(c[3]))
    return up(im, 32)


# 3. 석상 클로즈업: 64 격자, 루비 모아이 3배(48x60)가 화면을 꽉 채우고 눈이 빛난다.
def statue_closeup():
    im = Image.new('RGBA', (64, 64))
    dither_glow(im, 32, 28, 44, [P['red'][0], '2a0a14', P['bg0']], bg=P['bg0'])
    st = up(sprite('statues', 'red.png'), 3)
    im.alpha_composite(st, (8, 6))
    d = ImageDraw.Draw(im)
    for x in (4, 58):  # 양옆 기둥 룬
        for y in (14, 24, 34, 44):
            d.rectangle([x, y, x + 1, y + 1], fill=H('ff2b4e'))
    d.rectangle([0, 60, 63, 63], fill=H(P['bg1']))
    d.line([0, 60, 63, 60], fill=H(P['bg2']))
    return up(im, 16)


# 4. 방패 + 젬: 64 격자, 금 테 방패 안에 사파이어. 디펜스 게임이라는 걸 바로 보여 준다.
def shield_gem():
    im = Image.new('RGBA', (64, 64), H(P['bg0']))
    d = ImageDraw.Draw(im)
    pts = [(8, 6), (55, 6), (55, 34), (32, 59), (8, 34)]
    inner = [(12, 10), (51, 10), (51, 32), (32, 54), (12, 32)]
    d.polygon(pts, fill=H(P['yellow'][2]), outline=H(P['bg0']))
    d.polygon(inner, fill=H(P['bg1']), outline=H(P['yellow'][0]))
    d.line([(9, 7), (54, 7)], fill=H(P['yellow'][3]))  # 윗변 하이라이트
    d.line([(9, 7), (9, 33)], fill=H(P['yellow'][3]))
    for x in range(14, 50, 4):  # 안쪽 가로 줄눈
        d.point((x, 12), fill=H(P['bg2']))
    paste_center(im, gem('blue', 1), 32, 29)
    sparkle(d, 44, 18, 2)
    return up(im, 16)


# 5. 제단: 64 격자, 벽돌 지하실 + 제단 위에 떠 있는 루비 + 촛불. 타이틀 분위기.
def altar():
    im = bricks(64, 64, seed=4)
    dither_glow(im, 32, 26, 22, [P['red'][1], P['red'][0], '2a0a14', '221c2b'])
    d = ImageDraw.Draw(im)
    d.rectangle([0, 50, 63, 63], fill=H(P['bg1']))
    d.line([0, 50, 63, 50], fill=H(P['bg2']))
    d.rectangle([20, 42, 43, 50], fill=H(P['bg2']), outline=H(P['bg0']))  # 제단
    d.rectangle([18, 40, 45, 43], fill=H(P['bg3']), outline=H(P['bg0']))
    d.rectangle([22, 44, 41, 44], fill=H(P['yellow'][1]))
    paste_center(im, gem('red', 1), 32, 25)
    for x in (8, 54):  # 촛불
        d.rectangle([x - 1, 44, x + 1, 50], fill=H(P['bone']), outline=H(P['bg0']))
        d.point((x, 42), fill=H(P['yellow'][3])); d.point((x, 41), fill=H(P['yellow'][2]))
    sparkle(d, 46, 12, 2); d.point((16, 16), fill=H('ffffff'))
    frame(d, 64, 64)
    return up(im, 16)


# 6. 로고: 64 격자, 타이틀 로고의 "GEM" 글자 + 루비. 타이틀 화면과 한 세트.
def logo_gem():
    lg = sprite('title', 'logo.png')
    alpha = lg.split()[3]
    rows = [y for y in range(lg.height) if alpha.crop((0, y, lg.width, y + 1)).getbbox()]
    gap = next(y for y in range(rows[0], rows[-1]) if y not in rows)  # GEM / GUARDIANS 사이 빈 줄
    word = lg.crop((0, 0, lg.width, gap)); word = word.crop(word.getbbox())
    im = Image.new('RGBA', (64, 64))
    dither_glow(im, 32, 40, 40, [P['red'][0], '2a0a14', P['bg0']], bg=P['bg0'])
    paste_center(im, word, 32, 16)
    paste_center(im, gem('red', 1), 32, 43)
    d = ImageDraw.Draw(im)
    sparkle(d, 50, 32, 2); sparkle(d, 13, 48, 1)
    frame(d, 64, 64)
    return up(im, 16)


# 7. 라인 폭발: 64 격자, 가로줄 특수 젬이 화면 끝까지 빛줄기를 쏜다. 매치3 쾌감.
def line_blast():
    im = Image.new('RGBA', (64, 64), H(P['bg0']))
    d = ImageDraw.Draw(im)
    rnd = random.Random(2)
    for _ in range(40):  # 속도선
        x, y, w = rnd.randint(0, 60), rnd.randint(4, 60), rnd.randint(3, 10)
        d.line([x, y, x + w, y], fill=H(P['bg2'] if rnd.random() < 0.6 else P['red'][0]))
    d.rectangle([0, 29, 63, 34], fill=H(P['red'][0]))
    d.rectangle([0, 30, 63, 33], fill=H(P['red'][2]))
    d.rectangle([0, 31, 63, 32], fill=H('ffd0d8'))
    paste_center(im, sprite('gems', 'line_h', 'red.png'), 32, 32)
    for x, y in [(6, 10), (58, 52), (50, 8)]: sparkle(d, x, y, 2)
    return up(im, 16)


# 8. 보석 더미: 128 격자(더 고운 도트), 5색 젬이 겹쳐 쌓인 보물 더미. 가운데 루비가 2배로 주인공.
def cluster():
    im = Image.new('RGBA', (128, 128))
    dither_glow(im, 64, 70, 80, [P['red'][0], '2a0a14', P['bg0']], bg=P['bg0'])
    for c, x, y, k in [('red', 64, 70, 2), ('yellow', 40, 44, 1), ('purple', 88, 44, 1), ('blue', 30, 78, 1), ('green', 98, 78, 1)]:  # 루비 뒤, 작은 젬 앞
        paste_center(im, gem(c, k), x, y)
    d = ImageDraw.Draw(im)
    for x, y, r in [(104, 18, 3), (20, 108, 2), (110, 104, 2), (18, 24, 2)]: sparkle(d, x, y, r)
    frame(d, 128, 128)
    return up(im, 8)


# 9. 열린 문: 64 격자, 양쪽으로 열린 문 사이 금빛 빛줄기(디더) 속 루비.
def door_burst():
    im = bricks(64, 64, seed=9)
    dither_glow(im, 32, 30, 30, [P['yellow'][3], P['yellow'][2], P['yellow'][1], P['yellow'][0], '221c2b'])
    d = ImageDraw.Draw(im)
    for x0, x1 in ((4, 21), (42, 59)):  # 문짝(열림)
        d.rectangle([x0, 12, x1, 56], fill=H(P['bg1']), outline=H(P['bg0']))
        d.rectangle([x0 + 2, 14, x1 - 2, 54], outline=H(P['yellow'][1]))
        d.rectangle([x0 + 4, 16, x1 - 4, 52], outline=H(P['bg2']))
        d.rectangle([x1 - 5 if x0 == 4 else x0 + 4, 33, x1 - 4 if x0 == 4 else x0 + 5, 34], fill=H(P['yellow'][3]))  # 손잡이
    d.rectangle([2, 6, 61, 11], fill=H(P['bg2']), outline=H(P['bg0']))  # 상인방(돌)
    d.line([3, 7, 60, 7], fill=H(P['bg3']))
    d.rectangle([0, 56, 63, 63], fill=H(P['bg1'])); d.line([0, 56, 63, 56], fill=H(P['bg2']))
    paste_center(im, gem('red', 1), 32, 32)
    frame(d, 64, 64)
    return up(im, 16)


# 10~12. 조합: 큰 루비(01) + 가로 빛줄기·속도선(07) + 곁에 다른 젬 몇 개(08). 128 격자, 루비 2배(60px).
def streaks(d, w, h, seed, n=70):
    rnd = random.Random(seed)
    for _ in range(n):
        x, y, L = rnd.randint(-4, w), rnd.randint(2, h - 2), rnd.randint(5, 18)
        d.line([x, y, x + L, y], fill=H(P['bg2'] if rnd.random() < 0.6 else P['red'][0]))


def beam(d, w, y, core='ffd0d8', gem_x=None, vertical=False):
    R = (lambda a, b, c, e: d.rectangle([b, a, e, c], fill=_f)) if vertical else (lambda a, b, c, e: d.rectangle([a, b, c, e], fill=_f))
    for _f, t in ((H(P['red'][0]), 5), (H(P['red'][2]), 3), (H(core), 1)):
        R(0, y - t, w, y + t)
    if gem_x:  # 젬 양옆에서 터져 나오는 흰 섬광
        _f = H(P['bone'])
        for x0, x1 in gem_x:
            R(x0, y - 2, x1, y + 2)


def combo_a():
    im = Image.new('RGBA', (128, 128))
    dither_glow(im, 64, 64, 92, [P['red'][0], '2a0a14', P['bg0']], bg=P['bg0'])
    d = ImageDraw.Draw(im)
    streaks(d, 128, 128, 21)
    paste_center(im, gem('blue', 2), 30, 32)
    paste_center(im, gem('green', 2), 98, 30)
    paste_center(im, gem('yellow', 2), 30, 98)
    paste_center(im, gem('purple', 2), 98, 96)
    beam(d, 128, 64, gem_x=[(22, 34), (94, 106)])
    beam(d, 128, 64, gem_x=[(22, 34), (94, 106)], vertical=True)
    paste_center(im, gem('red', 2), 64, 64)
    for x, y, r in [(50, 14, 2), (78, 114, 2), (12, 50, 2), (118, 78, 2)]: sparkle(d, x, y, r)
    frame(d, 128, 128)
    return up(im, 8)


def combo_b():
    """빛줄기 끝에 맞는 젬 둘(파랑·초록)이 흰빛으로 터지는 순간 - '라인 클리어'."""
    im = Image.new('RGBA', (128, 128), H(P['bg0']))
    dither_glow(im, 64, 64, 70, [P['red'][0], '2a0a14', P['bg0']])
    d = ImageDraw.Draw(im)
    streaks(d, 128, 128, 5, 90)
    beam(d, 128, 64)
    for c, x in (('blue', 18), ('green', 110)):
        paste_center(im, gem(c, 1), x, 64)
        d.rectangle([x - 6, 61, x + 6, 67], fill=H('ffffff'))  # 맞은 자리 섬광
        for dx, dy in ((-12, -10), (12, -10), (-12, 10), (12, 10)): d.rectangle([x + dx - 1, 64 + dy - 1, x + dx, 64 + dy], fill=H('ffffff'))
    paste_center(im, gem('red', 2), 64, 64)
    for x, y, r in [(100, 22, 4), (26, 104, 3), (104, 102, 2), (30, 26, 2)]: sparkle(d, x, y, r)
    return up(im, 8)


def combo_c():
    """테두리 없이, 루비는 좌상단으로 살짝 치우치고 우하단에 노랑·보라 젬이 겹친 더미."""
    im = Image.new('RGBA', (128, 128))
    dither_glow(im, 52, 52, 96, [P['red'][0], '2a0a14', P['bg0']], bg=P['bg0'])
    d = ImageDraw.Draw(im)
    streaks(d, 128, 128, 13)
    beam(d, 128, 52, gem_x=[(10, 22), (82, 94)])
    paste_center(im, gem('red', 2), 52, 52)
    paste_center(im, gem('yellow', 2), 96, 94)
    paste_center(im, gem('purple', 1), 66, 104)
    for x, y, r in [(112, 16, 4), (14, 106, 3), (118, 60, 2), (20, 20, 2)]: sparkle(d, x, y, r)
    return up(im, 8)


ICONS = [gem_big, gem_eyes, statue_closeup, shield_gem, altar, logo_gem, line_blast, cluster, door_burst, combo_a, combo_b, combo_c]


def main():
    os.makedirs(OUT, exist_ok=True)
    T, cols = 300, 3
    rows = math.ceil(len(ICONS) / cols)
    sheet = Image.new('RGBA', (20 + cols * (T + 20), 20 + rows * (T + 50)), H(P['bg0']))
    sd = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype('malgun.ttf', 20)
    except OSError:
        font = ImageFont.load_default()
    for i, fn in enumerate(ICONS):
        im = fn()
        assert im.size == (N, N), (fn.__name__, im.size)
        name = f'{i + 1:02d}_{fn.__name__}.png'
        im.save(os.path.join(OUT, name))
        x, y = 20 + (i % cols) * (T + 20), 20 + (i // cols) * (T + 50)
        if fn is combo_a: im.save(os.path.join(ROOT, 'art', 'icons', 'app_icon.png'))  # 확정 시안
        sheet.alpha_composite(im.resize((T, T), Image.NEAREST), (x, y))
        sd.text((x, y + T + 6), name, fill=H(P['bg3']), font=font)
        print('wrote', name)
    sheet.save(os.path.join(OUT, 'preview.png'))


if __name__ == '__main__':
    main()
