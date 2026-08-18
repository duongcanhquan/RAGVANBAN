-- ============================================================
-- RAG Văn bản Hành chính — Supabase Schema + Storage
-- Dán vào: Dashboard → SQL Editor → Run
-- ============================================================

-- 1) Bảng lịch sử chat
create table if not exists public.chat_logs (
  id uuid primary key default gen_random_uuid(),
  user_session text not null default 'anonymous',
  question text not null,
  citations_used jsonb not null default '[]'::jsonb,
  answer text default '',
  created_at timestamptz not null default now()
);

create index if not exists chat_logs_created_at_idx on public.chat_logs (created_at desc);
create index if not exists chat_logs_user_session_idx on public.chat_logs (user_session);

-- 2) Bảng tài liệu đã số hóa
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  so_hieu text,
  loai_van_ban text,
  trang_thai text,
  chunk_count integer not null default 0,
  storage_path text,
  storage_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Nâng cấp cột nếu bảng đã tồn tại từ bản cũ
alter table public.documents add column if not exists storage_path text;
alter table public.documents add column if not exists storage_url text;
alter table public.documents add column if not exists drive_file_id text;
alter table public.documents add column if not exists drive_web_view_link text;
alter table public.documents add column if not exists source text default 'upload';

create index if not exists documents_created_at_idx on public.documents (created_at desc);

-- 3) RLS
alter table public.chat_logs enable row level security;
alter table public.documents enable row level security;

drop policy if exists "anon_read_chat_logs" on public.chat_logs;
create policy "anon_read_chat_logs"
  on public.chat_logs for select
  to anon, authenticated
  using (true);

drop policy if exists "anon_read_documents" on public.documents;
create policy "anon_read_documents"
  on public.documents for select
  to anon, authenticated
  using (true);

-- 4) Storage bucket `documents` (public đọc URL)
insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do update set public = excluded.public;

-- Cho phép đọc object công khai
drop policy if exists "public_read_documents_bucket" on storage.objects;
create policy "public_read_documents_bucket"
  on storage.objects for select
  to public
  using (bucket_id = 'documents');

-- Ghi object: dùng service_role từ backend (bypass RLS).
-- Nếu muốn upload từ client (không khuyến nghị), thêm policy insert riêng.

comment on table public.chat_logs is 'Lịch sử câu hỏi RAG + citations';
comment on table public.documents is 'PDF đã số hóa + URL Supabase Storage';
