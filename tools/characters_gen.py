"""Gem Guardians 캐릭터 생성 예시 (ART_DIRECTION.md v2).
글자 격자 1칸 = 1픽셀. '.' = 투명, 각 글자는 범례(EL, OL)로 팔레트 색 키(C)에 연결된다.
render(grid, legend, x오프셋, 파일명): 16x16 캔버스에 발이 맨 아래 줄에 오도록 그린다.
새 캐릭터는 이 파일을 복사해 GRID와 범례만 바꾼다. 색은 C에 있는 것만 쓴다.
"""
from PIL import Image
H=lambda s:tuple(int(s[i:i+2],16) for i in (0,2,4))
C={ 'o':'0d0a10','i':'221c2b','I':'3b3347','m':'655a74','W':'e8dcc0',
    'b1':'0c1838','b2':'1c3a76','b3':'386cbc','b4':'8cc4ee',
    'p1':'220e38','p2':'48206e','p3':'7a3cae','p4':'c48ce6',
    'r1':'3a0814','r2':'741426','r3':'b82a3c','r4':'ec6a6a',
    'y1':'3a2808','y2':'7a5212','y3':'c28a20','y4':'f2d264',
    'g1':'0c2814','g2':'1c5228','g3':'3a8a3c','g4':'9cd872',
    's':'d4a88c','S':'8a5a4a'}
def render(grid,legend,ox,name):
  im=Image.new('RGBA',(16,16),(0,0,0,0)); oy=16-len(grid)
  for y,row in enumerate(grid):
    for x,ch in enumerate(row):
      if ch!='.': im.putpixel((ox+x,oy+y),H(C[legend[ch]])+(255,))
  im.save(name); return im
# ---- elf: ash-haired ranger, dark green cloak, glowing green eye
ELF=[
"...00000.....",
"..0WWmmm0....",
".0Wmmmmss0...",
"00mmmmsEs0...",
"0ssmmmsss0...",
".00mIIsS0B0..",
"..0IICC00tB0.",
".0CccccC0t0B0",
"0CcccccC0t0B0",
"0sCccccsss0B0",
".0LLLLL00t0B0",
".0CcCcCC0t0B0",
"..0CcCc00tB0.",
"..0D0D000B0..",
"..0kk0kk00...",
"...00.00.....",
]
EL={'0':'o','m':'m','W':'W','I':'I','s':'s','S':'S','E':'g4','C':'g1','c':'g2',
    'B':'y2','L':'y1','t':'m','D':'i','k':'r1'}
# ---- orc: dark swamp skin, iron armor, rusty axe, red eye
ORC=[
"...0000.......",
"..0hGGG0......",
".0hGGGGG0.....",
".0GGG0RGG0000.",
".0GGGGGWg0mmm0",
"..0gWGgW00mBr0",
".000ggg00.0B0.",
"0mmmIIIIm0GB0.",
"0GIllllI00GB0.",
"0GIIIIIi0.0B0.",
".00ppppp0.0B0.",
".0ppp0pp0.0B0.",
".0pp0.0pp0.0..",
".0II0.0II0....",
"0III0.0III0...",
"00000.000000..",
]
ORC=[r[:14] for r in ORC]
OL={'0':'o','G':'g2','g':'g1','h':'g3','R':'r4','W':'W','m':'m','I':'I','i':'i',
    'l':'y1','B':'y2','r':'r2','p':'r1'}
e=render(ELF,EL,2,'elf.png'); o=render(ORC,OL,1,'orc.png')
