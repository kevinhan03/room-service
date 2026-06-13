create table if not exists public.taste_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_text text not null default '',
  analyzed_through_count integer not null default 0,
  sample_count integer not null default 0,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists taste_profiles_created_idx
  on public.taste_profiles (created_at desc);

alter table public.taste_profiles enable row level security;
