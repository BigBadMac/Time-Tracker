-- Developer feedback tests (11-17). Runs in the same session as 02_tests.sql:
-- the people (:H ... :L) and tests.ok / tests.refused / tests.login exist.
-- Cast: K owner, L helper, H and I reporters, J an outsider.
reset role;
insert into support.staff(user_id, role, name) values (:K, 'owner', 'Kim'), (:L, 'helper', 'Lee');
set role authenticated;

-- --------------------------------------------------- nobody gets in raw --
select tests.login(:H);
select tests.refused('select * from support.feedback', 'the feedback table cannot be read directly');
select tests.refused('insert into support.feedback(user_id,kind,body) values (auth.uid(),''idea'',''x'')', 'or written directly');
select tests.refused('select * from support.staff', 'nor the team list');
select tests.refused('select support.role_of(auth.uid())', 'nor its helper functions');
select tests.login(null);
select tests.refused('select public.fb_send(''idea'',''hello'')', 'sending needs sign-in');

-- ------------------------------------------------------------ sending --
select tests.login(:H);
select public.fb_send('problem', '  The timer stops when I lock my phone.  ', '{"version":"1.5.4","device":"iPhone"}') as h1 \gset
select tests.ok((public.fb_mine()->0->>'body') = 'The timer stops when I lock my phone.', 'a sent item comes back trimmed in My feedback');
select tests.ok((public.fb_mine()->0->>'status') = 'new', 'and starts as new');
select tests.ok((public.fb_mine()->0->'app'->>'version') = '1.5.4', 'app details travel when included');
select tests.ok((public.fb_mine()->0) ? 'priority' = false and (public.fb_mine()->0) ? 'reporter' = false,
  'a reporter does not see staff fields');
select tests.refused('select public.fb_send(''idea'', ''   '')', 'an empty item is refused');
select tests.refused('select public.fb_send(''rant'', ''x'')', 'an unknown kind is refused');
select tests.refused('select public.fb_send(''idea'', repeat(''x'',4001))', 'nothing over four thousand characters');
select tests.refused('select public.fb_send(''idea'', ''x'', jsonb_build_object(''big'', repeat(''x'',3000)))', 'app details stay small');

select tests.login(:I);
select public.fb_send('idea', 'Dark mode for the report.') as i1 \gset
select tests.ok(jsonb_array_length(public.fb_mine()) = 1, 'each reporter sees only their own');
select tests.refused(format('select public.fb_thread(%L)', :'h1'), 'someone else''s thread is not found');
select tests.refused(format('select public.fb_reply(%L, ''me too'')', :'h1'), 'nor can they reply on it');

select tests.login(:J);
select tests.ok(public.fb_mine() = '[]', 'an outsider sees nothing');
select tests.refused('select public.fb_inbox()', 'and has no inbox');
select tests.refused('select public.fb_team()', 'nor a team list');
select tests.ok((public.fb_unread()->>'staff') is null and (public.fb_unread()->>'inbox')::int = 0, 'their badge says not staff');

-- ---------------------------------------------------------- the owner --
select tests.login(:K);
select tests.ok(jsonb_array_length(public.fb_inbox()) = 2, 'the owner sees every item');
select tests.ok((public.fb_unread()->>'inbox')::int = 2, 'both count as needing a look');
select tests.ok((public.fb_inbox()->0->>'reporter') like '%@none', 'with the reporter''s email');
select tests.ok(jsonb_array_length(public.fb_inbox('{"kind":"idea"}')) = 1, 'filter by kind');
select tests.ok(jsonb_array_length(public.fb_inbox('{"text":"LOCK my"}')) = 1, 'search the words');
select tests.ok(jsonb_array_length(public.fb_inbox('{"text":"%"}')) = 0, 'a percent sign is searched as itself');
select tests.ok(jsonb_array_length(public.fb_inbox('{"status":["fixed"]}')) = 0, 'filter by status');
select tests.ok((public.fb_thread(:'h1')->>'as') = 'owner', 'opening a thread');
select tests.ok((public.fb_unread()->>'inbox')::int = 1, 'marks it read for the owner');

select public.fb_reply(:'h1', 'Thanks - which iPhone and iOS?') as r1 \gset
select public.fb_reply(:'h1', 'Probably the wake lock.', true) as n1 \gset
select tests.ok((public.fb_inbox('{"status":["open"]}')->0->>'id') = :'h1', 'a staff reply moves new to open');
select public.fb_update(:'h1', '{"status":"waiting","priority":"high","tags":["Timer","timer"," ios "]}') as upd \gset
select tests.ok((:'upd'::jsonb->>'priority') = 'high', 'priority set');
select tests.ok((:'upd'::jsonb->'tags') = '["ios","timer"]', 'tags trimmed, lower-cased, no repeats');
select tests.refused(format('select public.fb_update(%L, ''{"status":"lost"}'')', :'h1'), 'an unknown status is refused');
select tests.refused(format('select public.fb_update(%L, ''{"assignee":"%s"}'')', :'h1', :J), 'only teammates can be assigned');

