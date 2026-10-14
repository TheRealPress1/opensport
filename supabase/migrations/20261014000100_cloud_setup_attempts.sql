-- One-click cloud installs protect team creation and owner recovery with a setup
-- code. Counting attempts keeps that code from being guessed online. Each visitor
-- gets ten attempts an hour, and everyone together fifty, so one visitor can't
-- lock the owner out by using up a shared allowance.
create table private.setup_attempts (
  client text not null check (length(client) <= 128),
  attempted_at timestamptz not null default clock_timestamp()
);
create index setup_attempts_attempted_at on private.setup_attempts (attempted_at);
revoke all on private.setup_attempts from public, anon, authenticated;

-- Returns whether this attempt may check a code, recording it only when allowed,
-- so refused requests can't grow the table. The lock makes simultaneous attempts
-- count one after another.
create function public.record_setup_attempt(p_client text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(784532, 2);
  delete from private.setup_attempts where attempted_at <= clock_timestamp() - interval '1 hour';
  if (select count(*) from private.setup_attempts where client = p_client) >= 10
    or (select count(*) from private.setup_attempts) >= 50 then
    return false;
  end if;
  insert into private.setup_attempts(client) values (p_client);
  return true;
end;
$$;
revoke all on function public.record_setup_attempt(text) from public, anon, authenticated;
grant execute on function public.record_setup_attempt(text) to service_role;
