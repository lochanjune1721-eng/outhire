-- outbid.lol — schema, triggers, RLS, storage.
-- Paste into the Supabase SQL editor and run once.

-- ===========================================================================
-- 1. TABLES
-- ===========================================================================

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  source_url text unique,
  source_domain text,
  company_name text, company_domain text,
  role_title text, location text,
  claimed_by_email text,
  created_at timestamptz default now()
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  side text,                              -- 'candidate' | 'recruiter'
  board_id uuid references boards(id),    -- null = homepage
  display_name text,
  headline text,                          -- the one-liner, max 120
  url text,                               -- portfolio or company
  email text,
  photo_path text,
  video_url text,
  video_platform text,                    -- 'youtube' | 'vimeo'
  category text,
  current_bid_cents int default 0,
  click_count int default 0,
  status text default 'pending',
  upload_token text unique,
  created_at timestamptz default now(),
  last_bid_at timestamptz,
  constraint media_required check (photo_path is not null or video_url is not null)
);

create table if not exists bids (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references entries(id),
  amount_cents int,
  stripe_session_id text unique,
  created_at timestamptz default now()
);

create table if not exists clicks (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references entries(id),
  created_at timestamptz default now()
);

create table if not exists site_stats (
  id int primary key default 1,
  total_revenue_cents int default 0,
  visitor_count int default 0,
  launched_at timestamptz default now()
);
insert into site_stats (id) values (1) on conflict (id) do nothing;

-- Part 5 needs per-recruiter state the base schema has no place for:
-- shortlist flags, private notes, and an audit trail of contact reveals.
create table if not exists recruiter_notes (
  id uuid primary key default gen_random_uuid(),
  board_id uuid references boards(id) on delete cascade,
  entry_id uuid references entries(id) on delete cascade,
  recruiter_email text not null,
  shortlisted boolean default false,
  note text,
  updated_at timestamptz default now(),
  unique (entry_id, recruiter_email)
);

create table if not exists contact_reveals (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid references entries(id) on delete cascade,
  recruiter_email text not null,
  created_at timestamptz default now(),
  unique (entry_id, recruiter_email)
);

-- The one-liner cap is a product rule, so the database enforces it too.
do $$ begin
  alter table entries add constraint entries_headline_len check (char_length(headline) <= 120);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table entries add constraint entries_side_valid check (side in ('candidate','recruiter'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table entries add constraint entries_status_valid check (status in ('pending','live','rejected'));
exception when duplicate_object then null; end $$;

create index if not exists entries_rank_idx
  on entries (current_bid_cents desc, last_bid_at asc nulls last, created_at asc);
create index if not exists entries_side_idx on entries (side, status);
create index if not exists entries_board_idx on entries (board_id);
create index if not exists entries_category_idx on entries (category);
create index if not exists bids_created_idx on bids (created_at desc);
create index if not exists clicks_entry_idx on clicks (entry_id);
create index if not exists boards_domain_idx on boards (company_domain);

-- ===========================================================================
-- 2. TRIGGERS
-- ===========================================================================

create or replace function on_bid_inserted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update entries
     set current_bid_cents = greatest(coalesce(current_bid_cents, 0), new.amount_cents),
         last_bid_at       = coalesce(new.created_at, now())
   where id = new.entry_id;

  update site_stats
     set total_revenue_cents = total_revenue_cents + new.amount_cents
   where id = 1;
  return new;
end $$;

drop trigger if exists bids_after_insert on bids;
create trigger bids_after_insert after insert on bids
  for each row execute function on_bid_inserted();

-- clicks is the only public-writable table, and entries is not public-writable,
-- so the denormalised counter has to be maintained here.
create or replace function on_click_inserted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update entries set click_count = coalesce(click_count, 0) + 1 where id = new.entry_id;
  return new;
end $$;

drop trigger if exists clicks_after_insert on clicks;
create trigger clicks_after_insert after insert on clicks
  for each row execute function on_click_inserted();

-- ===========================================================================
-- 3. PUBLIC RPC — the visitor counter in the header
-- ===========================================================================

create or replace function record_visit() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update site_stats set visitor_count = coalesce(visitor_count, 0) + 1
   where id = 1 returning visitor_count into n;
  return n;
end $$;

grant execute on function record_visit() to anon, authenticated;

-- ===========================================================================
-- 4. ROW LEVEL SECURITY
-- ===========================================================================

alter table entries enable row level security;
drop policy if exists "public read live" on entries;
create policy "public read live" on entries for select using (status = 'live');
-- no public insert/update/delete on entries

-- RLS is row-level, so it cannot hide the email column on a readable row.
-- Column privileges can: revoke everything, then grant back every column
-- except `email` and `upload_token`. Candidate contact details are therefore
-- unreachable with the anon key even for a live row -- the only way to a
-- candidate's email is /api/recruiter with action 'reveal', which records the
-- reveal and notifies the candidate.
revoke select on entries from anon, authenticated;
grant select (
  id, slug, side, board_id, display_name, headline, url,
  photo_path, video_url, video_platform, category,
  current_bid_cents, click_count, status, created_at, last_bid_at
) on entries to anon, authenticated;

alter table clicks enable row level security;
drop policy if exists "public insert" on clicks;
create policy "public insert" on clicks for insert with check (true);

alter table site_stats enable row level security;
drop policy if exists "public read" on site_stats;
create policy "public read" on site_stats for select using (true);

alter table boards enable row level security;
drop policy if exists "public read" on boards;
create policy "public read" on boards for select using (true);

alter table bids enable row level security;
drop policy if exists "public read" on bids;
create policy "public read" on bids for select using (true);

-- Recruiter state is private to the recruiter. Reads go through the signed-in
-- session; every write goes through /api/recruiter with the service key.
alter table recruiter_notes enable row level security;
drop policy if exists "own notes" on recruiter_notes;
create policy "own notes" on recruiter_notes for select
  using (recruiter_email = (auth.jwt() ->> 'email'));

alter table contact_reveals enable row level security;
drop policy if exists "own reveals" on contact_reveals;
create policy "own reveals" on contact_reveals for select
  using (recruiter_email = (auth.jwt() ->> 'email'));

-- ===========================================================================
-- 5. REALTIME — the activity feed subscribes to bids
-- ===========================================================================

do $$ begin
  alter publication supabase_realtime add table bids;
exception when duplicate_object then null; end $$;

-- ===========================================================================
-- 6. STORAGE — bucket `photos`: public read, no public write.
--    Uploads use a signed URL minted server-side after payment.
-- ===========================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg','image/png','image/webp'];

drop policy if exists "photos public read" on storage.objects;
create policy "photos public read" on storage.objects
  for select using (bucket_id = 'photos');
-- no insert/update/delete policy: the service role is the only writer.

-- ===========================================================================
-- 7. SEED — exactly one entry. Nothing else.
--    An obviously fake board is worse than an empty one, so there are no
--    placeholder companies or invented candidates here.
--
--    Before running: replace the headline with your own one-liner, and upload
--    your photo to the `photos` bucket as `seed/lochan.jpg`. If that object is
--    missing the card falls back to a coral monogram tile rather than breaking.
-- ===========================================================================

insert into entries (
  slug, side, display_name, url, headline, email,
  photo_path, category, current_bid_cents, status, created_at, last_bid_at
) values (
  'lochan',
  'candidate',
  'Lochan',
  'https://lochan-maru.vercel.app',
  'REPLACE ME: one line on why you should be hired.',
  null,
  'seed/lochan.jpg',
  'Engineering',
  500,
  'live',
  now(),
  now()
) on conflict (slug) do nothing;