-- ----------------------------------------------- the reporter's view --
select tests.login(:H);
select tests.ok((public.fb_unread()->>'mine')::int = 1, 'the reporter has a reply waiting');
select public.fb_thread(:'h1') as th \gset
select tests.ok(jsonb_array_length(:'th'::jsonb->'messages') = 2, 'they see the reply and the status change');
select tests.ok(not (:'th'::jsonb::text like '%wake lock%'), 'but never the internal note');
select tests.ok((:'th'::jsonb->'messages'->0->>'who') = 'Kim', 'staff replies carry the staff name');
select tests.ok((:'th'::jsonb->'item'->>'status') = 'waiting', 'and the status');
select tests.ok((public.fb_unread()->>'mine')::int = 0, 'opening it clears the badge');
select tests.refused(format('select public.fb_reply(%L, ''x'', true)', :'h1'), 'a reporter cannot write internal notes');
select tests.refused(format('select public.fb_update(%L, ''{"status":"closed"}'')', :'h1'), 'or change the status');
select public.fb_reply(:'h1', 'iPhone 15, iOS 18.') as r2 \gset
select tests.ok((public.fb_mine()->0->>'status') = 'open', 'replying while waiting opens it again');

select tests.login(:K);
select public.fb_reply(:'h1', 'Repro on my phone too.', true);
select tests.login(:H);
select tests.ok((public.fb_unread()->>'mine')::int = 0, 'an internal note never lights the reporter''s badge');
select tests.refused(format('select public.fb_reply(%L, repeat(''x'',4001))', :'h1'), 'replies stay under four thousand characters');

-- --------------------------------------------------------- the helper --
select tests.login(:L);
select tests.ok(public.fb_inbox() = '[]', 'a helper sees nothing until assigned');
select tests.refused(format('select public.fb_thread(%L)', :'h1'), 'not even by id');
select tests.login(:K);
select public.fb_update(:'h1', format('{"assignee":"%s"}', :L)::jsonb) as upd \gset
select tests.ok((:'upd'::jsonb->>'assignee_name') = 'Lee', 'the owner assigns it');
select tests.login(:L);
select tests.ok(jsonb_array_length(public.fb_inbox()) = 1 and (public.fb_inbox()->0->>'id') = :'h1', 'now the helper sees just that one');
select tests.ok(jsonb_array_length(public.fb_inbox('{"who":"me"}')) = 1, 'under assigned to me');
select tests.ok(public.fb_thread(:'h1')::text like '%wake lock%', 'internal notes are shared with the team');
select tests.refused(format('select public.fb_update(%L, ''{"assignee":null}'')', :'h1'), 'a helper cannot reassign');
select tests.refused(format('select public.fb_delete(%L)', :'h1'), 'or delete');
select tests.refused(format('select public.fb_team_set(''hank@none'', ''helper'')'), 'or change the team');
select public.fb_update(:'h1', '{"status":"fixed","fixed_in":"1.5.5"}') as upd \gset
select tests.ok((:'upd'::jsonb->>'fixed_in') = '1.5.5', 'a helper marks it fixed, with the version');
select tests.refused(format('select public.fb_thread(%L)', :'i1'), 'other items stay out of reach');

select tests.login(:H);
select tests.ok((public.fb_mine()->0->>'status') = 'fixed' and (public.fb_mine()->0->>'fixed_in') = '1.5.5',
  'the reporter sees fixed in which version');

-- ---------------------------------------------------------- the team --
select tests.login(:K);
select tests.ok(jsonb_array_length(public.fb_team()) = 2, 'the owner sees the team');
select tests.refused('select public.fb_team_set(''nobody@nowhere'', ''helper'')', 'a teammate must have signed in before');
select tests.ok(jsonb_array_length(public.fb_team_set('jon@none', 'helper', 'Jon')) = 3, 'add a helper by email');
select tests.refused('select public.fb_team_set(''kim@none'', ''helper'')', 'the last owner cannot step down');
select tests.refused('select public.fb_team_set(''kim@none'', null)', 'or leave');
select tests.ok(jsonb_array_length(public.fb_team_set('lee@none', null)) = 2, 'removing a helper');
select tests.ok((public.fb_inbox()->0->>'assignee') is null, 'hands their items back to nobody');
select tests.login(:L);
select tests.refused('select public.fb_inbox()', 'and they are out');

-- ------------------------------------------------------------ limits --
select tests.login(:I);
select public.fb_send('idea', 'two'); select public.fb_send('idea', 'three');
select public.fb_send('idea', 'four'); select public.fb_send('idea', 'five');
select tests.refused('select public.fb_send(''idea'', ''six'')', 'no more than five an hour');

-- ----------------------------------------------------------- deleting --
select tests.login(:K);
select tests.ok(public.fb_delete(:'i1'), 'the owner deletes an item');
select tests.login(:I);
select tests.ok(jsonb_array_length(public.fb_mine()) = 4, 'and it is gone for its reporter');
reset role;
delete from auth.users where id = :H;
select tests.ok(not exists (select 1 from support.feedback where user_id = :H), 'deleting an account takes its feedback with it');
set role authenticated;
