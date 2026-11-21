// Threads 포스팅 도구. 사용: npm run threads:post -- threads/posts/YYYY-MM-DD-slug.md [--yes]
// --yes 없으면 검증 + 미디어 변환 + 미리보기만(네트워크 없음). --yes면 실제 발행.
// 게임 빌드와 무관(vite는 assets/config/public만 복사). 토큰·키는 어떤 출력에도 찍지 않는다(mask).
import matter from 'gray-matter';
import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { basename, extname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '../..');
const CACHE = join(ROOT, 'threads/media-cache');
export const ENV_FILE = join(ROOT, '.env.threads');
const API = 'https://graph.threads.net/v1.0';
const LIMITS = { chars: 500, links: 5, media: 20, imageBytes: 8 * 1024 * 1024, videoBytes: 1024 ** 3, videoSec: 300 };
const MIN_W = 320, MAX_W = 1440;

export const secrets = new Set();
export const mask = (s) => [...secrets].reduce((t, k) => (k ? t.split(k).join('***') : t), String(s));

// ---------- 순수 함수(tests/threadsPost.test.js) ----------

/** Threads 글자 수: 이모지는 UTF-8 바이트 수로, 나머지는 한 글자로 센다. */
export function countChars(text) {
  let n = 0;
  for (const { segment } of new Intl.Segmenter().segment(text)) {
    n += /\p{Extended_Pictographic}/u.test(segment) ? Buffer.byteLength(segment) : 1;
  }
  return n;
}

export const countLinks = (text) => (text.match(/https?:\/\/\S+/g) || []).length;

/** 본문을 '---'만 있는 줄로 나눈다. 첫 조각=본 게시물, 나머지=답글. */
export const splitPieces = (body) => body.split(/^---[ \t]*$/m).map((s) => s.trim()).filter(Boolean);

