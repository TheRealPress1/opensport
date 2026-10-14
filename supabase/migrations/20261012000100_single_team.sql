-- Fresh installations only. Do not apply this baseline to the existing Babson database.
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated, service_role;

create table public.team_settings (
  id integer primary key default 1 check (id = 1),
  name text not null default 'My team' check (length(btrim(name)) between 1 and 100),
  season text not null default extract(year from current_date)::text check (length(season) <= 40),
  timezone text not null default 'UTC',
  sport_mode text not null default 'general' check (sport_mode in ('general', 'soccer')),
  scores_enabled boolean not null default true,
  organizer_name text not null default '' check (length(organizer_name) <= 100),
  organizer_whatsapp text not null default '' check (organizer_whatsapp ~ '^[0-9+ ()-]{0,30}$'),
  updated_at timestamptz not null default now()
);
insert into public.team_settings (id) values (1);

create table public.soccer_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 100),
  jersey_number integer check (jersey_number between 0 and 999),
  position text not null default '' check (length(position) <= 40),
  avatar_path text check (length(avatar_path) <= 300),
  avatar_emoji text not null default '⚽' check (length(avatar_emoji) <= 20),
  role text not null default 'player' check (role in ('admin', 'coach', 'player')),
  active boolean not null default false,
  joined_at timestamptz not null default now(),
  onboarding_completed_at timestamptz,
  check (not active or onboarding_completed_at is not null)
);

create table public.soccer_member_contacts (
  member_id uuid primary key references public.soccer_members(id) on delete cascade,
  email text not null check (length(email) between 3 and 320),
  phone text check (length(phone) <= 40)
);

create table public.soccer_events (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('game', 'practice', 'other')),
  title text not null check (length(btrim(title)) between 1 and 200),
  date date not null,
  time time,
  end_time time,
  location text not null default '' check (length(location) <= 500),
  opponent text check (length(opponent) <= 150),
  home_away text check (home_away in ('home', 'away', 'neutral')),
  notes text not null default '' check (length(notes) <= 10000),
  team_score integer check (team_score between 0 and 9999),
  opponent_score integer check (opponent_score between 0 and 9999),
  created_by uuid references public.soccer_members(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((team_score is null) = (opponent_score is null)),
  check (team_score is null or type = 'game'),
  check (end_time is null or time is null or end_time > time)
);
create index soccer_events_date_idx on public.soccer_events(date);

create table public.soccer_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.soccer_events(id) on delete cascade,
  member_id uuid not null references public.soccer_members(id) on delete restrict,
  status text not null check (status in ('going', 'maybe', 'cant')),
  updated_at timestamptz not null default now(),
  unique (event_id, member_id)
);
create index soccer_rsvps_member_idx on public.soccer_rsvps(member_id);

create table public.soccer_goals (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.soccer_events(id) on delete cascade,
  scorer_id uuid not null references public.soccer_members(id) on delete restrict,
  assist_id uuid references public.soccer_members(id) on delete restrict,
  minute integer check (minute between 0 and 999),
  check (assist_id is null or assist_id <> scorer_id)
);
create index soccer_goals_event_idx on public.soccer_goals(event_id);

create table public.soccer_lineups (
  id uuid primary key default gen_random_uuid(),
  event_id uuid unique references public.soccer_events(id) on delete cascade,
  name text check (length(name) <= 150),
  formation text not null default '4-4-2' check (length(formation) <= 30),
  slots jsonb not null default '[]'::jsonb check (jsonb_typeof(slots) = 'array' and jsonb_array_length(slots) <= 40),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_by uuid references public.soccer_members(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  token_digest text not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

-- SECURITY DEFINER helpers avoid recursive member policies. The API does not expose
-- the private schema, and all functions have a fixed, empty search_path.
create function private.is_member() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.soccer_members where user_id = (select auth.uid()) and active and onboarding_completed_at is not null)
$$;
create function private.is_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.soccer_members where user_id = (select auth.uid()) and active and onboarding_completed_at is not null and role in ('admin', 'coach'))
$$;
create function private.member_id() returns uuid language sql stable security definer set search_path = '' as $$
  select id from public.soccer_members where user_id = (select auth.uid()) and active and onboarding_completed_at is not null
$$;
revoke all on function private.is_member(), private.is_admin(), private.member_id() from public;
grant execute on function private.is_member(), private.is_admin(), private.member_id() to anon, authenticated, service_role;

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger events_updated_at before update on public.soccer_events for each row execute function private.touch_updated_at();
create trigger rsvps_updated_at before update on public.soccer_rsvps for each row execute function private.touch_updated_at();
create trigger lineups_updated_at before update on public.soccer_lineups for each row execute function private.touch_updated_at();
create trigger settings_updated_at before update on public.team_settings for each row execute function private.touch_updated_at();

