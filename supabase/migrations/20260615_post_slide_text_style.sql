alter table public.post_slides
  add column if not exists text_style jsonb not null default '{}'::jsonb;

alter table public.post_slides
  drop constraint if exists post_slides_text_style_object_check;

alter table public.post_slides
  add constraint post_slides_text_style_object_check
  check (jsonb_typeof(text_style) = 'object');
