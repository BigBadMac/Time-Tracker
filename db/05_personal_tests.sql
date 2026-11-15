-- Personal sync tests (11-13). Runs in the same session as 02_tests.sql, so
-- the people (:A, :B ...) and tests.ok / tests.refused / tests.login exist.
set role authenticated;

-- ------------------------------------------------ only you, ever --
select tests.login(:H);
select tests.ok(public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"Deck","lane":"Home"},"field_ts":{"name":1000,"lane":1000}}]') = 1,
  'a push stores a new record');
select tests.ok((select fields->>'name' from public.personal_items where item_id='p1') = 'Deck', 'and its owner reads it back');
select tests.ok((select user_id from public.personal_items where item_id='p1') = :H, 'the row belongs to whoever pushed it');

select tests.login(:I);
select tests.ok(not exists(select 1 from public.personal_items), 'someone else sees none of it');
select tests.ok(public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"Ivy''s"},"field_ts":{"name":9000}}]') = 1,
  'the same id from someone else is their own record');
reset role;
select tests.ok((select fields->>'name' from public.personal_items where user_id = :H and item_id='p1') = 'Deck',
  'and never touches the first person''s');
set role authenticated;
select tests.login(:I);
select tests.ok((select count(*) from public.personal_items) = 1, 'each person sees exactly their own');
update public.personal_items set fields = '{"name":"x"}' where user_id = :H;
delete from public.personal_items where user_id = :H;
reset role;
select tests.ok((select fields->>'name' from public.personal_items where user_id = :H and item_id='p1') = 'Deck',
  'nobody else can change or delete it');
set role authenticated;
select tests.login(:I);
select tests.login(:J);
delete from public.personal_items;   -- no WHERE: only the delete rule stands guard
reset role;
select tests.ok((select count(*) from public.personal_items where user_id = :H) = 1, 'a blanket delete from someone else removes none of it');
set role authenticated;
select tests.login(:I);
select tests.refused('insert into public.personal_items(user_id, coll, item_id) values (' || quote_literal(:H) || ', ''projects'', ''planted'')',
  'nobody can write a row into someone else''s board');
select tests.login(:A);
select tests.ok(not exists(select 1 from public.personal_items), 'an org admin sees none of anyone''s personal board');
reset role;

set role anon;
select tests.refused('select * from public.personal_items', 'signed out: no reading');
select tests.refused('select public.personal_push(''[]'')', 'signed out: no pushing');
reset role;

-- ------------------------------------------------ merging, field by field --
set role authenticated;
select tests.login(:H);
-- the iPad renames it later; the iPhone changes the lane, also later
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"Deck rebuild"},"field_ts":{"name":2000}}]');
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"lane":"Outside"},"field_ts":{"lane":2500}}]');
select tests.ok((select fields from public.personal_items where item_id='p1') = '{"name":"Deck rebuild","lane":"Outside"}',
  'two devices editing different fields: both edits kept');
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"Old name"},"field_ts":{"name":1500}}]');
select tests.ok((select fields->>'name' from public.personal_items where item_id='p1') = 'Deck rebuild',
  'an older edit arriving late does not win');
select tests.ok(public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"Deck rebuild"},"field_ts":{"name":2000}}]') = 0,
  'pushing what is already there changes nothing');
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"Same time"},"field_ts":{"name":2000}}]');
select tests.ok((select fields->>'name' from public.personal_items where item_id='p1') = 'Deck rebuild',
  'a tie keeps what is stored (every device ends the same)');
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{},"field_ts":{"lane":3000}}]');
select tests.ok(not ((select fields from public.personal_items where item_id='p1') ? 'lane'),
  'a field cleared later is cleared');

-- deletion
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{},"field_ts":{},"del_ts":4000}]');
select tests.ok((select del_ts from public.personal_items where item_id='p1') = 4000, 'a deletion is kept as a time');
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"stale"},"field_ts":{"name":3500}}]');
select tests.ok((select del_ts from public.personal_items where item_id='p1') = 4000,
  'an edit made before the deletion does not bring it back');
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"tie"},"field_ts":{"name":4000}}]');
select tests.ok((select del_ts from public.personal_items where item_id='p1') = 4000,
  'an edit at the very moment of the deletion leaves it gone');
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"Back"},"field_ts":{"name":4500}}]');
select tests.ok((select del_ts is null and fields->>'name' = 'Back' from public.personal_items where item_id='p1'),
  'an edit made after the deletion brings it back');