create function private.validate_settings() returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception 'Choose a valid IANA timezone' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger settings_timezone before insert or update on public.team_settings for each row execute function private.validate_settings();

create function private.guard_membership() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Serialize all changes that could remove the final administrator, including
  -- operations made with service credentials and concurrent demotions.
  if tg_op in ('INSERT', 'DELETE') or old.active is distinct from new.active or old.role is distinct from new.role then
    perform pg_catalog.pg_advisory_xact_lock(784532, 1);
  end if;
  if tg_op <> 'INSERT' and old.active and old.role in ('admin', 'coach') then
    if tg_op = 'DELETE' or not new.active or new.role not in ('admin', 'coach') then
      if not exists (select 1 from public.soccer_members where id <> old.id and active and role in ('admin', 'coach')) then
        raise exception 'The team must keep at least one active admin or coach' using errcode = '23514';
      end if;
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.avatar_path is not null and (
    split_part(new.avatar_path, '/', 1) <> new.user_id::text
    or new.avatar_path like '%..%' or new.avatar_path like '%\\%'
  ) then
    raise exception 'Avatar must be stored in this member''s folder' using errcode = '22023';
  end if;
  return new;
end;
$$;
create trigger membership_guard before insert or update or delete on public.soccer_members for each row execute function private.guard_membership();

alter table public.team_settings enable row level security;
alter table public.soccer_members enable row level security;
alter table public.soccer_member_contacts enable row level security;
alter table public.soccer_events enable row level security;
alter table public.soccer_rsvps enable row level security;
alter table public.soccer_goals enable row level security;
alter table public.soccer_lineups enable row level security;
alter table public.team_invitations enable row level security;

create policy settings_read on public.team_settings for select to authenticated using ((select private.is_member()));
create policy settings_edit on public.team_settings for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy members_read on public.soccer_members for select to authenticated using ((select private.is_member()) or user_id = (select auth.uid()));
create policy members_edit_self on public.soccer_members for update to authenticated using (user_id = (select auth.uid()) and (select private.is_member())) with check (user_id = (select auth.uid()) and (select private.is_member()));
create policy contacts_read on public.soccer_member_contacts for select to authenticated using ((select private.is_admin()) or member_id = (select private.member_id()));
create policy contacts_edit on public.soccer_member_contacts for update to authenticated using ((select private.is_admin()) or member_id = (select private.member_id())) with check ((select private.is_admin()) or member_id = (select private.member_id()));
create policy events_read on public.soccer_events for select to authenticated using ((select private.is_member()));
create policy events_insert on public.soccer_events for insert to authenticated with check ((select private.is_admin()) and created_by = (select private.member_id()));
create policy events_update on public.soccer_events for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy events_delete on public.soccer_events for delete to authenticated using ((select private.is_admin()));
create policy rsvps_read on public.soccer_rsvps for select to authenticated using ((select private.is_member()));
create policy rsvps_insert on public.soccer_rsvps for insert to authenticated with check ((select private.is_admin()) or member_id = (select private.member_id()));
create policy rsvps_update on public.soccer_rsvps for update to authenticated using ((select private.is_admin()) or member_id = (select private.member_id())) with check ((select private.is_admin()) or member_id = (select private.member_id()));
create policy goals_read on public.soccer_goals for select to authenticated using ((select private.is_member()));
create policy lineups_read on public.soccer_lineups for select to authenticated using ((select private.is_admin()) or ((select private.is_member()) and status = 'published'));
create policy lineups_insert on public.soccer_lineups for insert to authenticated with check ((select private.is_admin()) and created_by = (select private.member_id()));
create policy lineups_update on public.soccer_lineups for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy lineups_delete on public.soccer_lineups for delete to authenticated using ((select private.is_admin()));
create policy invitations_read on public.team_invitations for select to authenticated using ((select private.is_admin()));

-- Restrict grants as well as rows: an owner of a profile must never update role,
-- active, user_id or onboarding state. Results can only be written atomically.
revoke all on public.team_settings, public.soccer_members, public.soccer_member_contacts,
  public.soccer_events, public.soccer_rsvps, public.soccer_goals, public.soccer_lineups, public.team_invitations from anon, authenticated;
grant select on public.team_settings, public.soccer_members, public.soccer_member_contacts,
  public.soccer_events, public.soccer_rsvps, public.soccer_goals, public.soccer_lineups to anon, authenticated;
