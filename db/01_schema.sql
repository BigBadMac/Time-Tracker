-- Time Tracker - shared board schema (draft 1, 10-27).
-- Written for Supabase (Postgres 15+): relies on auth.users, auth.uid() and
-- the anon / authenticated roles. Tested locally against Postgres 16 with
-- 00_local_shim.sql standing in for Supabase's auth.
--
-- The rules this enforces (decided with Brent 10-20 .. 10-27):
--  * ORGS: joined by JOIN CODE only (stored hashed). A person may be in many.
--    Members see each org project's NAME + PUBLIC DESCRIPTION until added.
--  * A SHARED PROJECT is a top-level project with its whole tree, owned by an
--    org or by one person. Exactly ONE top admin; only they add/remove admins
--    and they can hand the role on (never leave without doing so).
--  * Roles: admin, lead (manages a branch), assignee (owns a branch), member.
--  * SHARE LINKS: every rule optional and chosen by the person making the
--    link - approval, expiry, use limit, date window, PIN - plus what the
--    guest gets: branch, view/edit, end date, date window, days, hours.
--    Access windows are checked on EVERY read, not just at joining.
--  * HOURS: the full record (job time, clock, breaks, disruptions) is
--    uploaded only for shared-project work. An org admin sees it for their
--    own org's members on their org's projects - never a guest's, never
--    another org's. Others see hours only by an org admin's GRANT.
--    Teammates see totals per job.
--  * Edits: later edit wins, field by field; the losing value goes to history.
--  * Last active time is recorded from the first build.

-- ---------------------------------------------------------------- tables --
create table public.profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  display_name   text not null default '',
  last_active_at timestamptz not null default now()
);

create table public.orgs (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (length(trim(name)) > 0),
  join_code_hash text unique,                 -- sha256 of the current code; null = closed
  created_by     uuid not null references auth.users(id),
  created_at     timestamptz not null default now()
);

