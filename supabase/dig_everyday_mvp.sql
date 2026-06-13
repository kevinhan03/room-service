create table if not exists sources (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('rss', 'url', 'manual', 'social')),
  source_type text not null default 'Magazine' check (
    source_type in ('Magazine', 'Brand', 'Kevin')
  ),
  name text not null,
  url text not null,
  category text,
  is_active boolean not null default true,
  last_fetched_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  source_id uuid references sources(id) on delete set null,
  source_type text not null default 'Magazine' check (
    source_type in ('Magazine', 'Brand', 'Kevin')
  ),
  title text not null,
  url text not null unique,
  canonical_url text,
  image_url text,
  image_credit text,
  image_source_url text,
  image_usage_status text not null default 'unknown' check (
    image_usage_status in ('owned', 'permission_needed', 'credited_ok', 'do_not_use', 'unknown')
  ),
  author text,
  publisher text,
  published_at timestamptz,
  fetched_at timestamptz not null default now(),
  raw_excerpt text,
  raw_content text,
  reference_urls jsonb not null default '[]',
  language text,
  content_hash text,
  created_at timestamptz not null default now()
);

create table if not exists kevin_finds (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null check (
    category in (
      'Restaurant', 'Cafe', 'Hotel', 'Travel', 'Store', 'Exhibition',
      'Perfume', 'Object', 'Product', 'Brand', 'Book', 'Magazine',
      'Artwork', 'Playlist'
    )
  ),
  location text,
  visited_at date,
  rating integer check (rating between 1 and 5),
  notes text,
  why_saved text,
  image_url text,
  image_credit text,
  image_source_url text,
  image_usage_status text not null default 'owned' check (
    image_usage_status in ('owned', 'permission_needed', 'credited_ok', 'do_not_use', 'unknown')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ai_analyses (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('daily_find', 'kevin_found')),
  content_item_id uuid references content_items(id) on delete cascade,
  kevin_find_id uuid references kevin_finds(id) on delete cascade,
  generated_title text,
  one_line_summary text,
  three_line_summary text,
  category text not null check (
    category in (
      'Fashion', 'Space', 'Food', 'Travel', 'Hotel', 'Object', 'Perfume',
      'Architecture', 'Restaurant', 'Cafe', 'Store', 'Exhibition',
      'Product', 'Brand', 'Book', 'Magazine', 'Artwork', 'Playlist'
    )
  ),
  recommendation_reason text,
  why_this_feels_good text,
  editorial_angle text,
  visual_strength text,
  kevin_taste_fit text,
  suitability_score integer check (suitability_score between 0 and 100),
  taste_fit_score integer check (taste_fit_score between 0 and 100),
  visual_score integer check (visual_score between 0 and 100),
  story_score integer check (story_score between 0 and 100),
  suggested_status text check (
    suggested_status in ('Candidate', 'Approved', 'Hold', 'Rejected', 'Dig More Candidate')
  ),
  key_points jsonb not null default '[]',
  source_facts jsonb not null default '[]',
  risk_notes text,
  verification_needed text,
  model text,
  created_at timestamptz not null default now(),
  check (
    (item_type = 'daily_find' and content_item_id is not null and kevin_find_id is null)
    or
    (item_type = 'kevin_found' and kevin_find_id is not null and content_item_id is null)
  )
);

create table if not exists curation_items (
  id uuid primary key default gen_random_uuid(),
  item_type text not null check (item_type in ('daily_find', 'kevin_found')),
  content_item_id uuid references content_items(id) on delete cascade,
  kevin_find_id uuid references kevin_finds(id) on delete cascade,
  ai_analysis_id uuid references ai_analyses(id) on delete set null,
  status text not null default 'Candidate' check (
    status in ('Candidate', 'Approved', 'Hold', 'Rejected', 'Dig More Candidate')
  ),
  priority integer not null default 0,
  human_decision text not null default 'none' check (
    human_decision in ('none', 'post_today', 'saved_candidate', 'dig_more', 'rejected')
  ),
  human_saved boolean not null default false,
  human_saved_at timestamptz,
  last_recommended_at timestamptz,
  recommendation_count integer not null default 0 check (recommendation_count >= 0),
  editor_note text,
  rejection_reason text,
  publish_target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (item_type = 'daily_find' and content_item_id is not null and kevin_find_id is null)
    or
    (item_type = 'kevin_found' and kevin_find_id is not null and content_item_id is null)
  )
);

create table if not exists post_drafts (
  id uuid primary key default gen_random_uuid(),
  curation_item_id uuid references curation_items(id) on delete set null,
  title text not null,
  category text,
  source_type text not null check (source_type in ('daily_find', 'kevin_found')),
  status text not null default 'Draft' check (
    status in ('Draft', 'Editing', 'Ready to Export', 'Exported', 'Published')
  ),
  image_url text,
  image_credit text,
  image_source_url text,
  image_usage_status text not null default 'unknown' check (
    image_usage_status in ('owned', 'permission_needed', 'credited_ok', 'do_not_use', 'unknown')
  ),
  caption text,
  hashtags jsonb not null default '[]',
  credit_note text,
  source_note text,
  editor_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists post_slides (
  id uuid primary key default gen_random_uuid(),
  post_draft_id uuid not null references post_drafts(id) on delete cascade,
  slide_index integer not null check (slide_index between 1 and 7),
  slide_type text not null check (
    slide_type in (
      'Cover', 'Introduction', 'Why It Matters', 'Detail 1',
      'Detail 2', 'Editor''s Note', 'CTA'
    )
  ),
  title text,
  body text,
  image_url text,
  layout_key text,
  created_at timestamptz not null default now(),
  unique (post_draft_id, slide_index)
);
