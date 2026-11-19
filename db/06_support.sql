-- Time Tracker - DEVELOPER FEEDBACK (11-17). Runs after 01_schema.sql.
--
-- Brent (11-17): feedback lives in the same Supabase project, in its own
-- schema; sending needs sign-in; managed from an in-app staff inbox; threads
-- ("blog style") so assigned helpers can answer.
--
-- The tables sit in schema "support", which the API does not expose and no
-- app role can touch. Every read and write goes through the public.fb_*
-- functions below, which check who is asking:
--   reporter - anyone signed in: sends, sees and replies to their OWN items;
--              never sees internal notes, other people's items, or staff lists.
--   helper   - staff: sees and works only the items assigned to them.
--   owner    - staff: sees everything, assigns, manages helpers, deletes.
-- Owners are added by hand once (see the end of this file); owners add helpers
-- in the app.

create schema support;
revoke all on schema support from public, anon, authenticated;

create table support.staff (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  role     text not null check (role in ('owner','helper')),
  name     text not null check (length(name) between 1 and 40),
  added_at timestamptz not null default now()
);

create table support.feedback (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  kind       text not null check (kind in ('problem','idea','question','praise')),
  body       text not null check (length(body) between 1 and 4000),
  app        jsonb check (app is null or (jsonb_typeof(app) = 'object' and length(app::text) <= 2000)),
  status     text not null default 'new' check (status in ('new','open','waiting','planned','fixed','closed')),
  priority   text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assignee   uuid references support.staff(user_id) on delete set null,
  tags       text[] not null default '{}' check (cardinality(tags) <= 8),
  fixed_in   text check (fixed_in is null or length(fixed_in) <= 16),
  created_at timestamptz not null default now(),
  last_at    timestamptz not null default now()      -- latest activity, for sorting
);
create index on support.feedback (user_id, created_at);
create index on support.feedback (last_at desc);
create index on support.feedback (assignee);

create table support.messages (
  id          bigint generated always as identity primary key,
  feedback_id uuid not null references support.feedback(id) on delete cascade,
  author      uuid references auth.users(id) on delete set null,
  by_staff    boolean not null,
  internal    boolean not null default false,        -- staff-only note
  event       text check (event is null or event ~ '^[a-z]+:[a-z0-9_.-]{0,40}$'),
  body        text not null default '' check (length(body) <= 4000),
  created_at  timestamptz not null default clock_timestamp(),
  check (event is not null or length(body) >= 1),
  check (not internal or by_staff)
);
create index on support.messages (feedback_id, created_at);
create index on support.messages (author, created_at);

-- When each person last opened each thread: drives "new reply" dots.
create table support.seen (
  user_id     uuid not null references auth.users(id) on delete cascade,
  feedback_id uuid not null references support.feedback(id) on delete cascade,
  at          timestamptz not null default clock_timestamp(),
  primary key (user_id, feedback_id)
);
create index on support.seen (feedback_id);

alter table support.staff    enable row level security;
alter table support.feedback enable row level security;
alter table support.messages enable row level security;
alter table support.seen     enable row level security;
revoke all on all tables in schema support from public, anon, authenticated;
-- No policies and no grants: only the functions below (security definer) reach them.

-- ------------------------------------------------------------ helpers --
create function support.role_of(u uuid) returns text language sql stable security definer set search_path = '' as
  $$ select role from support.staff where user_id = u $$;

-- may the caller see this item, and as what? 'owner' | 'helper' | 'reporter' | null
create function support.access(f support.feedback) returns text language plpgsql stable security definer set search_path = '' as $$
declare r text := support.role_of(auth.uid());
begin
  if r = 'owner' then return 'owner'; end if;
  if r = 'helper' and f.assignee = auth.uid() then return 'helper'; end if;
  if f.user_id = auth.uid() then return 'reporter'; end if;
  return null;
end $$;

create function support.need_user() returns uuid language plpgsql stable set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'sign in first' using errcode = '42501'; end if;
  return auth.uid();
end $$;

create function support.clean(t text, n int) returns text language sql immutable set search_path = '' as
  $$ select nullif(left(btrim(coalesce(t,'')), n), '') $$;

-- Who wrote it, as the reader should see it.
create function support.who(m support.messages, viewer text) returns text language sql stable security definer set search_path = '' as $$
  select case
    when m.by_staff then coalesce((select s.name from support.staff s where s.user_id = m.author), 'Hiatt Studios')
    when viewer = 'reporter' then 'You'
    else coalesce((select u.email from auth.users u where u.id = m.author), 'Reporter') end
