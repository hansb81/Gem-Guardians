"""Gem Guardians 수호자 목업 빌드. 실행: python build_mockup.py  (이 파일이 그림의 원본)"""
import json
import os
import sys
from PIL import Image

W, H = 20, 26
OUT = os.path.dirname(os.path.abspath(__file__))
OUTLINE = "0d0a10"
BASE = ("0d0a10 221c2b 3b3347 655a74 e8dcc0 0c1838 1c3a76 386cbc 8cc4ee 220e38 48206e 7a3cae c48ce6 "
        "3a0814 741426 b82a3c ec6a6a 3a2808 7a5212 c28a20 f2d264 0c2814 1c5228 3a8a3c 9cd872 "
        "d4a88c 8a5a4a a59cb2").split()  # assets/characters/characters.hex
sys.stdout.reconfigure(encoding="utf-8")
NEON = {"red": ["ff2b4e", "ffb3c0"], "blue": ["3ff0ff", "c8fbff"], "yellow": ["ffe14a", "fff3b8"],
        "green": ["b8ff3c", "eaffb0"], "purple": ["d94dff", "f2c4ff"]}


def rgb(h):
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def render(rows, key, particles=""):
    """rows: [(y, x0, 'chars')], '.'=건너뜀. particles 글자는 외곽선을 두르지 않는다."""
    img = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    solid = set()
    for y, x0, s in rows:
        for i, ch in enumerate(s):
            if ch == ".":
                continue
            x = x0 + i
            assert 0 <= x < W and 0 <= y < H, (x, y)
            img.putpixel((x, y), rgb(key[ch]))
            if ch not in particles:
                solid.add((x, y))
    for y in range(H):
        for x in range(W):
            if img.getpixel((x, y))[3] == 0 and any(
                    (x + dx, y + dy) in solid for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                img.putpixel((x, y), rgb(OUTLINE))
    return img


IDLE_FRAMES, IDLE_MS = 4, (140, 180, 180, 140)  # 올라간 프레임(1·2)을 길게
ATTACK_FRAMES, ATTACK_MS = 6, (80, 80, 80, 120, 80, 80)  # f3 = 발사 강조
FIRE_FRAME, MUZZLE = 3, (16, 5)  # muzzle = f3 결정 중심(원본 픽셀 좌표)

IGNIS_KEY = {"h": "3a0814", "H": "741426", "R": "b82a3c", "p": "ec6a6a", "k": "221c2b", "K": "3b3347",
             "G": "655a74", "e": "ff2b4e", "E": "ffb3c0", "g": "c28a20", "w": "3a2808", "n": "7a5212",
             "c": "e8dcc0", "y": "d4a88c", "*": "ff2b4e", "+": "ec6a6a", "!": "ffb3c0", "s": "655a74"}
CRYSTAL = {"normal": ("p", "RpH", "RRH", "HHH"), "dark": ("R", "HRH", "HHH", "hHh"),
           "spent": ("H", "HHH", "HHH", "hHh"), "bright": ("E", "pEp", "pEp", "RpR"),
           "flare": ("e", "pep", "eEe", "pep")}  # flare: 중심 ffb3c0 + ff2b4e 십자
STAFF_UP = ((7, 24, 16),)  # (y부터, y까지, x) - 수직 자루


def _ignis(hy=0, sy=0, crystal="normal", cx=15, cy=3, shaft=STAFF_UP, flame=(), embers=(), eye="eE",
           hem="RR", tip_dx=0, flap=False):
    """v2 이그니스 한 프레임. hy = 머리(후드) 세로 이동, sy = 어깨·망토·소매·손 세로 이동(-1 위, +1 아래),
    cx/cy = 결정 왼쪽 위(3x4, 첫 줄은 가운데 1px), shaft = 자루 구간들, hem = 밑단 틈 불빛 2px,
    tip_dx = 후드 끝 가로 날림, flap = 로브 뒤 자락 1px 날림(밑단 3줄은 고정)."""
    c = CRYSTAL[crystal]
    wood = [(y, x) for y0, y1, x in shaft for y in range(y0, y1 + 1)]
    staff = [(cy, cx + 1, c[0]), (cy + 1, cx, c[1]), (cy + 2, cx, c[2]), (cy + 3, cx, c[3])] +             [(y, x, "n" if i in (4, 13) else "w") for i, (y, x) in enumerate(wood)]
    head = [  # 뒤로 처진 뾰족 후드, 그림자 속 눈
        (5, 5 + tip_dx, "RH"), (6, 5 + tip_dx, "RRH"), (7, 5, "RRHHH"),
        (8, 5, "RRHHHHhh"),
        (9, 5, "RHHHhkkk"),
        (10, 5, "RHHhk" + eye + "k"),
        (11, 5, "HHHhhkkh"),
    ]
    shoulders = [  # 견갑(뿔 + 용암 균열) / 깃 + 금 걸쇠 / 가슴 루비 / 벨 소매와 손
        (9, 2, "G"), (10, 2, "K"), (11, 2, "KK"),
        (12, 3, "GGKKKKKKkg"),
        (13, 2, "GKRpKkHcpRH"),
        (14, 2, "KKkRkHHpRHHRR"),
        (15, 3, "nnnnHHRHHhHHy"),
    ]
    neck = [(11 + sy, 5, "HHHhhkkh")] if hy < sy else []  # 머리만 먼저 올라가면 목이 1px 늘어난다
    # 허리 줄: 어깨가 내려오면 접혀 사라지고, 올라가면 한 줄 늘어난다(소매 끝은 팔을 따라간다)
    waist = {1: [], 0: [(16, 5, "HhHHHHh"), (16, 13, "Hh")],
             -1: [(15, 5, "HhHHHHh"), (16, 5, "HhHHHHh"), (15, 13, "Hh")]}[sy]
    lower = [
        (17, 5, "kkkkggk"),  # 허리띠 + 화염 부적
        # 로브: 사선 주름, 뒤(왼쪽)로 벌어짐
        (18, 4, "HHhRRgeh"),
        (19, 4, "HhRRHgnh"),
        (20, 3, "HhRRHHHRh"),
        (21, 2, "HhRRHHhRRHh"),
        (22, 1, "HhRRHHhRRHHh"),
        (23, 1, "hRR" + hem[0] + "HhR" + hem[1] + "HHHh"),
        (24, 1, "hHH.HhH.HH.h"),
    ]
    if flap:
        lower += [(19, 3, "H"), (20, 2, "H"), (21, 1, "H")]
    move = lambda part, d: [(y + d, x, t) for y, x, t in part]
    rows = staff + list(flame) + move(shoulders, sy) + neck + move(head, hy) + waist + lower + list(embers)
    return render(rows, IGNIS_KEY, particles="*+!s")


def ignis(frame=0):
    # idle(숨 들이쉬기): 머리가 먼저 1px 올라가고(1) 어깨·망토·소매가 한 프레임 늦게 따라온다(2).
    # 내려올 때도 머리가 먼저(3), 어깨는 다음 프레임(0). 허리띠 아래와 지팡이 자루는 고정.
    flame = ([(1, 16, "e"), (2, 15, "eE")], [(1, 15, "e"), (2, 15, "Ee")],
             [(1, 16, "E"), (2, 15, "ee")], [(1, 17, "e"), (2, 16, "Ee")])[frame]
    # 불씨 3개: 정해진 열에서 매 프레임 1px씩 오르다 사라지고 아래에서 다시 나온다(4프레임 순환)
    embers = [(base - (frame + phase) % 4, x, ch) for x, base, phase, ch in
              ((1, 7, 0, "*"), (18, 11, 2, "*"), (0, 18, 1, "+"))]  # 19열은 비운다
    return _ignis(hy=(0, -1, -1, 0)[frame], sy=(0, 0, -1, -1)[frame], flame=flame, embers=embers,
                  eye="EE" if frame == 2 else "eE", hem="ee" if frame in (2, 3) else "RR")


def ignis_attack(frame=0):
    # 발·밑단은 6프레임 고정. 19열은 쓰지 않는다(결정 외곽선이 18열이라 결정은 16열보다 앞으로 못 간다 →
    # 앞 기울기는 지팡이 발을 뒤로 빼서 만든다).
    if frame == 0:  # 준비: idle 1번 프레임과 동일
        return ignis(1)
    return _ignis(**[
        None,
        # 예비동작: 웅크림 + 지팡이 윗부분을 몸 쪽으로(자루 위 8행 1px, 결정 2px), 결정 어둡게
        dict(hy=1, sy=1, crystal="dark", cx=13, shaft=((7, 14, 15), (15, 24, 16))),
        # 들어올림/차지: 상체 1px 위, 지팡이 수직 + 1px 위(아직 1px 뒤 - f3에서 결정이 앞으로 나간다), 결정 밝게
        dict(hy=-1, sy=-1, crystal="bright", cx=14, cy=2, shaft=((6, 23, 15),), eye="EE",
             embers=[(3, 12, "*"), (1, 17, "*")]),
        # 발사: 대각선 지팡이(발이 2px 뒤로), 결정 플레어, 후드 끝·뒤 자락 반동
        dict(crystal="flare", shaft=((7, 12, 16), (13, 18, 15), (19, 24, 14)), flame=[(2, 16, "E")], eye="EE",
             hem="ee", tip_dx=-1, flap=True, embers=[(4, 18, "!"), (5, 18, "!"), (6, 18, "*")]),
        # 반동: 끝만 1px 앞에 남음(자루 15열, 결정 중심 16열), 결정 식음 + 연기
        dict(crystal="spent", shaft=((7, 24, 15),), embers=[(1, 16, "s"), (0, 17, "s"), (9, 18, "+")]),
        # 복귀: idle 0번 프레임과 같은 자세·결정·불꽃(다음 idle로 이어진다)
        dict(flame=[(1, 16, "e"), (2, 15, "eE")],
             embers=[(7, 1, "*"), (9, 18, "*"), (17, 0, "+")]),
    ][frame])


FROST_KEY = {"D": "0c1838", "N": "1c3a76", "b": "386cbc", "a": "8cc4ee", "c": "e8dcc0", "k": "221c2b",
             "K": "3b3347", "G": "655a74", "t": "3ff0ff", "T": "c8fbff",
             "1": "e8dcc0", "2": "c8fbff", "3": "8cc4ee", "4": "386cbc"}  # 숫자 = 외곽선 없는 효과 픽셀
# 결정 4x5(첫·끝 줄은 가운데 2px). flare: 중심 c8fbff + 3ff0ff 십자, muzzle = 그 중심
ICE = {"normal": ("ab", "aabb", "atbb", "bbbN", "bN"), "pulse": ("ab", "aabb", "aTbb", "bbbN", "bN"),
       "dark": ("bN", "bbNN", "bNNN", "NNND", "ND"), "bright": ("aT", "aTTa", "TtTa", "aaab", "ab"),
       "flare": ("ta", "ataa", "tTta", "ataa", "ab")}
FROST_MUZZLE = (15, 4)


def _frost(hy=0, sy=0, crystal="normal", cx=14, cy=2, shaft=STAFF_UP, eye="tT", fx=(), hem="c"):
    """프로스트 한 프레임. hy = 머리(가시+후드), sy = 어깨 결정·깃·가슴·소매·손 세로 이동(-1 위, +1 아래),
    cx/cy = 결정 왼쪽 위(4x5), shaft = 자루 구간들, fx = 외곽선 없는 효과 픽셀, hem = 밑단 서리 점 1개 색."""
    c = ICE[crystal]
    wood = [(y, x) for y0, y1, x in shaft for y in range(y0, y1 + 1)]
    staff = [(cy, cx + 1, c[0]), (cy + 1, cx, c[1]), (cy + 2, cx, c[2]), (cy + 3, cx, c[3]), (cy + 4, cx + 1, c[4])] +             [(y, x, "a" if i in (2, 7, 14) else "K" if i in (5, 6, 11, 12) else "G") for i, (y, x) in enumerate(wood)]
    head = [  # 얼음 가시 3개(가운데가 높다) + 곧게 선 후드, 얼음색 테두리, 창백한 눈
        (5, 8, "a"),
        (6, 6, "a"), (6, 8, "b"), (6, 10, "a"),
        (7, 6, "bNNNb"),
        (8, 6, "NNNNNNN"),
        (9, 6, "NNNaDDD"),
        (10, 6, "DNNa" + eye + "D"),
        (11, 6, "DNNaDDD"),
        (12, 6, "DDNNaa"),
    ]
    shoulders = [  # 어깨 얼음 결정(2x3) + 은회색 깃 + 가슴 사파이어 + 소매와 장갑 낀 손
        (10, 4, "a"), (11, 3, "ba"), (12, 3, "bb"),
        (13, 3, "GGGGKGGGK"),
        (14, 4, "NNDNcabD"), (14, 12, "NN"),
        (15, 4, "NNDNabND"), (15, 12, "DNNG"),
        (16, 4, "NNDNbNND"), (16, 12, "Da"),
    ]
    neck = [(12 + sy, 6, "DDNNaa")] if hy < sy else []  # 머리만 먼저 올라가면 목이 1px 늘어난다
    lower = [  # 좁은 수직 로브: 세로 주름 + 앞섶 얼음색 선. 6프레임 내내 고정
        (17, 4, "NNDNDbDk"),
        (18, 4, "NNDNDbDk"),
        (19, 4, "NDDNDbDk"),
        (20, 4, "NNDNDbDk"),
        (21, 4, "NNDDDbDk"),
        (22, 4, "NNDNDbDk"),
        (23, 4, "NaDN" + hem + "bDk"),  # 밑단 2행: 서리 점 4개 + 고드름 톱니 4개
        (24, 4, "N.Da.b.D"),
        (24, 2, "4"), (25, 1, "43"), (25, 13, "43"),  # 발밑 결정
    ]
    # 어깨가 올라가면 허리에 한 줄을 채우고, 내려오면 17행 위를 덮는다
    fill = [(16, 4, "NNDNDbDk")] if sy < 0 else []
    move = lambda part, d: [(y + d, x, t) for y, x, t in part]
    rows = staff + lower + fill + move(shoulders, sy) + neck + move(head, hy) + list(fx)
    return render(rows, FROST_KEY, particles="1234")


def frost(frame=0):
    # idle: 이그니스와 같은 박자(머리 먼저, 어깨 한 프레임 늦게). 눈송이 3개는 정해진 열에서 1px씩 내려오고,
    # 떠 있는 얼음 조각은 1px 까딱인다. 결정 중심과 눈은 프레임 2에서 한 번 밝아진다.
    snow = [(base + (frame + phase) % 4, x, ch) for x, base, phase, ch in
            ((1, 6, 0, "1"), (2, 15, 2, "1"), (0, 11, 1, "2"))]
    shards = [((2, 2, 1, 1)[frame], 12, "2"), (0, (16, 16, 17, 17)[frame], "3"), ((5, 4, 4, 5)[frame], 12, "3")]
    return _frost(hy=(0, -1, -1, 0)[frame], sy=(0, 0, -1, -1)[frame], fx=snow + shards,
                  crystal="pulse" if frame == 2 else "normal", eye="TT" if frame == 2 else "tT",
                  hem="a" if frame in (2, 3) else "c")


def frost_attack(frame=0):
    # 이그니스와 같은 흐름. 발·밑단 고정, 19열 비움. f0 = idle 1번, f5 = idle 0번과 같은 그림.
    if frame == 0:
        return frost(1)
    if frame == 5:
        return frost(0)
    return _frost(**[
        None,
        # 예비동작: 웅크림 + 지팡이 윗부분을 몸 쪽으로(자루 위 8행 1px, 결정 2px), 결정 어둡게
        dict(hy=1, sy=1, crystal="dark", cx=12, shaft=((7, 14, 15), (15, 24, 16)), fx=[(8, 1, "1"), (12, 0, "2")]),
        # 들어올림/차지: 상체 1px 위, 지팡이 수직 + 1px 위(아직 1px 뒤), 결정 발광, 조각이 모여든다
        dict(hy=-1, sy=-1, crystal="bright", cx=13, cy=1, shaft=((6, 23, 15),), eye="TT",
             fx=[(2, 11, "2"), (4, 18, "3"), (7, 1, "1")]),
        # 발사: 대각선 지팡이(발이 2px 뒤로), 결정 플레어, 얼음 조각이 앞으로 튄다
        dict(crystal="flare", shaft=((7, 12, 16), (13, 18, 15), (19, 24, 14)), eye="TT", hem="a",
             fx=[(3, 18, "2"), (4, 18, "2"), (5, 18, "3"), (1, 17, "3"), (7, 18, "3"), (9, 0, "1")]),
        # 반동: 끝만 1px 앞에 남음(자루 15열), 결정 어둡게 + 서리 김
        dict(crystal="dark", shaft=((7, 24, 15),), fx=[(0, 16, "3"), (1, 13, "3"), (10, 0, "1"), (9, 18, "3")]),
    ][frame])


SILVA_KEY = {"d": "0c2814", "g": "1c5228", "G": "3a8a3c", "l": "9cd872", "w": "3a2808", "n": "7a5212",
             "B": "8a5a4a", "c": "e8dcc0", "e": "b8ff3c", "E": "eaffb0",
             "1": "9cd872", "2": "3a8a3c", "3": "e8dcc0", "4": "b8ff3c"}  # 숫자 = 외곽선 없는 효과 픽셀
# 생명의 보석 3x3. flare: 중심 eaffb0 + b8ff3c 십자, muzzle = 그 중심
LIFE = {"normal": ("EGG", "GeG", "GGg"), "pulse": ("EGG", "GEG", "GGg"), "dark": ("ggg", "gGg", "ggd"),
        "bright": ("ElG", "leE", "GlG"), "flare": ("GeG", "eEe", "GeG")}
SILVA_MUZZLE = (15, 3)
SILVA_SHAFT = [(6, 15)] + [(y, 16) for y in range(7, 11)] + [(y, 15) for y in range(11, 16)] +               [(y, 16) for y in range(16, 20)] + [(y, 17) for y in range(20, 23)] + [(23, 16), (24, 16)]


def _silva(hy=0, sy=0, gem="normal", head_dx=0, staff_dy=0, lean=(0, 0, 0), eye="eE", fx=()):
    """실바 한 프레임. hy = 머리(뿔+후드), sy = 견갑·가슴·소매·손 세로 이동(-1 위, +1 아래),
    head_dx = 지팡이 머리(보석+가지) 가로 이동, staff_dy = 지팡이 전체 세로 이동,
    lean = 자루 가로 이동 (y6~12, y13~18, y19~24), fx = 외곽선 없는 효과 픽셀."""
    c = LIFE[gem]
    sdx = lambda y: lean[0] if y <= 12 else lean[1] if y <= 18 else lean[2]
    vine = {9: "G", 13: "G", 17: "G", 21: "G"}  # 지팡이를 감는 덩굴(자루 픽셀과 번갈아)
    leaf_side = {9: 1, 17: 1, 21: -1}  # 덩굴 잎이 붙는 쪽
    top = [  # 두 갈래 가지 + 보석 + 새순
        (2, 14, c[0]), (3, 14, c[1]), (4, 14, c[2]),
        (3, 13, "n"), (4, 13, "w"), (3, 17, "n"), (4, 17, "w"), (5, 14, "wnw"), (2, 17, "G"),
    ]
    staff = [(y + staff_dy, x + head_dx, t) for y, x, t in top] +             [(y + staff_dy, x + sdx(y), vine.get(y, "w" if y % 4 == 0 else "n")) for y, x in SILVA_SHAFT] +             [(y + staff_dy, x + sdx(y) + leaf_side[y], "l") for y, x in SILVA_SHAFT if y in leaf_side]
    head = [  # 가지 뿔 2개(뒤로 휨) + 둥글고 낮은 후드 + 잎 톱니 테두리
        (5, 7, "n"), (6, 8, "n"), (7, 9, "n"),
        (5, 10, "n"), (6, 11, "n"), (7, 12, "n"),
        (8, 8, "GGGgg"),
        (9, 7, "GGggggg"),
        (10, 6, "Ggggd" + eye + "d"),
        (11, 6, "ggggdddg"),
        (12, 6, "GdGdldG"),
    ]
    shoulders = [  # 등 쪽 나무껍질 견갑(세로 결) / 가슴 판 + 에메랄드 / 덩굴과 잎 / 소매와 손
        (11, 4, "BB"),
        (12, 3, "BwB"),
        (13, 3, "BwBwGBclGB"), (13, 13, "l"),
        (14, 3, "BwBBGBlGgBGB"),
        (15, 4, "wBwGwGggww"),
    ]
    neck = [(12 + sy, 6, "gdgdgdg")] if hy < sy else []  # 머리만 먼저 올라가면 목이 1px 늘어난다
    lower = [  # 갈색 로브: 앞자락 룬(1c5228), 허리 씨앗 주머니. 전 프레임 고정
        (16, 4, "nnwnnwww"),
        (17, 4, "nnwnnwnn"),
        (18, 4, "nngnnwnl"),
        (19, 4, "nngnnwnn"),
        (20, 4, "nnwngwww"),
        (21, 4, "ngwnnwnw"),
        (22, 4, "nnwggwnw"),
        (23, 4, "nnwnnwnw"),
        (24, 4, "nn.nn.nw"),
        (24, 1, "31"), (25, 1, "22"), (24, 13, "1"), (25, 13, "23"),  # 발밑 풀과 흰 꽃
    ]
    fill = [(15, 4, "nnwnnwww")] if sy < 0 else []  # 어깨가 올라가면 허리에 한 줄을 채운다
    move = lambda part, d: [(y + d, x, t) for y, x, t in part]
    rows = staff + lower + fill + move(shoulders, sy) + neck + move(head, hy) + list(fx)
    return render(rows, SILVA_KEY, particles="1234")


def silva(frame=0):
    # idle: 같은 박자(머리 먼저, 어깨 한 프레임 늦게). 잎 3개가 정해진 열에서 1px씩 내려오고,
    # 보석 중심과 눈은 프레임 2에서 한 번 밝아진다. 새순 끝은 프레임 2·3에서 1px 까딱인다.
    leaves = [(base + (frame + phase) % 4, x, ch) for x, base, phase, ch in
              ((1, 8, 0, "1"), (2, 16, 2, "1"), (0, 12, 1, "4"))]
    tip = [((1, 1, 0, 0)[frame], 18, "1")]
    return _silva(hy=(0, -1, -1, 0)[frame], sy=(0, 0, -1, -1)[frame], fx=leaves + tip,
                  gem="pulse" if frame == 2 else "normal", eye="EE" if frame == 2 else "eE")


def silva_attack(frame=0):
    # 다른 수호자와 같은 흐름. 발·밑단·발밑 풀 고정, 19열 비움. f0 = idle 1번, f5 = idle 0번과 같은 그림.
    if frame == 0:
        return silva(1)
    if frame == 5:
        return silva(0)
    return _silva(**[
        None,
        # 예비동작: 웅크림 + 지팡이 윗부분을 몸 쪽으로(자루 위쪽 1px, 머리 2px), 보석 어둡게
        dict(hy=1, sy=1, gem="dark", head_dx=-2, lean=(-1, 0, 0), fx=[(10, 1, "1"), (13, 0, "4")]),
        # 들어올림/차지: 상체 1px 위, 지팡이 1px 위 + 1px 뒤, 보석 발광, 새순이 1px 자란다
        dict(hy=-1, sy=-1, gem="bright", head_dx=-1, staff_dy=-1, lean=(-1, -1, -1), eye="EE",
             fx=[(0, 17, "1"), (1, 17, "2"), (2, 11, "4"), (9, 1, "1")]),
        # 발사: 지팡이 머리는 제자리, 발이 2px 뒤로 빠진 대각선. 보석 플레어, 잎이 앞으로 튄다
        dict(gem="flare", lean=(0, -1, -2), eye="EE",
             fx=[(1, 18, "1"), (3, 18, "4"), (4, 18, "4"), (6, 18, "1"), (8, 0, "1")]),
        # 반동: 머리만 1px 앞에 남음(자루가 1px 뒤), 보석 어둡게, 잎 하나가 떨어진다
        dict(gem="dark", lean=(-1, -1, -1), fx=[(8, 18, "1"), (9, 0, "1"), (14, 1, "4")]),
    ][frame])


VENOM_KEY = {"k": "221c2b", "K": "3b3347", "D": "220e38", "P": "48206e", "V": "7a3cae", "v": "c48ce6",
             "c": "e8dcc0", "G": "655a74", "M": "a59cb2", "e": "d94dff", "E": "f2c4ff", "o": "0d0a10",
             "1": "f2c4ff", "2": "d94dff", "3": "7a3cae", "4": "48206e", "5": "c48ce6", "6": "655a74"}
# 지팡이 머리 해골 3x4(눈구멍이 빛난다). flare: 중심 f2c4ff + d94dff 십자, muzzle = 그 중심
SKULL = {"normal": ("ccc", "ece", "cGc", "GcG"), "pulse": ("ccc", "EcE", "cGc", "GcG"),
         "dark": ("ccc", "PcP", "cGc", "GcG"), "bright": ("ccc", "EEE", "cEc", "GcG"),
         "flare": ("cec", "eEe", "cec", "GcG")}
VENOM_MUZZLE = (16, 4)
VENOM_JOINT = {0: "M", 2: "G", 4: "M", 6: "G", 10: "G", 14: "G", 17: "M"}  # 금속 고리·뼈 마디·뾰족한 끝


def _venom(hy=0, sy=0, skull="normal", cx=15, cy=3, shaft=STAFF_UP, eye="eE", fx=(), mist="43443"):
    """베놈 한 프레임. hy = 머리(후드), sy = 어깨 해골·몸통·소매·손 세로 이동(-1 위, +1 아래),
    cx/cy = 지팡이 해골 왼쪽 위, shaft = 자루 구간들, fx = 외곽선 없는 효과 픽셀, mist = 바닥 독안개 5점 색."""
    c = SKULL[skull]
    wood = [(y, x) for y0, y1, x in shaft for y in range(y0, y1 + 1)]
    staff = [(cy + i, cx, c[i]) for i in range(4)] +             [(y, x, VENOM_JOINT.get(i, "K")) for i, (y, x) in enumerate(wood)]
    head = [  # 검은 후드: 끝이 앞으로 처진 부리, 안감 보라, 찌푸린 가는 눈
        (5, 8, "KK"),
        (6, 7, "KKKk"),
        (7, 6, "KKKkkk"),
        (8, 6, "KKkkkKK"),
        (9, 6, "KkkPookK"),
        (10, 6, "KkkP" + eye + "DK"),
        (11, 6, "KkkPDDD"),
        (12, 7, "kkPP"),
    ]
    shoulders = [  # 앞쪽 어깨의 작은 해골 / 마른 몸통 + 가슴 자수정 / 소매(끝 1px 줄)와 손
        (12, 11, "cc"),
        (13, 6, "VPPPDoc"),
        (14, 6, "VPcvVDPPP"),
        (15, 6, "VPvVPDDPVG"),
    ]
    neck = [(12 + sy, 7, "kkPP")] if hy < sy else []  # 머리만 먼저 올라가면 목이 1px 늘어난다
    # 허리 줄: 어깨가 내려오면 접혀 사라지고, 올라가면 한 줄 늘어난다(소매 끝은 팔을 따라간다)
    waist = {1: [], 0: [(16, 6, "VPVPPD"), (16, 13, "DD")],
             -1: [(15, 6, "VPVPPD"), (16, 6, "VPVPPD"), (15, 13, "DD")]}[sy]
    lower = [  # 가죽끈 + 독병 3개, 로브(구멍·물방울 문양), 긴 천 조각 밑단, 바닥 독안개. 전 프레임 고정
        (17, 5, "GKKKKKKG"),
        (18, 4, "GePPeGPDeG"),
        (19, 4, "GVVPVGPDVG"),
        (20, 6, "VPPoPD"),
        (21, 6, "PPVPDD"),
        (22, 6, "VPVPPD"),
        (23, 6, "V.PP.D"),
        (24, 5, "PD.P..DP"),
        (25, 1, mist[0]), (24, 2, mist[1]), (25, 3, mist[2]), (24, 14, mist[3]), (25, 13, mist[4]),
    ]
    move = lambda part, d: [(y + d, x, t) for y, x, t in part]
    rows = staff + lower + waist + move(shoulders, sy) + neck + move(head, hy) + list(fx)
    return render(rows, VENOM_KEY, particles="123456")


def venom(frame=0):
    # idle: 같은 박자(머리 먼저, 어깨 한 프레임 늦게). 해골 위로 기포가 번갈아 오르고, 독방울 2개가
    # 지팡이 옆으로 1px씩 떨어진다. 몸 뒤 기포·연기는 위로, 바닥 독안개는 프레임 2·3에서 색이 뒤바뀐다.
    bubbles = [((1, 0, 1, 0)[frame], 15, "12"[frame % 2])] +               ([((None, 1, 0)[frame], 17, "12"[frame - 1])] if frame in (1, 2) else [])
    drips = [(8 + (frame + phase) % 4, 18, "2") for phase in (0, 2)]
    back = [(9 - frame, 3, "5"), (6 - (frame + 2) % 4, 2, "6")]
    return _venom(hy=(0, -1, -1, 0)[frame], sy=(0, 0, -1, -1)[frame], fx=bubbles + drips + back,
                  skull="pulse" if frame == 2 else "normal", eye="EE" if frame == 2 else "eE",
                  mist="34334" if frame in (2, 3) else "43443")


def venom_attack(frame=0):
    # 다른 수호자와 같은 흐름. 발·밑단 고정, 19열 비움. f0 = idle 1번, f5 = idle 0번과 같은 그림.
    if frame == 0:
        return venom(1)
    if frame == 5:
        return venom(0)
    return _venom(**[
        None,
        # 예비동작: 웅크림 + 지팡이 윗부분을 몸 쪽으로(자루 위 8행 1px, 해골 2px), 눈구멍 어둡게
        dict(hy=1, sy=1, skull="dark", cx=13, shaft=((7, 14, 15), (15, 24, 16)), fx=[(8, 3, "5"), (4, 2, "6")]),
        # 들어올림/차지: 상체 1px 위, 지팡이 수직 + 1px 위(아직 1px 뒤), 해골 발광, 기포 3개
        dict(hy=-1, sy=-1, skull="bright", cx=14, cy=2, shaft=((6, 23, 15),), eye="EE",
             fx=[(0, 13, "1"), (0, 15, "2"), (0, 17, "1"), (7, 3, "5")]),
        # 발사: 대각선 지팡이(발이 2px 뒤로), 해골에서 플레어, 독방울이 앞으로 튄다
        dict(skull="flare", shaft=((7, 12, 16), (13, 18, 15), (19, 24, 14)), eye="EE", mist="34334",
             fx=[(3, 18, "1"), (4, 18, "2"), (6, 18, "2"), (1, 17, "2"), (6, 3, "5")]),
        # 반동: 끝만 1px 앞에 남음(자루 15열), 눈구멍 어둡게 + 연기
        dict(skull="dark", shaft=((7, 24, 15),), fx=[(1, 16, "6"), (0, 15, "6"), (9, 18, "2"), (5, 3, "5")]),
    ][frame])


VOLTER_KEY = {"k": "221c2b", "K": "3b3347", "N": "0c1838", "o": "0d0a10", "n": "7a5212", "g": "c28a20",
              "y": "f2d264", "G": "655a74", "M": "a59cb2", "w": "3a2808", "c": "e8dcc0",
              "e": "ffe14a", "E": "fff3b8", "1": "ffe14a", "2": "fff3b8"}  # 숫자 = 외곽선 없는 효과 픽셀
# 번개 모양 결정(2px 폭 지그재그, 6행). (dy, dx, 글자) - 기준점은 결정 맨 윗줄, x=15
BOLT_SHAPE = [(0, 2), (1, 1), (1, 2), (2, 0), (2, 1), (3, 0), (3, 1), (3, 2), (4, 1), (4, 2), (5, 1)]
BOLT = {"normal": "EeyyegyegyG".replace("G", "g"), "pulse": "EEyyEgyEgyg", "dark": "ggnngnngnnn",
        "spent": "ggggggggggg", "bright": "EEeeEeEEeEe", "flare": "EEeeeeEeeey"}  # flare: 중심 + 십자
VOLTER_MUZZLE = (17, 2)  # 결정 끝
VOLTER_SHAFT = ((9, 24, 16),)


def _volter(hy=0, sy=0, bolt="normal", bdx=0, bdy=0, shaft=VOLTER_SHAFT, eye="eE", fx=(), dots="eee"):
    """볼테르 한 프레임. hy = 머리(후드+번개 뿔), sy = 견갑·가슴 띠·소매·손 세로 이동(-1 위, +1 아래),
    bolt = 결정 밝기, bdx/bdy = 결정+집게 이동, shaft = 자루 구간들, fx = 외곽선 없는 효과 픽셀,
    dots = 소매 끝·밑단 톱니 2곳의 전기 점(e 켜짐 / k 꺼짐)."""
    wood = [(y, x) for y0, y1, x in shaft for y in range(y0, y1 + 1)]
    band = lambda i: "M" if i in (1, 10) else "g" if i == 7 else "wk"[i % 2]  # 금속 띠 2곳, 손잡이 아래 금색
    staff = [(2 + dy + bdy, 15 + dx + bdx, ch) for (dy, dx), ch in zip(BOLT_SHAPE, BOLT[bolt])] +             [(8 + bdy, 15 + bdx, "M"), (8 + bdy, 16 + bdx, "w"), (8 + bdy, 17 + bdx, "M")] +             [(y, x, band(i)) for i, (y, x) in enumerate(wood)]
    head = [  # 후드 뒤 번개 날개 뿔 2개(한 번씩 꺾임) + 각진 검은 후드, 번쩍이는 눈
        (5, 6, "y"), (6, 5, "g"), (7, 6, "g"),
        (7, 4, "y"), (8, 3, "g"), (9, 4, "g"), (10, 5, "g"),
        (7, 7, "KKkk"),
        (8, 6, "KKkkkk"),
        (9, 6, "KkkNook"),
        (10, 6, "KkkN" + eye + "k"),
        (11, 6, "KkkoNok"),
    ]
    shoulders = [  # 위로 솟은 금속 견갑 2개(금색 테) + 토파즈가 박힌 띠 + 소매와 손
        (11, 2, "M"), (11, 13, "M"),
        (12, 2, "MMMGgkkkgGMM"),
        (13, 2, "GGGggcyggGGG"),
        (14, 2, "gggkkygnkkgg"),
        (15, 4, "KkkgnnkkkKKG"),
    ]
    neck = [(11 + sy, 6, "KkkoNok")] if hy < sy else []  # 머리만 먼저 올라가면 목이 1px 늘어난다
    cuff = "k" + dots[0]
    waist = {1: [], 0: [(16, 4, "KkkkkkkK"), (16, 13, cuff)],
             -1: [(15, 4, "KkkkkkkK"), (16, 4, "KkkkkkkK"), (15, 13, cuff)]}[sy]
    lower = [  # 검은 로브: 앞자락 금색 번개 문양, 45도 톱니 밑단(톱니 끝 전기 점). 전 프레임 고정
        (17, 4, "KkkkkgkK"),
        (18, 4, "KkKkgkkk"),
        (19, 4, "KkKkkgkk"),
        (20, 4, "KkKkgkkk"),
        (21, 4, "Kkkkkgkk"),
        (22, 4, "KkKkykkk"),
        (23, 4, "Kkkkkkkk"),
        (24, 4, "K." + dots[1] + ".k." + dots[2] + "."),
    ]
    move = lambda part, d: [(y + d, x, t) for y, x, t in part]
    rows = staff + lower + waist + move(shoulders, sy) + neck + move(head, hy) + list(fx)
    return render(rows, VOLTER_KEY, particles="12")


def volter(frame=0):
    # idle: 같은 박자(머리 먼저, 어깨 한 프레임 늦게). 전기는 흐르지 않고 '깜빡'인다 - 스파크 자리는 고정,
    # 프레임마다 켜지는 것만 바뀐다. 눈은 4프레임 중 1프레임(2)만 두 픽셀 모두 fff3b8.
    on = lambda frames, px: px if frame in frames else []
    fx = on((0, 1), [(7, 1, "1")]) + on((1, 2), [(15, 0, "1")]) +         on((2, 3), [(18, 0, "2"), (18, 1, "1"), (19, 1, "1")]) +         on((0, 2), [(18, 14, "2"), (19, 13, "1"), (20, 14, "1"), (21, 13, "2")]) +         on((0, 1, 3), [(3, 14, "1")]) + on((1, 2), [(1, 18, "2")]) + on((0, 2, 3), [(6, 13, "1")])
    return _volter(hy=(0, -1, -1, 0)[frame], sy=(0, 0, -1, -1)[frame], fx=fx,
                   bolt="pulse" if frame == 2 else "normal", eye="EE" if frame == 2 else "eE",
                   dots=("eek", "kee", "eke", "eek")[frame])


def volter_attack(frame=0):
    # 같은 흐름이지만 f1·f2가 60ms로 짧다. 발·밑단 고정, 19열 비움. f0 = idle 1번, f5 = idle 0번과 같은 그림.
    if frame == 0:
        return volter(1)
    if frame == 5:
        return volter(0)
    return _volter(**[
        None,
        # 예비동작: 웅크림 + 지팡이 윗부분을 몸 쪽으로(자루 위 6행 1px, 결정 2px), 결정 어둡게
        dict(hy=1, sy=1, bolt="dark", bdx=-2, shaft=((9, 14, 15), (15, 24, 16)), dots="kkk", fx=[(16, 0, "1")]),
        # 들어올림/차지: 상체 1px 위, 지팡이 수직 + 1px 위(아직 1px 뒤), 결정과 눈이 함께 번쩍, 스파크 4개
        dict(hy=-1, sy=-1, bolt="bright", bdx=-1, bdy=-1, shaft=((8, 23, 15),), eye="EE",
             fx=[(2, 12, "1"), (0, 17, "2"), (5, 18, "1"), (6, 12, "2")]),
        # 발사: 대각선 지팡이(발이 2px 뒤로), 결정 플레어, 앞으로 튀는 번개(18열 안에서)
        dict(bolt="flare", shaft=((9, 13, 16), (14, 18, 15), (19, 24, 14)), eye="EE",
             fx=[(1, 18, "2"), (3, 18, "2"), (4, 18, "1"), (6, 18, "2"), (7, 18, "1"), (5, 13, "1")]),
        # 반동: 끝만 1px 앞에 남음(자루 15열), 결정 어둡게, 남은 스파크 1px
        dict(bolt="spent", shaft=((9, 24, 15),), dots="kke", fx=[(4, 18, "1")]),
    ][frame])


GUARDIANS = {"red": ignis, "blue": frost, "yellow": volter, "green": silva, "purple": venom}


def qc(name, img):
    allowed = {rgb(h)[:3] for h in BASE + NEON[name]}
    px = [img.getpixel((x, y)) for y in range(H) for x in range(W)]
    alphas = {p[3] for p in px}
    colors = {p[:3] for p in px if p[3]}
    off = colors - allowed
    feet = max(y for y in range(H) for x in range(W) if img.getpixel((x, y))[3])
    ok = img.size == (W, H) and alphas <= {0, 255} and len(colors) <= 16 and not off and feet == 25
    print(f"{name}: size={img.size} alpha={sorted(alphas)} colors={len(colors)} off_palette={len(off)} "
          f"foot_y={feet} -> {'OK' if ok else 'FAIL'}")
    return sorted("%02x%02x%02x" % c for c in colors)
    assert ok, name


def sheet(imgs, scale, path, bg="4a4458"):
    out = Image.new("RGBA", ((W + 4) * len(imgs) * scale, (H + 4) * scale), rgb(bg))
    for i, im in enumerate(imgs):
        big = im.resize((W * scale, H * scale), Image.NEAREST)
        out.alpha_composite(big, (((W + 4) * i + 2) * scale, 2 * scale))
    out.save(path)


def anim(name, tag, fn, n, ms, bg="4a4458", scales=(3, 6), clear_col19=False):
    frames = [fn(i) for i in range(n)]
    strip = Image.new("RGBA", (W * n, H), (0, 0, 0, 0))
    for i, f in enumerate(frames):
        qc(name, f)
        if clear_col19:  # 불꽃 잘림 방지: 19열에는 외곽선도 없어야 한다
            used = sum(1 for y in range(H) if f.getpixel((19, y))[3])
            assert used == 0, (tag, i, used)
        strip.paste(f, (W * i, 0))
    strip.save(os.path.join(OUT, f"{name}_{tag}.png"))  # 가로 n프레임 시트
    for sc in scales:
        row = Image.new("RGBA", (W * n * sc, H * sc), rgb(bg))  # 프레임당 정확히 W*sc x H*sc
        row.alpha_composite(strip.resize(row.size, Image.NEAREST))
        row.save(os.path.join(OUT, f"{name}_{tag}_frames_x{sc}.png"))
        big = [row.crop((W * sc * i, 0, W * sc * (i + 1), H * sc)).convert("P", palette=Image.ADAPTIVE)
               for i in range(n)]
        big[0].save(os.path.join(OUT, f"{name}_{tag}_x{sc}.gif"), save_all=True, append_images=big[1:],
                    duration=list(ms), loop=0)
    return frames


ATTACK_ORDER = [0, 1, 2, 3, 3, 4, 5]  # 프레임 시간 한 값만 지원하는 쪽: 전부 80ms + f3 2장(7프레임)


def export_statues():
    """게임 적용: 5색 idle·공격 시트를 assets/statues/sheets/guardian_{idle,attack}_{색}.png로 내보내고
    assets/statues/manifest.json의 statue_idle_{색} / statue_attack_{색} 항목을 맞춘다.
    석상 에셋 규칙이 '왼쪽을 봄 + 게임이 좌우 반전'이라 프레임마다 좌우를 뒤집어 저장한다
    (muzzle은 화면에서 보이는 방향 = 오른쪽을 보는 목업 좌표 그대로 적는다).
    게임이 프레임 시간을 한 값만 받으므로 idle 160ms, 공격은 80ms x 7프레임(f3 2장).
    내보낸 뒤 python tools/optimize_png.py assets/statues 를 돌릴 것."""
    from PIL import ImageOps
    root = os.path.normpath(os.path.join(OUT, "..", "..", "..", "assets", "statues"))
    mpath = os.path.join(root, "manifest.json")
    raw = open(mpath, encoding="utf-8", newline="").read()
    m = json.loads(raw)

    def strip(frames, path):
        im = Image.new("RGBA", (W * len(frames), H), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            im.paste(ImageOps.mirror(f), (W * i, 0))
        im.save(os.path.join(root, path))

    for name, fn in GUARDIANS.items():
        strip([fn(i) for i in range(IDLE_FRAMES)], f"sheets/guardian_idle_{name}.png")
        strip([ATTACKS[name](k) for k in ATTACK_ORDER], f"sheets/guardian_attack_{name}.png")
        size = {"frameW": W, "frameH": H, "drawScale": 1.5}
        m["anims"][f"statue_idle_{name}"] = {"sheet": f"sheets/guardian_idle_{name}.png", "frames": IDLE_FRAMES,
                                             "frameMs": 160, "loop": True, **size}
        mx, my = MUZZLES[name]
        m["anims"][f"statue_attack_{name}"] = {"sheet": f"sheets/guardian_attack_{name}.png",
                                               "frames": len(ATTACK_ORDER), "frameMs": 80, "loop": False,
                                               "fireFrame": FIRE_FRAME, "muzzle": {"x": mx, "y": my}, **size}
        print("exported", name)
    lf, crlf = chr(10), chr(13) + chr(10)
    nl = crlf if crlf in raw else lf
    out = json.dumps(m, ensure_ascii=False, indent=2).replace(lf, nl) + (nl if raw.endswith(lf) else "")
    open(mpath, "w", encoding="utf-8", newline="").write(out)


ATTACKS = {"red": ignis_attack, "blue": frost_attack, "green": silva_attack, "purple": venom_attack, "yellow": volter_attack}
MUZZLES = {"red": MUZZLE, "blue": FROST_MUZZLE, "green": SILVA_MUZZLE, "purple": VENOM_MUZZLE, "yellow": VOLTER_MUZZLE}
ATTACK_MS_BY = {"yellow": (80, 60, 60, 120, 80, 80)}  # 볼테르는 f1·f2가 빠르다

if __name__ == "__main__":
    if "--export-statues" in sys.argv:
        export_statues()
        sys.exit()
    imgs, anims = [], {}
    order = ATTACK_ORDER
    for name, fn in GUARDIANS.items():
        im = fn()
        used = qc(name, im)
        print(f"  {name} colors {len(used)}: {' '.join(used)}")
        im.save(os.path.join(OUT, f"{name}.png"))
        imgs.append(im)
        if name not in ATTACKS:  # 정지 1장만 있는 수호자
            assert not any(im.getpixel((19, y))[3] for y in range(H)), name
            continue
        anim(name, "idle", fn, IDLE_FRAMES, IDLE_MS, clear_col19=True)
        atk_ms = ATTACK_MS_BY.get(name, ATTACK_MS)
        atk = anim(name, "attack", ATTACKS[name], ATTACK_FRAMES, atk_ms, clear_col19=True)
        even = Image.new("RGBA", (W * len(order), H), (0, 0, 0, 0))
        for i, k in enumerate(order):
            even.paste(atk[k], (W * i, 0))
        even.save(os.path.join(OUT, f"{name}_attack_80ms.png"))
        fire = {"loop": False, "fireFrame": FIRE_FRAME, "muzzle": list(MUZZLES[name])}
        anims[f"guardian_idle_{name}"] = {"sheet": f"{name}_idle.png", "frames": IDLE_FRAMES,
                                          "frameMs": list(IDLE_MS), "loop": True}
        anims[f"guardian_attack_{name}"] = {"sheet": f"{name}_attack.png", "frames": ATTACK_FRAMES,
                                            "frameMs": list(atk_ms), **fire}
        anims[f"guardian_attack_{name}_80ms"] = {"sheet": f"{name}_attack_80ms.png", "frames": len(order),
                                                 "frameMs": 80, **fire}
    json.dump({"frameW": W, "frameH": H, "anchor": "bottom-center", "facing": "right", "anims": anims},
              open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8"), indent=2)
    sheet(imgs, 6, os.path.join(OUT, "overview_x6.png"))
    sheet(imgs, 3, os.path.join(OUT, "overview_x3.png"))
