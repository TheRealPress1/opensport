-- Supabase may assign an unknown random password when generating an invite.
-- Nonempty encrypted_password therefore does not prove the player chose one.
-- Keep only a digest of the initial hash, never the hash itself or a password,
-- and require it to change before granting active team membership.
alter table public.team_invitations add column initial_password_digest text;
update public.team_invitations invitation set initial_password_digest = encode(extensions.digest(coalesce(account.encrypted_password, ''), 'sha256'), 'hex')
  from auth.users account where account.id = invitation.user_id;
alter table public.team_invitations alter column initial_password_digest set not null;

create or replace function public.issue_invitation(p_user_id uuid, p_email text, p_name text, p_token_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare member public.soccer_members; invitation public.team_invitations; password_digest text;
begin
  perform pg_catalog.pg_advisory_xact_lock(784532, 1);
  select * into member from public.soccer_members where user_id = p_user_id for update;
  if found and member.onboarding_completed_at is not null then raise exception 'This account already belongs to a member' using errcode = '22023'; end if;
  if length(p_token_hash) < 20 then raise exception 'Invalid invitation token' using errcode = '22023'; end if;
  select encode(extensions.digest(coalesce(encrypted_password, ''), 'sha256'), 'hex') into password_digest
    from auth.users where id = p_user_id and lower(email) = lower(p_email);
  if not found then raise exception 'Invitation user mismatch' using errcode = '22023'; end if;
  insert into public.soccer_members(user_id, name) values(p_user_id, btrim(p_name))
    on conflict (user_id) do update set name = excluded.name returning * into member;
  insert into public.soccer_member_contacts(member_id, email) values(member.id, lower(p_email))
    on conflict (member_id) do update set email = excluded.email;
  insert into public.team_invitations(user_id, email, token_digest, initial_password_digest, expires_at)
    values(p_user_id, lower(p_email), encode(extensions.digest(p_token_hash, 'sha256'), 'hex'), password_digest, now() + interval '1 hour')
    on conflict (user_id) do update set token_digest = excluded.token_digest, initial_password_digest = excluded.initial_password_digest,
      expires_at = excluded.expires_at, revoked_at = null, accepted_at = null, created_at = now()
    returning * into invitation;
  return jsonb_build_object('id', invitation.id, 'user_id', invitation.user_id, 'expires_at', invitation.expires_at);
end;
$$;

create or replace function public.complete_invitation(p_invitation_id uuid, p_token_hash text, p_name text,
  p_jersey_number integer default null, p_position text default '', p_phone text default null)
returns public.soccer_members language plpgsql security definer set search_path = '' as $$
declare invitation public.team_invitations; result public.soccer_members;
begin
  perform pg_catalog.pg_advisory_xact_lock(784532, 1);
  select * into invitation from public.team_invitations where id = p_invitation_id for update;
  if not found or invitation.user_id <> (select auth.uid()) or auth.uid() is null
    or invitation.accepted_at is not null or invitation.revoked_at is not null
    or invitation.expires_at <= now() or p_token_hash is null
    or invitation.token_digest <> encode(extensions.digest(p_token_hash, 'sha256'), 'hex') then
    raise exception 'Invitation is invalid, expired, revoked, or already accepted' using errcode = '42501';
  end if;
  if not exists (
    select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null
      and coalesce(encrypted_password, '') <> ''
      and encode(extensions.digest(encrypted_password, 'sha256'), 'hex') <> invitation.initial_password_digest
  ) then
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
