-- Time Tracker - FAQ (11-18). Runs after 06_support.sql.
--
-- Brent (11-18): an FAQ in the User Manual (layout D: by topic, tap to open,
-- "Did this help?", "Still stuck? Send feedback"), filled from the feedback
-- inbox: staff push an answer from any item, and Claude suggests entries from
-- what keeps coming up (option 1: Claude reads the inbox on request through
-- the database connector and adds rows with support.suggest(); option 2, an
-- in-app button calling the Claude API, is saved for later - see the Project
-- doc FAQ-CLAUDE-OPTION2.md). Nothing is published without an owner.
--
-- Same rule as feedback: tables in schema "support", reached only through
-- the functions below.
--   anyone (even signed out) - reads PUBLISHED entries (faq_list)
--   signed in               - one helpful / not helpful vote per entry
--   helper                  - drafts and edits entries, sees suggestions
--   owner                   - also publishes, unpublishes and deletes

create table support.faq (
  id         uuid primary key default gen_random_uuid(),
  question   text not null check (length(question) between 3 and 200),
  answer     text not null check (length(answer) between 1 and 3000),
  topic      text not null default 'General' check (length(topic) between 1 and 30),
  guide      text check (guide is null or guide ~ '^[a-z0-9:_-]{1,40}$'),   -- a manual guide's id, for "Show me how"
  published  boolean not null default false,
  sort       int not null default 0,
  source     uuid references support.feedback(id) on delete set null,   -- the item it came from, if any
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
create index on support.faq (published, topic, sort);
create index on support.faq (source);
create index on support.faq (updated_by);

create table support.faq_votes (
  user_id  uuid not null references auth.users(id) on delete cascade,
  faq_id   uuid not null references support.faq(id) on delete cascade,
  helpful  boolean not null,
  at       timestamptz not null default now(),
  primary key (user_id, faq_id)
);
create index on support.faq_votes (faq_id);

create table support.faq_suggestions (
  id         uuid primary key default gen_random_uuid(),
  question   text not null check (length(question) between 3 and 200),
  answer     text not null check (length(answer) between 1 and 3000),
  topic      text not null default 'General' check (length(topic) between 1 and 30),
  guide      text check (guide is null or guide ~ '^[a-z0-9:_-]{1,40}$'),
  asked      int not null default 1 check (asked >= 0),
  sources    uuid[] not null default '{}',
  note       text check (note is null or length(note) <= 300),
  status     text not null default 'suggested' check (status in ('suggested','accepted','dismissed')),
  created_by text not null default 'claude' check (length(created_by) <= 20),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  faq_id     uuid references support.faq(id) on delete set null
);
create index on support.faq_suggestions (status, created_at desc);
create index on support.faq_suggestions (decided_by);
create index on support.faq_suggestions (faq_id);

alter table support.faq             enable row level security;
alter table support.faq_votes       enable row level security;
alter table support.faq_suggestions enable row level security;
revoke all on all tables in schema support from public, anon, authenticated;

create function support.faq_json(f support.faq, staff boolean) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', f.id, 'question', f.question, 'answer', f.answer, 'topic', f.topic, 'guide', f.guide,
           'updated_at', f.updated_at,
           'my', (select v.helpful from support.faq_votes v where v.faq_id = f.id and v.user_id = auth.uid()))
    || case when staff then jsonb_build_object('published', f.published, 'sort', f.sort, 'source', f.source,
           'yes', (select count(*) from support.faq_votes v where v.faq_id = f.id and v.helpful),
           'no',  (select count(*) from support.faq_votes v where v.faq_id = f.id and not v.helpful)) else '{}'::jsonb end
$$;

-- Everyone: the published FAQ, by topic.
create function public.faq_list() returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(support.faq_json(f, false) order by f.topic, f.sort, f.question), '[]')
    from support.faq f where f.published
$$;

-- Signed in: did this help? true / false, or null to take the vote back.
create function public.faq_vote(id uuid, helpful boolean) returns boolean language plpgsql security definer set search_path = '' as $$
declare me uuid := support.need_user();
begin
  if not exists (select 1 from support.faq f where f.id = faq_vote.id and f.published) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if helpful is null then
    delete from support.faq_votes v where v.user_id = me and v.faq_id = faq_vote.id;
  else
    insert into support.faq_votes(user_id, faq_id, helpful) values (me, faq_vote.id, helpful)
      on conflict (user_id, faq_id) do update set helpful = excluded.helpful, at = now();
  end if;
  return true;
end $$;

-- Staff: every entry, drafts too, with the vote counts.
create function public.faq_all() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform support.need_staff();
  return coalesce((select jsonb_agg(support.faq_json(f, true) order by f.published desc, f.topic, f.sort, f.question) from support.faq f), '[]');
end $$;

