-- Vân tay nội dung file gốc — chống trùng R2 / vector.
alter table public.documents add column if not exists content_sha256 text;
alter table public.documents add column if not exists byte_size bigint;

create unique index if not exists documents_content_sha256_uidx
  on public.documents (content_sha256)
  where content_sha256 is not null and length(content_sha256) = 64;

comment on column public.documents.content_sha256 is 'SHA-256 hex của bytes file gốc (R2/upload)';
