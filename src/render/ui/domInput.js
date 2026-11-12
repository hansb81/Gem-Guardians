// 캔버스 위에 실제 HTML <input>을 겹치는 도우미 - 랭킹 닉네임(src/game/rankingUi.js)과 쿠폰 입력(mainMenuScreen)이 같이 쓴다.
// 모바일 키보드·붙여넣기·한글 조합을 브라우저에 맡기기 위해서. 위치는 매 프레임 placeDomInput으로 맞춘다(바뀔 때만 style 갱신).
const BASE_CSS = 'position:fixed;z-index:50;margin:0;padding:0 4px;border:0;outline:0;background:transparent;color:#e8dcc0;caret-color:#f2d264;box-sizing:border-box;';
const placeholderRules = new Set();

// opts: { value, maxLength, placeholder, placeholderColor, ariaLabel, align, attrs{}, onInput(el), onEnter(el) }.
// document가 없으면(node 테스트) null. 탭 동작 안에서 부르면 focus()로 모바일 키보드도 같이 뜬다.
export function createDomInput(opts = {}) {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('input');
  el.type = 'text';
  if (opts.maxLength) el.maxLength = opts.maxLength;
  el.autocomplete = 'off';
  el.spellcheck = false;
  el.placeholder = opts.placeholder ?? '';
  if (opts.ariaLabel) el.setAttribute('aria-label', opts.ariaLabel);
  for (const [k, v] of Object.entries(opts.attrs ?? {})) el.setAttribute(k, v);
  el.value = opts.value ?? '';
  el.style.cssText = BASE_CSS + (opts.align ? `text-align:${opts.align};` : '');
  if (opts.placeholderColor) {
    // ::placeholder는 인라인 style로 못 바꾼다 - 색마다 규칙 한 줄을 한 번만 넣는다.
    const cls = `gg-ph-${opts.placeholderColor.replace(/[^0-9a-z]/gi, '')}`;
    if (!placeholderRules.has(cls)) {
      const st = document.createElement('style');
      st.textContent = `.${cls}::placeholder{color:${opts.placeholderColor};opacity:1}`;
      document.head.appendChild(st);
      placeholderRules.add(cls);
    }
    el.classList.add(cls);
  }
  el.addEventListener('input', () => opts.onInput?.(el));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') opts.onEnter?.(el);
  });
  document.body.appendChild(el);
  el.focus();
  return el;
}

// r = 입력 칸 사각형(렌더 논리 px, {x, y, width, height}) x scale -> 캔버스 위 CSS 위치. 글꼴 Galmuri11 fontPx(렌더 px) 기준.
export function placeDomInput(el, canvas, r, scale = 1, fontPx = 22) {
  if (!el) return;
  const c = canvas.getBoundingClientRect();
  scale *= c.u ?? 1; // 렌더 논리 px -> CSS px
  const css = `${Math.round(c.left + r.x * scale)}px|${Math.round(c.top + r.y * scale)}px|${Math.round(r.width * scale)}px|${Math.round(r.height * scale)}px|${Math.round(fontPx * scale)}`;
  if (el.dataset.pos === css) return;
  el.dataset.pos = css;
  const [l, tp, w, h, f] = css.split('|');
  Object.assign(el.style, { left: l, top: tp, width: w, height: h, font: `${f}px 'Galmuri11', monospace` });
}