-- Staff: create (id null) or change an entry.
-- e: {question, answer, topic, guide, sort, published, source, notify, suggestion}
--   published - owners only; a helper's save keeps whatever it was (new = draft)
--   source    - the inbox item it came from (must be one the caller can reach)
--   notify    - with source, and once published: a reply in that thread
--               telling the sender it is in the FAQ (sent once per entry)
--   suggestion - the suggestion it came from: marked accepted
create function public.faq_save(id uuid, e jsonb) returns jsonb language plpgsql security definer set search_path = '' as $$
declare r text := support.need_staff(); f support.faq; src support.feedback; pub boolean; q text; a text; t text; g text;
begin
  q := support.clean(e->>'question', 201); a := support.clean(e->>'answer', 3001);
  t := coalesce(support.clean(e->>'topic', 31), 'General'); g := nullif(btrim(coalesce(e->>'guide','')), '');
  if q is null or a is null then raise exception 'a question and an answer are both needed' using errcode = '22023'; end if;
  if length(q) > 200 or length(a) > 3000 or length(t) > 30 then raise exception 'too long' using errcode = '22001'; end if;
  if faq_save.id is not null then
    select * into f from support.faq x where x.id = faq_save.id for update;
    if f.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  end if;
  pub := case when e ? 'published' and r = 'owner' then coalesce((e->>'published')::boolean, false) else coalesce(f.published, false) end;
  if e ? 'published' and r <> 'owner' and coalesce((e->>'published')::boolean, false) is distinct from coalesce(f.published, false) then
    raise exception 'only an owner publishes' using errcode = '42501';
  end if;
  if nullif(e->>'source','') is not null then
    select * into src from support.feedback x where x.id = (e->>'source')::uuid;
    if src.id is null or coalesce(support.access(src), '') not in ('owner','helper') then raise exception 'not found' using errcode = 'P0002'; end if;
  end if;
  if f.id is null then
    insert into support.faq(question, answer, topic, guide, sort, published, source, updated_by)
      values (q, a, t, g, coalesce((e->>'sort')::int, 0), pub, src.id, auth.uid()) returning * into f;
  else
    update support.faq x set question = q, answer = a, topic = t, guide = g, sort = coalesce((e->>'sort')::int, x.sort),
           published = pub, source = coalesce(src.id, x.source), updated_at = now(), updated_by = auth.uid()
     where x.id = f.id returning * into f;
  end if;
  if coalesce((e->>'notify')::boolean, false) and f.published and f.source is not null
     and not exists (select 1 from support.messages m where m.feedback_id = f.source and m.event = 'faq:added') then
    insert into support.messages(feedback_id, author, by_staff, event, body)
      values (f.source, auth.uid(), true, 'faq:added', 'Thanks for asking. It’s now in the FAQ: “' || f.question || '”');
    update support.feedback x set last_at = now() where x.id = f.source;
  end if;
  if nullif(e->>'suggestion','') is not null then
    update support.faq_suggestions s set status = 'accepted', decided_at = now(), decided_by = auth.uid(), faq_id = f.id
     where s.id = (e->>'suggestion')::uuid;
  end if;
  return support.faq_json(f, true);
end $$;

create function public.faq_delete(id uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if support.need_staff() <> 'owner' then raise exception 'only an owner deletes' using errcode = '42501'; end if;
  delete from support.faq x where x.id = faq_delete.id;
  return found;
end $$;

-- Staff: suggestions waiting for a decision, newest first.
create function public.faq_suggestions() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform support.need_staff();
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'question', s.question, 'answer', s.answer, 'topic', s.topic,
           'guide', s.guide, 'asked', s.asked, 'sources', to_jsonb(s.sources), 'note', s.note, 'created_by', s.created_by,
           'created_at', s.created_at) order by s.asked desc, s.created_at desc)
           from support.faq_suggestions s where s.status = 'suggested'), '[]');
end $$;

-- Staff: dismiss a suggestion (or bring one back).
create function public.faq_suggestion_set(id uuid, status text) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  perform support.need_staff();
  if status not in ('suggested','dismissed') then raise exception 'not allowed' using errcode = '22023'; end if;
  update support.faq_suggestions s set status = faq_suggestion_set.status, decided_at = case when faq_suggestion_set.status = 'suggested' then null else now() end,
         decided_by = case when faq_suggestion_set.status = 'suggested' then null else auth.uid() end
   where s.id = faq_suggestion_set.id and s.status <> 'accepted';
  return found;
end $$;

-- NOT callable from the app: how Claude (option 1, through the database
-- connector) or a later server job adds a suggestion. Skips a question that
-- matches a published entry or an open suggestion, word for word (case and
-- spacing aside). Returns the new id, or null when skipped.
create function support.suggest(question text, answer text, topic text default 'General', guide text default null,
                                asked int default 1, sources uuid[] default '{}', note text default null, by text default 'claude')
returns uuid language plpgsql security definer set search_path = '' as $$
declare k text := lower(regexp_replace(btrim(question), '\s+', ' ', 'g')); new_id uuid;
begin
  if exists (select 1 from support.faq f where lower(regexp_replace(btrim(f.question), '\s+', ' ', 'g')) = k)
     or exists (select 1 from support.faq_suggestions s where s.status = 'suggested' and lower(regexp_replace(btrim(s.question), '\s+', ' ', 'g')) = k) then
    return null;
  end if;
  insert into support.faq_suggestions(question, answer, topic, guide, asked, sources, note, created_by)
    values (btrim(question), btrim(answer), coalesce(nullif(btrim(topic),''), 'General'), guide, greatest(asked, 0), coalesce(sources, '{}'), note, by)
    returning id into new_id;
  return new_id;
end $$;

revoke all on all functions in schema support from public, anon, authenticated;
revoke all on function public.faq_list(), public.faq_vote(uuid,boolean), public.faq_all(), public.faq_save(uuid,jsonb),
  public.faq_delete(uuid), public.faq_suggestions(), public.faq_suggestion_set(uuid,text) from public, anon;
grant execute on function public.faq_list() to anon, authenticated;
grant execute on function public.faq_vote(uuid,boolean), public.faq_all(), public.faq_save(uuid,jsonb),
  public.faq_delete(uuid), public.faq_suggestions(), public.faq_suggestion_set(uuid,text) to authenticated;

-- The thread shows "It's in the FAQ" as a line of its own: event names allowed
-- by support.messages already cover 'faq:added'.
