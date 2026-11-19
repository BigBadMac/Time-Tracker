-- FAQ tests (11-18). Runs after 07_support_tests.sql in the same session.
-- Cast at this point: K owner (Kim), J helper (Jon), I a reporter with items,
-- L signed in but not staff.
reset role;
select id as isrc from support.feedback where user_id = :I order by created_at limit 1 \gset
set role authenticated;

-- ------------------------------------------------------ nobody gets in raw --
select tests.login(:I);
select tests.refused('select * from support.faq', 'the FAQ table cannot be read directly');
select tests.refused('select * from support.faq_suggestions', 'nor the suggestions');
select tests.refused('select support.suggest(''Hello there?'', ''Hi'')', 'and suggesting is not open to the app');

-- ------------------------------------------------------------- drafting --
select tests.login(:J);
select public.faq_save(null, '{"question":"  Does sync use a lot of data? ","answer":"About two megabytes a month on Smart.","topic":"Sync","guide":"sync"}') as d1 \gset
select tests.ok((:'d1'::jsonb->>'question') = 'Does sync use a lot of data?', 'a helper drafts an entry, trimmed');
select tests.ok((:'d1'::jsonb->>'published') = 'false', 'a new entry starts as a draft');
select tests.refused(format('select public.faq_save(%L, ''{"question":"Does sync use a lot of data?","answer":"x","published":true}'')', :'d1'::jsonb->>'id'),
  'a helper cannot publish');
select tests.refused('select public.faq_save(null, ''{"question":"Why?","answer":"   "}'')', 'an empty answer is refused');
select tests.refused('select public.faq_save(null, jsonb_build_object(''question'', repeat(''x'',201), ''answer'', ''a''))', 'a question over two hundred characters is refused');
select tests.refused('select public.faq_save(null, ''{"question":"Hello?","answer":"a","guide":"Not A Guide!"}'')', 'a guide must look like a guide id');
select tests.refused(format('select public.faq_save(null, ''{"question":"Hello?","answer":"a","source":"%s"}'')', :'isrc'),
  'a helper cannot hang an entry on an item not assigned to them');

select tests.login(:L);
select tests.refused('select public.faq_all()', 'someone not on the team cannot see drafts');
select tests.refused('select public.faq_save(null, ''{"question":"Hello?","answer":"a"}'')', 'nor write entries');
select tests.ok(public.faq_list() = '[]', 'the public FAQ shows no drafts');

-- ----------------------------------------------------------- publishing --
select tests.login(:K);
select tests.ok(jsonb_array_length(public.faq_all()) = 1, 'the owner sees the draft');
select public.faq_save((:'d1'::jsonb->>'id')::uuid, '{"question":"Does sync use a lot of data?","answer":"About two megabytes a month on Smart.","topic":"Sync","guide":"sync","published":true}') as p1 \gset
select tests.ok((:'p1'::jsonb->>'published') = 'true', 'the owner publishes it');
select public.faq_save(null, format('{"question":"Do paid breaks count toward overtime?","answer":"Yes, unless Pay & Work Week says otherwise.","topic":"Breaks","published":true,"source":"%s","notify":true}', :'isrc')::jsonb) as p2 \gset
select tests.ok((:'p2'::jsonb->>'source') = :'isrc', 'an entry made from an inbox item remembers it');

select tests.login(null);
reset role; set role anon;
select tests.ok(jsonb_array_length(public.faq_list()) = 2, 'signed out, anyone reads the published FAQ');
select tests.ok((public.faq_list()->0) ? 'yes' = false and (public.faq_list()->0) ? 'source' = false, 'without the staff fields');
select tests.ok((public.faq_list()->0->>'topic') = 'Breaks', 'ordered by topic');
select tests.refused('select public.faq_all()', 'signed out, no drafts');
select tests.refused(format('select public.faq_vote(%L, true)', :'p1'::jsonb->>'id'), 'signed out, no vote');
reset role; set role authenticated;

-- ----------------------------------------------- telling the sender --
select tests.login(:I);
select public.fb_thread(:'isrc') as th \gset
select tests.ok(:'th'::jsonb::text like '%now in the FAQ%', 'the sender is told their question is in the FAQ');
select tests.ok(exists (select 1 from jsonb_array_elements(:'th'::jsonb->'messages') m where m->>'event' = 'faq:added' and (m->>'by_staff')::boolean),
  'as a line from the team');
