-- ============================================================
-- RAGVANBAN — chạy MỘT LẦN trong SQL Editor (đúng thứ tự 001→007)
-- ============================================================

-- ---------- 001: chat_logs + documents + storage ----------
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

alter table public.documents add column if not exists storage_path text;
alter table public.documents add column if not exists storage_url text;
alter table public.documents add column if not exists drive_file_id text;
alter table public.documents add column if not exists drive_web_view_link text;
alter table public.documents add column if not exists source text default 'upload';

create index if not exists documents_created_at_idx on public.documents (created_at desc);

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

insert into storage.buckets (id, name, public)
values ('documents', 'documents', true)
on conflict (id) do update set public = excluded.public;

drop policy if exists "public_read_documents_bucket" on storage.objects;
create policy "public_read_documents_bucket"
  on storage.objects for select
  to public
  using (bucket_id = 'documents');

-- ---------- 002: Drive columns ----------
alter table public.documents add column if not exists drive_file_id text;
alter table public.documents add column if not exists drive_web_view_link text;
alter table public.documents add column if not exists source text default 'upload';

create index if not exists documents_drive_file_id_idx
  on public.documents (drive_file_id)
  where drive_file_id is not null;

create index if not exists documents_source_idx on public.documents (source);

-- ---------- 003: knowledge ----------
alter table public.chat_logs add column if not exists marked_knowledge boolean default false;
alter table public.chat_logs add column if not exists tags jsonb default '[]'::jsonb;

create index if not exists chat_logs_session_idx on public.chat_logs (user_session, created_at desc);
create index if not exists chat_logs_knowledge_idx on public.chat_logs (marked_knowledge) where marked_knowledge = true;

create table if not exists public.scenarios (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  situation text not null,
  suggested_question text default '',
  sample_answer text default '',
  tags text[] not null default '{}',
  use_count integer not null default 0,
  created_by text default 'anonymous',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scenarios_created_at_idx on public.scenarios (created_at desc);
create index if not exists scenarios_tags_idx on public.scenarios using gin (tags);

alter table public.scenarios enable row level security;

drop policy if exists "anon_read_scenarios" on public.scenarios;
create policy "anon_read_scenarios"
  on public.scenarios for select
  to anon, authenticated
  using (true);

-- ---------- 004: doc_categories ----------
create table if not exists public.doc_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.doc_categories(id) on delete cascade,
  name text not null,
  slug text not null,
  kind text not null default 'folder',
  description text default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists doc_categories_slug_parent_uidx
  on public.doc_categories (slug, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid));

create index if not exists doc_categories_parent_idx on public.doc_categories (parent_id);
create index if not exists doc_categories_sort_idx on public.doc_categories (sort_order, name);

alter table public.documents add column if not exists category_id uuid references public.doc_categories(id) on delete set null;
alter table public.documents add column if not exists chuyen_mon text;
alter table public.documents add column if not exists folder_path text;

create index if not exists documents_category_id_idx on public.documents (category_id);

alter table public.scenarios
  add column if not exists category_id uuid references public.doc_categories(id) on delete set null;
create index if not exists scenarios_category_id_idx on public.scenarios (category_id);

alter table public.doc_categories enable row level security;

drop policy if exists "anon_read_doc_categories" on public.doc_categories;
create policy "anon_read_doc_categories"
  on public.doc_categories for select
  to anon, authenticated
  using (true);

-- ---------- 005: /quantri ----------
create table if not exists public.admin_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text not null default '',
  role text not null default 'editor' check (role in ('super_admin', 'editor')),
  is_active boolean not null default true,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists admin_profiles_role_idx on public.admin_profiles (role);
create index if not exists admin_profiles_email_idx on public.admin_profiles (email);

create table if not exists public.admin_category_grants (
  user_id uuid not null references public.admin_profiles (id) on delete cascade,
  category_id uuid not null references public.doc_categories (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, category_id)
);

create index if not exists admin_category_grants_category_idx
  on public.admin_category_grants (category_id);

alter table public.admin_profiles enable row level security;
alter table public.admin_category_grants enable row level security;

drop policy if exists "admin_read_own_profile" on public.admin_profiles;
create policy "admin_read_own_profile"
  on public.admin_profiles for select
  to authenticated
  using (id = auth.uid());

drop policy if exists "admin_read_own_grants" on public.admin_category_grants;
create policy "admin_read_own_grants"
  on public.admin_category_grants for select
  to authenticated
  using (user_id = auth.uid());

-- ---------- 006: app_settings (từ khóa tìm nhanh) ----------
create table if not exists public.app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

drop policy if exists "anon_read_app_settings" on public.app_settings;
create policy "anon_read_app_settings"
  on public.app_settings for select
  to anon, authenticated
  using (key = 'quick_keywords');

-- ---------- 007: sort_order tài liệu ----------
alter table public.documents add column if not exists sort_order integer;

create index if not exists documents_category_sort_idx
  on public.documents (category_id, sort_order, created_at desc);

-- ---------- 008: display_name / mo_ta ----------
alter table public.documents add column if not exists display_name text;
alter table public.documents add column if not exists mo_ta text;

-- ---------- 009: chống trùng nội dung file ----------
alter table public.documents add column if not exists content_sha256 text;
alter table public.documents add column if not exists byte_size bigint;

-- ---------- 010: dạy AI (kỹ năng lưu app_settings key ai_skills / ai_learn) ----------
-- Không bắt buộc bảng mới: skillStore đọc public.app_settings.
-- Cron /api/cron/ai-learn mỗi ngày đề xuất bài mẫu; admin duyệt tại /quantri/day-ai.

