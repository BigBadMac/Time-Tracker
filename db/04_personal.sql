-- Time Tracker - PERSONAL SYNC (draft 1, 11-13). Runs after 01_schema.sql.
--
-- Opt-in (Brent, 11-13): "Sync my own jobs and hours" puts a person's whole
-- board on all of their own devices. Only they can read it - no org, no
-- teammate, no admin. Shared projects stay in the shared tables.
--
-- One row per record the app keeps: coll is the app's collection, item_id the
-- record's own id. fields holds the record; field_ts the time (ms, from the
-- device that made the edit) each field last changed. Merging is FIELD BY
-- FIELD, LATER EDIT WINS - done here, inside personal_push, so two devices
-- pushing the same record can never overwrite each other wholesale.
-- A deletion is a time too (del_ts): it wins over edits made before it; an
-- edit made after it brings the record back.
-- updated_at is the SERVER's time, set on every change: the pull cursor. A
-- device pulls everything changed since its last pull, with a little overlap
-- (merging is idempotent, so seeing a row twice does no harm).

create table public.personal_items (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  coll       text not null check (coll ~ '^[a-z_]{1,24}$'),
  item_id    text not null check (length(item_id) between 1 and 80),
  fields     jsonb not null default '{}' check (jsonb_typeof(fields) = 'object'),
  field_ts   jsonb not null default '{}' check (jsonb_typeof(field_ts) = 'object'),
  del_ts     bigint,                                 -- device ms of the deletion; null = alive
  updated_at timestamptz not null default now(),
  primary key (user_id, coll, item_id)
);
create index on public.personal_items (user_id, updated_at);
comment on table public.personal_items is 'Opt-in personal sync: one person''s own board, readable only by them.';

-- The server stamps updated_at itself; a device cannot move the cursor.
create function private.personal_touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger personal_touch before insert or update on public.personal_items
  for each row execute function private.personal_touch();

alter table public.personal_items enable row level security;
create policy pi_read on public.personal_items for select to authenticated using (user_id = (select auth.uid()));
create policy pi_ins  on public.personal_items for insert to authenticated with check (user_id = (select auth.uid()));
create policy pi_upd  on public.personal_items for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy pi_del  on public.personal_items for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.personal_items to authenticated;

-- Merge one incoming record into the stored one. Pure: no table access.
create function private.personal_merge(old_f jsonb, old_ts jsonb, old_del bigint,
                                       new_f jsonb, new_ts jsonb, new_del bigint,
                                       out f jsonb, out ts jsonb, out del bigint)
language plpgsql immutable set search_path = '' as $$
declare k text; t bigint; latest bigint := 0;
begin
  f := coalesce(old_f, '{}'); ts := coalesce(old_ts, '{}');
  for k, t in select key, value::text::bigint from jsonb_each(coalesce(new_ts, '{}')) loop
    if (ts->k) is null or t > (ts->>k)::bigint then
      ts := ts || jsonb_build_object(k, t);
      if new_f ? k then f := f || jsonb_build_object(k, new_f->k); else f := f - k; end if;
    end if;
  end loop;
  del := greatest(old_del, new_del);
  select coalesce(max(value::text::bigint), 0) into latest from jsonb_each(ts);
  if del is not null and latest > del then del := null; end if;   -- edited after it went: back again
end $$;

-- Push a batch: [{coll, item_id, fields, field_ts, del_ts}, ...]. Returns how
-- many rows it touched. Runs as the caller, so the table's rules apply.
create function public.personal_push(items jsonb) returns int
language plpgsql security invoker set search_path = '' as $$
declare it jsonb; cur public.personal_items; m record; n int := 0; me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  if jsonb_typeof(items) <> 'array' or jsonb_array_length(items) > 500 then
    raise exception 'push an array of at most 500 items';
  end if;
  for it in select value from jsonb_array_elements(items) loop
    select * into cur from public.personal_items
      where user_id = me and coll = it->>'coll' and item_id = it->>'item_id' for update;
    select * into m from private.personal_merge(cur.fields, cur.field_ts, cur.del_ts,
      it->'fields', it->'field_ts', nullif(it->>'del_ts','')::bigint);
    if cur.user_id is null then
      insert into public.personal_items(user_id, coll, item_id, fields, field_ts, del_ts)
        values (me, it->>'coll', it->>'item_id', m.f, m.ts, m.del);
      n := n + 1;
    elsif m.f is distinct from cur.fields or m.ts is distinct from cur.field_ts or m.del is distinct from cur.del_ts then
      update public.personal_items set fields = m.f, field_ts = m.ts, del_ts = m.del
        where user_id = me and coll = it->>'coll' and item_id = it->>'item_id';
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- "Use this device's board": everything on the server goes (as of now), then
-- this device's board goes up. Other devices see the deletions on their next
-- pull. One call, so a dropped connection can't leave half of each.
create function public.personal_replace(items jsonb, at_ms bigint) returns int
language plpgsql security invoker set search_path = '' as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  update public.personal_items set del_ts = greatest(coalesce(del_ts, 0), at_ms)
    where user_id = me and (del_ts is null or del_ts < at_ms);
  return public.personal_push(items);
end $$;

-- The newest edit or deletion time the account holds (device ms; 0 = none).
-- "Use this device's board" stamps itself after this, so a device whose clock
-- runs behind another's still replaces everything.
create function public.personal_clock() returns bigint
language sql stable security invoker set search_path = '' as $$
  select coalesce(max(greatest(coalesce(p.del_ts, 0),
           coalesce((select max(value::text::bigint) from jsonb_each(p.field_ts)), 0))), 0)
  from public.personal_items p where p.user_id = (select auth.uid())
$$;

-- What the account holds, for "your account already has a board": how many
-- projects (and tasks) and time entries are alive, and when it last changed.
create function public.personal_summary() returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'projects', count(*) filter (where p.coll = 'projects' and p.del_ts is null),
    'logs',     count(*) filter (where p.coll = 'logs' and p.del_ts is null),
    'last',     max(p.updated_at))
  from public.personal_items p where p.user_id = (select auth.uid())
$$;

revoke all on function public.personal_push(jsonb), public.personal_replace(jsonb, bigint), public.personal_clock(), public.personal_summary() from public, anon;
grant execute on function public.personal_push(jsonb), public.personal_replace(jsonb, bigint), public.personal_clock(), public.personal_summary() to authenticated;
revoke all on function private.personal_merge(jsonb,jsonb,bigint,jsonb,jsonb,bigint), private.personal_touch() from public, anon;
grant execute on function private.personal_merge(jsonb,jsonb,bigint,jsonb,jsonb,bigint) to authenticated;
