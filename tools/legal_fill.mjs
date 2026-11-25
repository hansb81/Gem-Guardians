// docs/legal-src/company.json의 회사 정보를 docs/terms.html, docs/refund.html의 <span ... data-co="키">에 채운다.
// email은 게임 안 환불 안내 팝업(src/config/gameInfo.js contactEmail)에도 넣는다.
// 몇 번 돌려도 같다(span은 남기고 안쪽 글자만 바꾼다). 빈 값은 건드리지 않는다(노란 빈칸 그대로).
// 사용: node tools/legal_fill.mjs  (값을 고친 뒤 다시 돌리면 덮어쓴다)
import { readFileSync, writeFileSync } from 'node:fs';

const co = JSON.parse(readFileSync('docs/legal-src/company.json', 'utf8'));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const SPAN = /<span class="(blank )?co" data-co="(\w+)">[^<]*<\/span>/g;

for (const file of ['docs/terms.html', 'docs/refund.html']) {
  const src = readFileSync(file, 'utf8');
  const left = new Set();
  const out = src.replace(SPAN, (m, _blank, key) => {
    const v = co[key];
    if (typeof v !== 'string') throw new Error(`${file}: company.json에 없는 키 ${key}`);
    if (!v.trim()) {
      left.add(key);
      return m;
    }
    return `<span class="co" data-co="${key}">${esc(v.trim())}</span>`;
  });
  if (out !== src) writeFileSync(file, out);
  console.log(`${file}: ${left.size ? `빈칸 남음 ${[...left].join(', ')}` : '회사 정보 다 채움'}`);
}

const GI = 'src/config/gameInfo.js';
const gi = readFileSync(GI, 'utf8');
const giOut = gi.replace(/contactEmail: '[^']*'/, `contactEmail: '${(co.email ?? '').trim().replace(/'/g, '')}'`);
if (giOut !== gi) writeFileSync(GI, giOut);