$$;

-- Unread for this viewer: something they may see, newer than their last look,
-- written by the other side.
create function support.unread(f support.feedback, viewer text) returns boolean language sql stable security definer set search_path = '' as $$
  with s as (select coalesce((select s.at from support.seen s where s.user_id = auth.uid() and s.feedback_id = f.id), '-infinity') as at)
  select (viewer <> 'reporter' and f.user_id is distinct from auth.uid() and f.created_at > (select at from s))
      or exists (
    select 1 from support.messages m
     where m.feedback_id = f.id
       and m.created_at > (select at from s)
       and m.author is distinct from auth.uid()
       and (case when viewer = 'reporter' then m.by_staff and not m.internal
                 else (not m.by_staff) or m.event is null end))
$$;

create function support.item_json(f support.feedback, viewer text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', f.id, 'kind', f.kind, 'body', f.body, 'status', f.status, 'fixed_in', f.fixed_in,
    'created_at', f.created_at, 'last_at', f.last_at, 'unread', support.unread(f, viewer),
    'replies', (select count(*) from support.messages m where m.feedback_id = f.id and m.event is null
                  and (viewer <> 'reporter' or not m.internal)),
    'app', f.app)
  || case when viewer = 'reporter' then '{}'::jsonb else jsonb_build_object(
    'priority', f.priority, 'tags', to_jsonb(f.tags), 'assignee', f.assignee,
    'assignee_name', (select s.name from support.staff s where s.user_id = f.assignee),
    'reporter', (select u.email from auth.users u where u.id = f.user_id),
    'mine', f.user_id = auth.uid()) end
$$;

-- ----------------------------------------------------------- reporter --
-- Send a new item. Limits: five an hour, twenty a day per person.
create function public.fb_send(kind text, body text, app jsonb default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare me uuid := support.need_user(); b text := support.clean(body, 4001); new_id uuid;
begin
  if length(b) > 4000 then raise exception 'too long' using errcode = '22001'; end if;
  if b is null then raise exception 'write something first' using errcode = '22023'; end if;
  if (select count(*) from support.feedback where user_id = me and created_at > now() - interval '1 hour') >= 5
     or (select count(*) from support.feedback where user_id = me and created_at > now() - interval '1 day') >= 20 then
    raise exception 'too many sent for now - try again later' using errcode = '54000';
  end if;
  insert into support.feedback(user_id, kind, body, app) values (me, kind, b, app) returning id into new_id;
  insert into support.seen(user_id, feedback_id) values (me, new_id);
  return new_id;
end $$;

-- The caller's own items, newest activity first.
create function public.fb_mine() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(support.item_json(f, 'reporter') order by f.last_at desc), '[]')
    from support.feedback f where f.user_id = auth.uid()
$$;

