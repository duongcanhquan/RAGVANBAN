-- ============================================================
-- Google Drive metadata trên bảng documents
-- Dán vào: Dashboard → SQL Editor → Run (sau 001)
-- ============================================================

alter table public.documents add column if not exists drive_file_id text;
alter table public.documents add column if not exists drive_web_view_link text;
alter table public.documents add column if not exists source text default 'upload';

create index if not exists documents_drive_file_id_idx
  on public.documents (drive_file_id)
  where drive_file_id is not null;

create index if not exists documents_source_idx on public.documents (source);

comment on column public.documents.drive_file_id is 'Google Drive file id (nếu nguồn từ Drive)';
comment on column public.documents.drive_web_view_link is 'Link xem trên Drive';
comment on column public.documents.source is 'upload | google_drive | n8n | url';