/** 글 파일 검증. 문제 목록을 돌려준다(빈 배열이면 통과). */
export function validate(data, pieces, exists = (p) => existsSync(join(ROOT, p))) {
  const errs = [];
  if (data.status === 'posted') errs.push('status가 posted - 이미 올린 글(중복 방지)');
  else if (!['draft', 'failed'].includes(data.status)) errs.push(`status는 draft|failed 여야 함 (지금: ${data.status})`);
  else if (data.threads_id) errs.push(`threads_id(${data.threads_id})가 있음 - 일부 발행됨. 스레드에서 확인 후 정리하고 threads_id를 지운 뒤 다시`);
  if (!pieces.length) errs.push('본문이 비어 있음');
  pieces.forEach((t, i) => {
    const c = countChars(t), cp = [...t].length;
    if (c > LIMITS.chars || cp > LIMITS.chars) errs.push(`조각 ${i + 1}: ${c}자(이모지 UTF-8 기준) / ${cp}자 - ${LIMITS.chars}자 초과`);
    const links = countLinks(t) + (i === 0 && data.link && !t.includes(data.link) ? 1 : 0);
    if (links > LIMITS.links) errs.push(`조각 ${i + 1}: 링크 ${links}개 - ${LIMITS.links}개 초과`);
  });
  const tag = data.topic_tag;
  if (tag != null && (typeof tag !== 'string' || tag.length < 1 || tag.length > 50 || /[.&]/.test(tag))) {
    errs.push('topic_tag는 1~50자, 마침표(.)와 & 금지');
  }
  const media = data.media ?? [];
  if (!Array.isArray(media)) errs.push('media는 배열이어야 함');
  else {
    if (media.length > LIMITS.media) errs.push(`media ${media.length}개 - ${LIMITS.media}개 초과`);
    for (const m of media) if (!exists(m)) errs.push(`미디어 파일 없음: ${m}`);
  }
  if (data.link && !/^https?:\/\//.test(data.link)) errs.push('link는 http(s):// 로 시작해야 함');
  return errs;
}

// ---------- 미디어 준비(ffmpeg) ----------

const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function ffmpeg(args) {
  const r = spawnSync(FFMPEG, ['-hide_banner', ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) {
    throw new Error(
      'ffmpeg를 찾을 수 없습니다.\n  윈도우: winget install ffmpeg  (설치 후 터미널 재시작)\n  macOS: brew install ffmpeg\n' +
        '  또는 FFMPEG_PATH 환경 변수에 ffmpeg 실행 파일 경로를 지정',
    );
  }
  return r;
}

/** ffmpeg -i 의 출력에서 해상도·길이·fps를 읽는다(ffprobe 없이). */
function probe(file) {
  const err = ffmpeg(['-i', file]).stderr;
  const size = err.match(/Video:.*?, (\d+)x(\d+)[\s,[]/);
  if (!size) throw new Error(`해상도를 읽을 수 없음: ${relative(ROOT, file)}`);
  const d = err.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const fps = err.match(/([\d.]+) fps/);
  return {
    w: +size[1],
    h: +size[2],
    sec: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    fps: fps ? +fps[1] : 0,
    codec: err.match(/Video: (\w+)/)?.[1],
  };
}

function run(args, out) {
  const r = ffmpeg(['-y', ...args, out]);
  if (r.status !== 0) throw new Error(`ffmpeg 변환 실패: ${relative(ROOT, out)}\n${r.stderr.split('\n').slice(-6).join('\n')}`);
}

const upscale = (w) => Math.max(1, Math.ceil(MIN_W / w));

/** 원본 미디어를 Threads 조건에 맞게 준비. { file, kind: IMAGE|VIDEO, w, h, sec, bytes } */
export function prepareMedia(src, idx, slug) {
  const abs = join(ROOT, src);
  const ext = extname(src).toLowerCase();
  const stem = `${slug}-${idx + 1}-${basename(src, extname(src))}`;
  mkdirSync(CACHE, { recursive: true });
  let file = abs, kind;
  if (ext === '.gif') {
    kind = 'VIDEO';
    const { w } = probe(abs);
    const n = upscale(w);
    if (w * n > MAX_W) console.warn(`  경고: ${src} 가로 ${w * n}px > ${MAX_W}`);
    file = join(CACHE, `${stem}.mp4`);
    run(['-i', abs, '-vf', `fps=30,scale=iw*${n}:ih*${n}:flags=neighbor,pad=ceil(iw/2)*2:ceil(ih/2)*2`,
      '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an'], file);
  } else if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    kind = 'IMAGE';
    const { w } = probe(abs);
    if (w < MIN_W) {
      const n = upscale(w);
      file = join(CACHE, `${stem}.png`); // 확대 결과는 무손실 PNG로(JPG 재압축 방지)
      run(['-i', abs, '-vf', `scale=iw*${n}:ih*${n}:flags=neighbor`], file);
    }
  } else if (['.mp4', '.mov'].includes(ext)) {
    kind = 'VIDEO';
  } else {
    throw new Error(`지원하지 않는 미디어 형식: ${src} (gif/png/jpg/mp4/mov)`);
  }
  const info = probe(file);
  const bytes = statSync(file).size;
  if (kind === 'IMAGE' && bytes > LIMITS.imageBytes) {
    throw new Error(`${src}: ${(bytes / 1048576).toFixed(1)}MB - 이미지는 8MB 이하 (JPG로 저장하거나 해상도를 줄여 주세요)`);
  }
  if (kind === 'VIDEO') {
    const fix = `\n  해결: ffmpeg -i "${src}" -vf fps=30 -t 300 -c:v libx264 -crf 23 -pix_fmt yuv420p -movflags +faststart out.mp4`;
    if (info.sec > LIMITS.videoSec) throw new Error(`${src}: ${info.sec.toFixed(0)}초 - 영상은 5분 이하${fix}`);
    if (bytes > LIMITS.videoBytes) throw new Error(`${src}: 1GB 초과 (crf를 높여 다시 인코딩)${fix}`);
    if (info.fps && (info.fps < 23 || info.fps > 60)) throw new Error(`${src}: ${info.fps}fps - 23~60fps 필요${fix}`);
    if (info.codec !== 'h264') throw new Error(`${src}: 코덱 ${info.codec} - H.264만 가능${fix}`);
  }
  return { src, file, kind, ...info, bytes };
}

// ---------- Threads / Supabase ----------

function loadEnv() {
  if (!existsSync(ENV_FILE)) throw new Error('.env.threads 가 없습니다 (.env.threads.example 을 복사해 채우세요)');
  const env = parseEnv(readFileSync(ENV_FILE, 'utf8'));
  for (const k of ['THREADS_ACCESS_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (!env[k]) throw new Error(`.env.threads 에 ${k} 값이 없습니다`);
  }
  secrets.add(env.THREADS_ACCESS_TOKEN).add(env.SUPABASE_SERVICE_ROLE_KEY);
  return env;
}

export function saveToken(token, issuedAt) {
  const set = (txt, k, v) => (new RegExp(`^${k}=.*$`, 'm').test(txt) ? txt.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${txt.trimEnd()}\n${k}=${v}\n`);
  let txt = readFileSync(ENV_FILE, 'utf8');
  txt = set(set(txt, 'THREADS_ACCESS_TOKEN', token), 'THREADS_TOKEN_ISSUED_AT', issuedAt);
  writeFileSync(ENV_FILE, txt);
}

class ApiError extends Error {}

export async function api(method, url, params) {
  const u = new URL(url.startsWith('http') ? url : API + url);
  const init = { method };
  if (method === 'GET') for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  else init.body = new URLSearchParams(params);
  const res = await fetch(u, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    const e = data.error || {};
    if (e.code === 190 || res.status === 401) throw new ApiError('토큰 만료/무효 - 토큰 재발급 필요(docs 5-2)');
    throw new ApiError(`Threads API ${res.status}: ${e.message || JSON.stringify(data)}${e.code ? ` (code ${e.code})` : ''}`);
  }
  return data;
}

async function checkToken(env) {
  let token = env.THREADS_ACCESS_TOKEN;
  const issued = env.THREADS_TOKEN_ISSUED_AT ? Date.parse(env.THREADS_TOKEN_ISSUED_AT) : NaN;
  const age = Date.now() - issued;
  if (age > 60 * 86400e3) throw new ApiError('토큰 발급 후 60일 지남 - 토큰 재발급 필요(docs 5-2)');
  if (age > 30 * 86400e3) { // 남은 기간 30일 이하면 갱신(docs 3장)
    const r = await api('GET', 'https://graph.threads.net/refresh_access_token', { grant_type: 'th_refresh_token', access_token: token });
    token = r.access_token;
    secrets.add(token);
    saveToken(token, new Date().toISOString().slice(0, 10));
    console.log('  토큰 갱신됨 (.env.threads 업데이트)');
  }
  const me = await api('GET', '/me', { fields: 'id,username', access_token: token });
  if (Number.isNaN(issued)) {
    // docs 5-2의 .env.threads 틀에는 발급일 칸이 없다 - 방금 만든 토큰으로 보고 오늘로 기록해 30일 뒤 자동 갱신되게.
    saveToken(token, new Date().toISOString().slice(0, 10));
    console.warn('  THREADS_TOKEN_ISSUED_AT 이 비어 있어 오늘 날짜로 기록함 (더 오래된 토큰이면 직접 고쳐 주세요)');
  }
  return { token, userId: me.id, username: me.username };
}

const MIME = { '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

async function upload(env, m, year, slug) {
  const key = `${year}/${slug}/${basename(m.file)}`;
  const base = env.SUPABASE_URL.replace(/\/$/, '');
  const res = await fetch(`${base}/storage/v1/object/threads-media/${key}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      // 옛 service_role(JWT)만 Bearer로. 새 sb_secret_ 키는 JWT가 아니라 apikey 헤더로만 보낸다.
      ...(env.SUPABASE_SERVICE_ROLE_KEY.startsWith('eyJ') && { Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` }),
      'x-upsert': 'true', 'Content-Type': MIME[extname(m.file).toLowerCase()] },
    body: readFileSync(m.file),
  });
  if (!res.ok) throw new Error(`Supabase 업로드 실패 ${res.status}: ${await res.text()}`);
  return `${base}/storage/v1/object/public/threads-media/${key}`;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(id, token, isVideo) {
  const end = Date.now() + 5 * 60e3;
  for (;;) {
    const { status, error_message } = await api('GET', `/${id}`, { fields: 'status,error_message', access_token: token });
    if (status === 'FINISHED') return;
    if (status === 'ERROR' || status === 'EXPIRED') throw new Error(`컨테이너 ${status}: ${error_message || '(사유 없음)'}`);
    if (Date.now() > end) throw new Error(`컨테이너 준비 5분 초과 (마지막 상태 ${status})`);
    await sleep(isVideo ? 15e3 : 5e3);
  }
}

async function createAndPublish(ctx, params, isVideo) {
  const { id } = await api('POST', `/${ctx.userId}/threads`, { ...params, access_token: ctx.token });
  await waitReady(id, ctx.token, isVideo);
  return (await api('POST', `/${ctx.userId}/threads_publish`, { creation_id: id, access_token: ctx.token })).id;
}

async function publish(ctx, data, pieces, media, urls, onRoot) {
  const extra = { text: pieces[0], ...(data.topic_tag && { topic_tag: data.topic_tag }) };
  const anyVideo = media.some((m) => m.kind === 'VIDEO');
  const item = (m, url) => (m.kind === 'VIDEO' ? { media_type: 'VIDEO', video_url: url } : { media_type: 'IMAGE', image_url: url });
  let rootId;
  if (!media.length) {
    rootId = await createAndPublish(ctx, { media_type: 'TEXT', ...extra, ...(data.link && { link_attachment: data.link }) }, false);
  } else if (media.length === 1) {
    rootId = await createAndPublish(ctx, { ...item(media[0], urls[0]), ...extra }, anyVideo);
  } else {
    const children = [];
    for (let i = 0; i < media.length; i++) {
      const { id } = await api('POST', `/${ctx.userId}/threads`, { ...item(media[i], urls[i]), is_carousel_item: 'true', access_token: ctx.token });
      await waitReady(id, ctx.token, media[i].kind === 'VIDEO');
      children.push(id);
    }
    rootId = await createAndPublish(ctx, { media_type: 'CAROUSEL', children: children.join(','), ...extra }, false);
  }
  onRoot(rootId);
  let prev = rootId;
  for (const text of pieces.slice(1)) {
    prev = await createAndPublish(ctx, { media_type: 'TEXT', text, reply_to_id: prev }, false);
  }
  return rootId;
}

// ---------- main ----------

const kb = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)}MB` : `${(b / 1024).toFixed(0)}KB`);

async function main() {
  const args = process.argv.slice(2);
  const yes = args.includes('--yes');
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) throw new Error('사용: npm run threads:post -- threads/posts/YYYY-MM-DD-slug.md [--yes]');
  const abs = resolve(path);
  const name = basename(abs, '.md');
  const fm = name.match(/^(\d{4})-\d{2}-\d{2}-(.+)$/);
  if (!fm) throw new Error('파일 이름은 YYYY-MM-DD-slug.md 형식이어야 합니다');
  const [, year, slug] = fm;

  const doc = matter(readFileSync(abs, 'utf8'));
  const data = doc.data;
  const pieces = splitPieces(doc.content);
  const errs = validate(data, pieces);
  if (errs.length) throw new Error(`검증 실패:\n  - ${errs.join('\n  - ')}`);

  const media = (data.media ?? []).map((m, i) => prepareMedia(m, i, slug));

  console.log(`\n=== ${relative(ROOT, abs)} ===`);
  console.log(`topic_tag: ${data.topic_tag ?? '(없음)'}${data.link ? `   link: ${data.link}` : ''}`);
  pieces.forEach((t, i) => {
    console.log(`\n--- ${i === 0 ? '본 게시물' : `답글 ${i}`} (${countChars(t)}/${LIMITS.chars}자, 링크 ${countLinks(t)}) ---\n${t}`);
  });
  console.log(`\n미디어 ${media.length}개${media.length > 1 ? ' (캐러셀)' : ''}:`);
  for (const m of media) {
    console.log(`  ${m.src} -> ${relative(ROOT, m.file)}  [${m.kind} ${m.w}x${m.h}, ${kb(m.bytes)}${m.kind === 'VIDEO' ? `, ${m.sec.toFixed(1)}s` : ''}]`);
  }

  if (!yes) {
    console.log('\n(미리보기만 - 아무것도 업로드하지 않았습니다. 발행하려면 --yes)');
    return;
  }

  const save = (patch) => {
    Object.assign(data, patch);
    writeFileSync(abs, matter.stringify(doc.content, data));
  };
  try {
    const env = loadEnv();
    console.log('\n토큰 확인...');
    const ctx = await checkToken(env);
    console.log(`  @${ctx.username}`);
    const urls = [];
    for (const m of media) {
      console.log(`업로드: ${basename(m.file)}`);
      urls.push(await upload(env, m, year, slug));
    }
    console.log('컨테이너 생성·발행...');
    const rootId = await publish(ctx, data, pieces, media, urls, (id) => save({ threads_id: id }));
    const { permalink } = await api('GET', `/${rootId}`, { fields: 'permalink', access_token: ctx.token });
    delete data.error;
    save({ status: 'posted', permalink, posted_at: new Date().toISOString() });
    console.log(`\n발행 완료: ${permalink}`);
  } catch (e) {
    save({ status: 'failed', error: mask(e.message) });
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`\n오류: ${mask(e.message)}`);
    process.exit(1);
  });
}