-- One thread. Opening it marks it read for the caller.
create function public.fb_thread(id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare me uuid := support.need_user(); f support.feedback; a text; out jsonb;
begin
  select * into f from support.feedback x where x.id = fb_thread.id;
  a := case when f.id is null then null else support.access(f) end;
  if a is null then raise exception 'not found' using errcode = 'P0002'; end if;
  -- the owner reading their own item still sees it as staff
  out := jsonb_build_object('item', support.item_json(f, a), 'as', a, 'messages', coalesce((
    select jsonb_agg(jsonb_build_object('id', m.id, 'by_staff', m.by_staff, 'internal', m.internal, 'event', m.event,
                     'body', m.body, 'at', m.created_at, 'who', support.who(m, a), 'mine', m.author = me) order by m.created_at, m.id)
      from support.messages m where m.feedback_id = f.id and (a <> 'reporter' or not m.internal)), '[]'));
  insert into support.seen(user_id, feedback_id) values (me, f.id)
    on conflict (user_id, feedback_id) do update set at = clock_timestamp();
  return out;
end $$;

-- Reply on a thread. Staff may add an internal note. A reporter's reply on an
-- item that was waiting, fixed or closed opens it again.
create function public.fb_reply(id uuid, body text, internal boolean default false) returns bigint
language plpgsql security definer set search_path = '' as $$
declare me uuid := support.need_user(); f support.feedback; a text; b text := support.clean(body, 4001); mid bigint;
begin
  select * into f from support.feedback x where x.id = fb_reply.id for update;
  a := case when f.id is null then null else support.access(f) end;
  if a is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if b is null then raise exception 'write something first' using errcode = '22023'; end if;
  if length(b) > 4000 then raise exception 'too long' using errcode = '22001'; end if;
  if a = 'reporter' then
    if internal then raise exception 'not allowed' using errcode = '42501'; end if;
    if (select count(*) from support.messages m where m.author = me and m.created_at > now() - interval '1 hour') >= 30 then
      raise exception 'too many replies for now - try again later' using errcode = '54000';
    end if;
  end if;
  insert into support.messages(feedback_id, author, by_staff, internal, body)
    values (f.id, me, a <> 'reporter', coalesce(internal,false) and a <> 'reporter', b) returning messages.id into mid;
  if a = 'reporter' and f.status in ('waiting','fixed','closed') then
    update support.feedback set status = 'open' where support.feedback.id = f.id;
    insert into support.messages(feedback_id, author, by_staff, event) values (f.id, me, false, 'status:open');
  elsif a <> 'reporter' and f.status = 'new' and not coalesce(internal,false) then
    update support.feedback set status = 'open' where support.feedback.id = f.id;
  end if;
  if not (coalesce(internal,false) and a <> 'reporter') then
    update support.feedback set last_at = now() where support.feedback.id = f.id;
  end if;
  insert into support.seen(user_id, feedback_id) values (me, f.id)
    on conflict (user_id, feedback_id) do update set at = clock_timestamp();
  return mid;
end $$;

-- Counts for the badges: replies waiting for me, and (staff) inbox items needing a look.
create function public.fb_unread() returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'mine',  (select count(*) from support.feedback f where f.user_id = auth.uid() and support.unread(f, 'reporter')),
    'staff', support.role_of(auth.uid()),
    'inbox', case when support.role_of(auth.uid()) is null then 0 else
             (select count(*) from support.feedback f where f.user_id is distinct from auth.uid()
                and support.access(f) in ('owner','helper') and support.unread(f, 'staff')) end)
$$;

-- -------------------------------------------------------------- staff --
create function support.need_staff() returns text language plpgsql stable security definer set search_path = '' as $$
declare r text := support.role_of(support.need_user());
begin
  if r is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return r;
end $$;

-- The inbox. q: {"status":["new","open"], "who":"me"|"none"|"all", "kind":"idea", "text":"crash"}
create function public.fb_inbox(q jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r text := support.need_staff(); st text[]; who text := coalesce(q->>'who','all'); k text := q->>'kind'; t text := support.clean(q->>'text', 80);
begin
  if jsonb_typeof(q->'status') = 'array' then select array_agg(x) into st from jsonb_array_elements_text(q->'status') x; end if;
  return coalesce((select jsonb_agg(support.item_json(f, r) order by f.last_at desc) from (
    select * from support.feedback f
     where support.access(f) in ('owner','helper')
       and (st is null or f.status = any(st))
       and (k is null or f.kind = k)
       and (who = 'all' or (who = 'me' and f.assignee = auth.uid()) or (who = 'none' and f.assignee is null))
       and (t is null or f.body ilike '%' || replace(replace(t,'%','\%'),'_','\_') || '%'
            or exists (select 1 from support.messages m where m.feedback_id = f.id and m.body ilike '%' || replace(replace(t,'%','\%'),'_','\_') || '%'))
     order by f.last_at desc limit 300) f), '[]');
end $$;

-- Change an item: {"status":"fixed","fixed_in":"1.6","priority":"high","tags":["sync"],"assignee":"<uuid>"|null}
-- Helpers may change status, fixed_in, priority and tags on their own items;
-- only an owner assigns. Status and assignment changes go into the thread
-- (assignment as an internal note).
create function public.fb_update(id uuid, ch jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text := support.need_staff(); f support.feedback; a text; v text; nv uuid;
begin
  select * into f from support.feedback x where x.id = fb_update.id for update;
  a := case when f.id is null then null else support.access(f) end;
  if a not in ('owner','helper') or a is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if ch ? 'status' then
    v := ch->>'status';
    if v is distinct from f.status then
      update support.feedback set status = v, last_at = now() where support.feedback.id = f.id;
      insert into support.messages(feedback_id, author, by_staff, event) values (f.id, auth.uid(), true, 'status:' || v);
    end if;
  end if;
  if ch ? 'fixed_in' then update support.feedback set fixed_in = support.clean(ch->>'fixed_in', 16) where support.feedback.id = f.id; end if;
  if ch ? 'priority' then update support.feedback set priority = ch->>'priority' where support.feedback.id = f.id; end if;
  if ch ? 'tags' then
    update support.feedback set tags = coalesce((select array_agg(distinct lower(support.clean(x, 24))) from jsonb_array_elements_text(ch->'tags') x
                                                  where support.clean(x, 24) is not null), '{}') where support.feedback.id = f.id;
  end if;
  if ch ? 'assignee' then
    if a <> 'owner' then raise exception 'only an owner assigns' using errcode = '42501'; end if;
    nv := nullif(ch->>'assignee','')::uuid;
    if nv is not null and support.role_of(nv) is null then raise exception 'not on the team' using errcode = '22023'; end if;
    if nv is distinct from f.assignee then
      update support.feedback set assignee = nv where support.feedback.id = f.id;
      insert into support.messages(feedback_id, author, by_staff, internal, event)
        values (f.id, auth.uid(), true, true, 'assign:' || coalesce(nv::text, 'none'));
    end if;
  end if;
  select * into f from support.feedback x where x.id = fb_update.id;
  return support.item_json(f, a);
end $$;

-- Owners only: remove an item for good (spam, duplicates).
create function public.fb_delete(id uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if support.need_staff() <> 'owner' then raise exception 'not allowed' using errcode = '42501'; end if;
  delete from support.feedback x where x.id = fb_delete.id;
  return found;
end $$;

-- The team: who is staff. Staff only.
create function public.fb_team() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform support.need_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'role', s.role, 'name', s.name,
           'email', (select u.email from auth.users u where u.id = s.user_id), 'me', s.user_id = auth.uid()) order by s.role desc, s.name)
           from support.staff s), '[]');
