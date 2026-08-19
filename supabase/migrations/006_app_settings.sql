-- Từ khóa tìm nhanh + cài đặt app (ghi bằng service role).
-- Anon chỉ được đọc key public `quick_keywords`. Secret (google_sa, n8n_secret) không lộ qua Data API.
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
