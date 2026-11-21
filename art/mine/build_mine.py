#!/usr/bin/env python3
"""저주받은 수정 광산 그림 생성기 (docs/mine.md 15-4, 시안 C).

역할 번호(명도 맵)로 한 번 그리고, 광맥 5색은 V1~V4만 바꿔 뽑는다(팔레트 스왑).
    python art/mine/build_mine.py && python tools/optimize_png.py assets/mine assets/ui
출력: assets/mine/*.png, assets/ui/icons/ore*.png, assets/ui/menu/{btn_mine*,emblem_refinery}.png (게임용, 1배)
      art/mine/preview_*.png (미리보기)
"""
import os
import random

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, 'assets', 'mine')
UI = os.path.join(ROOT, 'assets', 'ui')
PRE = os.path.dirname(os.path.abspath(__file__))

# 역할: 0 투명. V1~V4 = 광맥 색(스왑), 나머지는 고정색.
O, I1, I2, I3, BONE, W1, W2, W3, V1, V2, V3, V4, R1, R2, R3, R4, P1, P2, P3, G3, B3, G2, G4 = range(1, 24)
FIXED = {O: '0d0a10', I1: '221c2b', I2: '3b3347', I3: '655a74', BONE: 'e8dcc0', W1: '3a2808', W2: '7a5212', W3: 'c28a20',
         R1: '3a0814', R2: '741426', R3: 'b82a3c', R4: 'ec6a6a', P1: '220e38', P2: '48206e', P3: '7a3cae', G3: '3a8a3c', B3: '386cbc', G2: '1c5228', G4: '9cd872'}
VEINS = {  # 젬과 같은 계열, 어두움 -> 밝음
    'emerald': ['0c2814', '1c5228', '3a8a3c', '9cd872'],
    'sapphire': ['0c1838', '1c3a76', '386cbc', '8cc4ee'],
    'topaz': ['3a2808', '7a5212', 'c28a20', 'f2d264'],
    'ruby': ['3a0814', '741426', 'b82a3c', 'ec6a6a'],
    'amethyst': ['220e38', '48206e', '7a3cae', 'c48ce6'],
}
DOTS = [G3, B3, W3, R3, P3]  # 5색 광맥의 V3 - 원석 더미에 드문드문 박히는 점
PALETTE = {l.strip().lower() for l in open(os.path.join(ROOT, 'assets', 'characters', 'characters.hex')) if l.strip()}
CH = {'.': 0, 'O': O, 'D': I1, 'M': I2, 'L': I3, 'B': BONE, 'W': W1, 'H': W2, 'h': W3, 'g': G3, 'e': G2, 'G': G4, 'r': R3, 'R': R2, 'q': R4, 'k': R1}


def canvas(w, h):
    im = Image.new('L', (w, h), 0)
    return im, ImageDraw.Draw(im), im.load()


def colorize(im, vein=None):
    lut = dict(FIXED)
    if vein:
        lut.update(zip((V1, V2, V3, V4), VEINS[vein]))
    out = Image.new('RGBA', im.size, (0, 0, 0, 0))
    src, dst = im.load(), out.load()
    for y in range(im.height):
        for x in range(im.width):
            if src[x, y]:
                h = lut[src[x, y]]
                dst[x, y] = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)
    return out


def blob(px, size, pts):
    """pts = {(x,y): 역할}. 둘레 1px 외곽선을 먼저 깔고 그 위에 칠한다(겹친 조각끼리도 갈라진다)."""
    w, h = size
    for (x, y) in pts:
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if 0 <= x + dx < w and 0 <= y + dy < h:
                px[x + dx, y + dy] = O
    for (x, y), c in pts.items():
        if 0 <= x < w and 0 <= y < h:
            px[x, y] = c


def stamp(px, rows, ox, oy, skip='.'):
    """글자 그림을 찍는다. '.'은 건드리지 않는다."""
    for y, line in enumerate(rows):
        for x, ch in enumerate(line):
            if ch != skip:
                px[ox + x, oy + y] = CH[ch]


def grid(rows):
    assert len({len(r) for r in rows}) == 1, rows
    im, d, px = canvas(len(rows[0]), len(rows))
    stamp(px, rows, 0, 0)
    return im


def slabs(px, rnd, x0, y0, x1, y1, hi=True):
    """석판 암벽: 가로 줄눈 7px 간격(군데군데 끊김), 줄마다 어긋난 세로 줄눈. I1 바탕에 O/I2만 쓴다."""
    r = 0
    for y in range(y0 + 6, y1 + 1, 7):
        for x in range(x0, x1 + 1):
            if rnd.random() > 0.12:
                px[x, y] = O
        x = x0 + 8 + (r * 7) % 13
        while x <= x1:
            for yy in range(y - 6, y):
                if yy >= y0 and rnd.random() > 0.1:
                    px[x, yy] = O
            if hi and rnd.random() > 0.45 and x + 2 <= x1:  # 석판 왼쪽 위 모서리 하이라이트
                px[x + 1, max(y0, y - 6)] = I2
                px[x + 2, max(y0, y - 6)] = I2
            x += rnd.choice((13, 16, 19, 22))
        r += 1


