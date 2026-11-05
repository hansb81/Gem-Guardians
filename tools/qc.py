"""Gem Guardians 캐릭터 스프라이트 자동 검수 (ART_DIRECTION.md 11·12항).
사용: python3 qc.py <sprite.png> [palette.hex]
- palette.hex 첫 줄 = 외곽선 색. 기본 경로: 이 파일 옆의 characters.hex
- 시트(가로로 프레임 나열)도 --frame W 로 프레임별 검사: python3 qc.py sheet.png --frame 16
"""
import sys, os
from PIL import Image
args=[a for a in sys.argv[1:]]
fw=None
if '--frame' in args:
  i=args.index('--frame'); fw=int(args[i+1]); del args[i:i+2]
path=args[0]
pal=args[1] if len(args)>1 else os.path.join(os.path.dirname(os.path.abspath(__file__)),'characters.hex')
cols=[l.strip().lstrip('#') for l in open(pal) if l.strip()]
ALLOWED={tuple(int(c[i:i+2],16) for i in (0,2,4)) for c in cols}
OUTLINE=tuple(int(cols[0][i:i+2],16) for i in (0,2,4))
sheet=Image.open(path).convert('RGBA')
fw=fw or sheet.size[0]
ok=True; feet=set(); boxes=[]
for f in range(sheet.size[0]//fw):
  im=sheet.crop((f*fw,0,(f+1)*fw,sheet.size[1])); W,H=im.size; px=im.load(); tag=f'[frame {f}] ' if fw!=sheet.size[0] else ''
  used=set()
  for y in range(H):
    for x in range(W):
      r,g,b,a=px[x,y]
      if a not in (0,255): print(tag+'반투명 픽셀',x,y); ok=False
      if a==255:
        used.add((r,g,b))
        if (r,g,b) not in ALLOWED: print(tag+'팔레트 밖 색',x,y,'#%02x%02x%02x'%(r,g,b)); ok=False
        elif (r,g,b)!=OUTLINE:
          for dx,dy in((1,0),(-1,0),(0,1),(0,-1)):
            nx,ny=x+dx,y+dy
            if not(0<=nx<W and 0<=ny<H) or px[nx,ny][3]==0: print(tag+'외곽선 누락',x,y); ok=False; break
  bb=im.getbbox()
  if not bb: print(tag+'빈 프레임'); ok=False; continue
  print(tag+f'캔버스 {W}x{H} bbox {bb} 키 {bb[3]-bb[1]}px 색 {len(used)}개')
  if bb[3]!=H: print(tag+'발이 맨 아래 줄에 있지 않음'); ok=False
  if bb[0]==0 or bb[2]==W: print(tag+'좌우 경계에 닿음'); ok=False
  feet.add(bb[3])
print('PASS' if ok else 'FAIL')
sys.exit(0 if ok else 1)
