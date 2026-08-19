-- Thứ tự kéo-thả tài liệu trong từng chuyên mục (admin /quantri).
alter table public.documents add column if not exists sort_order integer;

create index if not exists documents_category_sort_idx
  on public.documents (category_id, sort_order, created_at desc);
