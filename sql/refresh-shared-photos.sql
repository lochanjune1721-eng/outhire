-- GOAT.lol — re-check the photos that were resolved under the wrong board.
--
-- The bulk resolver used to look a name up once and copy that picture to every
-- board carrying the name. Leonardo da Vinci is on boards in Mind, Culture,
-- Tech and History, so one of those four decided his portrait for all four.
-- 109 names across 353 rows were affected.
--
-- The code is fixed, but rows already written keep their old picture until they
-- are looked up again. This marks every name that appears on more than one
-- board as outstanding, and the site's own resolver picks them up: it runs
-- nightly, starts itself when a visitor lands on a page with unresolved people,
-- and can be started by hand from /admin.html.
--
-- Nothing else is touched — no id, no money, no board position. Rows resolve
-- again over the next while; until then they show the picture they have now.
-- Safe to run more than once.

update people
   set image_status = 'pending',
       image_last_checked = null
 where name in (
   select name from people group by name having count(*) > 1
 );

-- How many are now queued:
select count(*) as queued from people where image_status = 'pending';
