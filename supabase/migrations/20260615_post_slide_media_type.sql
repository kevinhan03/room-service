alter table public.post_slides
  add column if not exists media_type text not null default 'photo';

alter table public.post_slides
  drop constraint if exists post_slides_media_type_check;

alter table public.post_slides
  add constraint post_slides_media_type_check
  check (media_type in ('photo', 'video'));