end $$;

-- Owners only: add, change or remove a teammate by their sign-in email.
-- role null removes them. The last owner cannot remove or demote themselves.
create function public.fb_team_set(email text, role text, name text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  if support.need_staff() <> 'owner' then raise exception 'not allowed' using errcode = '42501'; end if;
  select x.id into u from auth.users x where lower(x.email) = lower(btrim(fb_team_set.email));
  if u is null then raise exception 'nobody has signed in with that email yet' using errcode = 'P0002'; end if;
  if (role is null or role <> 'owner') and support.role_of(u) = 'owner'
     and (select count(*) from support.staff where support.staff.role = 'owner') <= 1 then
    raise exception 'the team needs an owner' using errcode = '22023';
  end if;
  if role is null then
    update support.feedback set assignee = null where assignee = u;
    delete from support.staff where user_id = u;
  else
    insert into support.staff(user_id, role, name) values (u, role, coalesce(support.clean(name, 40), split_part(btrim(fb_team_set.email), '@', 1)))
      on conflict (user_id) do update set role = excluded.role, name = coalesce(support.clean(fb_team_set.name, 40), support.staff.name);
  end if;
  return public.fb_team();
end $$;

-- ------------------------------------------------------------- grants --
revoke all on all functions in schema support from public, anon, authenticated;
revoke all on function public.fb_send(text,text,jsonb), public.fb_mine(), public.fb_thread(uuid), public.fb_reply(uuid,text,boolean),
  public.fb_unread(), public.fb_inbox(jsonb), public.fb_update(uuid,jsonb), public.fb_delete(uuid), public.fb_team(),
  public.fb_team_set(text,text,text) from public, anon;
grant execute on function public.fb_send(text,text,jsonb), public.fb_mine(), public.fb_thread(uuid), public.fb_reply(uuid,text,boolean),
  public.fb_unread(), public.fb_inbox(jsonb), public.fb_update(uuid,jsonb), public.fb_delete(uuid), public.fb_team(),
  public.fb_team_set(text,text,text) to authenticated;

-- ---------------------------------------------------- the first owner --
-- (Applied to Supabase 11-17 as migration developer_feedback; Brent added as owner.)
-- Run ONCE by hand in the SQL editor, with your own sign-in email:
--   insert into support.staff(user_id, role, name)
--   select id, 'owner', 'Brent' from auth.users where email = 'YOUR SIGN-IN EMAIL';