def chain(px, x0, y0, x1, y1):
    """쇠사슬: 2px 굵기, 고리 3px마다 끊어 보이게."""
    n = max(abs(x1 - x0), abs(y1 - y0))
    for i in range(n + 1):
        x, y = round(x0 + (x1 - x0) * i / n), round(y0 + (y1 - y0) * i / n)
        px[x, y] = O if i % 3 == 2 else I3
        px[x, y + 1] = O if i % 3 == 2 else I2


# ---------- 광맥 수정 24x24, 3단계 ----------
def shard(cx, base, w, h, lean=0.0, spark=False):
    """뾰족한 기둥. 좌상단 광원: 왼쪽 면 V3, 오른쪽 면 V2, 오른쪽 끝 V1."""
    pts = {}
    for i in range(h):
        cw = min(w, 1 + 2 * (i // 2))
        x0 = cx - cw // 2 + round(lean * (h - 1 - i))
        for k in range(cw):
            c = V3 if k < (cw + 1) // 2 else V2
            if cw >= 4 and k == cw - 1:
                c = V1
            pts[(x0 + k, base - h + 1 + i)] = c
    if spark:  # 3단계만: 끝에 가장 밝은 색 1~2px
        tip = cx + round(lean * (h - 1))
        pts[(tip, base - h + 1)] = V4
        pts[(tip - (1 if w >= 5 else 0), base - h + 3)] = V4
    return pts


STAGES = [  # (cx, 밑동 y, 폭, 높이, 기울기). 1단계 2개·높이 7 이하 / 2단계 5개·최대 14 / 3단계 7개·최대 20
    [(8, 20, 4, 5, -0.2), (13, 20, 5, 7, 0.1)],
    [(11, 20, 5, 14, -0.05), (16, 20, 4, 11, 0.15), (7, 20, 3, 9, -0.2), (19, 20, 3, 6, 0.25), (13, 20, 3, 6, 0.0)],
    [(12, 21, 7, 20, 0.0), (7, 21, 5, 16, -0.14), (17, 21, 5, 17, 0.12), (4, 21, 3, 10, -0.22), (20, 21, 3, 11, 0.16), (10, 21, 3, 8, 0.0), (15, 21, 3, 7, 0.1)],
]


def crystal(stage):
    im, d, px = canvas(24, 24)
    sh = STAGES[stage]
    xs = [s[0] for s in sh]
    base = sh[0][1]
    rub = {}  # 뿌리 암석
    for x in range(min(xs) - 2, max(xs) + 3):
        for y in (base, base + 1):
            rub[(x, y)] = I2 if (y == base and x % 3) else I1
    blob(px, im.size, rub)
    for i, s in enumerate(sh):
        blob(px, im.size, shard(*s, spark=(stage == 2 and i < 3)))
    for x in range(min(xs) - 1, max(xs) + 2):  # 뿌리 앞 자갈이 기둥 밑동을 덮는다
        if x % 4 != 1:
            px[x, base + 1] = I1 if x % 2 else I2
    return im


# ---------- 광맥 줄 배경 180x32 ----------
def row(locked=False):
    W, H = 180, 32
    im, d, px = canvas(W, H)
    rnd = random.Random(7)
    d.rectangle([0, 0, W - 1, H - 1], fill=I1)
    slabs(px, rnd, 0, 4, W - 1, H - 1, hi=not locked)  # 글자 뒤는 I1/O만 - 어둡게
    # 수정 자리: x4..27 y4..27 의 파인 굴(수정 24x24가 여기 올라간다)
    glow = O if locked else V1
    for y in range(4, 29):
        for x in range(2, 31):
            dx, dy = (x - 16) / 14.0, (y - 16) / 12.5
            r2 = dx * dx + dy * dy + rnd.uniform(-0.06, 0.06)
            if r2 < 0.78:
                px[x, y] = O if (r2 < 0.45 or (x + y) % 2) else glow
            elif r2 < 1.0:
                px[x, y] = glow
            elif r2 < 1.3 and (x + y) % 2 == 0 and not locked:
                px[x, y] = V1  # 빛이 암벽에 번지는 디더
    if locked:  # 굴을 X자 사슬로 막고 가운데 자물쇠(글자 뒤는 비워 둔다)
        chain(px, 3, 5, 29, 26)
        chain(px, 29, 5, 3, 26)
        stamp(px, ['.OOO.', 'OLLLO', 'OOOOO', 'OHhHO', 'OHOHO', 'OHHHO', 'OOOOO'], 14, 12)
    else:  # 바닥 줄의 작은 결정
        for x, h in ((40, 2), (57, 3), (61, 2), (83, 2), (102, 3), (106, 2), (126, 2), (149, 3), (153, 2), (167, 2)):
            for i in range(h):
                px[x, 30 - i] = V2
                if i < h - 1:
                    px[x + 1, 30 - i] = V1
            px[x, 30 - h + 1] = V3
    # 버팀목: 위 들보 y0..2, 양쪽 기둥 3px. 줄이 쌓이면 들보가 색 경계를 가린다. 잠긴 줄은 쇠(회색).
    wd, wl = (I1, I2) if locked else (W1, W2)
    d.rectangle([0, 0, W - 1, 2], fill=wd)
    d.line([0, 0, W - 1, 0], fill=wl)
    d.line([0, 3, W - 1, 3], fill=O)
    for x in range(5, W, 9):
        px[x + rnd.choice((0, 1, 2)), 1] = wl  # 나뭇결
    for x0 in (0, W - 3):
        d.rectangle([x0, 0, x0 + 2, H - 1], fill=wd)
        d.line([x0, 3, x0, H - 1], fill=wl)
        for y in range(7, H, 8):
            px[x0, y] = wd
    d.line([3, 4, 3, H - 1], fill=O)
    d.line([W - 4, 4, W - 4, H - 1], fill=O)
    for x0 in (0, W - 5):  # 모서리 쇠 꺾쇠
        d.rectangle([x0, 0, x0 + 4, 4], fill=I2)
        d.line([x0, 0, x0 + 4, 0], fill=I3)
        px[x0 + 2, 2] = BONE
        d.line([x0, 5, x0 + 4, 5], fill=O)
    d.line([0, H - 1, W - 1, H - 1], fill=O)
    return im


# ---------- 원석(저주가 굳은 결정): 회보라 몸체 + 왼쪽 위 뼈색 ----------
CHUNKS = [  # 각진 결정. B = 뼈색(왼쪽 위 모서리), L/M/D = 밝은 면/몸체/그늘
    ['..B..', '.BLM.', '.LMM.', 'LLMMD', '.LMD.', '..D..'],
    ['...BL.', '..LLMM', '.LMMD.', 'LMMD..', '.DD...'],
    ['.BL.', 'LLMM', 'LMMD', '.MDD', '..D.'],
    ['.B.', 'LMD', '.D.'],
    ['.BL..', 'LLMM.', 'LMMMD', '.MMDD', '..DD.'],
    ['.B..', 'LLM.', 'LMMD', 'LMMD', 'LMDD'],  # 5: 선 결정(바닥 평평)
    ['...BL.', '..LLMD', '.LMMD.', 'LMMDD.'],  # 6: 누운 결정
]
ORE_10 = [
    '....OO....',
    '...OBLO...',
    '..OBLMMO..',
    '..OLMMDO..',
    '.OLLMgDOO.',
    '.OLMMMDOLO',
    'OLMMrMDOMO',
    'OLMMMDDMDO',
    '.OMMDDDDO.',
    '..OOOOOO..',
]
ORE_8 = ['...OO...', '..OBLO..', '.OBLLMO.', '.OLLgMO.', 'OLLLMMDO', 'OLLMMDO.', '.OMMDO..', '..OOO...']


def chunk(cx, cy, k, rnd):
    t = CHUNKS[k]
    pts = {}
    for y, line in enumerate(t):
        for x, ch in enumerate(line):
            if ch != '.':
                pts[(cx - len(line) // 2 + x, cy - len(t) // 2 + y)] = I3 if (ch == 'B' and rnd.random() < 0.45) else CH[ch]
    return pts


# ---------- 수레 84x60, 3상태 ----------
RAIL_Y = 54  # 수레 캔버스 안의 레일 윗줄. 작업장 배경은 CART_Y + RAIL_Y 에 같은 레일을 깐다.


def rail(d, x0, x1, y, phase):
    """침목(14px 간격) + 레일 3줄(O / I3 / O). 수레와 작업장이 같은 함수를 써서 픽셀이 맞는다."""
    for x in range(phase - 14, x1, 14):
        if x + 6 >= x0:
            d.rectangle([max(x, x0), y + 2, min(x + 6, x1), y + 4], fill=W1, outline=O)
    d.rectangle([x0, y, x1, y + 2], fill=I2, outline=O)
    d.line([x0 + 1, y + 1, x1 - 1, y + 1], fill=I3)


def cart(state):
    W, H = 84, 60
    im, d, px = canvas(W, H)
    rnd = random.Random(31 + state)
    rail(d, 3, 80, RAIL_Y, 8)
    # 통 안쪽(뒤 벽) - 3/4 시점
    d.polygon([(12, 16), (16, 11), (67, 11), (71, 16)], fill=I1, outline=O)
    d.line([17, 12, 66, 12], fill=I2)
    # 원석 더미(통보다 먼저 그려 앞판이 덮는다)
    if state:
        peak = 10 if state == 1 else 1
        n = 10 if state == 1 else 60
        top = lambda x: 16 - (16 - peak) * max(0.0, 1 - (abs(x - 42) / 30.0) ** 2)  # 가운데가 높은 둥근 더미
        heap = [(x, top(x) + 3, rnd.choice((0, 1, 2, 4))) for x in range(16, 69, 4)]  # 겉면
        for _ in range(n):
            x = rnd.randint(17, 66)
            heap.append((x, rnd.uniform(top(x) + 4, 17), rnd.choice((0, 1, 2, 2, 3, 4))))
        d.polygon([(14, 17)] + [(x, top(x) + 2) for x in range(16, 69, 4)] + [(70, 17)], fill=I1, outline=O)
        for x, y, k in sorted(heap, key=lambda c: c[1]):
            blob(px, im.size, chunk(x, round(y), k, rnd))
        # 5색 광맥 점: 가득 9개 / 반 3개, 몸체(I2) 픽셀 위에만 1px씩
        body = [(x, y) for y in range(1, 15) for x in range(14, 71) if px[x, y] == I2]
        for i, p in enumerate(rnd.sample(body, 9 if state == 2 else 3)):
            px[p] = DOTS[i % 5]
    # 통 앞판: 사다리꼴 나무판 + 쇠 띠
    d.polygon([(9, 16), (74, 16), (68, 41), (15, 41)], fill=W1, outline=O)  # 어두운 나무가 바탕
    for x in range(18, 68, 8):  # 판자 이음 + 왼쪽 위에서 받는 빛
        d.line([x, 20, x, 37], fill=O)
        d.line([x + 1, 20, x + 1, 30 if x < 40 else 24], fill=W2)
    d.line([11, 20, 11, 30], fill=W2)
    d.line([10, 20, 72, 20], fill=W2)
    d.rectangle([9, 16, 74, 19], fill=I2, outline=O)  # 윗 테
    d.line([10, 17, 73, 17], fill=I3)
    d.rectangle([15, 37, 68, 40], fill=I2, outline=O)  # 아랫 테
    for x in (23, 59):  # 세로 띠
        d.rectangle([x, 19, x + 3, 37], fill=I2, outline=O)
        d.line([x + 1, 20, x + 1, 36], fill=I3)
    for x in range(14, 72, 9):
        px[x, 18] = BONE  # 리벳
    px[12, 21] = W3  # 왼쪽 위 나무 하이라이트(점만)
    # 차대 + 바퀴
    d.rectangle([17, 42, 66, 45], fill=I1, outline=O)
    for cx in (27, 57):
        d.ellipse([cx - 6, 43, cx + 6, 55], fill=I1, outline=O)
        d.ellipse([cx - 4, 45, cx + 4, 53], outline=I2)
        d.arc([cx - 4, 45, cx + 4, 53], 150, 290, fill=I3)
        d.rectangle([cx - 1, 48, cx + 1, 50], fill=I3)
        px[cx - 1, 48] = BONE
    if state == 2:  # 넘친 조각: 테 위와 바닥
        for x, y, k in ((11, 12, 6), (72, 12, 5), (77, 51, 5), (6, 52, 6), (71, 52, 6)):
            blob(px, im.size, chunk(x, y, k, rnd))
    return im


def sparkle():
    """가득 찬 수레 반짝임 2프레임(7x7 조각). 코드가 더미 위 몇 곳에 번갈아 찍는다."""
    im, d, px = canvas(14, 7)
    for x, y in ((3, 3), (3, 2), (3, 4), (2, 3), (4, 3)):
        px[x, y] = BONE
    for x, y in ((10, 3), (10, 1), (10, 2), (10, 4), (10, 5), (8, 3), (9, 3), (11, 3), (12, 3)):
        px[x, y] = BONE
    return im


# ---------- 정제소 83x60 + 불 조각 19x15 x 4 ----------
FIRE_AT = (25, 40)  # 정제소 캔버스 안에서 불 조각이 놓이는 왼쪽 위


def fire(f):
    """아궁이 불. 혀 3갈래가 프레임마다 엇갈려 오르내린다. 빨강 계열 + 금갈색(W3)만 - 노란 빛은 토파즈 것."""
    W, H = 19, 15
    im, d, px = canvas(W, H)
    d.rectangle([0, 0, W - 1, H - 1], fill=R1)
    tongues = list(zip((3, 9, 15), ((7, 13, 8), (11, 9, 12), (8, 14, 6), (12, 8, 10))[f]))
    for x in range(W):
        c0, h0 = max(tongues, key=lambda t: t[1] - 2.4 * abs(x - t[0]))
        h = max(2, round(h0 - 2.4 * abs(x - c0)))
        for i in range(h):  # i = 불꽃 끝에서부터
            t = i / h
            px[x, H - h + i] = R2 if t < 0.3 else W3 if (t >= 0.6 and abs(x - c0) <= 1 and h > 5) else R3
    c0, h0 = max(tongues, key=lambda t: t[1])
    px[c0, H - h0] = R4  # 가장 높은 혀 끝 1px
    return im


LIFT = 10  # 건물을 이만큼 올리고 그 아래에 간판을 둔다
FIRE_AT = (25, 40 - LIFT)  # 정제소 캔버스 안에서 불 조각이 놓이는 왼쪽 위
SIGN = (1, 47, 81, 59)  # 간판 사각형. 글자 2줄 자리 = x4..78, y49..57


def refinery():
    W, H = 83, 60
    im, d, px = canvas(W, H + LIFT)  # 원래 좌표로 그리고 마지막에 LIFT만큼 올려 자른다
    # 몸통(돌 용광로)
    d.rectangle([4, 22, 62, 56], fill=I2, outline=O)
    for y in (29, 36, 43, 50):
        d.line([5, y, 61, y], fill=O)
    for r, y in enumerate((23, 30, 37, 44, 51)):
        for x in range(9 + (r % 2) * 6, 61, 12):
            d.line([x, y, x, y + 5], fill=O)
            px[x + 1, y] = I3
            px[x + 2, y] = I3
    for y in range(23, 56):  # 오른쪽은 한 단계 어두운 단색 그늘
        for x in range(53, 62):
            if px[x, y] in (I2, I3):
                px[x, y] = I1
    d.rectangle([2, 19, 64, 22], fill=I3, outline=O)  # 처마
    d.line([3, 21, 63, 21], fill=I2)
    # 아궁이: 돌 아치 + 안쪽 불
    d.ellipse([19, 27, 49, 53], fill=I3, outline=O)
    d.rectangle([19, 40, 49, 56], fill=I3, outline=O)
    for x, y in ((21, 36), (24, 31), (30, 28), (38, 28), (44, 31), (47, 36), (20, 46), (48, 46)):
        px[x, y] = O  # 아치 돌 이음
        px[x, y + 1] = O
    d.ellipse([23, 31, 45, 51], fill=R1, outline=O)
    d.rectangle([23, 40, 45, 56], fill=R1, outline=O)
    d.rectangle([24, 40, 44, 41], fill=R1)
    im.paste(fire(0), (FIRE_AT[0], FIRE_AT[1] + LIFT))
    d.rectangle([23, 55, 45, 56], fill=I1, outline=O)  # 재받이
    for x in range(26, 44, 4):
        px[x, 55] = I2
    for x, y in ((17, 44), (18, 51), (51, 43), (50, 50), (34, 25)):  # 열로 달궈진 틈(점만)
        px[x, y] = R2
    # 도가니: 팔걸이 + 사슬 + 솥 + 받침
    d.rectangle([62, 25, 79, 27], fill=I1, outline=O)
    d.line([63, 26, 78, 26], fill=I2)
    for y in range(28, 31):
        px[72, y] = I3 if y % 2 else O
    d.polygon([(65, 33), (79, 33), (77, 45), (67, 45)], fill=I2, outline=O)
    d.line([67, 35, 68, 43], fill=I3)
    d.line([76, 35, 75, 43], fill=I1)
    d.rectangle([64, 31, 80, 34], fill=I3, outline=O)
    d.line([66, 32, 78, 32], fill=R3)  # 녹은 원석
    px[69, 32] = W3
    px[74, 32] = W3
    px[71, 32] = R4
    d.rectangle([66, 48, 78, 56], fill=I1, outline=O)  # 주형 받침
    d.line([67, 49, 77, 49], fill=I2)
    d.rectangle([69, 46, 75, 48], fill=W2, outline=O)  # 굳은 덩이
    px[70, 47] = W3
    im = im.crop((0, LIFT, W, H + LIFT))
    d, px = ImageDraw.Draw(im), im.load()
    # 굴뚝(올린 뒤에 그린다 - 위가 잘리지 않게)
    d.rectangle([10, 3, 24, 10], fill=I2, outline=O)
    d.line([11, 4, 11, 9], fill=I3)
    d.rectangle([21, 4, 23, 9], fill=I1)
    d.rectangle([8, 1, 26, 4], fill=I3, outline=O)
    d.line([9, 3, 25, 3], fill=I2)
    px[13, 7] = BONE
    px[19, 7] = BONE
    # 간판: 가로로 긴 어두운 판(글자 2줄). 건물이 이 위에 선다.
    d.rectangle(list(SIGN), fill=O, outline=O)
    d.rectangle([SIGN[0] + 1, SIGN[1] + 1, SIGN[2] - 1, SIGN[3] - 1], outline=I2)
    d.line([SIGN[0] + 1, SIGN[1] + 1, SIGN[2] - 1, SIGN[1] + 1], fill=I3)
    for x, y in ((3, 49), (79, 49), (3, 57), (79, 57)):
        px[x, y] = BONE  # 모서리 못
    return im


# ---------- 용광로 작업장 배경 180x119 ----------
REF_AT, CART_AT = (4, 9), (92, 9)  # 정제소·수레를 놓는 자리(네이티브). 목업과 manifest가 이 값을 쓴다.


def workshop():
    W, H = 180, 119
    im, d, px = canvas(W, H)
    rnd = random.Random(11)
    d.rectangle([0, 0, W - 1, H - 1], fill=I1)
    slabs(px, rnd, 0, 8, W - 1, 61)
    for _ in range(26):  # 정제소 쪽 벽은 열로 틈이 붉다
        x, y = rnd.randint(4, 88), rnd.randint(9, 60)
        if px[x, y] == O:
            px[x, y] = R1 if rnd.random() < 0.7 else R2
    # 들보(이름 글자 자리, 어둡게) + 기둥 3개
    d.rectangle([0, 0, W - 1, 7], fill=W1, outline=O)
    d.line([1, 1, W - 2, 1], fill=W2)
    for x0 in (0, 88, W - 3):
        d.rectangle([x0, 7, x0 + 2, 61], fill=W1)
        d.line([x0, 8, x0, 61], fill=W2)
        d.line([x0 + 3, 8, x0 + 3, 61], fill=O)
        d.rectangle([x0 - (1 if x0 else 0), 6, x0 + 3, 9], fill=I2, outline=O)
    # 바닥 + 레일(수레 레일과 같은 높이로 좌우 끝까지)
    d.rectangle([0, 62, W - 1, 70], fill=I1, outline=O)
    rail(d, 0, W - 1, CART_AT[1] + RAIL_Y, (CART_AT[0] + 8) % 14)
    d.line([1, 69, W - 2, 69], fill=I2)
    # 바닥 턱 아래(버튼 줄이 덮는 곳)와 그 아래 기초벽
    slabs(px, rnd, 0, 71, W - 1, 95, hi=False)
    d.line([0, 96, W - 1, 96], fill=O)
    d.line([0, 97, W - 1, 97], fill=I2)
    slabs(px, rnd, 0, 98, W - 1, H - 1)
    for x, y, k in ((14, 114, 0), (22, 115, 2), (30, 116, 3), (58, 115, 1), (66, 116, 3), (96, 115, 4)):  # 굴러 떨어진 원석
        blob(px, im.size, chunk(x, y, k, rnd))
    # 봉인된 심층 문(P2 자리): 오른쪽 아래 돌 아치 + 쇠창살 + X자 사슬 + 자물쇠, 틈으로 보라빛
    x0, x1, y0, y1 = 124, 172, 100, 118
    d.ellipse([x0, y0, x1, y0 + 26], fill=I3, outline=O)
    d.rectangle([x0, y0 + 13, x1, y1], fill=I3, outline=O)
    for x, y in ((127, 107), (133, 102), (142, 100), (154, 100), (163, 102), (169, 107)):
        px[x, y] = O
        px[x, y + 1] = O
    d.ellipse([x0 + 4, y0 + 4, x1 - 4, y0 + 26], fill=O)
    d.rectangle([x0 + 4, y0 + 13, x1 - 4, y1], fill=O)
    for y in range(y0 + 6, y1):
        for x in range(x0 + 6, x1 - 5):
            if px[x, y] == O and (x + y) % 2 == 0 and abs(x - 148) < 14 - (y - y0) * 0.3:
                px[x, y] = P1
    for x in range(x0 + 8, x1 - 5, 6):  # 창살
        for y in range(y0 + 5, y1):
            if px[x, y] in (O, P1):
                px[x, y] = I2
    chain(px, x0 + 5, y0 + 7, x1 - 5, y1 - 2)
    chain(px, x1 - 5, y0 + 7, x0 + 5, y1 - 2)
    stamp(px, ['.OOO.', 'OLLLO', 'OOOOO', 'OHhHO', 'OHOHO', 'OHHHO', 'OOOOO'], 146, 106)
    px[140, 115] = P3
    px[157, 111] = P2
    px[153, 116] = P3
    d.line([0, H - 1, W - 1, H - 1], fill=O)
    return im


# ---------- 메뉴 아이콘 btn_mine / 문장 emblem_refinery (기존 틀을 그대로 가져와 속만 바꾼다) ----------
MINE_ICON = [  # 16x16, 버튼 안쪽(4,4)에. 곡괭이(머리 2px, 뼈색 윗모서리) + 오른쪽 아래 수정 덩어리
    '....OOOOOO......',
    '..OOBBBBBBOO....',
    '.OBBLLLLLLLBO...',
    'OBLLOOHHOOLLLO..',
    'OLLO.OHHO.OLLO..',
    'OLO.OHHO...OLO..',
    '.O.OHHO.....O...',
    '..OHHO..........',
    '.OHHO.....O.....',
    'OHHO.....OGO.O..',
    'OHO.....OggOOgO.',
    '.O......OgeOgeO.',
    '.......OOgeOgeO.',
    '......OgOgeegeO.',
    '......OLLLLLLLLO',
    '.......OOOOOOOO.',
]
assert all(len(r) == 16 for r in MINE_ICON)
REFINERY_ICON = [  # 16x12, 문장 안쪽(4,6)에. 도가니 + 불
    '.......OO.......',
    '......OrqO......',
    '.....OrhrRO.....',
    '....ORrhhrO.....',
    '..OOOOOOOOOOOO..',
    '..OBLLLLLLLLMO..',
    '..OOrrhrrqrrOO..',
    '...OLMMMMMMDO...',
    '...OLMMMMMDDO...',
    '....OMMMMDDO....',
    '...OOOOOOOOOO...',
    '...ODO....ODO...',
]


def rgba_swap(img, swaps):
    px = img.load()
    for y in range(img.height):
        for x in range(img.width):
            h = '%02x%02x%02x' % px[x, y][:3]
            if px[x, y][3] and h in swaps:
                s = swaps[h]
                px[x, y] = (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16), 255)


def paint(img, rows, ox, oy):
    px = img.load()
    for y, line in enumerate(rows):
        for x, ch in enumerate(line):
            if ch != '.':
                h = FIXED[CH[ch]]
                px[ox + x, oy + y] = (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def btn_mine(pressed):
    """btn_shop(+pressed)의 틀을 그대로 쓰고 테두리 색만 초록(에메랄드 = 첫 광맥)으로, 속 그림만 새로."""
    img = Image.open(os.path.join(UI, 'menu', 'btn_shop_pressed.png' if pressed else 'btn_shop.png')).convert('RGBA')
    px = img.load()
    rgba_swap(img, {'8cc4ee': '9cd872', '386cbc': '3a8a3c', '1c3a76': '1c5228'})
    fill = (0x22, 0x1c, 0x2b, 255) if pressed else (0x3b, 0x33, 0x47, 255)
    for y in range(4, 20):
        for x in range(4, 20):
            px[x, y] = fill
    paint(img, MINE_ICON, 4, 5 if pressed else 4)  # 눌림은 기존 버튼처럼 1px 아래
    if pressed:  # 아래로 밀린 맨 아랫줄은 안쪽 테두리(행 20) 위에 겹치지 않게 지운다
        for x in range(4, 20):
            px[x, 20] = (0x0d, 0x0a, 0x10, 255)
    return img


def emblem_refinery():
    """emblem_coupon의 팔각 금테를 그대로 쓰고 가운데만 도가니로."""
    img = Image.open(os.path.join(UI, 'menu', 'emblem_coupon.png')).convert('RGBA')
    px = img.load()
    for y in range(7, 17):
        for x in range(4, 20):
            edge = x in (4, 19) or (y in (7, 16) and x in (5, 18))
            px[x, y] = (0x3b, 0x33, 0x47, 255) if edge else (0x22, 0x1c, 0x2b, 255)
    paint(img, REFINERY_ICON, 4, 6)
    return img


def sheet(frames):
    w, h = frames[0].size
    out = Image.new('L', (w * len(frames), h), 0)
    for i, f in enumerate(frames):
        out.paste(f, (i * w, 0))
    return out


def check(name, img, frame_w=None, sprite=False):
    px = img.load()
    cols = set()
    bad = []
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if a not in (0, 255):
                bad.append('alpha')
            if a:
                cols.add('%02x%02x%02x' % (r, g, b))
    if cols - PALETTE:
        bad.append('팔레트 밖 %s' % sorted(cols - PALETTE))
    if len(cols) > 16:
        bad.append('색 %d > 16' % len(cols))
    if frame_w and img.width % frame_w:
        bad.append('프레임 폭')
    if sprite:  # 가장자리 1px: 비었거나 외곽선이어야 한다(그림이 잘리지 않음)
        fw = frame_w or img.width
        for f in range(img.width // fw):
            edge = [(f * fw + x, y) for x in (0, fw - 1) for y in range(img.height)] + [(f * fw + x, 0) for x in range(fw)]
            if any(px[p][3] and px[p][:3] != (0x0d, 0x0a, 0x10) for p in edge):
                bad.append('가장자리 잘림 f%d' % f)
    print('%-26s %4dx%-3d colors %2d  %s' % (name, img.width, img.height, len(cols), 'FAIL ' + ', '.join(sorted(set(bad))) if bad else 'ok'))
    return not bad


def main():
    os.makedirs(OUT, exist_ok=True)
    ok = True
    jobs = []  # (폴더, 파일, RGBA, 프레임 폭, 스프라이트 여부)
    row_map, cry_map = row(), sheet([crystal(s) for s in range(3)])
    for vid in VEINS:
        jobs.append((OUT, 'row_%s.png' % vid, colorize(row_map, vid), None, False))
        jobs.append((OUT, 'crystals_%s.png' % vid, colorize(cry_map, vid), 24, True))
    jobs += [
        (OUT, 'row_locked.png', colorize(row(locked=True)), None, False),
        (OUT, 'cart.png', colorize(sheet([cart(s) for s in range(3)])), 84, True),
        (OUT, 'cart_sparkle.png', colorize(sparkle()), 7, True),
        (OUT, 'workshop.png', colorize(workshop()), None, False),
        (OUT, 'refinery.png', colorize(refinery()), None, True),
        (OUT, 'refinery_fire.png', colorize(sheet([fire(f) for f in range(4)])), 19, False),
        (os.path.join(UI, 'icons'), 'ore.png', colorize(grid(ORE_10)), None, False),
        (os.path.join(UI, 'icons'), 'ore_small.png', colorize(grid(ORE_8)), None, False),
        (os.path.join(UI, 'menu'), 'btn_mine.png', btn_mine(False), None, False),
        (os.path.join(UI, 'menu'), 'btn_mine_pressed.png', btn_mine(True), None, False),
        (os.path.join(UI, 'menu'), 'emblem_refinery.png', emblem_refinery(), None, False),
    ]
    for folder, name, img, fw, sp in jobs:
        img.save(os.path.join(folder, name))
        ok &= check(name, img, fw, sp)

    # ---- 미리보기(3~8배) ----
    op = lambda *p: Image.open(os.path.join(*p)).convert('RGBA')
    S = 3
    pv = Image.new('RGBA', (180, 32 * 6), (0x0d, 0x0a, 0x10, 255))
    for i, vid in enumerate(VEINS):
        pv.alpha_composite(op(OUT, 'row_%s.png' % vid), (0, i * 32))
        cs = op(OUT, 'crystals_%s.png' % vid)
        for s in range(3):  # 3단계 나란히(비교용)
            pv.alpha_composite(cs.crop((s * 24, 0, s * 24 + 24, 24)), ((4, 60, 96)[s], i * 32 + 4))
    pv.alpha_composite(op(OUT, 'row_locked.png'), (0, 160))
    pv.resize((pv.width * S, pv.height * S), Image.NEAREST).save(os.path.join(PRE, 'preview_rows.png'))

    ws = op(OUT, 'workshop.png')  # 작업장 + 정제소 + 수레 3상태
    wv = Image.new('RGBA', (180, 119 * 3), (0, 0, 0, 255))
    c = op(OUT, 'cart.png')
    for s in range(3):
        wv.alpha_composite(ws, (0, s * 119))
        wv.alpha_composite(op(OUT, 'refinery.png'), (REF_AT[0], s * 119 + REF_AT[1]))
        wv.alpha_composite(c.crop((s * 84, 0, s * 84 + 84, 60)), (CART_AT[0], s * 119 + CART_AT[1]))
    wv.resize((wv.width * S, wv.height * S), Image.NEAREST).save(os.path.join(PRE, 'preview_workshop.png'))

    # 아이콘: 골드·다이아 옆 원석(2배 = 게임 표시), 메뉴 버튼 줄, 문장 줄, 불 4프레임 - 8배 확대
    iv = Image.new('RGBA', (190, 64), (0x22, 0x1c, 0x2b, 255))
    x = 2
    for p in (('icons', 'gold.png'), ('icons', 'diamond.png'), ('icons', 'ore.png'), ('icons', 'ore_small.png')):
        im = op(UI, *p)
        iv.alpha_composite(im, (x, 2 + (16 - im.height) // 2))
        x += im.width + 3
    x = 2
    for n in ('btn_shop', 'btn_mail', 'btn_mine', 'btn_mine_pressed'):
        iv.alpha_composite(op(UI, 'menu', n + '.png'), (x, 20))
        x += 26
    for n in ('emblem_settings', 'emblem_coupon', 'emblem_refinery'):
        iv.alpha_composite(op(UI, 'menu', n + '.png'), (x - 104 + 2, 44) if False else (x, 20))
        x += 26
    iv.alpha_composite(op(OUT, 'refinery_fire.png'), (2, 47))
    iv.resize((iv.width * 8, iv.height * 8), Image.NEAREST).save(os.path.join(PRE, 'preview_icons.png'))
    ref, fr, frames = op(OUT, 'refinery.png'), op(OUT, 'refinery_fire.png'), []
    for f in range(4):
        im = Image.new('RGBA', ref.size, (0x22, 0x1c, 0x2b, 255))
        im.alpha_composite(ref)
        im.alpha_composite(fr.crop((f * 19, 0, f * 19 + 19, 15)), FIRE_AT)
        frames.append(im.resize((ref.width * 4, ref.height * 4), Image.NEAREST).convert('P', palette=Image.ADAPTIVE))
    frames[0].save(os.path.join(PRE, 'preview_fire.gif'), save_all=True, append_images=frames[1:], duration=160, loop=0)
    print('ALL OK' if ok else 'CHECK FAILED')
    raise SystemExit(0 if ok else 1)


if __name__ == '__main__':
    main()
