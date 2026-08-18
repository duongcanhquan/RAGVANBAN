-- ============================================================
-- Lịch sử chat mở rộng + kho tình huống mẫu (làm giàu AI)
-- ============================================================

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

comment on table public.scenarios is 'Tình huống đặc thù mẫu — làm giàu AI & tái sử dụng';
