-- Tên hiển thị + mô tả tài liệu (khác file_name dùng để số hóa / Pinecone).
alter table public.documents add column if not exists display_name text;
alter table public.documents add column if not exists mo_ta text;

comment on column public.documents.display_name is 'Tên hiện trên danh mục / thư viện';
comment on column public.documents.mo_ta is 'Mô tả ngắn do người tải lên nhập';
