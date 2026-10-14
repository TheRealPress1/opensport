-- Auth invite verification itself creates a temporary random password BEFORE
-- confirming the email. Only a later password change proves the player chose a
-- usable password. Track that event without recording any credential value.
alter table public.team_invitations add column password_changed_at timestamptz;

create function private.record_invitation_password_setup() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.email_confirmed_at is not null
    and new.encrypted_password is distinct from old.encrypted_password
    and coalesce(new.encrypted_password, '') <> '' then
    update public.team_invitations set password_changed_at = clock_timestamp()
      where user_id = new.id and accepted_at is null and revoked_at is null
        and expires_at > clock_timestamp();
  end if;
  return new;
end;
$$;
revoke all on function private.record_invitation_password_setup() from public;
create trigger opensport_invitation_password_setup after update of encrypted_password on auth.users
  for each row execute function private.record_invitation_password_setup();

create function private.reset_invitation_password_setup() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.password_changed_at := null;
  return new;
end;
$$;
revoke all on function private.reset_invitation_password_setup() from public;
create trigger invitation_password_reset before insert or update of token_digest on public.team_invitations
  for each row execute function private.reset_invitation_password_setup();

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
  if invitation.password_changed_at is null or invitation.password_changed_at < invitation.created_at or not exists (
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