grant select (id, user_id, email, expires_at, revoked_at, accepted_at, created_at) on public.team_invitations to authenticated;
grant update (name, season, timezone, sport_mode, scores_enabled, organizer_name, organizer_whatsapp) on public.team_settings to authenticated;
grant update (name, jersey_number, position, avatar_path, avatar_emoji) on public.soccer_members to authenticated;
grant update (phone) on public.soccer_member_contacts to authenticated;
grant insert (id, type, title, date, time, end_time, location, opponent, home_away, notes, created_by),
  update (type, title, date, time, end_time, location, opponent, home_away, notes), delete on public.soccer_events to authenticated;
grant insert (event_id, member_id, status), update (event_id, member_id, status, updated_at) on public.soccer_rsvps to authenticated;
grant insert (event_id, name, formation, slots, status, created_by), update (name, formation, slots, status, updated_at), delete on public.soccer_lineups to authenticated;
grant all on public.team_settings, public.soccer_members, public.soccer_member_contacts,
  public.soccer_events, public.soccer_rsvps, public.soccer_goals, public.soccer_lineups, public.team_invitations to service_role;

create function public.set_member_access(p_member_id uuid, p_role text default null, p_active boolean default null)
returns public.soccer_members language plpgsql security definer set search_path = '' as $$
declare result public.soccer_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(784532, 1);
  if not private.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  if p_role is not null and p_role not in ('admin', 'coach', 'player') then raise exception 'Invalid role' using errcode = '22023'; end if;
  update public.soccer_members set role = coalesce(p_role, role), active = coalesce(p_active, active)
    where id = p_member_id returning * into result;
  if not found then raise exception 'Member not found' using errcode = 'P0002'; end if;
  return result;
end;
$$;

