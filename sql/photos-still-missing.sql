-- GOAT.lol — who still has no picture, and why.
--
-- Paste into the Supabase SQL editor. Read-only: nothing is changed.
--
-- After the display fix, a face falls back to initials only when there is
-- genuinely nothing stored. This is that list — usually people with no
-- free-licence photo on Wikimedia Commons.

-- 1. The headline numbers.
select
  count(*)                                                          as people,
  count(*) filter (where wikimedia_thumbnail_url is not null)       as have_a_picture,
  count(*) filter (where wikimedia_thumbnail_url is null)           as no_picture,
  count(*) filter (where image_status = 'verified')                 as verified,
  count(*) filter (where image_status = 'needs_review')             as needs_review,
  count(*) filter (where image_status = 'missing')                  as missing,
  count(*) filter (where image_status = 'pending')                  as not_looked_up_yet
from people;

-- 2. Everyone still showing initials, with their board and the reason.
--    Fix one by pasting an image URL into photo_path, or from /admin.html.
select p.name,
       c.name  as board,
       p.image_status,
       p.image_attempts,
       p.image_note,
       p.wikipedia_url
  from people p
  left join categories c on c.id = p.category_id
 where p.wikimedia_thumbnail_url is null
   and coalesce(p.photo_path, '') = ''
 order by c.name, p.name;

-- 3. Which boards are worst affected.
select c.name as board,
       count(*) as without_a_picture
  from people p
  join categories c on c.id = p.category_id
 where p.wikimedia_thumbnail_url is null
   and coalesce(p.photo_path, '') = ''
 group by c.name
 order by without_a_picture desc, c.name
 limit 30;
