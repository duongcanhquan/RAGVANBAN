-- Tình huống Q&A gắn hạng mục (cây doc_categories)
alter table public.scenarios
  add column if not exists category_id uuid references public.doc_categories(id) on delete set null;

create index if not exists scenarios_category_id_idx on public.scenarios (category_id);

comment on column public.scenarios.category_id is 'Hạng mục / chuyên mục để trang ngoài lọc tình huống Q&A';
comment on table public.scenarios is 'Tình huống Q&A do admin/quản lý nhập sẵn — không sinh bằng AI';