create function public.save_result(p_event_id uuid, p_team_score integer, p_opponent_score integer, p_goals jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare settings public.team_settings; item jsonb;
begin
  if not private.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  select * into settings from public.team_settings where id = 1;
  if not settings.scores_enabled then raise exception 'Scores are disabled for this team' using errcode = '22023'; end if;
  if p_team_score is null or p_opponent_score is null or p_team_score not between 0 and 9999 or p_opponent_score not between 0 and 9999 then
    raise exception 'Scores must be whole numbers from 0 to 9999' using errcode = '22023';
  end if;
  if p_goals is null or jsonb_typeof(p_goals) <> 'array' or jsonb_array_length(p_goals) > p_team_score then
    raise exception 'Goal records must be an array and cannot exceed the team score' using errcode = '22023';
  end if;
  if settings.sport_mode <> 'soccer' and jsonb_array_length(p_goals) > 0 then raise exception 'Goal records require soccer mode' using errcode = '22023'; end if;
  -- The row lock also serializes concurrent result replacements.
  perform 1 from public.soccer_events where id = p_event_id and type = 'game' for update;
  if not found then raise exception 'Game not found' using errcode = 'P0002'; end if;
  update public.soccer_events set team_score = p_team_score, opponent_score = p_opponent_score where id = p_event_id;
  -- Switching the UI into general mode must not silently destroy existing
  -- soccer history. Only soccer mode explicitly replaces goal records.
  if settings.sport_mode = 'soccer' then
    delete from public.soccer_goals where event_id = p_event_id;
    for item in select value from jsonb_array_elements(p_goals) loop
      insert into public.soccer_goals (event_id, scorer_id, assist_id, minute)
        values (p_event_id, (item->>'scorer_id')::uuid, nullif(item->>'assist_id', '')::uuid, nullif(item->>'minute', '')::integer);
    end loop;
  end if;
end;
$$;

create function public.bootstrap_owner(p_user_id uuid, p_email text, p_name text)
returns public.soccer_members language plpgsql security definer set search_path = '' as $$
declare result public.soccer_members;
begin
  if not exists (select 1 from auth.users where id = p_user_id and lower(email) = lower(p_email)) then
    raise exception 'Owner must match an existing Auth user' using errcode = '22023';
  end if;
  insert into public.soccer_members(user_id, name, role, active, onboarding_completed_at)
    values(p_user_id, btrim(p_name), 'admin', true, now())
    on conflict (user_id) do update set role = 'admin', active = true, onboarding_completed_at = coalesce(public.soccer_members.onboarding_completed_at, now())
    returning * into result;
  insert into public.soccer_member_contacts(member_id, email) values(result.id, lower(p_email))
    on conflict (member_id) do update set email = excluded.email;
  update public.team_invitations set revoked_at = now() where user_id = p_user_id and accepted_at is null;
  return result;
end;
$$;

create function public.find_invitation_user(p_email text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', id, 'email_confirmed_at', email_confirmed_at) from auth.users where lower(email) = lower(p_email) limit 1
$$;

-- Only the privileged function may provision invitations. The native Auth token
-- is hashed again here so database reads can never reveal a redeemable link.
create function public.issue_invitation(p_user_id uuid, p_email text, p_name text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare member public.soccer_members; invitation public.team_invitations;
begin
  perform pg_catalog.pg_advisory_xact_lock(784532, 1);
  select * into member from public.soccer_members where user_id = p_user_id for update;
  if found and member.onboarding_completed_at is not null then raise exception 'This account already belongs to a member' using errcode = '22023'; end if;
  if length(p_token_hash) < 20 then raise exception 'Invalid invitation token' using errcode = '22023'; end if;
  if not exists (select 1 from auth.users where id = p_user_id and lower(email) = lower(p_email)) then raise exception 'Invitation user mismatch' using errcode = '22023'; end if;
  insert into public.soccer_members(user_id, name) values(p_user_id, btrim(p_name))
    on conflict (user_id) do update set name = excluded.name returning * into member;
  insert into public.soccer_member_contacts(member_id, email) values(member.id, lower(p_email))
    on conflict (member_id) do update set email = excluded.email;
  insert into public.team_invitations(user_id, email, token_digest, expires_at)
    values(p_user_id, lower(p_email), encode(extensions.digest(p_token_hash, 'sha256'), 'hex'), now() + interval '1 hour')
    on conflict (user_id) do update set token_digest = excluded.token_digest, expires_at = excluded.expires_at,
      revoked_at = null, accepted_at = null, created_at = now()
    returning * into invitation;
  return jsonb_build_object('id', invitation.id, 'user_id', invitation.user_id, 'expires_at', invitation.expires_at);
end;
$$;

create function public.revoke_invitation(p_invitation_id uuid) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'Administrator access required' using errcode = '42501'; end if;
  update public.team_invitations set revoked_at = now() where id = p_invitation_id and accepted_at is null;
  if not found then raise exception 'Pending invitation not found' using errcode = 'P0002'; end if;
end;
$$;

create function public.complete_invitation(p_invitation_id uuid, p_token_hash text, p_name text,
  p_jersey_number integer default null, p_position text default '', p_phone text default null)
returns public.soccer_members language plpgsql security definer set search_path = '' as $$
declare invitation public.team_invitations; result public.soccer_members;
begin
  -- Match the lock order of issuance and membership mutations.
  perform pg_catalog.pg_advisory_xact_lock(784532, 1);
  select * into invitation from public.team_invitations where id = p_invitation_id for update;
  if not found or invitation.user_id <> (select auth.uid()) or auth.uid() is null
    or invitation.accepted_at is not null or invitation.revoked_at is not null
    or invitation.expires_at <= now() or p_token_hash is null
    or invitation.token_digest <> encode(extensions.digest(p_token_hash, 'sha256'), 'hex') then
    raise exception 'Invitation is invalid, expired, revoked, or already accepted' using errcode = '42501';
  end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null and coalesce(encrypted_password, '') <> '') then
    raise exception 'Verify the invitation and set a password before joining' using errcode = '42501';
  end if;
  update public.soccer_members set name = btrim(p_name), jersey_number = p_jersey_number,
    position = coalesce(p_position, ''), active = true, onboarding_completed_at = now()
    where user_id = invitation.user_id and onboarding_completed_at is null returning * into result;
  if not found then raise exception 'Membership is already complete' using errcode = '42501'; end if;
  update public.soccer_member_contacts set phone = nullif(btrim(p_phone), '') where member_id = result.id;
  update public.team_invitations set accepted_at = now() where id = invitation.id;
  return result;
end;
$$;

revoke all on function public.set_member_access(uuid,text,boolean), public.save_result(uuid,integer,integer,jsonb),
  public.bootstrap_owner(uuid,text,text), public.find_invitation_user(text), public.issue_invitation(uuid,text,text,text), public.revoke_invitation(uuid),
  public.complete_invitation(uuid,text,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.set_member_access(uuid,text,boolean), public.save_result(uuid,integer,integer,jsonb),
  public.revoke_invitation(uuid), public.complete_invitation(uuid,text,text,integer,text,text) to authenticated;
grant execute on function public.bootstrap_owner(uuid,text,text), public.find_invitation_user(text), public.issue_invitation(uuid,text,text,text) to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
create policy avatars_read on storage.objects for select to authenticated using (bucket_id = 'avatars' and (select private.is_member()));
create policy avatars_insert on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (select private.is_member()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_update on storage.objects for update to authenticated using (bucket_id = 'avatars' and (select private.is_member()) and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'avatars' and (select private.is_member()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy avatars_delete on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (select private.is_member()) and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Private contacts/invitation rows are deliberately not published via Realtime.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then create publication supabase_realtime; end if;
end;
$$;
alter publication supabase_realtime add table public.team_settings, public.soccer_members, public.soccer_events,
  public.soccer_rsvps, public.soccer_goals, public.soccer_lineups;
