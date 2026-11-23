"""정령 초상(24x24, 정지 1장)과 정령석(16x16). 실행: python build_portraits.py  (이 파일이 그림의 원본)
결과: out/portrait/{id}.png, out/stone.png, preview/portrait_x6.png(전설 5종), preview/portrait_all_x4.png, preview/stone_compare.png.
QC 실패 시 assert로 멈춘다. 전투 스프라이트(build_spirits.py)와 같은 디자인을 크게 다시 그린 것 - 확대본이 아니다."""
import os
import sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_spirits import COMMON, ELEM, GRID, HERE, OUTLINE, PALETTE, rgb  # noqa: E402

P = 24  # 초상 한 변
# 초상 전용 글자: o = 외곽선 색을 몸 안에(깊은 눈구멍), h = 속성별 가장 밝은 단계(characters.hex)
EXTRA = {"red": {}, "blue": {"h": "8cc4ee"}, "green": {"h": "9cd872"}, "purple": {"h": "c48ce6"}, "yellow": {"h": "f2d264"}}


def draw(rows, key):
    """rows: 정사각 글자 격자, '.' = 빈칸, '*' = 외곽선 없는 입자(밝은 네온). 몸과 4방향으로 닿는 빈칸에 외곽선."""
    n = len(rows)
    assert all(len(r) == n for r in rows), [(y, len(r)) for y, r in enumerate(rows) if len(r) != n]
    img = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    cells = {(x, y): ch for y, r in enumerate(rows) for x, ch in enumerate(r) if ch != "."}
    solid = {p for p, ch in cells.items() if ch != "*"}
    for (x, y), ch in cells.items():
        assert ch == "*" or (0 < x < n - 1 and 0 < y < n - 1), f"몸이 테두리 칸에 닿음: {(x, y)}"
        img.putpixel((x, y), rgb(key["N" if ch == "*" else ch]))
    for y in range(n):
        for x in range(n):
            if (x, y) not in cells and any((x + dx, y + dy) in solid for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                img.putpixel((x, y), rgb(OUTLINE))
    return img


def full(top, *rows):
    """24칸 폭 줄들(오른쪽 빈칸은 생략 가능)을 top번째 줄부터 놓는다."""
    out = ["." * P] * P
    assert top + len(rows) <= P and all(len(r) <= P for r in rows), [r for r in rows if len(r) > P]
    out[top:top + len(rows)] = [r.ljust(P, ".") for r in rows]
    return out


def half(top, *rows):
    """왼쪽 절반(정확히 12글자, 오른쪽 끝이 가운데)을 좌우 대칭으로 펼친다 - 정면 구도."""
    assert all(len(r) == P // 2 for r in rows), [r for r in rows if len(r) != P // 2]
    return full(top, *[r + r[::-1] for r in rows])


PORTRAITS = {}


def portrait(elem):
    def reg(fn):
        PORTRAITS[fn.__name__] = (elem, fn())
        return fn
    return reg


# ---- 전설 ----
@portrait("red")
def phoenix():
    return half(
        1,
        ".N..........",
        ".nl........c",
        ".lll......cc",
        ".mlll....ddd",
        ".mmlll..dddd",
        "..mmlll.dnnd",
        "..mmmllldddb",
        "...mmmlllddb",
        "...dmmmlllcc",
        "....dmmmlmml",
        "....ddmmmmlN",
        ".....ddmmmlN",
        "......dmmmml",
        "......dmmmmm",
        ".......dmmmm",
        ".......dmmmm",
        "......mmdmml",
        ".....mml.mll",
        "....mll..mll",
        "....ll...lln",
        "...nl....lnN",
        "...N.......N",
    )


@portrait("blue")
def frost_whale():
    # 옆모습(전투 스프라이트와 같은 구도). 심해의 고대 괴수: 등 가시, 흉터, 처진 입, 가는 눈.
    return full(
        4,
        ".N....N...N......*.*",
        ".nl..ln...l..N....*",
        "..lllll..ll..l..N.*",
        "...mlm...ll.ll..l.lll",
        "...mm....lllllllllmmmll",
        "...mm...lmmmmmmmmmmmmml",
        "...mmm.lmmmmdmmmmmmmmmm",
        "....mmmmmmmmmdmmmmkkkkm",
        "....mmmmmmmmmmdmmmknnkm",
        ".....mmmmmmmmmmmmmmmmmm",
        ".....dmmmmmmlmmmmmmmmmd",
        "......dmmmmllmmmmddddd",
        ".......dmmmllmmddmmmmm",
        "........ddmlmdddddmm",
        "..........ddmmddddm",
        "............ddddd",
    )


@portrait("green")
def elder_treant():
    return half(
        1,
        "...h........",
        "...m...h...h",
        "...m...m...m",
        ".h.mm..m..mm",
        ".m..m.mm..mm",
        ".mm.mmm..mmm",
        "..mmmm..mmmm",
        "....mmmmmmmm",
        "......mmdmlm",
        ".......mdmlm",
        ".......mooom",
        ".......monom",
        ".......mooom",
        ".......mdmlm",
        ".......ldmlm",
        ".......mdnld",
        "......mmdlmd",
        "......mdmlmm",
        ".....mmdmmlm",
        "...mmmd.mmlm",
        ".dmmd....mmd",
        ".d........dd",
    )


@portrait("purple")
def wraith_queen():
    return half(
        1,
        "...........c",
        ".......l...c",
        ".......ll.lc",
        ".......lllll",
        "......mmmmmm",
        ".....mmmkkkk",
        ".....mmkkkkk",
        ".....mmknnkk",
        ".....mmkkkkk",
        "....mmmmkkkk",
        "...mmmlmmmcc",
        "..lmmmlmmmmm",
        ".llmm.dlmmmN",
        ".Nl...dmlmmm",
        ".n....dmmlmm",
        ".....dmmmlmm",
        "....dmmmmlmm",
        "...dmmmmmmlm",
        "..dmmdmmmmlm",
        "..mmd.dmmdmm",
        ".dm...dm.dmm",
        ".n....n...dm",
    )


@portrait("yellow")
def storm_kirin():
    return half(
        1,
        "...........N",
        "...........N",
        "..n........n",
        "..l..l.....n",
        "..ll.ll.l..l",
        "..llllllm..l",
        "...lmllmmmhl",
        "...llmllmmmm",
        "....llmlnddm",
        ".....llldnNm",
        ".......ldddm",
        "........mmmm",
        "........mlmm",
        "........mlmm",
        "........mmlm",
        ".........mlm",
        ".........mmm",
        ".........dmm",
        "........lmmm",
        ".......l..dd",
        "......n.....",
    )


# ---- 나머지 25종 ----
@portrait("red")
def fire_wisp():
    return full(
        3,
        ".............ll",
        "............lm",
        "...........lmm",
        "..........lmml",
        ".........mlmmm",
        "........mllmmmm",
        ".......mlllmmmmm",
        "......mllNNlmmmmd",
        ".....mmllNNlmmmmdd",
        ".....mmmllllmmmmdd",
        "....mmkkkkkkkkkkmdd",
        "....mdknnkkkkknnkdd",
        "....mdkkkkkkkkkkkdd",
        "....ddmkkkkkkkkmddd",
        ".....dddmmmmmmdddd",
        "......dddddddddd",
        "........dddddd",
    )


@portrait("red")
def ember_rat():
    return full(
        5,
        "..N",
        ".Nn",
        ".nl",
        "..l.............mm",
        "..l......mmmm..mllm",
        "..ll...mmlllmmmmllmmm",
        "...l..mllllllmmmmmmmmm",
        "...lmmlllllllmmmddddmmm",
        "....mmllllllmmmmdnndmmm",
        "....mmmlllllmmmmmdddmml",
        ".....mmmmmmmmmmmmmmmmd",
        ".....ddmmmmmmmmdddmm",
        "......dd.ddmmdd..dd",
        "......d...dd.....d",
    )


@portrait("red")
def flame_fox():
    return full(
        3,
        "....N........l....l",
        "...Nn........ll..ll",
        "..nll........lmmmml",
        "..lll........mmmmmmm",
        ".llNl.......mmddddmmm",
        ".llml.......mdnnddmmml",
        ".lNmll......mmmmmmmmd",
        ".lmmml.......mmmllm",
        "..mmml......mmmlll",
        "..mmmll....mmmmlll",
        "..mmmml...mmmmmllm",
        "...mmml...mmmmmllm",
        "...dmmm..mmmmmmlmm",
        "....dmm..mmmmmmmmm",
        "....ddmm.mmmdmmmdm",
        ".....dmmmmmmdmmmdm",
        "......dddmmddmmddm",
        "........dd.dd..dd",
    )


@portrait("red")
def lava_turtle():
    return full(
        6,
        "......mmmmmm",
        "....mmllllllmm",
        "...mllldllllllm",
        "..mlllldllnlldlm",
        ".mlllnddllldddllm..mmmm",
        ".mlldllldddlllldm..mddd",
        ".mlddlllnlldlllnmmmmdnn",
        ".mmlllddlllddllmmmmmddd",
        ".dmmmmmmmmmmmmmmdmmmmm",
        "..dddddddddddddd.mmm",
        "..mmd.......dmm",
        "..ddd.......ddd",
    )


@portrait("red")
def sup_cascade():
    return full(
        3,
        ".........mmmm",
        "........mllllm",
        ".......ml....lm",
        ".......ml....lm",
        ".......mm....mm",
        ".....mmmmmmmmm",
        "....mlllmmmm",
        "...mlkkkkklm",
        "...mlknnkklm",
        "...mlkkkkklm",
        "....mmmmmmmmmm",
        "........mllllm",
        ".......mlnnnnlm",
        ".......mn....nm",
        ".......mlnnnnlm",
        "........mllllm",
        ".........mmmm",
    )


@portrait("blue")
def snow_fairy():
    return half(
        1,
        "...........l",
        "...........m",
        ".........l.m",
        "..N.......lm",
        "..ll.......m",
        "...lm......m",
        "....mm...mmm",
        ".....mmdmmmm",
        "......mddddd",
        ".....mddkkkk",
        "...lmmdknnkk",
        ".....mddkkkk",
        "......mddddd",
        ".....mmdmmmm",
        "....mm...mmm",
        "...lm......m",
        "..ll.......m",
        "..N.......lm",
        ".........l.m",
        "...........m",
        "...........l",
    )


@portrait("blue")
def frost_bat():
    return half(
        5,
        "........l...",
        "........lm..",
        ".l......mmmm",
        ".ll....mmddd",
        ".lml..mmdddd",
        ".lmml.mddnnd",
        ".lmmmlmmdddd",
        ".mmmmmmmmddb",
        ".mmdmmmdmmbd",
        ".md.mmd.mmdd",
        ".d...m...mdN",
        ".........mdd",
        "..........dd",
        "..........d.",
    )


@portrait("blue")
def ice_owl():
    return half(
        4,
        ".......mmmmm",
        ".....mmllllm",
        "....mllllmmm",
        "....mddmmmmm",
        "....mnnddmmm",
        "....mmmmmddm",
        ".....mmmmmmb",
        "..l..mmmmmmb",
        ".llm.mmlmlmm",
        ".lmmmmmmlmlm",
        ".lmmdmmlmlmm",
        ".Nmd.mmmlmlm",
        ".n.d.mmlmlmm",
        ".....dmmmmmm",
        "......dmmmmd",
        "........d.d.",
    )


@portrait("blue")
def glacier_wolf():
    return full(
        3,
        "............m.........*",
        "...........mlm.......ld",
        "...........mlmm....lllm",
        "....N......mmmmm.llllm",
        "....n.....mmmmmllllmm",
        ".N..l....mmmmdnnlkkkm",
        ".n.ll....mmmmmddmmmmb",
        ".l.lm....mmmmmmmm",
        ".lmmm...mmmlmmmm",
        "..mmmmmmmmlmmm",
        "...mmmmmmllmmm",
        "....mmmmmlmmm",
        "....mmmmllmmmd",
        "....mmmmlmmmmd",
        "...mmmmmlmmmmdd",
        "...mmmmmmmmmmdd",
        "...dmmmmmmmmddd",
        "....dddddddddd",
    )


@portrait("blue")
def sup_clock():
    return full(
        4,
        ".........nmm",
        "....mm.mmmmmmm.mm",
        "....mmmmmmmmmmmmm",
        ".....mmmlllllmmm",
        ".....mmlllblllmm",
        ".....mmlllblllmm",
        "...mmmmlllblllmmmm",
        "...nmmmlllNbblmmmn",
        "...mmmmlllllllmmmm",
        ".....mmlllllllmd",
        ".....mmlllllllmd",
        ".....mmmlllllmmd",
        "....mmmmmmmmmmmdd",
        "....mm.mmmmmdd.dd",
        ".........mnd",
    )


@portrait("green")
def seedling():
    return half(
        1,
        "...ll.......",
        "..lmml......",
        "..lmmml.....",
        "...mmmml....",
        "....dmmml...",
        "......dmml..",
        "........dmml",
        "..........mm",
        "..........mm",
        ".......mllll",
        ".....mlllllm",
        "....mllllllN",
        "....mlllllmn",
        "...mmddddddd",
        "...mddnndddd",
        "...mmddddddd",
        "...mmmlllmmm",
        "....dmmmmmmm",
        "....ddmmmmmm",
        ".....ddddddd",
        ".......ddddd",
    )


@portrait("green")
def moss_snail():
    return full(
        4,
        ".....llllll",
        "...llllllllll",
        "..lldddddddlll",
        ".lldllllllldll....n..n",
        ".lldlldddddlldl...m..m",
        ".ldlldllllldldl...m..m",
        ".ldlldlddlldldl...mm.m",
        ".ldlldldNlldldl..mmmmm",
        ".ldlldllldlldll.mmdnnm",
        ".lldlldddlldlll.mmmddm",
        ".lldlllllllldllmmmmmmm",
        "..lldddddddllmmmmmmmd",
        ".mmllllllllllmmmmmmd",
        ".dmmmmmmmmmmmmmmmdd",
        "..ddddddddddddddd",
    )


@portrait("green")
def vine_snake():
    return full(
        1,
        "..........mmmmm",
        ".........mlllmmm",
        ".........mldnndmm.N",
        ".........mmllmmmmn",
        "..........mmmmmm..N",
        "..........mlmm",
        ".........mllm",
        ".......mmllm",
        ".....mmlllm....ll",
        "....mllmm.....lll",
        "....mlmm.....lll",
        "....mmllllmmmmm",
        ".....mmmlnlllmmm",
        ".......mmmmllllmm",
        "...........mmlllm",
        "............mmllm",
        "...........mmllm",
        "..mmmmmmmmmmmlmm",
        ".mllnllllnllmmmd",
        ".dmmmmmmmmmmmmd",
        "..dddddddddddd",
    )


@portrait("green")
def stag():
    return half(
        2,
        ".N....N.....",
        ".l....l..N..",
        ".l...ll..l..",
        ".ll..l..ll..",
        "..ll.l.ll...",
        "...llllm....",
        ".....mmm....",
        "......mmm.mm",
        ".mm...mmmmmm",
        ".mlmmmmmmmmN",
        "..mmmmddddmN",
        ".....mdnndmm",
        ".....mmddmmm",
        "......mmmmlm",
        "......mmmlmm",
        ".......mmlmm",
        ".......mmmmm",
        "........mmdd",
        "........mddd",
        ".........mmm",
        "..........dd",
    )


@portrait("green")
def sup_breaker():
    return full(
        1,
        "......mllllllllllm",
        "....mlllmmmmmmmlllm",
        "..mllmm..mmmm..mmllm",
        ".mlm.....mllm.....mlm",
        ".Nm......mllm......mN",
        ".n.......lmlm.......n",
        ".........mllml.ll",
        ".........mmlmmlll",
        ".........dddd",
        ".........dnnd",
        ".........dddd",
        "......ll.mllm",
        ".....llllmlmm",
        "......l..lllm",
        ".........mmll",
        ".........mllm",
        ".........mlll",
        ".........mllmln",
        ".........mllm",
        ".........mmmm",
        ".........dddd",
    )


@portrait("purple")
def venom_moth():
    return half(
        2,
        ".hl.........",
        ".hlll....d..",
        ".hlllll...d.",
        ".hllmlll..dd",
        ".hlmnnmll.dd",
        "..lmnNmllmdd",
        "..llmmmllmdd",
        "...llllmmmdd",
        "....mmmmmddd",
        "..hlllmmmmdd",
        ".hllmmllmmdd",
        ".hlmnmlmm.dd",
        ".hllmlmm..dd",
        "..l.lmm...dd",
        "..l..m....dd",
        "..........dd",
        "..........dN",
        "...........N",
    )


@portrait("purple")
def bone_crow():
    return full(
        3,
        ".............bbbb",
        "............bbbbbb",
        "............bboobb",
        "............bbnNbbdddd",
        ".............bbbbddd",
        "..............mmm",
        "...........mmmmmmm",
        ".........mmllllmmmm",
        ".......mmllllllmmNm",
        "......mmllmmlllmmmm",
        ".....mmlmmllmmmmmmd",
        "....mmlmmmmmmmmmmd",
        "...mmmmmmmmmmmmdd",
        "..mmdmmddddmmdd",
        ".nmd.dd....d..d",
        ".n..........d..d",
        "...........dd.dd",
    )


@portrait("purple")
def shade_cat():
    return full(
        3,
        ".....l.......l",
        ".....kl.....lk",
        ".....kkk...kkk",
        ".....kkkkkkkkk",
        "....kkkkkkkkkkk",
        "....kknnkkknnkk",
        "....kkkkkkkkkkk",
        ".....kkkkdkkkk",
        "......kkkkkkk.......N",
        ".....kkkkkkkkk.....nk",
        "....kkkkdkkkkkk....kk",
        "....kkkdkkkdkkk....kk",
        "....kkkdkkkdkkk...kkk",
        "....kkkdkkkdkkk..kkk",
        "....kkkdkkkdkkkkkkk",
        "....kkkdkkkdkkkkkk",
        "...kkkkdkkkdkkkk",
        "...ddkkd.ddkkd",
    )


@portrait("purple")
def toxic_toad():
    return half(
        5,
        "....mmmm....",
        "...mddddm...",
        "..mmdnndmmmm",
        ".mmmmddmmmmN",
        ".mNmmmmmmmmm",
        ".mnmmmmmmmmm",
        ".mmddddddddd",
        ".mdmllllllll",
        ".mmmllllllll",
        "..mmmlllllll",
        ".mmmmmmmllll",
        ".mmdmm.mmmmm",
        ".dd.dd..dddd",
    )


@portrait("purple")
def sup_paint():
    return full(
        1,
        "..........nN",
        ".........nNNn",
        ".........lnnl",
        "........mllllm",
        "........mlllmm",
        "........mllmmm",
        "........mmmmmm",
        ".........hllh",
        ".........hllh....*",
        ".........mllm",
        ".........mlmm",
        ".........dddd",
        ".........dnnd",
        ".........dddd",
        ".........mlmm",
        ".........mlmm",
        "..........lm",
        "..........lm",
        "..........mm",
        "..........md",
        "..........dd",
    )


@portrait("yellow")
def spark_fly():
    # 번개 구슬
    return full(
        2,
        "......hhhhhh",
        "....hhhlllllll",
        "...hllllllllllm",
        "..lllllllllllllm",
        "..llllllllllllmm",
        ".lddddddddddddddm..*",
        ".lddnnddddddnnddm",
        ".lddddddddddddddm",
        ".lllllllllllllmmm",
        "..llllllllllmmmm",
        "..mllllllllmmmmd",
        "...mmllllmmmmdd",
        "....mmmmmmmdddll",
        "......dddddd...ll",
        "................ll",
        "...............ll",
        "..............ll",
        "..............lll",
        "................ln",
        ".................N",
    )


@portrait("yellow")
def copper_squirrel():
    return full(
        2,
        "....nN",
        "...nll",
        ".....ll",
        "...lllll",
        "..llmllll......m..m",
        ".llmmmlll......mmmm",
        ".llmmmmll.....mmmmmm",
        ".llmmmmll.....mddddmm",
        ".llmmmmll.....mdnndmmd",
        ".lllmmmll.....mmmmmmm",
        "..llmmmll.....mmlllm",
        "..lllmmlll...mmllllm",
        "...llmmmll..mmmlllmm",
        "....llmmllmmmmmllmm",
        "....lllmmlmmmmmmlmm",
        ".....llmmmmmmmmmmmm",
        "......lmmmmmmdmmmdm",
        ".......dddmmddmmdd",
        "..........ddd.ddd",
    )


@portrait("yellow")
def thunder_hawk():
    return full(
        4,
        "..N",
        "..nl",
        "..lll",
        "...llll",
        "...llmlll......mmmm",
        "....lmmlll....mmmmmm",
        "....llmmlll...mddddmbb",
        ".....lmmmlll..mdnndmb",
        "......lmmmllmmmmmmm.b",
        "......llmmmmmmmmNmm",
        ".......lmmmmmmmmmmm",
        "....mmmmmmmmmmmmmm",
        "..nmmmmmmmmmmmmdd",
        ".n..mmdddmmddd",
        ".........d..d",
        "........dd.dd",
    )


@portrait("yellow")
def storm_cat():
    return half(
        3,
        ".....l......",
        ".....ml.....",
        ".....mml....",
        ".....mmmmmmm",
        ".....mddddmm",
        ".....ddnnddm",
        ".....mddddmm",
        "...gggggmmmm",
        "..gggggggggg",
        ".gggkggggkgg",
        ".ggkgggnggkg",
        ".gkkgggkkggg",
        ".kkkkgkkkkgk",
        "..kkkkkkkkkk",
        "...kk..kkkk.",
        "...........n",
        "...........N",
        "...........n",
    )


@portrait("yellow")
def sup_tinker():
    return full(
        2,
        "...........llllllll",
        "..........lllllllllln",
        ".........mmmmddddmmmmN",
        ".........mmmmdnndmmmmN.*",
        ".........mmmmddddmmmmn",
        "..........mmmmmmmmmmm",
        "...........dddddddd",
        "...........mmm",
        "..........mlm",
        ".........mlm",
        "........mlm",
        ".......mlm",
        "......mlm",
        ".....mlm",
        "....mlm",
        "...mlm",
        "..nlm",
        ".mmm",
        ".dd",
    )


STONE = [  # 세로로 긴 육각 결정 기둥 + 옆의 작은 결정(16x16, 외곽선 포함)
    "................",
    ".......hl.......",
    "......hNll......",
    ".....hhlllm.....",
    ".....hllmmm.....",
    ".....hlmmmd.....",
    ".....hlmmmd.....",
    ".....hlmmmd.....",
    ".....hlmmmd.l...",
    ".....hlmmmdhlm..",
    ".....hlmmmdlmd..",
    ".....hlmmmdlmd..",
    ".....hmmmddlmd..",
    "......mmdd.mdd..",
    ".......dd.......",
    "................",
]

LEGENDS = ["phoenix", "frost_whale", "elder_treant", "wraith_queen", "storm_kirin"]


def qc(name, img, size, allowed, budget):
    px = list(img.get_flattened_data())
    alphas = {p[3] for p in px}
    colors = {"%02x%02x%02x" % p[:3] for p in px if p[3]}
    print(f"{name:16} {img.size[0]}x{img.size[1]} alpha={sorted(alphas)} colors={len(colors)} out_of_palette={len(colors - allowed)}")
    assert img.size == (size, size) and alphas <= {0, 255} and len(colors) <= budget and not colors - allowed, name


def table(cells, pad, bg, scale):
    """cells[줄][칸] 이미지를 pad 간격으로 놓고 scale배."""
    w = max(im.width for row in cells for im in row)
    h = max(im.height for row in cells for im in row)
    out = Image.new("RGBA", (pad + len(cells[0]) * (w + pad), pad + len(cells) * (h + pad)), rgb(bg))
    for r, row in enumerate(cells):
        for c, im in enumerate(row):
            out.alpha_composite(im, (pad + c * (w + pad) + (w - im.width) // 2, pad + r * (h + pad) + (h - im.height) // 2))
    return out.resize((out.width * scale, out.height * scale), Image.NEAREST).convert("RGB")


def main():
    os.makedirs(os.path.join(HERE, "out", "portrait"), exist_ok=True)
    imgs = {}
    for name, (elem, rows) in PORTRAITS.items():
        key = {**COMMON, "o": OUTLINE, **ELEM[elem], **EXTRA[elem]}
        imgs[name] = draw(rows, key)
        imgs[name].save(os.path.join(HERE, "out", "portrait", name + ".png"))
        qc(name, imgs[name], P, PALETTE | set(ELEM[elem].values()), 12)
    table([[imgs[n] for n in LEGENDS]], 2, "221c2b", 6).save(os.path.join(HERE, "preview", "portrait_x6.png"))
    ids = [[fn.__name__ for fn in row] for row in GRID]
    if all(n in imgs for row in ids for n in row):  # 30장이 다 있을 때만 전체 표(전투 시트와 같은 순서)
        table([[imgs[n] for n in row] for row in ids], 2, "221c2b", 4).save(os.path.join(HERE, "preview", "portrait_all_x4.png"))

    stone = draw(STONE, {**COMMON, **ELEM["purple"]})
    stone.save(os.path.join(HERE, "out", "stone.png"))
    qc("stone", stone, 16, PALETTE | {ELEM["purple"]["N"]}, 6)
    # 재화 아이콘(16x16) 옆에 같은 픽셀 크기로: 골드, 다이아, 정령석
    icons = [Image.open(os.path.join(HERE, "../../assets/ui/icons", f)).convert("RGBA") for f in ("gold.png", "diamond.png")]
    table([icons + [stone]], 3, "221c2b", 8).save(os.path.join(HERE, "preview", "stone_compare.png"))


if __name__ == "__main__":
    main()