-- the cursor
reset role;
set session_replication_role = replica;   -- backdate without the trigger
update public.personal_items set updated_at = now() - interval '1 hour' where user_id = :H;
set session_replication_role = origin;
set role authenticated;
select tests.login(:H);
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"Newer"},"field_ts":{"name":5000}}]');
select tests.ok((select updated_at > now() - interval '1 minute' from public.personal_items where item_id='p1'),
  'every change moves the record''s server time forward (the pull cursor)');
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"Newer"},"field_ts":{"name":5000}}]');
reset role;
set session_replication_role = replica;   -- backdate without the trigger
update public.personal_items set updated_at = now() - interval '1 hour' where user_id = :H;
set session_replication_role = origin;
set role authenticated;
select tests.login(:H);
select public.personal_push('[{"coll":"projects","item_id":"p1","fields":{"name":"Newer"},"field_ts":{"name":5000}}]');
select tests.ok((select updated_at < now() - interval '1 minute' from public.personal_items where item_id='p1'),
  'a push that changes nothing leaves the cursor alone');
select tests.refused('update public.personal_items set updated_at = now() + interval ''1 day'' where item_id = ''p1''; '
  || 'select 1/0 from public.personal_items where item_id = ''p1'' and updated_at > now() + interval ''1 hour''',
  'a device cannot set the server time');

-- limits
select tests.refused('select public.personal_push(''{"coll":"x"}'')', 'a push must be a list');
select tests.refused('select public.personal_push((select jsonb_agg(jsonb_build_object(''coll'',''logs'',''item_id'',''l''||g,''fields'',''{}''::jsonb,''field_ts'',''{}''::jsonb)) from generate_series(1,501) g))',
  'at most 500 records in one push');
select tests.refused('select public.personal_push(''[{"coll":"Bad Name","item_id":"x","fields":{},"field_ts":{}}]'')', 'collection names are checked');

-- replace: "use this device's board"
select public.personal_push('[{"coll":"logs","item_id":"l1","fields":{"a":1},"field_ts":{"a":6000}},{"coll":"logs","item_id":"l2","fields":{"a":2},"field_ts":{"a":6000}}]');
select public.personal_replace('[{"coll":"projects","item_id":"n1","fields":{"name":"Fresh"},"field_ts":{"name":7001}},{"coll":"logs","item_id":"l1","fields":{"a":9},"field_ts":{"a":7001}}]', 7000);
select tests.ok((select count(*) from public.personal_items where del_ts is null) = 2, 'replace: only this device''s records stay alive');
select tests.ok((select del_ts from public.personal_items where item_id='l2') = 7000, 'replace: the rest are marked gone, so other devices drop them');
select tests.ok((select fields->>'a' from public.personal_items where item_id='l1') = '9', 'replace: a record on both takes this device''s copy');
select tests.ok((select del_ts from public.personal_items where item_id='p1') = 7000, 'replace: an older record is marked gone too');
reset role;

-- the account's clock
set role authenticated;
select tests.login(:H);
select tests.ok(public.personal_clock() = 7001, 'the clock is the newest time the account holds');
select tests.login(:J);
select tests.ok(public.personal_clock() = 0, 'an empty account''s clock is zero');
select tests.login(:I);
select tests.ok(public.personal_clock() = 9000, 'and each person''s clock is only their own');
reset role;
set role anon;
select tests.refused('select public.personal_clock()', 'signed out: no clock');
reset role;

-- the summary
set role authenticated;
select tests.login(:H);
select tests.ok((public.personal_summary()->>'projects')::int = 1 and (public.personal_summary()->>'logs')::int = 1,
  'the summary counts only what is alive');
select tests.ok(public.personal_summary()->>'last' is not null, 'and says when it last changed');
select tests.login(:J);
select tests.ok((public.personal_summary()->>'projects')::int = 0 and public.personal_summary()->>'last' is null, 'an empty account sums to nothing');
reset role;
set role anon;
select tests.refused('select public.personal_summary()', 'signed out: no summary');
reset role;

-- ------------------------------------------------ the merge, on its own --
select tests.ok((select f from private.personal_merge(null, null, null, '{"a":1}', '{"a":5}', null)) = '{"a":1}', 'merge: into nothing');
select tests.ok((select del from private.personal_merge('{"a":1}', '{"a":5}', 9, '{}', '{}', null)) = 9, 'merge: a deletion survives a push with no edits');
select tests.ok((select del from private.personal_merge('{"a":1}', '{"a":5}', null, '{}', '{}', 3)) is null, 'merge: a deletion older than the newest edit is ignored');
select tests.ok((select ts from private.personal_merge('{"a":1,"b":2}', '{"a":5,"b":5}', null, '{"a":7}', '{"a":6,"b":4}', null)) = '{"a":6,"b":5}',
  'merge: each field keeps the later of the two times');

set role authenticated;
select tests.login(:H);
select tests.refused('select public.touch_active(); select private.personal_touch()', 'the trigger function is not callable');
reset role;
