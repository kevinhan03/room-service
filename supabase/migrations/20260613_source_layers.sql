alter table public.sources
  add column if not exists source_type text;

update public.sources
set source_type = 'Magazine'
where source_type is null
   or source_type not in ('Magazine', 'Brand', 'Kevin');

alter table public.sources
  alter column source_type set default 'Magazine',
  alter column source_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'sources_source_type_check'
      and conrelid = 'public.sources'::regclass
  ) then
    alter table public.sources
      add constraint sources_source_type_check
      check (source_type in ('Magazine', 'Brand', 'Kevin'));
  end if;
end
$$;

alter table public.content_items
  alter column source_type drop default;

update public.content_items
set source_type = coalesce(
  (
    select sources.source_type
    from public.sources
    where sources.id = content_items.source_id
  ),
  'Magazine'
)
where source_type is null
   or source_type not in ('Magazine', 'Brand', 'Kevin');

alter table public.content_items
  alter column source_type set default 'Magazine',
  alter column source_type set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'content_items_source_type_check'
      and conrelid = 'public.content_items'::regclass
  ) then
    alter table public.content_items
      add constraint content_items_source_type_check
      check (source_type in ('Magazine', 'Brand', 'Kevin'));
  end if;
end
$$;

create index if not exists sources_source_type_active_idx
  on public.sources (source_type, is_active, created_at desc);

create index if not exists content_items_source_type_created_idx
  on public.content_items (source_type, created_at desc);
