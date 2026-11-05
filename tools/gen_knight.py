"""Gem Guardians 기사(knight) 캐릭터 생성 (ART_DIRECTION.md v2, characters_gen.py와 같은 방식).
글자 격자 1칸 = 1픽셀. fill(row,x0,x1,ch)로 코어(외곽선 제외) 색만 칠하고,
dilate()가 코어 실루엣 바깥 1px을 자동으로 외곽선(#0d0a10)으로 감싼다.
eye-socket처럼 내부에 외곽선색이 필요하면 '0'을 직접 칠한다.
"""
from PIL import Image
H=lambda s:tuple(int(s[i:i+2],16) for i in (0,2,4))
C={'o':'0d0a10','i':'221c2b','I':'3b3347','m':'655a74','W':'e8dcc0',
   'r1':'3a0814','r2':'741426','r3':'b82a3c','r4':'ec6a6a',
   'y1':'3a2808','y2':'7a5212','y3':'c28a20','y4':'f2d264'}
LEGEND={'0':'o','W':'W','I':'I','i':'i','m':'m','p':'r3','r':'r2','g':'y3','y':'y1'}

SIZE=16
OX=2  # 로컬(폭13) -> 캔버스(폭16) x 오프셋

core=[['.' for _ in range(13)] for _ in range(SIZE)]
def fill(row,x0,x1,ch):
  for x in range(x0,x1+1): core[row][x]=ch

# ---- helmet (row0: 캡, 외곽선 전용 / row1~5). 눈구멍 주변은 밝은 톤(I)으로 감싸 대비를 준다.
fill(1,6,6,'W'); fill(1,7,7,'I'); fill(1,3,4,'p')
fill(2,5,5,'W'); fill(2,6,7,'I'); fill(2,8,9,'I'); fill(2,2,3,'p')
fill(3,5,6,'I'); fill(3,7,7,'I'); fill(3,8,8,'0'); fill(3,9,9,'I'); fill(3,1,2,'r')
fill(4,5,7,'I'); fill(4,8,8,'I'); fill(4,9,9,'i')
fill(5,6,7,'I'); fill(5,8,8,'i')

# ---- body (row6~11): 방패 없이 두꺼운 토르소+휘장, 검을 든 앞팔(오른쪽, 실루엣 밖으로 뻗어 분리)
fill(6,3,6,'I'); fill(6,7,9,'i'); fill(6,10,10,'y')
fill(7,3,5,'I'); fill(7,6,7,'r'); fill(7,8,9,'i'); fill(7,10,11,'g')
fill(8,3,5,'I'); fill(8,6,7,'r'); fill(8,8,9,'i'); fill(8,10,11,'m')
fill(9,3,6,'I'); fill(9,7,9,'i'); fill(9,10,11,'m')
fill(10,4,6,'I'); fill(10,7,9,'i'); fill(10,10,10,'m')
fill(11,4,6,'I'); fill(11,7,9,'i'); fill(11,10,10,'W')

# ---- legs (row12~14), row15은 dilate()가 발 외곽선으로 채운다
fill(12,4,5,'I'); fill(12,5,5,'i'); fill(12,7,8,'I'); fill(12,8,8,'i')
fill(13,4,5,'I'); fill(13,5,5,'i'); fill(13,7,8,'I'); fill(13,8,8,'i')
fill(14,4,5,'i'); fill(14,7,8,'i')

def render(name):
  im=Image.new('RGBA',(SIZE,SIZE),(0,0,0,0))
  for y,row in enumerate(core):
    for x,ch in enumerate(row):
      if ch!='.': im.putpixel((OX+x,y),H(C[LEGEND[ch]])+(255,))
  snap=[[im.getpixel((x,y))[3]==255 for x in range(SIZE)] for y in range(SIZE)]
  outline=H(C['o'])+(255,)
  for y in range(SIZE):
    for x in range(SIZE):
      if not snap[y][x]:
        for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
          nx,ny=x+dx,y+dy
          if 0<=nx<SIZE and 0<=ny<SIZE and snap[ny][nx]:
            im.putpixel((x,y),outline); break
  im.save(name); return im

if __name__=='__main__':
  render('assets/characters/knight/knight.png')
