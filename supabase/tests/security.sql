-- Can also run after migrations on a DISPOSABLE real Supabase stack. All rows
-- and assertion helpers are rolled back; no external Auth calls are made.
begin;
create schema test;
create function test.ok(condition boolean, description text) returns void language plpgsql as $$
begin
  if condition is distinct from true then raise exception 'FAIL: %', description; end if;
  raise notice 'ok - %', description;
end;
$$;
create function test.denied(command text, expected_state text, description text) returns void language plpgsql as $$
begin
  begin
    execute command;
  exception when others then
    if sqlstate <> expected_state then raise exception 'FAIL: % (expected %, received %: %)', description, expected_state, sqlstate, sqlerrm; end if;
    raise notice 'ok - %', description;
    return;
  end;
  raise exception 'FAIL: % (operation unexpectedly succeeded)', description;
end;
$$;
grant usage on schema test to anon, authenticated, service_role;
grant execute on all functions in schema test to anon, authenticated, service_role;

insert into auth.users(id,email,email_confirmed_at,encrypted_password) values
  ('10000000-0000-0000-0000-000000000001','owner@example.test',now(),'fixture-password'),
  ('10000000-0000-0000-0000-000000000002','coach@example.test',now(),'fixture-password'),
  ('10000000-0000-0000-0000-000000000003','player@example.test',now(),'fixture-password'),
  ('10000000-0000-0000-0000-000000000004','teammate@example.test',now(),'fixture-password'),
  ('10000000-0000-0000-0000-000000000005','invite@example.test',now(),'fixture-password'),
  ('10000000-0000-0000-0000-000000000006','outsider@example.test',now(),'fixture-password');
insert into public.soccer_members(id,user_id,name,role,active,onboarding_completed_at) values
  ('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Owner','admin',true,now()),
  ('20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002','Coach','coach',true,now()),
  ('20000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000003','Player','player',true,now()),
  ('20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000004','Teammate','player',true,now());
insert into public.soccer_member_contacts(member_id,email,phone)
  select m.id, u.email, '+15550000000' from public.soccer_members m join auth.users u on u.id = m.user_id where m.id::text like '20000000-%';
update public.team_settings set sport_mode='soccer' where id=1;
insert into public.soccer_events(id,type,title,date,time,end_time,created_by) values
  ('30000000-0000-0000-0000-000000000001','game','Fixture match','2026-10-20','18:00','20:00','20000000-0000-0000-0000-000000000001');
insert into public.soccer_lineups(id,name,formation,status,created_by) values
  ('40000000-0000-0000-0000-000000000001','Private draft','4-4-2','draft','20000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002','Published lineup','4-4-2','published','20000000-0000-0000-0000-000000000001');
insert into storage.objects(bucket_id,name) values ('avatars','10000000-0000-0000-0000-000000000003/avatar.png');