select tests.login(:K);
select public.faq_save((:'p2'::jsonb->>'id')::uuid, format('{"question":"Do paid breaks count toward overtime?","answer":"Yes, by default.","topic":"Breaks","published":true,"source":"%s","notify":true}', :'isrc')::jsonb);
reset role;
select tests.ok((select count(*) from support.messages where feedback_id = :'isrc' and event = 'faq:added') = 1, 'only once, however often it is saved');
set role authenticated;

-- --------------------------------------------------------------- votes --
select tests.login(:I);
select public.faq_vote((:'p1'::jsonb->>'id')::uuid, true);
select tests.login(:L);
select public.faq_vote((:'p1'::jsonb->>'id')::uuid, false);
select public.faq_vote((:'p1'::jsonb->>'id')::uuid, true);
select tests.ok((select (x->>'my')::boolean from jsonb_array_elements(public.faq_list()) x where x->>'id' = :'p1'::jsonb->>'id'), 'a person sees their own vote');
select tests.login(:K);
select tests.ok((select (x->>'yes')::int = 2 and (x->>'no')::int = 0 from jsonb_array_elements(public.faq_all()) x where x->>'id' = :'p1'::jsonb->>'id'),
  'one vote each, the latest counts');
select tests.login(:L);
select public.faq_vote((:'p1'::jsonb->>'id')::uuid, null);
select tests.login(:K);
select tests.ok((select (x->>'yes')::int = 1 from jsonb_array_elements(public.faq_all()) x where x->>'id' = :'p1'::jsonb->>'id'), 'a vote can be taken back');
select public.faq_save(null, '{"question":"A draft question?","answer":"Not yet."}') as d3 \gset
select tests.login(:L);
select tests.refused(format('select public.faq_vote(%L, true)', :'d3'::jsonb->>'id'), 'nobody votes on a draft');

-- ----------------------------------------------------------- suggestions --
reset role;
select support.suggest('Why does my other device not show a change?', 'Tap Sync now.', 'Sync', 'sync', 4, array[:'isrc'::uuid]) as s1 \gset
select tests.ok(support.suggest('why does my  other device not show a change? ', 'dup') is null, 'the same question is not suggested twice');
select tests.ok(support.suggest('Does sync use a lot of data?', 'dup') is null, 'nor one already in the FAQ');
select support.suggest('Can I export a week?', 'Not yet.', 'Reports') as s2 \gset
set role authenticated;
select tests.login(:L);
select tests.refused('select public.faq_suggestions()', 'suggestions are for the team only');
select tests.login(:J);
select tests.ok(jsonb_array_length(public.faq_suggestions()) = 2, 'a helper sees the suggestions');
select tests.ok((public.faq_suggestions()->0->>'asked')::int = 4, 'most asked first');
select tests.ok(public.faq_suggestion_set(:'s2', 'dismissed'), 'dismiss one');
select tests.ok(jsonb_array_length(public.faq_suggestions()) = 1, 'and it leaves the list');
select tests.refused(format('select public.faq_suggestion_set(%L, ''accepted'')', :'s1'), 'accepting goes through saving an entry');
select tests.login(:K);
select public.faq_save(null, format('{"question":"Why does my other device not show a change?","answer":"Tap Sync now.","topic":"Sync","published":true,"suggestion":"%s"}', :'s1')::jsonb) as p3 \gset
select tests.ok(public.faq_suggestions() = '[]', 'accepting a suggestion empties the list');
reset role;
select tests.ok((select status = 'accepted' and faq_id = (:'p3'::jsonb->>'id')::uuid from support.faq_suggestions where id = :'s1'), 'and links it to the entry');
set role authenticated;

-- ------------------------------------------------------------- deleting --
select tests.login(:J);
select tests.refused(format('select public.faq_delete(%L)', :'p3'::jsonb->>'id'), 'a helper cannot delete');
select tests.login(:K);
select tests.ok(public.faq_delete((:'p3'::jsonb->>'id')::uuid), 'the owner deletes an entry');
select tests.ok(not exists (select 1 from jsonb_array_elements(public.faq_list()) x where x->>'id' = :'p3'::jsonb->>'id'), 'and it is gone');
