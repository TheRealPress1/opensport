-- One-click cloud installs protect team creation and owner recovery with a setup
-- code. Counting every attempt keeps that code from being guessed online.
create table private.setup_attempts (
  attempted_at timestamptz not null default clock_timestamp()
);
create index setup_attempts_attempted_at on private.setup_attempts (attempted_at);
revoke all on private.setup_attempts from public, anon, authenticated;

-- Records one attempt and returns how many were made in the past hour, including
-- this one. The lock makes simultaneous attempts count one after another.
create function public.record_setup_attempt() returns integer
language plpgsql security definer set search_path = '' as $$
declare recent integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(784532, 2);
  delete from private.setup_attempts where attempted_at <= clock_timestamp() - interval '1 hour';
  insert into private.setup_attempts default values;
  select count(*) into recent from private.setup_attempts;
  return recent;
end;
$$;
revoke all on function public.record_setup_attempt() from public, anon, authenticated;
grant execute on function public.record_setup_attempt() to service_role;
