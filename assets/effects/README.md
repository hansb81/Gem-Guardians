# Gem Guardians 잼 터짐 이펙트

잼과 같은 25색 팔레트, 픽셀 아트, 안티앨리어싱 없음. 생성기: `art/effects/build_effects.py` (미리보기 `art/effects/preview.py`).

## 규격
- 프레임 64×64 투명 PNG, 가로 나열 시트. 잼 몸통 자리는 프레임 가운데 32×32 (잼 이미지와 같은 위치/크기).
- 화면에는 2배(128px)로 **칸 중심에 맞춰** 그립니다. 파편이 옆 칸으로 넘어가는 건 정상.
- `ctx.imageSmoothingEnabled = false` 필수. 늘리거나 줄이지 말 것.
- 이펙트가 시작되면 그 칸의 잼은 그리지 않습니다(첫 프레임에 잼 그림이 들어 있음).
- 루프 아님. `frameMs`는 프레임마다 길이가 다른 배열입니다.

## 이펙트 목록 (`manifest.anims`)
| 키 | 내용 | 프레임 | 길이 |
|---|---|---|---|
| `pop_{색}` | #1 기본 3매치 팝: 번쩍 → 금 → 산산조각 → 파편 흩어짐 (링 없음) | 5 | 270ms |
| `line_{h\|v}_origin_{색}` | #2 줄 잼 칸: 번쩍 → 금을 따라 위아래(좌우)로 갈라짐 + 빛줄기 → 사라짐. 64x64 | 7 | 380ms |
| `line_{h\|v}_seg{0\|1}_{색}` | #2 빛줄기가 지나가는 한 칸. 가로 32x64, 세로 64x32 (= 한 칸), 이어 붙이는 조각 | 6 | 320ms |
| `bomb_{색}` | #3 폭탄: 용암 핵이 끓음 → 번쩍 → 불규칙한 불꽃이 3x3으로 퍼짐 + 파편 → 연기 → 불씨. 128x128 | 8 | 500ms |

## #3 폭탄 쓰는 법 (미리보기 `art/effects/preview_bomb.gif`)
- 폭탄 칸 중심에 `bomb_{색}`을 2배(256px)로 그린다. 3x3칸(192px)보다 조금 크게 퍼짐.
- 주변 8칸 잼은 `manifest.bomb.hitMs`(110ms, 번쩍 직후)에 각자 `pop_{그 잼 색}` 시작. 폭탄 이펙트는 pop보다 위에.
- 화면 흔들림을 넣는다면 hitMs에 맞추면 자연스럽다.

## #2 가로/세로 줄 쓰는 법 (보드 크기와 상관없음, 7x7 기준 미리보기 `art/effects/preview_line.gif`)
- 줄 잼 칸에 `line_h_origin_{색}` (세로면 `line_v_...`).
- 같은 줄의 나머지 칸마다 `line_h_seg0/seg1_{색}`을 칸 번호 짝/홀로 번갈아 그린다(반짝이가 똑같이 반복되지 않게).
- 각 칸은 줄 잼에서 거리 × `manifest.line.stepMs`(30ms)만큼 늦게 시작 → 빛이 양쪽으로 뻗어 나가는 느낌. 7x7에서 끝 칸까지 최대 180ms.
- 그 칸의 잼은 같은 시각에 `pop_{그 잼 색}`을 시작하고, 줄 이펙트는 pop보다 위에 그린다.
- seg 프레임도 2배로, 칸 중심에 맞춰 그린다(가로 seg = 64x128px 화면 크기). 칸 크기가 64px가 아니면 배율 = 칸 크기 / 32.

```js
// dt = 이펙트 시작 후 경과 ms
let acc = 0, f = 0;
for (; f < a.frames; f++) { acc += a.frameMs[f]; if (dt < acc) break; }
if (f >= a.frames) { /* 끝: 이펙트 제거 */ }
const w = a.frameW * 2, h = a.frameH * 2;
ctx.drawImage(img, f * a.frameW, 0, a.frameW, a.frameH, cx - w / 2, cy - h / 2, w, h);
```
이펙트는 잼보다 나중에(위에) 그리세요.

## #4 박스 (랜덤 2칸 번개) - 미리보기 `art/effects/preview_box.gif`
지금 게임의 "박스 칸 → 랜덤 칸 체인 라이트닝" 방식을 그대로 두고, 모양만 픽셀 아트로 바꿉니다.
대상 칸이 보드 어디든(거리·각도 제각각) 될 수 있어서, 번개 줄기는 이미지가 아니라 **코드로 픽셀을 찍어** 그립니다(아래 `drawPixelBolt`).

| 키 | 내용 | 크기 | 프레임 | 길이 |
|---|---|---|---|---|
| `box_origin_{색}` | 박스 칸: 영혼불이 밝아짐 → 1번 팝처럼 조각남 | 64x64 | 6 | 330ms |
| `box_soul_{색}` | 번개 머리 영혼불(뻗는 동안 끝에 붙음), 반복 | 16x16 | 4 | 60ms/프레임 |
| `box_hit_{색}` | 번개가 꽂힌 칸 번쩍 + 갈라지는 빛 (원 없음) | 64x64 | 4 | 220ms |

타이밍 (`manifest.box`, 박스 발동 시각 = 0):
- 0ms: 박스 칸 `box_origin_{박스 색}`.
- `startMs`(60): 대상 칸마다 번개 시작, `durationMs`(300) 동안. 앞 30%(`growPart`)는 박스 칸에서 대상 칸으로 뻗어 나가고 머리에 `box_soul`. `reshapeMs`(70)마다 seed를 바꿔 모양이 꿈틀거림.
- `hitMs`(150, 번개 도착): 대상 칸 잼 `pop_{그 잼 색}` + 위에 `box_hit_{박스 색}`. 대상 잼은 hitMs까지 그대로 그린다.
- 색은 박스 잼 색(`manifest.box.colors[색]`): core 뼈색, glow 밝은 색, glowDark, outline.

