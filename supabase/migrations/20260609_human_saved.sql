alter table public.curation_items
  add column if not exists human_decision text not null default 'none',
  add column if not exists human_saved boolean not null default false,
  add column if not exists human_saved_at timestamptz,
  add column if not exists last_recommended_at timestamptz,
  add column if not exists recommendation_count integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'curation_items_human_decision_check'
      and conrelid = 'public.curation_items'::regclass
  ) then
    alter table public.curation_items
      add constraint curation_items_human_decision_check
      check (
        human_decision in (
          'none',
          'post_today',
          'saved_candidate',
          'dig_more',
          'rejected'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'curation_items_recommendation_count_check'
      and conrelid = 'public.curation_items'::regclass
  ) then
    alter table public.curation_items
      add constraint curation_items_recommendation_count_check
      check (recommendation_count >= 0);
  end if;
end
$$;

create index if not exists curation_items_recommendation_queue_idx
  on public.curation_items (
    status,
    human_saved desc,
    last_recommended_at asc nulls first,
    created_at desc
  )
  where status not in ('Rejected', 'Approved');
