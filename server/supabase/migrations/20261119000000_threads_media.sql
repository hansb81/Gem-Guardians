-- Threads 포스팅 미디어(tools/threads/post.mjs). Threads 서버가 가져갈 수 있게 공개 읽기 버킷.
-- 쓰기는 service_role(RLS 우회)만 - anon/authenticated용 storage.objects 정책은 일부러 만들지 않는다.
insert into storage.buckets (id, name, public)
values ('threads-media', 'threads-media', true)
on conflict (id) do nothing;
