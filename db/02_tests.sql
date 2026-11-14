-- Row-level security tests: run as each person in turn, the way Supabase
-- will (role authenticated + a signed-in user id). psql -v ON_ERROR_STOP=1.
\set QUIET on
\o /dev/null
create schema tests;
create table tests.results (n serial, ok boolean, label text);
create function tests.ok(c boolean, label text) returns void language sql as
  $$ insert into tests.results(ok, label) values (coalesce(c,false), label) $$;
-- passes if the statement FAILS (refused)
create function tests.refused(stmt text, label text) returns void language plpgsql as $$
begin
  begin execute stmt; exception when others then insert into tests.results(ok,label) values (true, label); return; end;
  insert into tests.results(ok,label) values (false, label || '  (was allowed)');
end $$;
create function tests.login(u uuid) returns void language sql as
  $$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role','authenticated')::text, false) $$;
grant usage on schema tests to authenticated, anon;
grant all on all tables in schema tests to authenticated, anon;
grant all on all sequences in schema tests to authenticated, anon;
grant execute on all functions in schema tests to authenticated, anon;

-- the people
insert into auth.users(id,email) values
 ('a0000000-0000-0000-0000-00000000000a','alice@acme'),   -- Acme admin, top admin of the project
 ('b0000000-0000-0000-0000-00000000000b','bob@acme'),     -- Acme, project member then admin
 ('c0000000-0000-0000-0000-00000000000c','carol@acme'),   -- Acme, lead of the bench branch
 ('e0000000-0000-0000-0000-00000000000e','eve@acme'),     -- Acme, assignee
 ('f0000000-0000-0000-0000-00000000000f','fran@acme'),    -- Acme, not on the project
 ('d0000000-0000-0000-0000-00000000000d','dana@beta'),    -- Beta admin
 ('90000000-0000-0000-0000-000000000009','gary@beta'),    -- Beta, a guest on Acme's project
 ('11000000-0000-0000-0000-000000000011','hank@none'),    -- nobody's
 ('12000000-0000-0000-0000-000000000012','ivy@none'),
 ('13000000-0000-0000-0000-000000000013','jon@none'),
 ('14000000-0000-0000-0000-000000000014','kim@none'),
 ('15000000-0000-0000-0000-000000000015','lee@none');
\set A '''a0000000-0000-0000-0000-00000000000a'''
\set B '''b0000000-0000-0000-0000-00000000000b'''
\set C '''c0000000-0000-0000-0000-00000000000c'''
\set E '''e0000000-0000-0000-0000-00000000000e'''
\set F '''f0000000-0000-0000-0000-00000000000f'''
\set D '''d0000000-0000-0000-0000-00000000000d'''
\set G '''90000000-0000-0000-0000-000000000009'''
\set H '''11000000-0000-0000-0000-000000000011'''
\set I '''12000000-0000-0000-0000-000000000012'''
\set J '''13000000-0000-0000-0000-000000000013'''
\set K '''14000000-0000-0000-0000-000000000014'''
\set L '''15000000-0000-0000-0000-000000000015'''

set role authenticated;

-- ---------------------------------------------------------------- orgs --
select tests.login(:A); select public.touch_active();
select public.create_org('Acme') as acme \gset
select public.new_join_code(:'acme') as acme_code \gset
select tests.ok(length(:'acme_code') = 10, 'a join code is made, ten characters');
select tests.refused('select join_code_hash from public.orgs', 'nobody can read a join code back, not even the admin');

