-- ============================================================
-- Quản trị /quantri — hồ sơ cán bộ + quyền theo chuyên mục
-- KHÔNG chạy file này trước. Cần bảng public.doc_categories.
-- Cách đúng: chạy 001 → 002 → 003 → 004 → 005
-- hoặc dán một lần: supabase/setup-all.sql
-- ============================================================

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

-- Ghi hồ sơ / gán quyền: chỉ service_role (backend), không mở insert cho anon.

comment on table public.admin_profiles is 'Cán bộ /quantri — role trong bảng này, không dùng user_metadata';
comment on table public.admin_category_grants is 'Editor được upload chuyên mục này và mọi mục con';
comment on column public.admin_profiles.role is 'super_admin = full; editor = theo grants';
