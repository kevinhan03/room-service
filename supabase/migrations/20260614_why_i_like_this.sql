alter table public.curation_items
  add column if not exists why_i_like_this text,
  add column if not exists kevin_angle text,
  add column if not exists personal_relevance_score integer,
  add column if not exists why_note_updated_at timestamptz;

alter table public.curation_items
  drop constraint if exists curation_items_personal_relevance_score_check;

alter table public.curation_items
  add constraint curation_items_personal_relevance_score_check
  check (personal_relevance_score between 0 and 100);
