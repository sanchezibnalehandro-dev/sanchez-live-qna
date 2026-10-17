-- ELINA 28 / Audience Choice · Slice 1 verification.
-- Run in Supabase SQL Editor on a TEST / STAGING environment only,
-- AFTER applying audience-choice.sql.
-- The entire test is transactional. No test votes/statuses are committed.
-- Not a guest UI test and not a concurrency/load test.

begin;

-- Prepare only the seeded, isolated rehearsal poll.
update public.audience_choice_polls
   set status = 'open'
 where poll_key = 'elina-28-rehearsal';

do $$
declare v_status jsonb;
begin
  v_status := public.audience_choice_event_status('elina-28-rehearsal');
  if v_status->>'status' is distinct from 'open'
     or v_status->>'poll_key' is distinct from 'elina-28-rehearsal' then
    raise exception 'FAIL: event_status mismatch';
  end if;
  if public.audience_choice_event_status('missing-event') is not null then
    raise exception 'FAIL: unknown events must have no poll';
  end if;
end
$$;

-- Test public/anonymous use, including the scoped read and RPC submission.
set local role anon;

do $$
declare
  v_guest uuid := '00000000-0000-4000-8000-000000000001';
  v_result boolean;
  v_get jsonb;
begin
  v_get := public.audience_choice_get('elina-28-rehearsal', v_guest);
  if v_get->>'status' is distinct from 'open'
     or (v_get->>'already_voted')::boolean is distinct from false then
    raise exception 'FAIL: new browser state';
  end if;

  -- Own-team vote must be rejected even when the RPC is called directly.
  begin
    perform public.audience_choice_submit('elina-28-rehearsal', v_guest, 2::smallint, 2::smallint);
    raise exception 'FAIL: self vote accepted';
  exception
    when others then
      if sqlerrm is distinct from 'Invalid team choice' then raise; end if;
  end;

  -- Bad ranges must be rejected.
  begin
    perform public.audience_choice_submit('elina-28-rehearsal', v_guest, 0::smallint, 3::smallint);
    raise exception 'FAIL: invalid team accepted';
  exception
    when others then
      if sqlerrm is distinct from 'Invalid team choice' then raise; end if;
  end;

  v_result := public.audience_choice_submit('elina-28-rehearsal', v_guest, 1::smallint, 2::smallint);
  if v_result is distinct from true then
    raise exception 'FAIL: first valid vote';
  end if;

  -- Changing the target or own team does not create a second vote.
  v_result := public.audience_choice_submit('elina-28-rehearsal', v_guest, 1::smallint, 3::smallint);
  if v_result is distinct from false then
    raise exception 'FAIL: second vote accepted';
  end if;

  v_get := public.audience_choice_get('elina-28-rehearsal', v_guest);
  if (v_get->>'already_voted')::boolean is distinct from true then
    raise exception 'FAIL: previously recorded vote not detected';
  end if;

  -- Anonymous guest cannot access private counts/controls.
  begin
    perform public.audience_choice_admin_state('elina-28-rehearsal');
    raise exception 'FAIL: anon can read admin counts';
  exception
    when others then
      if position('FAIL: anon can read admin counts' in sqlerrm) > 0 then raise; end if;
  end;
end
$$;

reset role;

do $$
declare
  v_poll_id bigint;
  v_count bigint;
  v_own smallint;
  v_target smallint;
begin
  select id into v_poll_id from public.audience_choice_polls
  where poll_key = 'elina-28-rehearsal';

  select count(*), max(own_team), max(team_no)
    into v_count, v_own, v_target
    from public.audience_choice_votes
   where poll_id = v_poll_id
     and guest_id = '00000000-0000-4000-8000-000000000001'::uuid;

  if v_count <> 1 or v_own <> 1 or v_target <> 2 then
    raise exception 'FAIL: stored vote or deduplication';
  end if;
end
$$;

-- After close, even a fresh browser ID cannot submit.
update public.audience_choice_polls
   set status = 'closed'
 where poll_key = 'elina-28-rehearsal';

set local role anon;

do $$
begin
  begin
    perform public.audience_choice_submit(
      'elina-28-rehearsal',
      '00000000-0000-4000-8000-000000000002'::uuid,
      4::smallint, 5::smallint
    );
    raise exception 'FAIL: closed poll accepted vote';
  exception
    when others then
      if sqlerrm is distinct from 'Voting is closed' then raise; end if;
  end;
end
$$;

reset role;

-- Repeatable tests always leave the database unchanged.
rollback;

-- Expected result if no exception was raised: PASS (rolled back).
-- Extra acceptance before release: concurrent submissions, guest phone flow,
-- and staff login. These cannot be proven by this single SQL transaction.
