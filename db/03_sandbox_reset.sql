-- SANDBOX ONLY, while the database is still empty: removes everything the
-- schema made so 01_schema.sql can be run again from the top. Never run this
-- once real data is in - it deletes every table.
drop schema if exists private cascade;
drop table if exists public.share_links, public.requests, public.time_entries, public.hours_grants,
  public.project_members, public.record_history, public.records, public.projects,
  public.org_members, public.orgs, public.profiles cascade;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('hash_code','access_ok','my_membership','is_org_member',
              'is_org_admin','project_org','is_top_admin','in_branch','can_read','can_write','can_see_hours',
              'can_answer','touch_active','create_org','new_join_code','join_org','org_project_directory',
              'create_project','add_member','remove_member','transfer_top_admin','grant_hours','revoke_hours',
              'job_totals','apply_edit','create_share_link','revoke_share_link','redeem_link','join_by_link','answer_request')
  loop execute 'drop function if exists ' || f.sig || ' cascade'; end loop;
end $$;
