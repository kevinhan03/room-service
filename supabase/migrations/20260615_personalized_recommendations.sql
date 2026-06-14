create table if not exists public.recommendation_events (
  id uuid primary key default gen_random_uuid(),
  curation_item_id uuid references public.curation_items(id) on delete cascade,
  inbox_item_id uuid references public.kevin_inbox_items(id) on delete cascade,
  inbox_idea_id uuid references public.kevin_inbox_ideas(id) on delete set null,
  action text not null check (
    action in (
      'post_today',
      'save_candidate',
      'dig_more',
      'reject',
      'why_note',
      'inbox_created',
      'idea_selected',
      'idea_held',
      'idea_researched',
      'kevin_find_created',
      'board_approved',
      'board_held'
    )
  ),
  weight numeric(6, 2) not null default 0,
  category text,
  source_type text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object')
);

create index if not exists recommendation_events_created_idx
  on public.recommendation_events (created_at desc);

create index if not exists recommendation_events_curation_idx
  on public.recommendation_events (curation_item_id, created_at desc);

create index if not exists recommendation_events_inbox_idx
  on public.recommendation_events (inbox_item_id, created_at desc);

alter table public.recommendation_events enable row level security;

grant select, insert, update, delete
  on table public.recommendation_events
  to service_role;

alter table public.kevin_inbox_ideas
  add column if not exists personal_score numeric(5, 2),
  add column if not exists score_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists matched_preferences jsonb not null default '[]'::jsonb;

alter table public.kevin_inbox_ideas
  drop constraint if exists kevin_inbox_ideas_personal_score_check;

alter table public.kevin_inbox_ideas
  drop constraint if exists kevin_inbox_ideas_score_breakdown_object_check;

alter table public.kevin_inbox_ideas
  drop constraint if exists kevin_inbox_ideas_matched_preferences_array_check;

alter table public.kevin_inbox_ideas
  add constraint kevin_inbox_ideas_personal_score_check
  check (personal_score is null or personal_score between 0 and 100);

alter table public.kevin_inbox_ideas
  add constraint kevin_inbox_ideas_score_breakdown_object_check
  check (jsonb_typeof(score_breakdown) = 'object');

alter table public.kevin_inbox_ideas
  add constraint kevin_inbox_ideas_matched_preferences_array_check
  check (jsonb_typeof(matched_preferences) = 'array');