create table public.org_members (
  org_id    uuid not null references public.orgs(id) on delete cascade,
  user_id   uuid not null references auth.users(id) on delete cascade,
  role      text not null default 'member' check (role in ('admin','member')),
  joined_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create table public.projects (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid references public.orgs(id) on delete restrict,   -- null = owned by one person
  owner_id           uuid not null references auth.users(id),
  top_admin_id       uuid not null references auth.users(id),
  name               text not null check (length(trim(name)) > 0),
  public_description text not null default '',                            -- what org members see before joining
  created_at         timestamptz not null default now()
);

-- The shared tree: nested projects, tasks, stages, milestones. fields holds
-- the record's data; field_ts the time each field was last edited, so the
-- later edit wins field by field.
create table public.records (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  parent_id  uuid references public.records(id) on delete cascade,        -- null = directly under the project
  kind       text not null check (kind in ('project','task','stage','milestone')),
  fields     jsonb not null default '{}',
  field_ts   jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  deleted_at timestamptz
);
create index on public.records (project_id);
create index on public.records (parent_id);

create table public.record_history (
  id         bigint generated always as identity primary key,
  record_id  uuid not null references public.records(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  field      text not null,
  value      jsonb,                 -- the value that lost (overwritten, or arrived too late)
  edited_at  timestamptz not null,  -- when that value was made on its device
  edited_by  uuid references auth.users(id),
  outcome    text not null check (outcome in ('overwritten','arrived_late')),
  logged_at  timestamptz not null default now()
);

create table public.project_members (
  project_id    uuid not null references public.projects(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null check (role in ('admin','lead','assignee','member')),
  branch_id     uuid references public.records(id) on delete set null,     -- lead/assignee branch; a guest's limit
  is_guest      boolean not null default false,                            -- joined by link from outside the org
  can_edit      boolean not null default true,                             -- guests may be view-only
  via_link      uuid,
  -- a guest's access rules (null = no limit), checked on every read
  access_ends_at timestamptz,
  allowed_from   timestamptz,
  allowed_until  timestamptz,
  allowed_days   int[] check (allowed_days is null or allowed_days <@ array[1,2,3,4,5,6,7]),   -- ISO: 1 = Monday
  allowed_start  time,
  allowed_end    time,
  tz             text not null default 'UTC',
  hours_notice_at timestamptz,      -- when they were told their hours are visible to the org
  joined_at     timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.hours_grants (
  project_id uuid not null references public.projects(id) on delete cascade,
  grantee    uuid not null references auth.users(id) on delete cascade,
  branch_id  uuid references public.records(id) on delete cascade,         -- null = the whole project
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (project_id, grantee)
);

-- The full time record, for shared-project work only (the phone decides what
-- to send; personal jobs never leave it).
create table public.time_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  record_id  uuid references public.records(id) on delete set null,
  kind       text not null check (kind in ('job','atwork','break','disruption')),
  started_at timestamptz not null,
  ended_at   timestamptz,
  label      text not null default '',
  data       jsonb not null default '{}',   -- paid/unpaid, personal, missed, reason ...
  updated_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);
create index on public.time_entries (project_id, user_id);

create table public.requests (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  requester   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('join','work_on','move_up')),
  record_id   uuid references public.records(id) on delete cascade,      -- the part asked about
  wanted_role text check (wanted_role in ('admin','lead','assignee','member')),
  link_id     uuid,                                                      -- a join that came through a link
  note        text not null default '',
  status      text not null default 'waiting' check (status in ('waiting','approved','declined')),
  answered_by uuid references auth.users(id),
  answered_at timestamptz,
  created_at  timestamptz not null default now()
);

create table public.share_links (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  code_hash     text not null unique,
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  server        text not null default 'hiatt',       -- which server it belongs to (cross-server links parked)
  -- rules for USING the link (each optional)
  needs_approval boolean not null default false,
  expires_at     timestamptz,
  max_uses       int check (max_uses is null or max_uses > 0),
  uses           int not null default 0,
  usable_from    timestamptz,
  usable_until   timestamptz,
  pin_hash       text,
  revoked_at     timestamptz,
  -- what the guest GETS (each optional)
  grant_role     text not null default 'member' check (grant_role in ('lead','assignee','member')),
  grant_branch   uuid references public.records(id) on delete set null,
  grant_can_edit boolean not null default false,
  grant_access_ends_at timestamptz,
  grant_allowed_from   timestamptz,
  grant_allowed_until  timestamptz,
  grant_allowed_days   int[] check (grant_allowed_days is null or grant_allowed_days <@ array[1,2,3,4,5,6,7]),
  grant_allowed_start  time,
  grant_allowed_end    time,
  grant_tz       text not null default 'UTC'
);

-- --------------------------------------------------------------- helpers --
-- All SECURITY DEFINER with a fixed search_path: they read the tables
-- without tripping the policies that call them.
create or replace function public.hash_code(code text) returns text
language sql immutable as $$ select encode(sha256(convert_to(upper(trim(code)),'UTF8')),'hex') $$;

create or replace function public.access_ok(m public.project_members) returns boolean
language sql stable set search_path = public as $$
  select m.user_id is not null
    and (m.access_ends_at is null or now() <  m.access_ends_at)
    and (m.allowed_from   is null or now() >= m.allowed_from)
    and (m.allowed_until  is null or now() <  m.allowed_until)
    and (m.allowed_days   is null or extract(isodow from now() at time zone m.tz)::int = any(m.allowed_days))
    and (m.allowed_start is null or m.allowed_end is null or (
          case when m.allowed_start <= m.allowed_end
               then (now() at time zone m.tz)::time >= m.allowed_start and (now() at time zone m.tz)::time < m.allowed_end
               else (now() at time zone m.tz)::time >= m.allowed_start or  (now() at time zone m.tz)::time < m.allowed_end end))
$$;

-- The caller's membership of a project, if their access is open right now.
create or replace function public.my_membership(p uuid) returns public.project_members
language sql stable security definer set search_path = public as $$
  select m from public.project_members m
   where m.project_id = p and m.user_id = auth.uid() and public.access_ok(m)
$$;

create or replace function public.is_org_member(o uuid, u uuid default null) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.org_members where org_id = o and user_id = coalesce(u, auth.uid()))
$$;
create or replace function public.is_org_admin(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.org_members where org_id = o and user_id = auth.uid() and role = 'admin')
$$;
create or replace function public.project_org(p uuid) returns uuid
language sql stable security definer set search_path = public as $$ select org_id from public.projects where id = p $$;
create or replace function public.is_top_admin(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from public.projects where id = p and top_admin_id = auth.uid())
$$;

-- Is r the branch itself or somewhere beneath it?
create or replace function public.in_branch(r uuid, branch uuid) returns boolean
language sql stable security definer set search_path = public as $$
  with recursive up(id, parent_id, depth) as (
    select id, parent_id, 0 from public.records where id = r
    union all
    select x.id, x.parent_id, up.depth + 1 from public.records x join up on x.id = up.parent_id where up.depth < 64)
  select branch is not null and exists(select 1 from up where id = branch)
$$;

-- Read: any open member (a guest limited to their branch); an org admin reads
-- their org's projects.
create or replace function public.can_read(p uuid, r uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.project_members;
begin
  m := public.my_membership(p);
  if m.user_id is not null then
    if m.is_guest and m.branch_id is not null and r is not null then return public.in_branch(r, m.branch_id); end if;
    return true;
  end if;
  return public.is_org_admin(public.project_org(p));
end $$;

-- Write: admins anywhere; leads and assignees inside their branch; a guest
-- with editing on, inside theirs (or anywhere if no branch). Members read.
create or replace function public.can_write(p uuid, r uuid) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.project_members;
begin
  m := public.my_membership(p);
  if m.user_id is null or not m.can_edit then return false; end if;
  if m.role = 'admin' then return true; end if;
  if m.role in ('lead','assignee') then return m.branch_id is not null and public.in_branch(r, m.branch_id); end if;
  if m.is_guest then return m.branch_id is null or public.in_branch(r, m.branch_id); end if;
  return false;
end $$;

-- Hours: the person themselves; an org admin for their own org's members on
-- their org's projects; anyone the org admin granted it to (within the
-- granted branch). Never a guest's hours: a guest is not in the org.
create or replace function public.can_see_hours(p uuid, owner uuid, r uuid default null) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare o uuid; g public.hours_grants;
begin
  if owner = auth.uid() then return true; end if;
  o := public.project_org(p);
  if o is null or not public.is_org_member(o, owner) then return false; end if;
  if exists(select 1 from public.project_members where project_id = p and user_id = owner and is_guest) then return false; end if;
  if public.is_org_admin(o) then return true; end if;
  select * into g from public.hours_grants where project_id = p and grantee = auth.uid();
  if g.grantee is null or (public.my_membership(p)).user_id is null then return false; end if;
  return g.branch_id is null or (r is not null and public.in_branch(r, g.branch_id));
end $$;

-- ------------------------------------------------------------------- RLS --
alter table public.profiles        enable row level security;
alter table public.orgs            enable row level security;
alter table public.org_members     enable row level security;
alter table public.projects        enable row level security;
alter table public.records         enable row level security;
alter table public.record_history  enable row level security;
alter table public.project_members enable row level security;
alter table public.hours_grants    enable row level security;
alter table public.time_entries    enable row level security;
alter table public.requests        enable row level security;
alter table public.share_links     enable row level security;

-- profiles: your own, and anyone you share an org or a project with.
create policy profiles_read on public.profiles for select to authenticated using (
  id = auth.uid()
  or exists(select 1 from public.org_members a join public.org_members b on a.org_id = b.org_id
             where a.user_id = auth.uid() and b.user_id = profiles.id)
  or exists(select 1 from public.project_members a join public.project_members b on a.project_id = b.project_id
             where a.user_id = auth.uid() and b.user_id = profiles.id));
create policy profiles_own on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profiles_upd on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- orgs: members read; the org admin renames. Codes are never readable (hash).
create policy orgs_read on public.orgs for select to authenticated using (public.is_org_member(id));
create policy orgs_upd  on public.orgs for update to authenticated using (public.is_org_admin(id)) with check (public.is_org_admin(id));

create policy orgm_read on public.org_members for select to authenticated using (public.is_org_member(org_id));
create policy orgm_leave on public.org_members for delete to authenticated using (user_id = auth.uid() or public.is_org_admin(org_id));

-- projects: open members, and the org admin. Other org members use
-- org_project_directory() - name and public description only.
create policy proj_read on public.projects for select to authenticated using (public.can_read(id));
create policy proj_upd  on public.projects for update to authenticated
  using ((public.my_membership(id)).role = 'admin') with check ((public.my_membership(id)).role = 'admin');

-- records: read by can_read; created by writers; edited through apply_edit().
create policy rec_read on public.records for select to authenticated using (public.can_read(project_id, id));
create policy rec_ins  on public.records for insert to authenticated with check (
  case when parent_id is null then (public.my_membership(project_id)).role = 'admin'
       else public.can_write(project_id, parent_id) end);

create policy hist_read on public.record_history for select to authenticated using (public.can_read(project_id, record_id));

-- members see each other (open access only); changes go through functions.
create policy pm_read on public.project_members for select to authenticated using (public.can_read(project_id));

create policy hg_read on public.hours_grants for select to authenticated
  using (grantee = auth.uid() or public.is_org_admin(public.project_org(project_id)));

-- time: write your own, on projects you are open on; read per can_see_hours.
create policy te_read on public.time_entries for select to authenticated using (public.can_see_hours(project_id, user_id, record_id));
create policy te_ins  on public.time_entries for insert to authenticated
  with check (user_id = auth.uid() and (public.my_membership(project_id)).user_id is not null);
create policy te_upd  on public.time_entries for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid() and (public.my_membership(project_id)).user_id is not null);
create policy te_del  on public.time_entries for delete to authenticated using (user_id = auth.uid());

