-- ============================================================
-- Cây chuyên mục / chuyên môn / thư mục con cho tài liệu
-- ============================================================

create table if not exists public.doc_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.doc_categories(id) on delete cascade,
  name text not null,
  slug text not null,
  kind text not null default 'folder', -- chuyen_muc | chuyen_mon | folder
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

alter table public.doc_categories enable row level security;

drop policy if exists "anon_read_doc_categories" on public.doc_categories;
create policy "anon_read_doc_categories"
  on public.doc_categories for select
  to anon, authenticated
  using (true);

comment on table public.doc_categories is 'Cây chuyên mục / chuyên môn / sub-folder tài liệu HCC';
comment on column public.documents.category_id is 'Thư mục chuyên môn chứa tài liệu';
comment on column public.documents.folder_path is 'Đường dẫn hiển thị: Cha / Con / ...';