select tests.login(:B); select public.touch_active(); select public.join_org(:'acme_code');
select tests.login(:C); select public.touch_active(); select public.join_org(:'acme_code');
select tests.login(:E); select public.join_org(:'acme_code');
select tests.login(:F); select public.touch_active(); select public.join_org(lower(:'acme_code'));
select tests.ok((select count(*) from public.org_members where org_id = :'acme') = 5, 'joining by code: four people joined (case does not matter)');
select tests.refused('select public.join_org(''WRONGCODE1'')', 'a wrong code joins nothing');
select tests.refused('select public.new_join_code(''' || :'acme' || ''')', 'a member cannot make join codes');

select tests.login(:D); select public.touch_active();
select public.create_org('Beta') as beta \gset
select public.new_join_code(:'beta') as beta_code \gset
select tests.login(:G); select public.join_org(:'beta_code');
select tests.ok((select count(*) from public.orgs) = 1 and (select name from public.orgs) = 'Beta', 'someone in Beta sees only Beta');

select tests.login(:A);
select public.new_join_code(:'acme') as acme_code2 \gset
select tests.login(:H);
select tests.refused('select public.join_org(''' || :'acme_code' || ''')', 'a new code retires the old one');
-- a person may be in more than one org
select tests.login(:F); select public.join_org(:'beta_code');
select tests.ok((select count(*) from public.orgs) = 2, 'one person can be in two orgs');

-- ------------------------------------------------------------- project --
select tests.login(:A);
select public.create_project('Workbench', :'acme', 'Bench refit for bay 2') as p \gset
insert into public.records(project_id, kind, fields) values (:'p','project','{"name":"Install new workbench"}') returning id as r1 \gset
insert into public.records(project_id, parent_id, kind, fields) values (:'p', :'r1', 'task','{"name":"Measure up"}') returning id as r2 \gset
insert into public.records(project_id, kind, fields) values (:'p','project','{"name":"Paint the bay"}') returning id as r3 \gset
select public.add_member(:'p', :B, 'member');
select public.add_member(:'p', :C, 'lead', :'r1');

-- what org members see before they are added
select tests.login(:F);
select tests.ok((select count(*) from public.org_project_directory(:'acme')) = 1
  and (select public_description from public.org_project_directory(:'acme')) = 'Bench refit for bay 2',
  'an org member not on it sees the name and public description');
select tests.ok((select count(*) from public.projects) = 0, 'but not the project itself');
select tests.ok((select count(*) from public.records) = 0, 'nor anything inside it');
select tests.login(:D);
select tests.ok((select count(*) from public.org_project_directory(:'acme')) = 0, 'another org sees nothing of it');

-- roles
select tests.login(:B);
select tests.refused('select public.add_member(''' || :'p' || ''', ' || quote_literal(:F) || ', ''member'')', 'a member cannot add people');
select tests.login(:C);
select public.add_member(:'p', :E, 'assignee', :'r2');
select tests.ok(exists(select 1 from public.project_members where user_id = :E and role = 'assignee'), 'a lead adds an assignee inside their branch');
select tests.refused('select public.add_member(''' || :'p' || ''', ' || quote_literal(:F) || ', ''member'', ''' || :'r3' || ''')', 'but not outside it');
select tests.refused('select public.add_member(''' || :'p' || ''', ' || quote_literal(:F) || ', ''admin'')', 'and never an admin');
select tests.login(:A);
select public.add_member(:'p', :B, 'admin');
select tests.login(:B);
select tests.refused('select public.add_member(''' || :'p' || ''', ' || quote_literal(:F) || ', ''admin'')', 'only the TOP admin adds an admin');
select tests.refused('select public.remove_member(''' || :'p' || ''', ' || quote_literal(:A) || ')', 'nobody removes the top admin');
select tests.refused('select public.transfer_top_admin(''' || :'p' || ''', ' || quote_literal(:B) || ')', 'only the top admin hands the role on');
select tests.login(:A);
select public.add_member(:'p', :F, 'admin');
select tests.refused('select public.remove_member(''' || :'p' || ''', ' || quote_literal(:A) || ')', 'the top admin cannot leave without handing the role on');
select tests.login(:B);
select tests.refused('select public.remove_member(''' || :'p' || ''', ' || quote_literal(:F) || ')', 'only the top admin removes an admin');
select tests.login(:A);
select public.remove_member(:'p', :F);
select tests.ok(not exists(select 1 from public.project_members where user_id = :F), 'the top admin can');

-- ---------------------------------------------------------------- edits --
select tests.login(:B);   -- now an admin
select tests.ok(public.apply_edit(:'r3', 'note', '"admins edit anywhere"', now()), 'an admin edits anywhere');
select tests.login(:C);
select tests.ok(public.apply_edit(:'r2', 'name', '"Measure twice"', '2026-10-27 10:00+00'), 'a lead edits inside their branch');
select tests.refused('select public.apply_edit(''' || :'r3' || ''', ''name'', ''"x"'', now())', 'but not outside it');
select tests.login(:E);
select tests.ok(public.apply_edit(:'r2', 'done', 'true', now()), 'an assignee edits their own branch');
select tests.login(:A);
select tests.ok(not public.apply_edit(:'r2', 'name', '"Older offline edit"', '2026-10-27 09:00+00'), 'an older edit arriving late does not win');
select tests.ok((select fields->>'name' from public.records where id = :'r2') = 'Measure twice', 'the newer value stays');
select tests.ok(exists(select 1 from public.record_history where record_id = :'r2' and outcome = 'arrived_late' and value = '"Older offline edit"'),
  'and the late one is kept in the history');
select tests.ok(public.apply_edit(:'r2', 'name', '"Measure three times"', '2026-10-27 11:00+00'), 'a newer edit wins');
select tests.ok(exists(select 1 from public.record_history where record_id = :'r2' and outcome = 'overwritten' and value = '"Measure twice"'),
  'and the value it replaced is kept');
select tests.refused('update public.records set fields = ''{}'' where id = ''' || :'r2' || '''', 'nobody edits a record directly, only through apply_edit');

-- ---------------------------------------------------------------- hours --
select tests.login(:E);
insert into public.time_entries(project_id, record_id, kind, started_at, ended_at, label)
  values (:'p', :'r2', 'job', now() - interval '2 hours', now() - interval '1 hour', 'Measure up');
insert into public.time_entries(project_id, record_id, kind, started_at, ended_at, label, data)
  values (:'p', :'r2', 'disruption', now() - interval '50 minutes', now() - interval '40 minutes', 'Waiting on parts', '{"reason":"parts"}');
select tests.ok((select count(*) from public.time_entries) = 2, 'you see your own full record');
select tests.refused('insert into public.time_entries(user_id, project_id, kind, started_at) values (' || quote_literal(:A) || ', ''' || :'p' || ''', ''job'', now())',
  'nobody writes time as someone else');
select tests.login(:A);
select tests.ok((select count(*) from public.time_entries where user_id = :E) = 2, 'the org admin sees their member''s full record, disruptions included');
select tests.login(:C);
select tests.ok((select count(*) from public.time_entries where user_id = :E) = 0, 'a lead sees no one''s hours without a grant');
select tests.ok((select total_seconds from public.job_totals(:'p') where user_id = :E) = 3600, 'but teammates see the total per job');
select tests.login(:B);
select tests.refused('select public.grant_hours(''' || :'p' || ''', ' || quote_literal(:C) || ', ''' || :'r1' || ''')', 'only the org admin grants hours, not a project admin');
select tests.login(:A);
select public.grant_hours(:'p', :C, :'r1');
select tests.login(:C);
select tests.ok((select count(*) from public.time_entries where user_id = :E) = 2, 'with a grant for the branch, the lead sees it');
select tests.login(:F);
select tests.ok((select count(*) from public.time_entries) = 0, 'an org member not on the project sees none');
select tests.login(:D);
select tests.ok((select count(*) from public.time_entries) = 0, 'another org''s admin sees none');

-- ----------------------------------------------------------- share links --
select tests.login(:A);
select public.create_share_link(:'p', json_build_object('max_uses',1,'pin','4321','branch',:'r3','can_edit',false)::jsonb) as link1 \gset
select tests.login(:B);
select tests.ok((select count(*) from public.share_links) = 1, 'project admins see the links');
select tests.refused('select code_hash from public.share_links', 'but never a link''s code or PIN');
select tests.login(:G);   -- from Beta
select tests.refused('select public.redeem_link(''' || :'link1' || ''', ''0000'')', 'a wrong PIN is refused');
select tests.ok(public.redeem_link(:'link1', '4321') = 'joined', 'the right PIN lets them in');
select tests.ok((select is_guest from public.project_members where user_id = :G), 'as a guest (not in Acme)');
select tests.ok(exists(select 1 from public.records where id = :'r3') and not exists(select 1 from public.records where id = :'r1'),
  'a guest sees only the branch the link gave');
select tests.refused('select public.apply_edit(''' || :'r3' || ''', ''name'', ''"x"'', now())', 'a view-only guest cannot edit');
insert into public.time_entries(project_id, record_id, kind, started_at, ended_at) values (:'p', :'r3', 'job', now() - interval '30 minutes', now());
select tests.login(:A);
select tests.ok((select count(*) from public.time_entries where user_id = :G) = 0, 'a guest''s hours are not the host org''s to see');
select tests.login(:D);
select tests.ok((select count(*) from public.time_entries where user_id = :G) = 0, 'nor their own org''s (it is not a Beta project)');
select tests.login(:H);
select tests.refused('select public.redeem_link(''' || :'link1' || ''', ''4321'')', 'a single-use link is used up');

select tests.login(:A);
select public.create_share_link(:'p', json_build_object('expires_at', now() - interval '1 minute')::jsonb) as link2 \gset
select public.create_share_link(:'p', json_build_object('usable_from', now() + interval '1 day')::jsonb) as link3 \gset
select public.create_share_link(:'p', '{}'::jsonb) as link4 \gset
select public.revoke_share_link((select id from public.share_links order by created_at desc limit 1));
select public.create_share_link(:'p', '{"needs_approval":true}'::jsonb) as link5 \gset
select tests.login(:H);
select tests.refused('select public.redeem_link(''' || :'link2' || ''')', 'an expired link is refused');
select tests.refused('select public.redeem_link(''' || :'link3' || ''')', 'a link used before its window is refused');
select tests.refused('select public.redeem_link(''' || :'link4' || ''')', 'a revoked link is refused');
select tests.ok(public.redeem_link(:'link5') = 'waiting', 'an approval link makes a request');
select tests.ok((select count(*) from public.records) = 0, 'and lets nothing in yet');
select tests.login(:C);
select tests.ok((select count(*) from public.requests where requester = :H) = 0, 'a lead does not answer a join');
select tests.login(:B);
select public.answer_request((select id from public.requests where requester = :H), true);
select tests.login(:H);
select tests.ok((select count(*) from public.projects) = 1, 'once an admin approves, they are in');
select public.join_org(:'acme_code2');
insert into public.time_entries(project_id, kind, started_at, ended_at) values (:'p', 'job', now() - interval '10 minutes', now());
select tests.login(:A);
select tests.ok((select count(*) from public.time_entries where user_id = :H) = 0,
  'someone who joined as a guest and later joined the org: their hours on it stay their own');

-- access windows, checked on every read
select tests.login(:A);
select public.create_share_link(:'p', json_build_object('access_ends_at', now() - interval '1 second')::jsonb) as link6 \gset
select public.create_share_link(:'p', json_build_object('allowed_days',
  json_build_array(((extract(isodow from now() at time zone 'UTC')::int % 7) + 1)))::jsonb) as link7 \gset
select public.create_share_link(:'p', json_build_object('allowed_days',
  json_build_array(extract(isodow from now() at time zone 'UTC')::int))::jsonb) as link8 \gset
select public.create_share_link(:'p', json_build_object(
  'allowed_start', ((now() at time zone 'UTC') + interval '2 hours')::time,
  'allowed_end',   ((now() at time zone 'UTC') + interval '3 hours')::time)::jsonb) as link9 \gset
select tests.login(:I); select public.redeem_link(:'link6');
select tests.ok((select count(*) from public.records) = 0, 'access that has ended shows nothing');
select tests.login(:J); select public.redeem_link(:'link7');
select tests.ok((select count(*) from public.records) = 0, 'outside the allowed days shows nothing');
select tests.login(:K); select public.redeem_link(:'link8');
select tests.ok((select count(*) from public.records) = 3, 'on an allowed day, it is there');
select tests.login(:L); select public.redeem_link(:'link9');
select tests.ok((select count(*) from public.records) = 0, 'outside the allowed hours shows nothing');
select tests.refused('insert into public.time_entries(project_id, kind, started_at) values (''' || :'p' || ''', ''job'', now())',
  'and nothing can be logged there either');

-- ------------------------------------------------------------- requests --
select tests.login(:E);
insert into public.requests(project_id, kind, record_id, wanted_role, note) values (:'p','work_on', :'r3', 'assignee', 'Can I help paint?');
insert into public.requests(project_id, kind, wanted_role) values (:'p','move_up','admin');
select tests.login(:C);
select tests.ok((select count(*) from public.requests where requester = :E) = 0, 'a lead does not see requests outside their branch');
select tests.login(:B);
select tests.refused('select public.answer_request(''' || (select id from public.requests where wanted_role = 'admin') || ''', true)',
  'an admin who is not the top admin cannot approve a new admin');
select public.answer_request((select id from public.requests where kind = 'work_on'), true);
select tests.ok((select branch_id from public.project_members where user_id = :E) = :'r3', 'approving work_on moves them to that part');
select tests.login(:A);
select public.answer_request((select id from public.requests where wanted_role = 'admin'), false);
select tests.ok((select status from public.requests where wanted_role = 'admin') = 'declined', 'the top admin answers the admin request');

-- ------------------------------------------------------------ top admin --
select tests.refused('select public.transfer_top_admin(''' || :'p' || ''', ' || quote_literal(:C) || ')', 'the top role goes only to an admin');
select public.transfer_top_admin(:'p', :B);
select tests.refused('select public.remove_member(''' || :'p' || ''', ' || quote_literal(:B) || ')', 'and the new top admin cannot be removed');
select tests.login(:B);
select public.remove_member(:'p', :A);
select tests.ok(not exists(select 1 from public.project_members where user_id = :A), 'the new top admin can remove the old one');

-- ------------------------------------------------------- profiles, anon --
select tests.login(:F);
select tests.ok(exists(select 1 from public.profiles where id = :A), 'you see the profiles of people in your orgs');
select tests.login(:L);
select tests.ok(not exists(select 1 from public.profiles where id = :F), 'not of strangers');
select tests.ok(not exists(select 1 from public.profiles where id = :B), 'nor of people on projects you are not on');
reset role;
set role anon;
select tests.refused('select * from public.projects', 'signed out, nothing is readable');
select tests.refused('select public.create_project(''x'')', 'and no function can even be called');
select tests.refused('select private.can_read(gen_random_uuid())', 'nor a permission helper');
reset role;

-- ------------------------------------------------- helpers kept private --
set role authenticated;
select tests.login(:F);
select tests.ok(not exists(select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                            where n.nspname = 'public' and p.proname in ('can_read','can_write','can_see_hours','is_org_member',
                              'is_org_admin','my_membership','project_org','is_top_admin','in_branch','can_answer','join_by_link')),
                'no permission helper sits in the API schema');
select tests.refused('select private.join_by_link(null::public.share_links, ' || quote_literal(:F) || ')', 'join_by_link stays uncallable');
reset role;

\o
select count(*) filter (where ok) || '/' || count(*) || ' passed' as rls from tests.results;
select n, label from tests.results where not ok order by n;