-- requests: your own; and whoever can answer them.
create or replace function public.can_answer(q public.requests) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare m public.project_members;
begin
  if q.kind = 'move_up' and q.wanted_role = 'admin' then return public.is_top_admin(q.project_id); end if;
  m := public.my_membership(q.project_id);
  if m.user_id is null then return false; end if;
  if m.role = 'admin' then return true; end if;
  if m.role = 'lead' and q.record_id is not null and q.kind <> 'join' then
    return public.in_branch(q.record_id, m.branch_id) and coalesce(q.wanted_role,'member') in ('assignee','member');
  end if;
  return false;
end $$;
create policy rq_read on public.requests for select to authenticated using (requester = auth.uid() or public.can_answer(requests));
create policy rq_ins  on public.requests for insert to authenticated
  with check (requester = auth.uid() and kind <> 'join' and status = 'waiting' and answered_by is null
              and (public.my_membership(project_id)).user_id is not null);

-- share links: the project's admins. Joining goes through redeem_link().
create policy sl_read on public.share_links for select to authenticated using ((public.my_membership(project_id)).role = 'admin');

-- ------------------------------------------------------------- functions --
create or replace function public.touch_active() returns void
language sql security definer set search_path = public as $$
  insert into public.profiles(id) values (auth.uid())
  on conflict (id) do update set last_active_at = now()
