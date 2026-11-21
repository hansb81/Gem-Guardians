// 로그인: 이메일+비밀번호(aal1) -> TOTP가 없으면 등록(QR + 6자리 확인) / 있으면 6자리 -> aal2 (supabase.auth.mfa).
import { supabase } from './api.js';
import { h } from './ui.js';

// 이미 aal2 세션이면 true. 아니면 로그인 화면을 그리고 끝나면 onDone().
export async function hasAal2() {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.currentLevel === 'aal2';
}

export function loginScreen(root, onDone, notice = '') {
  const msg = h('div.red', notice);
  const email = h('input', { type: 'email', placeholder: '관리자 이메일', autocomplete: 'username' });
  const pw = h('input', { type: 'password', placeholder: '비밀번호', autocomplete: 'current-password' });
  const btn = h('button.primary', '로그인');
  const go = async () => {
    btn.disabled = true;
    msg.textContent = '';
    const { error } = await supabase.auth.signInWithPassword({ email: email.value.trim(), password: pw.value });
    btn.disabled = false;
    if (error) return void (msg.textContent = `로그인 실패: ${error.message}`);
    await mfaStep(root, onDone);
  };
  btn.onclick = go;
  pw.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  root.replaceChildren(h('div.login.panel', h('h1', 'Gem Guardians 관리자'), msg, email, pw, btn));
  email.focus();
}

async function mfaStep(root, onDone) {
  if (await hasAal2()) return onDone();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) return loginScreen(root, onDone, error.message);
  const factor = data.totp.find((f) => f.status === 'verified');
  if (factor) return codeScreen(root, onDone, factor.id, null);
  // 등록 안 끝난 요소가 남아 있으면 지우고 새로 등록(같은 이름 충돌 방지).
  for (const f of data.all.filter((x) => x.factor_type === 'totp' && x.status !== 'verified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
  const en = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `admin-${Date.now()}` });
  if (en.error) return loginScreen(root, onDone, `OTP 등록 실패: ${en.error.message} (Authentication → Multi-Factor에서 TOTP 켜기)`);
  codeScreen(root, onDone, en.data.id, en.data.totp);
}

function codeScreen(root, onDone, factorId, enroll) {
  const msg = h('div.red');
  const code = h('input', { inputMode: 'numeric', maxLength: 6, placeholder: '6자리 코드', autocomplete: 'one-time-code' });
  const btn = h('button.primary', '확인');
  const go = async () => {
    btn.disabled = true;
    const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.value.trim() });
    btn.disabled = false;
    if (error) return void (msg.textContent = `코드가 맞지 않아요: ${error.message}`);
    onDone();
  };
  btn.onclick = go;
  code.addEventListener('keydown', (e) => e.key === 'Enter' && go());
  root.replaceChildren(h('div.login.panel',
    h('h1', enroll ? 'OTP 등록' : '2단계 인증'),
    enroll && [
      h('p', 'Google Authenticator 같은 OTP 앱으로 QR을 찍고, 앱에 나온 6자리를 입력하세요.'),
      h('img.qr', { src: enroll.qr_code, alt: 'OTP QR' }),
      h('p.muted', '직접 입력 키: ', h('span.uid', enroll.secret)),
    ],
    msg, code, btn,
    h('button.link', { onclick: async () => (await supabase.auth.signOut(), loginScreen(root, onDone)) }, '다른 계정으로')));
  code.focus();
}
