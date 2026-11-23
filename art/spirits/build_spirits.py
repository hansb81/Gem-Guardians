"""정령 전투 스프라이트(10x10, 대기 4프레임 = 40x10). 실행: python build_spirits.py  (이 파일이 그림의 원본)
결과: out/{id}.png(원본 해상도), preview/sheet_all_x8.png, silhouettes.png, idle_x8.gif. QC 실패 시 assert로 멈춘다."""
import os
import sys
from PIL import Image

F = 10  # 프레임 한 변
HERE = os.path.dirname(os.path.abspath(__file__))
sys.stdout.reconfigure(encoding="utf-8")
PALETTE = set(open(os.path.join(HERE, "../../assets/characters/characters.hex")).read().split())
COMMON = {"k": "221c2b", "g": "3b3347", "b": "e8dcc0", "w": "655a74", "h": "c48ce6", "c": "c28a20"}  # h = 독 날개 테 전용
OUTLINE = "0d0a10"
# d/m/l = 몸 어두운 순, n/N = 네온
ELEM = {
    "red": dict(d="3a0814", m="741426", l="b82a3c", n="ff2b4e", N="ffb3c0"),
    "blue": dict(d="0c1838", m="1c3a76", l="386cbc", n="3ff0ff", N="c8fbff", h="8cc4ee"),
    "green": dict(d="0c2814", m="1c5228", l="3a8a3c", n="b8ff3c", N="eaffb0"),
    "purple": dict(d="220e38", m="48206e", l="7a3cae", n="d94dff", N="f2c4ff"),
    "yellow": dict(d="3a2808", m="7a5212", l="c28a20", n="ffe14a", N="fff3b8", h="f2d264"),
}


