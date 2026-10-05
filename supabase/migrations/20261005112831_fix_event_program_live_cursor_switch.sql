create or replace function public.set_current_event_program_item(
  p_program_item_id bigint
)
returns void
language plpgsql
security invoker
set search_path = public
as $program_current$
declare
  v_event_key text;
  v_kind text;
  v_room_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select event_key, kind, room_id
  into v_event_key, v_kind, v_room_id
  from public.qna_event_program_items
  where id = p_program_item_id;

  if not found then
    raise exception 'Program item not found' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_event_key));

  perform id
  from public.qna_event_program_items
  where event_key = v_event_key
  order by id
  for update;

  perform id
  from public.qna_rooms
  where event_key = v_event_key
  order by id
  for update;

  update public.qna_event_program_items
  set is_current = false
  where event_key = v_event_key
    and is_current = true
    and id <> p_program_item_id;

  update public.qna_event_program_items
  set is_current = true
  where id = p_program_item_id
    and event_key = v_event_key
    and is_current = false;

  if v_kind = 'session' then
    if v_room_id is null then
      raise exception 'Session program item has no room' using errcode = '22023';
    end if;

    update public.qna_rooms
    set is_current_session = false,
        is_questions_open = false
    where event_key = v_event_key
      and id <> v_room_id
      and (is_current_session = true or is_questions_open = true);

    update public.qna_rooms
    set is_current_session = true
    where id = v_room_id
      and event_key = v_event_key;
  elsif v_kind = 'service' then
    update public.qna_rooms
    set is_current_session = false,
        is_questions_open = false
    where event_key = v_event_key
      and (is_current_session = true or is_questions_open = true);
  else
    raise exception 'Invalid program item kind' using errcode = '22023';
  end if;
end;
$program_current$;

revoke execute on function public.set_current_event_program_item(bigint)
from public, anon;
grant execute on function public.set_current_event_program_item(bigint)
to authenticated;

create or replace function public.set_current_event_session(
  p_room_id bigint
)
returns void
language plpgsql
set search_path = public
as $current$
declare
  v_event_key text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select event_key
  into v_event_key
  from public.qna_rooms
  where id = p_room_id;

  if not found then
    raise exception 'Room not found' using errcode = '22023';
  end if;

  if v_event_key is null then
    raise exception 'Room does not belong to an event' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_event_key));

  perform id
  from public.qna_event_program_items
  where event_key = v_event_key
  order by id
  for update;

  perform id
  from public.qna_rooms
  where event_key = v_event_key
  order by id
  for update;

  update public.qna_event_program_items
  set is_current = false
  where event_key = v_event_key
    and is_current = true
    and not (kind = 'session' and room_id = p_room_id);

  update public.qna_event_program_items
  set is_current = true
  where event_key = v_event_key
    and kind = 'session'
    and room_id = p_room_id
    and is_current = false;

  update public.qna_rooms
  set is_current_session = false,
      is_questions_open = false
  where event_key = v_event_key
    and id <> p_room_id
    and (is_current_session = true or is_questions_open = true);

  update public.qna_rooms
  set is_current_session = true
  where id = p_room_id;
end;
$current$;

revoke execute on function public.set_current_event_session(bigint)
from public, anon;
grant execute on function public.set_current_event_session(bigint)
to authenticated;


