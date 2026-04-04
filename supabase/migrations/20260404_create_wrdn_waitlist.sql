create extension if not exists citext;

create table if not exists public.wrdn_waitlist (
  id bigserial primary key,
  email citext not null unique,
  source text not null default 'wrdn-page',
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default timezone('utc', now())
);

comment on table public.wrdn_waitlist is 'Email captures for wrdn interest / waitlist.';
comment on column public.wrdn_waitlist.email is 'Normalized subscriber email address.';
comment on column public.wrdn_waitlist.source is 'Capture surface for the email.';

alter table public.wrdn_waitlist enable row level security;

create policy "deny direct client access to wrdn waitlist"
on public.wrdn_waitlist
as restrictive
for all
to public
using (false)
with check (false);