$$;

-- Orgs
create or replace function public.create_org(org_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  insert into public.orgs(name, created_by) values (org_name, auth.uid()) returning id into o;
  insert into public.org_members(org_id, user_id, role) values (o, auth.uid(), 'admin');
  return o;
end $$;

-- A new join code: shown ONCE to the admin, stored only as a hash. Making a
-- new one retires the old.
create or replace function public.new_join_code(o uuid) returns text
language plpgsql security definer set search_path = public as $$
declare code text := '';
        alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   -- no 0/O, 1/I
        i int;
begin
  if not public.is_org_admin(o) then raise exception 'only an org admin makes join codes'; end if;
  for i in 1..10 loop code := code || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1); end loop;
  update public.orgs set join_code_hash = public.hash_code(code) where id = o;
  return code;
end $$;

create or replace function public.join_org(code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare o uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select id into o from public.orgs where join_code_hash = public.hash_code(code);
  if o is null then raise exception 'that code does not match an organization'; end if;
  insert into public.org_members(org_id, user_id) values (o, auth.uid()) on conflict do nothing;
  return o;
end $$;

-- What an org member may see of the org's projects before joining one.
create or replace function public.org_project_directory(o uuid)
returns table(id uuid, name text, public_description text, is_member boolean)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.public_description,
         exists(select 1 from public.project_members m where m.project_id = p.id and m.user_id = auth.uid())
    from public.projects p
   where p.org_id = o and public.is_org_member(o)
   order by p.name
$$;

-- Projects and members
create or replace function public.create_project(project_name text, org uuid default null, description text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare p uuid;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  if org is not null and not public.is_org_member(org) then raise exception 'not a member of that organization'; end if;
  insert into public.projects(org_id, owner_id, top_admin_id, name, public_description)
       values (org, auth.uid(), auth.uid(), project_name, coalesce(description,'')) returning id into p;
  insert into public.project_members(project_id, user_id, role, hours_notice_at)
       values (p, auth.uid(), 'admin', case when org is null then null else now() end);
  return p;
end $$;

-- Add someone (already known to the caller, e.g. from the org directory).
-- Admins add anyone; only the TOP admin adds an admin; a lead adds an
-- assignee or member inside their own branch.
create or replace function public.add_member(p uuid, who uuid, new_role text, branch uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare me public.project_members; o uuid;
begin
  me := public.my_membership(p);
  if me.user_id is null then raise exception 'not on this project'; end if;
  if new_role = 'admin' and not public.is_top_admin(p) then raise exception 'only the top admin adds an admin'; end if;
  if me.role = 'lead' then
    if new_role not in ('assignee','member') or branch is null or not public.in_branch(branch, me.branch_id) then
      raise exception 'a lead adds assignees and members inside their own branch'; end if;
  elsif me.role <> 'admin' then raise exception 'only admins and leads add people'; end if;
  if new_role in ('lead','assignee') and branch is null then raise exception 'a lead or assignee needs a branch'; end if;
  o := public.project_org(p);
  insert into public.project_members(project_id, user_id, role, branch_id, is_guest, hours_notice_at)
       values (p, who, new_role, branch, (o is not null and not public.is_org_member(o, who)),
               case when o is not null and public.is_org_member(o, who) then now() end)
  on conflict (project_id, user_id) do update set role = excluded.role, branch_id = excluded.branch_id;
end $$;

create or replace function public.remove_member(p uuid, who uuid) returns void
language plpgsql security definer set search_path = public as $$
declare me public.project_members; them public.project_members;
begin
  select * into them from public.project_members where project_id = p and user_id = who;
  if them.user_id is null then return; end if;
  if exists(select 1 from public.projects where id = p and top_admin_id = who) then
    raise exception 'the top admin hands the role on before leaving'; end if;
  if who <> auth.uid() then
    me := public.my_membership(p);
    if them.role = 'admin' and not public.is_top_admin(p) then raise exception 'only the top admin removes an admin'; end if;
    if coalesce(me.role,'') = 'lead' then
      if them.role not in ('assignee','member') or them.branch_id is null or not public.in_branch(them.branch_id, me.branch_id) then
        raise exception 'a lead removes only inside their own branch'; end if;
    elsif coalesce(me.role,'') <> 'admin' then raise exception 'only admins and leads remove people'; end if;
  end if;
  delete from public.project_members where project_id = p and user_id = who;
  delete from public.hours_grants where project_id = p and grantee = who;
end $$;

create or replace function public.transfer_top_admin(p uuid, to_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_top_admin(p) then raise exception 'only the top admin hands the role on'; end if;
  if not exists(select 1 from public.project_members where project_id = p and user_id = to_user and role = 'admin') then
    raise exception 'hand it to one of the project''s admins'; end if;
  update public.projects set top_admin_id = to_user where id = p;
end $$;

-- Hours grants: only the org admin, only to people on the project.
create or replace function public.grant_hours(p uuid, who uuid, branch uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin(public.project_org(p)) then raise exception 'only the organization''s admin grants hours'; end if;
  if not exists(select 1 from public.project_members where project_id = p and user_id = who) then raise exception 'they are not on this project'; end if;
  insert into public.hours_grants(project_id, grantee, branch_id, granted_by) values (p, who, branch, auth.uid())
  on conflict (project_id, grantee) do update set branch_id = excluded.branch_id, granted_by = excluded.granted_by, granted_at = now();
end $$;
create or replace function public.revoke_hours(p uuid, who uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_org_admin(public.project_org(p)) then raise exception 'only the organization''s admin revokes hours'; end if;
  delete from public.hours_grants where project_id = p and grantee = who;
end $$;

-- Teammates see totals per job (seconds of job time), nothing finer.
create or replace function public.job_totals(p uuid)
returns table(user_id uuid, record_id uuid, total_seconds bigint)
language sql stable security definer set search_path = public as $$
  select t.user_id, t.record_id, sum(extract(epoch from (coalesce(t.ended_at, now()) - t.started_at)))::bigint
    from public.time_entries t
   where t.project_id = p and t.kind = 'job' and public.can_read(p)
   group by t.user_id, t.record_id
$$;

-- Edits: the later edit wins, field by field. A value that loses - because
-- it was overwritten, or because it arrived after a newer one - is kept in
-- the history.
create or replace function public.apply_edit(r uuid, field text, val jsonb, edited_at timestamptz)
returns boolean language plpgsql security definer set search_path = public as $$
declare rec public.records; cur_ts timestamptz;
begin
  select * into rec from public.records where id = r for update;
  if rec.id is null or not public.can_write(rec.project_id, r) then raise exception 'you cannot edit this'; end if;
  cur_ts := (rec.field_ts->>field)::timestamptz;
  if cur_ts is not null and edited_at <= cur_ts then
    insert into public.record_history(record_id, project_id, field, value, edited_at, edited_by, outcome)
         values (r, rec.project_id, field, val, edited_at, auth.uid(), 'arrived_late');
    return false;
  end if;
  if rec.fields ? field then
    insert into public.record_history(record_id, project_id, field, value, edited_at, edited_by, outcome)
         values (r, rec.project_id, field, rec.fields->field, coalesce(cur_ts, rec.updated_at), rec.updated_by, 'overwritten');
  end if;
  update public.records
     set fields = jsonb_set(fields, array[field], val, true),
         field_ts = jsonb_set(field_ts, array[field], to_jsonb(edited_at), true),
         updated_at = now(), updated_by = auth.uid()
   where id = r;
  return true;
end $$;

-- Share links. The maker chooses every rule; the code and PIN are shown once.
create or replace function public.create_share_link(p uuid, opts jsonb default '{}') returns text
language plpgsql security definer set search_path = public as $$
declare code text := ''; alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
begin
  if coalesce((public.my_membership(p)).role,'') <> 'admin' then raise exception 'only a project admin makes share links'; end if;
  for i in 1..12 loop code := code || substr(alphabet, 1 + floor(random()*length(alphabet))::int, 1); end loop;
  insert into public.share_links(project_id, code_hash, created_by, needs_approval, expires_at, max_uses,
      usable_from, usable_until, pin_hash, grant_role, grant_branch, grant_can_edit, grant_access_ends_at,
      grant_allowed_from, grant_allowed_until, grant_allowed_days, grant_allowed_start, grant_allowed_end, grant_tz)
  values (p, public.hash_code(code), auth.uid(),
      coalesce((opts->>'needs_approval')::boolean, false), (opts->>'expires_at')::timestamptz, (opts->>'max_uses')::int,
      (opts->>'usable_from')::timestamptz, (opts->>'usable_until')::timestamptz,
      case when opts ? 'pin' then public.hash_code(opts->>'pin') end,
      coalesce(opts->>'role','member'), (opts->>'branch')::uuid, coalesce((opts->>'can_edit')::boolean, false),
      (opts->>'access_ends_at')::timestamptz, (opts->>'allowed_from')::timestamptz, (opts->>'allowed_until')::timestamptz,
      case when opts ? 'allowed_days' then array(select jsonb_array_elements_text(opts->'allowed_days')::int) end,
      (opts->>'allowed_start')::time, (opts->>'allowed_end')::time, coalesce(opts->>'tz','UTC'));
  return code;
end $$;

create or replace function public.revoke_share_link(link uuid) returns void
language plpgsql security definer set search_path = public as $$
declare l public.share_links;
begin
  select * into l from public.share_links where id = link;
  if l.id is null or coalesce((public.my_membership(l.project_id)).role,'') <> 'admin' then raise exception 'only a project admin revokes links'; end if;
  update public.share_links set revoked_at = now() where id = link;
end $$;

-- Using a link: every rule the maker set is checked here. Returns 'joined'
-- or 'waiting' (approval needed). Someone from the project's own org joins
-- as a member, not a guest.
create or replace function public.redeem_link(code text, pin text default null) returns text
language plpgsql security definer set search_path = public as $$
declare l public.share_links; o uuid; guest boolean;
begin
  if auth.uid() is null then raise exception 'sign in first'; end if;
  select * into l from public.share_links where code_hash = public.hash_code(code) for update;
  if l.id is null or l.revoked_at is not null then raise exception 'this link is not valid'; end if;
  if l.expires_at is not null and now() >= l.expires_at then raise exception 'this link has expired'; end if;
  if l.usable_from is not null and now() < l.usable_from then raise exception 'this link cannot be used yet'; end if;
  if l.usable_until is not null and now() >= l.usable_until then raise exception 'this link can no longer be used'; end if;
  if l.max_uses is not null and l.uses >= l.max_uses then raise exception 'this link has been used up'; end if;
  if l.pin_hash is not null and (pin is null or public.hash_code(pin) <> l.pin_hash) then raise exception 'wrong PIN'; end if;
  if exists(select 1 from public.project_members where project_id = l.project_id and user_id = auth.uid()) then return 'joined'; end if;
  update public.share_links set uses = uses + 1 where id = l.id;
  if l.needs_approval then
    insert into public.requests(project_id, requester, kind, wanted_role, link_id, record_id)
         values (l.project_id, auth.uid(), 'join', l.grant_role, l.id, l.grant_branch);
    return 'waiting';
  end if;
  perform public.join_by_link(l, auth.uid());
  return 'joined';
end $$;

create or replace function public.join_by_link(l public.share_links, who uuid) returns void
language plpgsql security definer set search_path = public as $$
declare o uuid; guest boolean;
begin
  o := public.project_org(l.project_id);
  guest := not (o is not null and public.is_org_member(o, who));
  insert into public.project_members(project_id, user_id, role, branch_id, is_guest, can_edit, via_link,
      access_ends_at, allowed_from, allowed_until, allowed_days, allowed_start, allowed_end, tz, hours_notice_at)
  values (l.project_id, who, l.grant_role, l.grant_branch, guest, l.grant_can_edit or not guest, l.id,
      l.grant_access_ends_at, l.grant_allowed_from, l.grant_allowed_until, l.grant_allowed_days,
      l.grant_allowed_start, l.grant_allowed_end, l.grant_tz, case when guest then null else now() end)
  on conflict (project_id, user_id) do nothing;
end $$;
revoke execute on function public.join_by_link(public.share_links, uuid) from public, authenticated, anon;

-- Answering a request: whoever can_answer() it. Approving does what was asked.
create or replace function public.answer_request(q uuid, approve boolean) returns void
language plpgsql security definer set search_path = public as $$
declare r public.requests; l public.share_links;
begin
  select * into r from public.requests where id = q for update;
  if r.id is null or r.status <> 'waiting' then raise exception 'nothing to answer'; end if;
  if not public.can_answer(r) then raise exception 'you cannot answer this request'; end if;
  update public.requests set status = case when approve then 'approved' else 'declined' end,
         answered_by = auth.uid(), answered_at = now() where id = q;
  if not approve then return; end if;
  if r.kind = 'join' and r.link_id is not null then
    select * into l from public.share_links where id = r.link_id;
    perform public.join_by_link(l, r.requester);
  elsif r.kind in ('work_on','move_up') then
    update public.project_members
       set role = coalesce(r.wanted_role, role), branch_id = coalesce(r.record_id, branch_id)
     where project_id = r.project_id and user_id = r.requester;
  end if;
end $$;

-- ---------------------------------------------------------------- grants --
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.org_members, public.project_members, public.hours_grants,
  public.record_history, public.share_links from authenticated;
revoke update, delete on public.records from authenticated;       -- edits go through apply_edit()
revoke insert, update, delete on public.orgs from authenticated;
grant update (name) on public.orgs to authenticated;
-- the hashed codes are never readable, even by admins: column grants only
revoke select on public.orgs, public.share_links from authenticated;
grant select (id, name, created_by, created_at) on public.orgs to authenticated;
grant select (id, project_id, created_by, created_at, server, needs_approval, expires_at, max_uses, uses,
  usable_from, usable_until, revoked_at, grant_role, grant_branch, grant_can_edit, grant_access_ends_at,
  grant_allowed_from, grant_allowed_until, grant_allowed_days, grant_allowed_start, grant_allowed_end, grant_tz)
  on public.share_links to authenticated;
revoke all on all tables in schema public from anon;
grant execute on all functions in schema public to authenticated;
revoke execute on function public.join_by_link(public.share_links, uuid) from authenticated;
