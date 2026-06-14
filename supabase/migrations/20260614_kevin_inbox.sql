create table if not exists public.kevin_inbox_items (
  id uuid primary key default gen_random_uuid(),
  seed_text text not null,
  reference_urls jsonb not null default '[]'::jsonb,
  status text not null default 'new' check (
    status in ('new', 'ideas_ready', 'selected', 'held', 'researched')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(reference_urls) = 'array')
);

create table if not exists public.kevin_inbox_ideas (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references public.kevin_inbox_items(id) on delete cascade,
  rank integer not null check (rank between 1 and 3),
  title text not null,
  category text not null,
  angle text,
  why_publish text,
  research_query text,
  status text not null default 'suggested' check (
    status in ('suggested', 'selected', 'held', 'researched')
  ),
  research_brief jsonb,
  curation_item_id uuid references public.curation_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (inbox_item_id, rank)
);

create index if not exists kevin_inbox_items_updated_idx
  on public.kevin_inbox_items (updated_at desc);

create index if not exists kevin_inbox_ideas_item_idx
  on public.kevin_inbox_ideas (inbox_item_id, rank);

alter table public.kevin_inbox_items enable row level security;
alter table public.kevin_inbox_ideas enable row level security;