def rgb(h):
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def frame(rows, key):
    """rows: 10글자 x 10줄, '.' = 빈칸. 빈칸 중 몸과 4방향으로 닿는 칸에 외곽선을 두른다."""
    assert len(rows) == F and all(len(r) == F for r in rows), rows
    img = Image.new("RGBA", (F, F), (0, 0, 0, 0))
    solid = {(x, y) for y, r in enumerate(rows) for x, ch in enumerate(r) if ch != "."}
    sparks = {(x, y) for x, y in solid if rows[y][x] == "*"}
    solid -= sparks
    for x, y in sparks:
        img.putpixel((x, y), rgb(key["N"]))
    for x, y in solid:
        assert 0 < x < F - 1 and 0 < y < F - 1, f"몸이 테두리 칸에 닿음(외곽선 자리 없음): {(x, y)}"
        img.putpixel((x, y), rgb(key[rows[y][x]]))
    for y in range(F):
        for x in range(F):
            if (x, y) not in solid | sparks and any((x + dx, y + dy) in solid for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                img.putpixel((x, y), rgb(OUTLINE))
    return img


def patch(rows, *edits):
    """edits: (y, '10글자 줄') - 기준 프레임에서 몇 줄만 바꾼 프레임을 만든다."""
    rows = list(rows)
    for y, s in edits:
        rows[y] = s
    return rows


def fire_wisp():
    base = [
        "..........",
        "......m...",
        ".....ml...",
        "....lmm...",
        "...mlNmd..",
        "..mlmmmmd.",
        "..dknkknd.",
        "..ddkkkdd.",
        "...ddddd..",
        "..........",
    ]
    return "red", [
        base,
        patch(base, (1, ".....m...."), (2, ".....lm...")),
        patch(base, (1, "....m....."), (2, "....lm....")),
        patch(base, (1, ".....m...."), (2, ".....ml..."), (6, "..dkkkkkd.")),  # 눈 깜빡임
    ]


def snow_fairy():
    base = [
        "..........",
        "....ll....",
        ".l..lm..l.",
        "..ldmmdl..",
        "..dnkknd..",
        "..dkkkkd..",
        "..mdmmdm..",
        ".m..mm..m.",
        "....mm....",
        "..........",
    ]
    return "blue", [
        base,
        patch(base, (2, ".N..mm..N.")),
        patch(base, (4, "..dkkkkd..")),  # 눈 깜빡임
        patch(base, (7, ".N..mm..N.")),
    ]


def seedling():
    base = [
        "..........",
        "..ml..lm..",
        "...mm.mm..",
        "....mlm...",
        ".....m....",
        "...mlllm..",
        "..mllmNlm.",
        "..mdnddnm.",
        "...ddddd..",
        "..........",
    ]
    return "green", [
        base,
        patch(base, (1, "...ml..lm.")),
        base,
        patch(base, (1, ".ml..lm...")),
    ]


def venom_moth():
    opened = [
        "..........",
        ".hl....lh.",
        ".hll..llh.",
        ".lnmddmnl.",
        "..mmddmm..",
        ".hlmddmlh.",
        ".m.mddm.m.",
        "....dN....",
        "..........",
        "..........",
    ]
    folded = [
        "..........",
        "..h....h..",
        "..hl..lh..",
        "..nmddmn..",
        "..mmddmm..",
        "..hmddmh..",
        "..m.dd.m..",
        "....dN....",
        "..........",
        "..........",
    ]
    return "purple", [opened, folded, opened, folded]


def spark_fly():
    """번개 구슬(id는 spark_fly 그대로). '*' = 몸 옆에 튀는 스파크 - 외곽선 없음."""
    lit = [
        "..........",
        "..lhhl....",
        ".mllllm...",
        ".ddndnd...",
        ".mllllm...",
        ".mmmmmm...",
        "..dmmdl...",
        ".......ll.",
        ".......n..",
        "..........",
    ]
    off = patch(lit, (8, ".......l.."))
    return "yellow", [lit, patch(lit, (2, ".mllllm.*.")), off, off]


def R(y0, *rows):
    """y0번째 줄부터 채운 10줄(나머지는 빈 줄)."""
    out = ["." * F] * F
    out[y0:y0 + len(rows)] = rows
    return out


# ---- 불 ----
def ember_rat():
    b = R(2, ".N........", ".n....mm..", ".m...mllm.", ".mmmmldnm.", "..dmmmmd..", "...dd.dd..")
    return "red", [b, patch(b, (2, "..N.......")), b, patch(b, (2, ".........."), (3, ".N....mm.."), (4, ".n...mllm."))]


def flame_fox():
    b = R(1, ".N...m.m..", ".nN..mmm..", ".ll..dnml.", ".lm..mmm..", ".mm.mmlm..", ".mm.mmlm..", "..mmmmdd..")
    return "red", [b, patch(b, (1, "..N..m.m..")), b, patch(b, (1, ".....m.m.."), (2, ".NN..mmm.."))]


def lava_turtle():
    b = R(2, "..mlnm....", ".mlnmlm...", ".mmlmnmdd.", ".mnmlmmnd.", ".dddddd...", ".dd..dd...")
    down = patch(b, (4, ".mmlmnm..."), (5, ".mnmlmmdd."), (6, ".ddddddnd."))
    return "red", [b, down, b, patch(b, (5, ".mnmlmmdd."))]


def phoenix():
    tail = ("..mmllmm..", "..m.mm.m..", "..n.NN.n..")
    up = R(1, ".l..cc..l.", ".ml.dd.lm.", ".mdnddndm.", ".mmldblmm.", "..mmlNmm..", *tail)
    mid = R(1, "....cc....", "....dd....", ".ldnddndl.", ".mmldblmm.", ".mmmlNmmm.", *tail)
    down = R(1, "....cc....", "....dd....", "..dnddnd..", ".mmldblmm.", ".mmmlNmmm.", ".lmmllmml.", ".lm.mm.ml.", "..n.NN.n..")
    return "red", [up, mid, down, mid]


def sup_cascade():
    b = R(1, "...mllm...", "...m..m...", "..mmmmm...", "..mdnm....", "..mmmmmm..", "....m..m..", "....nNNn..")
    return "red", [b, patch(b, (7, "....NnnN..")), b, patch(b, (4, "..mddm...."))]


# ---- 얼음 ----
def frost_bat():
    o = R(2, "...m..m...", ".mmddddmm.", ".mlnddnlm.", ".m.mdNm.m.", "....dd....")
    f = R(2, "...m..m...", "...dddd...", "..mnddnm..", "..mmdNmm..", "..m.dd.m..")
    return "blue", [o, f, o, f]


def ice_owl():
    b = R(1, "...mmmm...", "..mdmmdm..", "..mnddnm..", ".lmmmbmml.", ".mlmmmmlm.", ".N.mmmm.N.", "...mmmm...", "...d..d...")
    return "blue", [b, patch(b, (5, ".NlmmmmlN."), (6, "...mmmm...")), b, patch(b, (3, "..mddddm.."))]


def glacier_wolf():
    b = R(1, ".....m....", "...N.mmll.", ".N.n.dnmm.", ".n.lmmmkb.", ".mmmmm....", "..mmmm....", "..dmmd....")
    br = patch(b, (1, ".....m..*."))
    return "blue", [b, br, br, b]


def frost_whale():
    b = R(2, ".N.N......", "..m..lll..", "..m.mnmmm.", "..mmmmdnm.", "...mnmmmm.", "...hhhhh..")
    sp = patch(b, (1, "......*..."), (2, ".N.N..*..."))
    return "blue", [b, sp, sp, b]


def sup_clock():
    b = R(1, "....n.....", "..mlmmm...", "..mdddm...", ".nmdNdmn..", "..mdddm...", "..mmmmm...", "....n.....")
    return "blue", [patch(b, (3, "..mdldm...")), patch(b, (4, ".nmdNlmn..")), patch(b, (5, "..mdldm...")), patch(b, (4, ".nmlNdmn.."))]


# ---- 숲 ----
def moss_snail():
    b = R(1, "..llll....", ".lddddl...", ".ldlldln..", ".ldlNdlmn.", ".ldllllmm.", "..llllmmd.", ".dmmmmmmm.")
    return "green", [b, patch(b, (3, ".ldlldl..."), (4, ".ldlNdlnn.")), b, patch(b, (4, ".ldlNdlm.."), (5, ".ldllllmn."))]


def vine_snake():
    b = R(1, "....mmm...", "....dndm..", "....mm....", "..nmm.....", "..mm...l..", "..mlmml...", "....mnm...", ".dmmmmd...")
    t = patch(b, (2, "....dndmn."))
    return "green", [b, t, t, b]


def stag():
    b = R(1, ".n.l..l.n.", ".l.l..l.l.", ".llm..mll.", "...mmmm...", ".mmdNNdmm.", "...nddn...", "...mmmm...", "....dd....")
    return "green", [b, patch(b, (4, ".m.mmmm..."), (5, "..mdNNdmm.")), b, patch(b, (4, "...mmmm.m."), (5, ".mmdNNdm.."))]


def elder_treant():
    b = R(1, "..ll.lll..", ".lNlllmNl.", ".llmlNllm.", ".mlnmmlmm.", "...dmmd...", "...nmmn...", "...mddm...", "..dm..md..")
    return "green", [b, patch(b, (1, "..lll.ll..")), b, patch(b, (6, "...dmmd..."))]


def sup_breaker():
    b = R(1, "..mllllm..", ".mm.mm.mm.", ".N..ml..N.", "....lmln..", "....dn....", "..llml....", "....lm....", "....mm....")
    return "green", [b, patch(b, (6, "...lml....")), patch(b, (5, "....dd....")), patch(b, (4, "....lmn..."))]


# ---- 독 ----
def bone_crow():
    b = R(1, "......b...", ".....bnbd.", ".....mm...", "...mmmmm..", "..mllmNm..", "..mmlmmd..", ".nm..d.d..")
    return "purple", [b, patch(b, (6, ".nmmlmmd.."), (7, "..m..d.d..")), b, patch(b, (2, ".....bdbd."))]


def shade_cat():
    b = R(1, "...l...l..", "...kkkkk..", "...knknk..", "....kkk...", "...kkkk.N.", "...kdkk.n.", "..kkdkkkk.")
    return "purple", [b, patch(b, (5, "...kkkk..."), (6, "...kdkk.N."), (7, "..kkdkkkn.")), b, patch(b, (5, "...kkkkN.."))]


def toxic_toad():
    b = R(2, "..dd..dd..", ".mdnmmndm.", ".NmmNmmmN.", ".mddddddm.", ".mmllllmm.", ".dm.mm.md.")
    s1 = patch(b, (6, ".mllllllm."))
    return "purple", [b, s1, patch(s1, (7, ".dmllllmd.")), s1]


def wraith_queen():
    b = R(1, "..l.cc.l..", "..lmmmml..", "..mkkkkm..", "..mnkknm..", ".lmmkkmml.", ".NmmmmmmN.", ".mdmmmmdm.", ".nm.mm.mn.")
    return "purple", [b, patch(b, (8, ".n.m..m.n.")), b, patch(b, (6, ".nmmmmmmn."))]


def sup_paint():
    b = R(1, "....nN....", "...mmmn...", "...mmmm...", "...lmml...", "....mm....", "....dn....", "....mm....", "....dd....")
    return "purple", [b, patch(b, (4, "...lmml*..")), patch(b, (6, "....dn.*..")), b]


# ---- 번개 ----
def copper_squirrel():
    b = R(1, "..nN......", ".ll...m...", ".lml.mmm..", ".lml.dnmm.", "..ll.mlm..", "..lllmlm..", "...mmmdd..")
    return "yellow", [b, patch(b, (1, ".nN.......")), b, patch(b, (4, ".lml.ddmm."))]


def thunder_hawk():
    b = R(1, ".N........", ".nl.......", "..lll.mm..", "..mmlmdnb.", "..mmmmNm..", ".nmmdmd...", ".....d.d..")
    low = patch(b, (1, ".........."), (2, ".Nl......."), (3, ".nlll.mm.."))
    return "yellow", [b, low, b, low]


def storm_cat():
    b = R(1, "..l....l..", "..mm..mm..", "..dnddnd..", ".gggggggg.", ".gngkggkg.", ".kkgkknkk.", "..kk..kk..")
    bolt = patch(b, (7, "..kk.nkk.."), (8, "....N....."))
    return "yellow", [b, bolt, bolt, b]


def storm_kirin():
    b = R(1, "....N.....", "....N.....", "....n...l.", ".lmmmmml..", "..dnmnd...", ".lmmmmml..", "...mmm..l.", "..ndmdn...")
    return "yellow", [b, patch(b, (3, "....n....."), (4, ".lmmmmmll.")), b, patch(b, (3, "....N...l."))]


def sup_tinker():
    b = R(1, "....llll..", "...mmdnmn.", "...mmmmmn.", "....mm....", "...mm.....", "..mm......", ".nd.......")
    sp = patch(b, (1, "....llll*."))
    return "yellow", [b, sp, sp, b]


# 속성 5줄 x 6칸: 시범 종, 일반, 희귀, 영웅, 전설, 보조
GRID = [
    [fire_wisp, ember_rat, flame_fox, lava_turtle, phoenix, sup_cascade],
    [snow_fairy, frost_bat, ice_owl, glacier_wolf, frost_whale, sup_clock],
    [seedling, moss_snail, vine_snake, stag, elder_treant, sup_breaker],
    [venom_moth, bone_crow, shade_cat, toxic_toad, wraith_queen, sup_paint],
    [spark_fly, copper_squirrel, thunder_hawk, storm_cat, storm_kirin, sup_tinker],
]
PAD = 2  # 표에서 칸 사이(원본 px)


def table(cells, w, bg):
    """cells[줄][칸] = 이미지(w x F). 칸 사이 PAD를 두고 8배로 키운 표."""
    out = Image.new("RGBA", (PAD + len(cells[0]) * (w + PAD), PAD + len(cells) * (F + PAD)), rgb(bg))
    for r, row in enumerate(cells):
        for c, im in enumerate(row):
            out.alpha_composite(im, (PAD + c * (w + PAD), PAD + r * (F + PAD)))
    return out.resize((out.width * 8, out.height * 8), Image.NEAREST).convert("RGB")


def main():
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    os.makedirs(os.path.join(HERE, "preview"), exist_ok=True)
    sheets = []
    for row in GRID:
        sheets.append([])
        for fn in row:
            elem, frames = fn()
            key = {**COMMON, **ELEM[elem]}
            allowed = PALETTE | set(ELEM[elem].values())
            img = Image.new("RGBA", (F * 4, F), (0, 0, 0, 0))
            for j, rows in enumerate(frames):
                img.paste(frame(rows, key), (j * F, 0))
            img.save(os.path.join(HERE, "out", fn.__name__ + ".png"))  # Pillow는 메타 청크를 넣지 않는다
            sheets[-1].append(img)
            # QC
            px = list(img.get_flattened_data())
            alphas = {p[3] for p in px}
            colors = {"%02x%02x%02x" % p[:3] for p in px if p[3]}
            outside = colors - allowed
            neon = [sum(1 for p in f.get_flattened_data() if p[3] and "%02x%02x%02x" % p[:3] in (key["n"], key["N"]))
                    for f in (img.crop((j * F, 0, j * F + F, F)) for j in range(4))]
            print(f"{fn.__name__:16} {img.size[0]}x{img.size[1]} alpha={sorted(alphas)} colors={len(colors)} "
                  f"out_of_palette={len(outside)} neon/frame={neon}")
            assert img.size == (40, 10) and alphas <= {0, 255} and len(colors) <= 8 and not outside, fn.__name__
    table(sheets, F * 4, "221c2b").save(os.path.join(HERE, "preview", "sheet_all_x8.png"))
    # 실루엣 표: 첫 프레임을 외곽선 색 한 가지로
    blank = Image.new("RGBA", (F, F), (0, 0, 0, 0))
    ink = Image.new("RGBA", (F, F), rgb(OUTLINE))
    sil = [[Image.composite(ink, blank, im.crop((0, 0, F, F)).getchannel("A")) for im in row] for row in sheets]
    table(sil, F, "a59cb2").save(os.path.join(HERE, "preview", "silhouettes.png"))
    # 대기 애니메이션 확인용 GIF(200ms)
    gif = [table([[im.crop((j * F, 0, j * F + F, F)) for im in row] for row in sheets], F, "221c2b") for j in range(4)]
    gif[0].save(os.path.join(HERE, "preview", "idle_x8.gif"), save_all=True, append_images=gif[1:], duration=200, loop=0)


if __name__ == "__main__":
    main()
