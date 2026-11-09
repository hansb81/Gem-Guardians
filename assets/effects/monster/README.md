# 몬스터 타격 / 사망 이펙트

몬스터 스프라이트(57종)는 대기·걷기 프레임만 있어서, 피격·사망은 **몬스터 자기 픽셀을 코드로 가공**하고 그 위에 작은 스프라이트를 얹는 방식입니다. 어떤 몬스터에도 그대로 붙습니다.
미리보기: `preview_monster.gif` (석상 투사체 3발, 3번째에 사망). 생성기: `art/effects/build_monster_fx.py`.
규칙: 잼 25색 팔레트, 외곽선 #0d0a10, `imageSmoothingEnabled = false`, **몬스터와 같은 정수 배율**로 그림.

## 스프라이트 (`manifest.anims`)
| 키 | 내용 | 크기 | 프레임 | 기준점 |
|---|---|---|---|---|
| `hit_{석상 색}` | 투사체가 맞은 자리 번쩍 + 파편 (빨강 불씨는 위로, 초록 방울은 아래로, 파랑 얼음 조각, 노랑 지그재그, 보라 검은 눈). 원 없음 | 32x32 | 5 / 260ms | 가운데 = 맞은 점 |
| `death_smoke_s` / `_l` | 쓰러진 자리 발밑 낮은 연기. s = 32px 이하 몬스터, l = 큰 몬스터(골렘 등) | 32x16 / 64x24 | 6 / 510ms | 아래 가운데 = 발밑 |
| `death_soul` | 몸에서 빠져나와 흔들리며 올라가는 보라 영혼불 | 16x32 | 8 / 640ms | 아래 가운데 = 몸 가운데 |

## 타격 (`manifest.hit`)
투사체가 닿는 순간:
1. 닿은 점(몬스터 몸 가운데, 앞쪽 가장자리)에 `hit_{석상 색}`.
2. 몬스터를 `flashMs`(70ms) 동안 **번쩍 버전**으로 그림: 각 픽셀 색을 `manifest.flashMap`으로 바꾼 것(같은 계열 2단계 밝게, 외곽선 유지). 프레임별로 한 번 만들어 캐시.
3. `knockbackPx`(원본 1px)만큼 뒤로 밀렸다가 `knockbackMs`(80ms)에 원위치.
4. 데미지 숫자는 기존 UI 폰트(`ui/font/damage_{색}`).

## 사망 (`manifest.death`)
마지막 타격 순간(= 0ms):
1. 위 타격 1~2와 같음 (hit + 번쩍 70ms).
2. 70ms부터 `dissolveMs`(700ms) 동안 **재 흩어짐**: 마지막 프레임의 픽셀이 위에서부터 차례로 떨어져 나와 위·뒤로 날리며 뼈색 → 회색 3단계로 식어서 사라짐(아래 JS).
3. `smokeAtMs`(60ms)에 발밑 `death_smoke_s/l`, `soulAtMs`(200ms)에 몸 가운데에서 `death_soul`.
4. 끝나면(약 0.9초) 몬스터 제거. 사망 처리(골드 등)는 0ms에 해도 되고, 그림만 0.9초 남기면 됨.

```js
// 번쩍 버전 만들기 (프레임마다 1번, 캐시)
function makeFlash(img, flashMap){ const c=document.createElement('canvas');c.width=img.width;c.height=img.height;
  const x=c.getContext('2d');x.drawImage(img,0,0);const d=x.getImageData(0,0,c.width,c.height),p=d.data;
  for(let i=0;i<p.length;i+=4){if(!p[i+3])continue;const h=((p[i]<<16)|(p[i+1]<<8)|p[i+2]).toString(16).padStart(6,'0');
    const n=flashMap[h]||'e8dcc0';p[i]=parseInt(n.slice(0,2),16);p[i+1]=parseInt(n.slice(2,4),16);p[i+2]=parseInt(n.slice(4,6),16);}
  x.putImageData(d,0,0);return c;}

// 재 흩어짐: 사망 순간 1번 준비 -> 매 프레임 그림
function mulberry32(a){return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
function buildDissolve(img, seed){ // img = 마지막 프레임 (좌우 반전해서 그리고 있었다면 반전된 상태로)
  const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const x=c.getContext('2d');x.drawImage(img,0,0);
  const p=x.getImageData(0,0,c.width,c.height).data,w=c.width,h=c.height,r=mulberry32(seed);let top=h,bot=0;
  for(let y=0;y<h;y++)for(let i=0;i<w;i++)if(p[(y*w+i)*4+3]){top=Math.min(top,y);bot=Math.max(bot,y);}
  const parts=[];
  for(let y=0;y<h;y++)for(let i=0;i<w;i++){const k=(y*w+i)*4;if(!p[k+3])continue;
    parts.push({x:i,y,c:`rgb(${p[k]},${p[k+1]},${p[k+2]})`,delay:(y-top)/Math.max(1,bot-top)*0.45+r()*0.15,
      dx:(r()-0.35)*7,dy:-(3+r()*9),keep:r()});}
  return parts;}
const ASH=['#655a74','#3b3347','#221c2b'];
// t = 0..1 (경과 / dissolveMs), (sx,sy) = 스프라이트 왼쪽 위 화면 좌표, s = 배율
function drawDissolve(ctx,parts,t,sx,sy,s){
  for(const q of parts){
    if(t<q.delay){ctx.fillStyle=q.c;ctx.fillRect(sx+q.x*s,sy+q.y*s,s,s);continue;}
    const p=Math.min(1,(t-q.delay)/0.45);if(q.keep<p)continue;
    ctx.fillStyle=p>0.08?ASH[Math.min(2,Math.floor(p*3))]:'#e8dcc0';
    ctx.fillRect(sx+Math.round(q.x+q.dx*p)*s,sy+Math.round(q.y+q.dy*p)*s,s,s);}}
```
