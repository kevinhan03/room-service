create table if not exists public.recommendation_snapshots (
  id uuid primary key default gen_random_uuid(),
  recommendation_date date not null unique,
  generated_at timestamptz not null default now(),
  item_count integer not null default 0 check (item_count >= 0)
);

create table if not exists public.recommendation_snapshot_items (
  snapshot_id uuid not null references public.recommendation_snapshots(id) on delete cascade,
  curation_item_id uuid not null references public.curation_items(id) on delete cascade,
  rank integer not null check (rank between 1 and 10),
  final_score numeric(5,1) not null default 0,
  created_at timestamptz not null default now(),
  primary key (snapshot_id, curation_item_id),
  unique (snapshot_id, rank)
);

create table if not exists public.collection_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null,
  status text not null default 'running' check (status in ('running', 'completed', 'partial', 'failed')),
  source_count integer not null default 0,
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.source_collection_runs (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.collection_runs(id) on delete cascade,
  source_id uuid references public.sources(id) on delete set null,
  source_name text,
  status text not null check (status in ('completed', 'partial', 'failed')),
  imported_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  completed_at timestamptz not null default now()
);

alter table public.post_drafts
  add column if not exists format text not null default 'Check-in',
  add column if not exists hook text,
  add column if not exists last_opened_at timestamptz;

create index if not exists recommendation_snapshot_date_idx
  on public.recommendation_snapshots (recommendation_date desc);

create index if not exists collection_runs_started_idx
  on public.collection_runs (started_at desc);

create index if not exists source_collection_runs_run_idx
  on public.source_collection_runs (run_id, started_at desc);

create index if not exists post_drafts_updated_idx
  on public.post_drafts (updated_at desc);

create index if not exists kevin_finds_updated_idx
  on public.kevin_finds (updated_at desc);


alter table public.recommendation_snapshots enable row level security;
alter table public.recommendation_snapshot_items enable row level security;
alter table public.collection_runs enable row level security;
alter table public.source_collection_runs enable row level security;