set local role anon;
select test.ok((select count(*)=0 from public.soccer_members), 'anonymous cannot read roster');
select test.ok((select count(*)=0 from public.soccer_events), 'anonymous cannot read events');
select test.ok((select count(*)=0 from public.soccer_member_contacts), 'anonymous cannot read contacts');
select test.ok((select count(*)=0 from public.team_settings), 'anonymous cannot read organizer contact/settings');
select test.ok((select count(*)=0 from storage.objects), 'anonymous cannot read avatars');
select test.denied($q$select public.bootstrap_owner('10000000-0000-0000-0000-000000000006','outsider@example.test','Attacker')$q$, '42501', 'anonymous cannot bootstrap an owner');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
select test.ok((select count(*)=0 from public.soccer_members), 'authenticated nonmember cannot read roster');
select test.ok((select count(*)=0 from public.soccer_events), 'authenticated nonmember cannot read schedule');
select test.denied($q$insert into public.soccer_members(user_id,name) values('10000000-0000-0000-0000-000000000006','Attacker')$q$, '42501', 'authenticated nonmember cannot create membership');
select test.denied($q$select public.bootstrap_owner('10000000-0000-0000-0000-000000000006','outsider@example.test','Attacker')$q$, '42501', 'authenticated user cannot call owner bootstrap');
select test.denied($q$select public.find_invitation_user('owner@example.test')$q$, '42501', 'authenticated users cannot enumerate Auth users');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select test.ok((select count(*)=4 from public.soccer_members), 'player can see team roster');
select test.ok((select count(*)=1 from public.soccer_member_contacts), 'player sees only own contact');
select test.ok((select count(*)=1 from public.soccer_lineups), 'player cannot read draft lineups');
select test.denied($q$update public.soccer_members set role='admin' where user_id=auth.uid()$q$, '42501', 'column grants prevent self-promotion');
select test.denied($q$update public.soccer_members set active=false where user_id=auth.uid()$q$, '42501', 'players cannot change membership access directly');
select test.denied($q$select public.set_member_access('20000000-0000-0000-0000-000000000003','admin',null)$q$, '42501', 'players cannot promote via RPC');
update public.soccer_members set name='Updated player' where user_id=auth.uid();
select test.ok((select name='Updated player' from public.soccer_members where user_id=auth.uid()), 'own profile fields remain editable');
update public.soccer_members set name='Unauthorized edit' where id='20000000-0000-0000-0000-000000000004';
select test.ok((select name='Teammate' from public.soccer_members where id='20000000-0000-0000-0000-000000000004'), 'other member profile cannot be changed');
select test.denied($q$update public.soccer_members set avatar_path='10000000-0000-0000-0000-000000000004/avatar.png' where user_id=auth.uid()$q$, '22023', 'profile cannot claim another user avatar');
update public.soccer_member_contacts set phone='+15551111111' where member_id='20000000-0000-0000-0000-000000000003';
select test.ok((select phone='+15551111111' from public.soccer_member_contacts), 'player can update own phone');
select test.denied($q$insert into public.soccer_events(type,title,date,created_by) values('game','Unauthorized','2026-10-20','20000000-0000-0000-0000-000000000003')$q$, '42501', 'player cannot create events');
insert into public.soccer_rsvps(event_id,member_id,status) values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','going');
insert into public.soccer_rsvps(event_id,member_id,status) values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','maybe') on conflict(event_id,member_id) do update set status=excluded.status;
select test.ok((select count(*)=1 and min(status)='maybe' from public.soccer_rsvps), 'RSVP upsert does not create duplicates');
select test.denied($q$insert into public.soccer_rsvps(event_id,member_id,status) values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000004','going')$q$, '42501', 'player cannot RSVP as teammate');
select test.denied($q$select public.save_result('30000000-0000-0000-0000-000000000001',1,0,'[]')$q$, '42501', 'player cannot save results');
select test.denied($q$select token_digest from public.team_invitations$q$, '42501', 'invitation digests never exposed to browser roles');
select test.denied($q$select initial_password_digest from public.team_invitations$q$, '42501', 'password hash digests never exposed to browser roles');
insert into storage.objects(bucket_id,name) values('avatars','10000000-0000-0000-0000-000000000003/new.png');
select test.denied($q$insert into storage.objects(bucket_id,name) values('avatars','10000000-0000-0000-0000-000000000004/new.png')$q$, '42501', 'avatar uploads limited to own folder');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select test.ok((select count(*)=4 from public.soccer_member_contacts), 'admin can read team contacts');
select test.ok((select count(*)=2 from public.soccer_lineups), 'admin can see drafts');
select public.save_result('30000000-0000-0000-0000-000000000001',2,1,'[{"scorer_id":"20000000-0000-0000-0000-000000000003","minute":14}]');
select test.ok((select team_score=2 and opponent_score=1 from public.soccer_events where id='30000000-0000-0000-0000-000000000001'), 'admin result save updates scores');
select test.denied($q$select public.save_result('30000000-0000-0000-0000-000000000001',4,3,'[{"scorer_id":"99999999-0000-0000-0000-000000000000"}]')$q$, '23503', 'invalid goal scorer fails the transaction');
select test.ok((select team_score=2 and opponent_score=1 from public.soccer_events where id='30000000-0000-0000-0000-000000000001'), 'failed result replacement preserves previous score');
select test.ok((select count(*)=1 and min(minute)=14 from public.soccer_goals), 'failed result replacement preserves previous goals');
select test.denied($q$update public.soccer_events set team_score=8 where id='30000000-0000-0000-0000-000000000001'$q$, '42501', 'even admin browser cannot bypass atomic result function');
update public.team_settings set sport_mode='general';
select test.denied($q$select public.save_result('30000000-0000-0000-0000-000000000001',1,0,'[{"scorer_id":"20000000-0000-0000-0000-000000000003"}]')$q$, '22023', 'general sport mode rejects soccer goal stats');
select public.save_result('30000000-0000-0000-0000-000000000001',25,21,'[]');
select test.ok((select count(*)=1 and min(minute)=14 from public.soccer_goals), 'general mode score edits preserve hidden soccer history');
update public.team_settings set scores_enabled=false;
select test.denied($q$select public.save_result('30000000-0000-0000-0000-000000000001',1,0,'[]')$q$, '22023', 'score switch enforced by database');
select test.denied($q$update public.team_settings set timezone='Unknown/Timezone'$q$, '22023', 'invalid timezone rejected');
select public.set_member_access('20000000-0000-0000-0000-000000000003',null,false);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000003',true);
select test.ok((select count(*)=0 from public.soccer_events), 'deactivated session loses team reads immediately');
select test.ok((select count(*)=0 from public.soccer_member_contacts), 'deactivated member loses private contacts');
select test.ok((select count(*)=0 from storage.objects), 'deactivated member cannot obtain avatar objects');
select test.ok((select count(*)=1 from public.soccer_members), 'inactive member can read only their own access status');
select test.denied($q$insert into public.soccer_rsvps(event_id,member_id,status) values('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000003','going') on conflict(event_id,member_id) do update set status=excluded.status$q$, '42501', 'deactivated session loses writes immediately');

select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.set_member_access('20000000-0000-0000-0000-000000000001','player',null);
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000002',true);
select test.ok((select private.is_admin()), 'coach counts as an administrator');
select test.denied($q$select public.set_member_access('20000000-0000-0000-0000-000000000002','player',null)$q$, '23514', 'cannot demote the last coach/admin');
select test.denied($q$select public.set_member_access('20000000-0000-0000-0000-000000000002',null,false)$q$, '23514', 'cannot deactivate the last coach/admin');

reset role;
select test.denied($q$delete from public.soccer_members where id='20000000-0000-0000-0000-000000000002'$q$, '23514', 'last admin protection applies to privileged deletes');
set local role service_role;
select public.bootstrap_owner('10000000-0000-0000-0000-000000000001','owner@example.test','Owner');
select test.ok((select role='admin' and active from public.soccer_members where user_id='10000000-0000-0000-0000-000000000001'), 'host bootstrap can recover owner access');
select public.issue_invitation('10000000-0000-0000-0000-000000000005','invite@example.test','Invited','original-token-hash-for-security-test');

set local role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
select test.ok((select count(*)=0 from public.soccer_events), 'verified invite session alone does not grant membership');
select test.ok((select count(*)=1 from public.soccer_members), 'invited member sees own pending status');

-- Use a stable ID so tests can exercise acceptance without access to invitation
-- rows. Administrators receive this ID only inside the generated link.
reset role;
update public.team_invitations set id='50000000-0000-0000-0000-000000000001' where user_id='10000000-0000-0000-0000-000000000005';
set local role authenticated;
select test.denied($q$select public.complete_invitation('50000000-0000-0000-0000-000000000001','wrong-token-hash-for-security-test','Invited')$q$, '42501', 'wrong invitation token is rejected');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000006',true);
select test.denied($q$select public.complete_invitation('50000000-0000-0000-0000-000000000001','original-token-hash-for-security-test','Intruder')$q$, '42501', 'invitation cannot be accepted by another account');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000001',true);
select public.revoke_invitation('50000000-0000-0000-0000-000000000001');
select set_config('request.jwt.claim.sub','10000000-0000-0000-0000-000000000005',true);
select test.denied($q$select public.complete_invitation('50000000-0000-0000-0000-000000000001','original-token-hash-for-security-test','Invited')$q$, '42501', 'revoked invitation cannot complete even with a verified session');

reset role;
update public.team_invitations set revoked_at=null, expires_at=now()-interval '1 minute' where id='50000000-0000-0000-0000-000000000001';
set local role authenticated;
select test.denied($q$select public.complete_invitation('50000000-0000-0000-0000-000000000001','original-token-hash-for-security-test','Invited')$q$, '42501', 'expired invitation cannot complete');
set local role service_role;
select public.issue_invitation('10000000-0000-0000-0000-000000000005','invite@example.test','Invited','replacement-token-hash-for-security-test');
set local role authenticated;
select test.denied($q$select public.complete_invitation('50000000-0000-0000-0000-000000000001','original-token-hash-for-security-test','Invited')$q$, '42501', 'reissued invitation invalidates previous token');
select test.denied($q$select public.complete_invitation('50000000-0000-0000-0000-000000000001','replacement-token-hash-for-security-test','Invited')$q$, '42501', 'an existing random password does not satisfy password setup');
reset role;
update auth.users set encrypted_password='' where id='10000000-0000-0000-0000-000000000005';
set local role authenticated;
select test.denied($q$select public.complete_invitation('50000000-0000-0000-0000-000000000001','replacement-token-hash-for-security-test','Invited')$q$, '42501', 'acceptance requires a password to have been set');
reset role;
-- Native Auth assigns a temporary password before confirming a first invite.
-- Neither that automatic change nor later email confirmation proves setup.
update auth.users set email_confirmed_at=null where id='10000000-0000-0000-0000-000000000005';
update auth.users set encrypted_password='native-temporary-password' where id='10000000-0000-0000-0000-000000000005';
update auth.users set email_confirmed_at=now() where id='10000000-0000-0000-0000-000000000005';
set local role authenticated;
select test.denied($q$select public.complete_invitation('50000000-0000-0000-0000-000000000001','replacement-token-hash-for-security-test','Invited')$q$, '42501', 'native automatic password before confirmation does not satisfy setup');
reset role;
update auth.users set encrypted_password='fixture-password-changed' where id='10000000-0000-0000-0000-000000000005';
set local role authenticated;
select public.complete_invitation('50000000-0000-0000-0000-000000000001','replacement-token-hash-for-security-test','New teammate',7,'','+15552222222');
select test.ok((select count(*)=1 from public.soccer_events), 'successful invitation grants team access');
select test.ok((select active and onboarding_completed_at is not null from public.soccer_members where user_id=auth.uid()), 'acceptance marks membership complete');
select test.denied($q$select public.complete_invitation('50000000-0000-0000-0000-000000000001','replacement-token-hash-for-security-test','New teammate')$q$, '42501', 'accepted invitation cannot be replayed');

-- One-click cloud installs count setup-code attempts on the server only.
set local role anon;
select test.denied($q$select public.record_setup_attempt('visitor')$q$, '42501', 'anonymous cannot count setup attempts');
set local role authenticated;
select test.denied($q$select public.record_setup_attempt('visitor')$q$, '42501', 'members cannot count setup attempts');
select test.denied($q$select count(*) from private.setup_attempts$q$, '42501', 'members cannot read setup attempts');
reset role;
set local role service_role;
select test.ok((select bool_and(public.record_setup_attempt('guesser')) from generate_series(1, 10)), 'a visitor gets ten setup attempts an hour');
select test.ok((select public.record_setup_attempt('guesser') = false), 'the eleventh attempt from that visitor is refused');
select test.ok((select public.record_setup_attempt('owner')), 'one visitor using up their attempts does not lock out the owner');
reset role;
select test.ok((select count(*) = 11 from private.setup_attempts), 'refused attempts are not stored');
insert into private.setup_attempts(client) select 'crowd-' || n from generate_series(1, 39) n;
set local role service_role;
select test.ok((select public.record_setup_attempt('newcomer') = false), 'fifty attempts an hour from everyone together stop all code checks');
reset role;
update private.setup_attempts set attempted_at = now() - interval '2 hours';
set local role service_role;
select test.ok((select public.record_setup_attempt('guesser')), 'attempts older than an hour stop counting');
reset role;

rollback;
