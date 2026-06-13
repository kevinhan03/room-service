alter table public.content_items
  add column if not exists reference_urls jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'content_items_reference_urls_array_check'
      and conrelid = 'public.content_items'::regclass
  ) then
    alter table public.content_items
      add constraint content_items_reference_urls_array_check
      check (jsonb_typeof(reference_urls) = 'array');
  end if;
end
$$;