```js
// 번개는 "원본 해상도" 오프스크린 캔버스(칸 = 32px)에 찍고, 보드 위에 2배(칸 64px)로 확대해서 그린다.
// sx,sy,tx,ty = 원본 픽셀 좌표(칸 중심 = col*32+16), t = 0..1, seed = 대상별 고정값 + Math.floor(ms / reshapeMs)
function mulberry32(a){return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function linePx(x0,y0,x1,y1){x0=Math.round(x0);y0=Math.round(y0);x1=Math.round(x1);y1=Math.round(y1);
  const dx=Math.abs(x1-x0),dy=-Math.abs(y1-y0),sx=x0<x1?1:-1,sy=y0<y1?1:-1;let err=dx+dy;const out=[];
  for(;;){out.push([x0,y0]);if(x0===x1&&y0===y1)return out;const e2=2*err;if(e2>=dy){err+=dy;x0+=sx;}if(e2<=dx){err+=dx;y0+=sy;}}}
function boltPath(sx,sy,tx,ty,seed){const r=mulberry32(seed),dx=tx-sx,dy=ty-sy,L=Math.hypot(dx,dy)||1,nx=-dy/L,ny=dx/L;
  const n=Math.max(2,Math.round(L/10)),pts=[[sx,sy]];
  for(let i=1;i<n;i++){const t=i/n,j=(r()*2-1)*Math.min(5,1+L/20);pts.push([sx+dx*t+nx*j,sy+dy*t+ny*j]);}
  pts.push([tx,ty]);let core=[];
  for(let i=0;i<pts.length-1;i++){const s=linePx(...pts[i],...pts[i+1]);core=core.concat(i?s.slice(1):s);}
  const branches=[];
  for(let i=1;i<pts.length-1;i++){if(r()<0.45){const side=r()<0.5?1:-1,bl=3+r()*4;
    branches.push([i/n,linePx(...pts[i],pts[i][0]+(dx/L*0.6+nx*side)*bl,pts[i][1]+(dy/L*0.6+ny*side)*bl).slice(1)]);}}
  return {core,branches};}
// put(x,y,'#rrggbb') 는 오프스크린 ctx.fillRect(x,y,1,1). 반환값 = 머리 위치(뻗는 중일 때) -> box_soul을 그 자리에.
function drawPixelBolt(put,{core,branches},t,col){ // col = manifest.box.colors[색]
  const grow=Math.min(1,t/0.3),body=core.slice(0,Math.max(1,Math.round(core.length*grow)));
  const [cc,gc]=t<0.5?[col.core,col.glow]:t<0.75?[col.glow,col.glowDark]:[col.glowDark,null];
  const K=(x,y)=>x+','+y,all=new Set(body.map(p=>K(...p))),br=[];
  if(t<0.75)for(const[f,b]of branches)if(f<=grow)for(const p of b){br.push(p);all.add(K(...p));}
  const N4=[[1,0],[-1,0],[0,1],[0,-1]];
  if(gc){const glow=new Map();
    for(const k of all){const[x,y]=k.split(',').map(Number);for(const[a,b]of N4){const q=K(x+a,y+b);if(!all.has(q))glow.set(q,[x+a,y+b]);}}
    for(const[x,y]of glow.values())for(const[a,b]of N4){const q=K(x+a,y+b);if(!all.has(q)&&!glow.has(q))put(x+a,y+b,col.outline);}
    for(const[x,y]of glow.values())put(x,y,gc);}
  body.forEach(([x,y],i)=>{if(!(t>=0.75&&i%3===0))put(x,y,cc);});
  for(const[x,y]of br)put(x,y,gc||cc);
  return grow<1?body[body.length-1]:null;}
```
그리는 순서: 잼 → pop/box_origin → 번개(2배 확대 레이어) → box_soul → box_hit.

## #5 컬러(무지개) - 미리보기 `art/effects/preview_color.gif`
지금 게임의 무지개 원(wipe) 대신 씁니다. 대상 = 지운 색의 잼 전부(`specialActivate.affected`).

| 키 | 내용 | 크기 | 프레임 | 길이 |
|---|---|---|---|---|
| `color_origin` | 컬러 잼 칸: 소용돌이가 빨라짐 → 가운데 눈으로 빨려 들어감 → 5색 불씨가 나선으로 터져 나감 | 96x96 (화면 192px) | 9 | 460ms |
| `color_wisp` | 컬러 잼에서 대상 칸으로 날아가는 무지개 불씨, 반복(색이 바뀜) | 12x12 | 5 | 50ms/프레임 |
| `color_mark_{색}` | 불씨가 꽂힌 칸: 그 잼 색으로 번쩍 + 5색 반짝이 (원 없음) | 64x64 | 4 | 200ms |

타이밍 (`manifest.color`, 발동 시각 = 0):
- 0ms: 컬러 잼 칸 `color_origin`.
- `waveStartMs`(240, 터져 나가는 순간): 대상 칸마다 `color_wisp` 출발. 비행시간 = max(`minFlightMs` 60, 거리(칸, 유클리드) × `stepMs` 45), easeInQuad(가속).
- 도착: 그 칸 잼 `pop_{그 잼 색}` + 위에 `color_mark_{그 잼 색}`. 대상 잼은 도착까지 그린다. 가까운 잼부터 차례로 터짐.
- 그리는 순서: 잼 → pop → color_origin → color_wisp → color_mark.
