-- OUTHIRE — Supabase schema, triggers, RLS, storage.
-- Paste this whole file into the Supabase SQL editor and run it once.
-- It is idempotent enough to re-run on a fresh project; it is not a migration tool.

-- ---------------------------------------------------------------------------
-- 1. TABLES
-- ---------------------------------------------------------------------------

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  slug text unique, name text, sort_order int
);

create table if not exists boards (
  id uuid primary key default gen_random_uuid(),
  share_token text unique,
  company_name text, role_title text, job_url text,
  recruiter_email text,
  created_at timestamptz default now()
);

create table if not exists entries (
  id uuid primary key default gen_random_uuid(),
  slug text unique,
  board_id uuid references boards(id),   -- null = global feed
  category_id uuid references categories(id),
  display_name text,
  headline text,                          -- max 140 chars
  email text,
  portfolio_url text,
  linkedin_url text,
  video_path text,
  video_duration int,
  current_bid_cents int default 0,
  click_count int default 0,
  view_count int default 0,
  status text default 'pending',          -- pending | live | rejected
  upload_token text unique,
  created_at timestamptz default now(),
  last_bid_at timestamptz
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
  launched_at timestamptz default now()
);
insert into site_stats (id) values (1) on conflict (id) do nothing;

-- Additive to the original spec: the masthead prints "X visitors since launch",
-- and nothing in the spec's schema counts visits. One integer, bumped through a
-- security-definer function so the table itself stays read-only to the public.
alter table site_stats add column if not exists visit_count int default 0;

-- Headline is capped at 140 in the spec's comment; enforce it in the database
-- so a bad serverless deploy cannot widen it.
do $$ begin
  alter table entries add constraint entries_headline_len check (char_length(headline) <= 140);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table entries add constraint entries_status_valid
    check (status in ('pending','live','rejected'));
exception when duplicate_object then null; end $$;

create index if not exists entries_rank_idx
  on entries (current_bid_cents desc, last_bid_at asc nulls last, created_at asc);
create index if not exists entries_status_idx on entries (status);
create index if not exists entries_board_idx on entries (board_id);
create index if not exists entries_category_idx on entries (category_id);
create index if not exists bids_created_idx on bids (created_at desc);
create index if not exists clicks_entry_idx on clicks (entry_id);

-- ---------------------------------------------------------------------------
-- 2. TRIGGERS
-- ---------------------------------------------------------------------------

-- On a bid: raise the entry's standing bid, stamp last_bid_at, and add the
-- money to the site-wide revenue counter that the masthead ticks up.
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

-- Clicks are public-insertable, but entries are not public-updatable, so the
-- denormalised click_count has to be maintained by the database.
create or replace function on_click_inserted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update entries set click_count = coalesce(click_count, 0) + 1 where id = new.entry_id;
  return new;
end $$;

drop trigger if exists clicks_after_insert on clicks;
create trigger clicks_after_insert after insert on clicks
  for each row execute function on_click_inserted();

-- ---------------------------------------------------------------------------
-- 3. PUBLIC RPCs (the only write paths the anon key gets)
-- ---------------------------------------------------------------------------

create or replace function record_view(entry uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update entries set view_count = coalesce(view_count, 0) + 1
   where id = entry and status = 'live';
end $$;

create or replace function record_visit() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update site_stats set visit_count = coalesce(visit_count, 0) + 1
   where id = 1 returning visit_count into n;
  return n;
end $$;

grant execute on function record_view(uuid) to anon, authenticated;
grant execute on function record_visit() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

alter table entries enable row level security;
drop policy if exists "public read live" on entries;
create policy "public read live" on entries
  for select using (status = 'live');
-- no public insert/update/delete on entries

alter table clicks enable row level security;
drop policy if exists "public insert" on clicks;
create policy "public insert" on clicks for insert with check (true);

alter table site_stats enable row level security;
drop policy if exists "public read" on site_stats;
create policy "public read" on site_stats for select using (true);

alter table categories enable row level security;
drop policy if exists "public read" on categories;
create policy "public read" on categories for select using (true);

alter table boards enable row level security;
drop policy if exists "public read" on boards;
create policy "public read" on boards for select using (true);

alter table bids enable row level security;
drop policy if exists "public read" on bids;
create policy "public read" on bids for select using (true);

-- ---------------------------------------------------------------------------
-- 5. REALTIME (the activity feed subscribes to bids)
-- ---------------------------------------------------------------------------

do $$ begin
  alter publication supabase_realtime add table bids;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 6. CATEGORIES — fixed list. No free text, or the feed fragments.
-- ---------------------------------------------------------------------------

insert into categories (slug, name, sort_order) values
  ('engineering','Engineering',1),
  ('frontend','Frontend',2),
  ('backend','Backend',3),
  ('ml-ai','ML/AI',4),
  ('design','Design',5),
  ('product','Product',6),
  ('marketing','Marketing',7),
  ('growth','Growth',8),
  ('sales','Sales',9),
  ('content','Content',10),
  ('video','Video',11),
  ('data','Data',12),
  ('devops','DevOps',13),
  ('ops','Ops',14),
  ('founding','Founding',15),
  ('internship','Internship',16),
  ('other','Other',17)
on conflict (slug) do update set name = excluded.name, sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- 7. STORAGE — bucket `videos`: public read, no public write.
--    Writes happen only through a signed upload URL minted server-side after
--    payment (see /api/upload-url.js).
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 52428800,
        array['video/mp4','video/quicktime','video/webm'])
on conflict (id) do update
  set public = true,
      file_size_limit = 52428800,
      allowed_mime_types = array['video/mp4','video/quicktime','video/webm'];

drop policy if exists "videos public read" on storage.objects;
create policy "videos public read" on storage.objects
  for select using (bucket_id = 'videos');
-- no insert/update/delete policy for anon: the service role bypasses RLS and is
-- the only thing that mints upload URLs.
