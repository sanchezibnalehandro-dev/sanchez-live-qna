alter table public.qna_event_program_items
  add column if not exists is_current boolean not null default false;

create unique index if not exists qna_event_program_items_one_current_per_event_idx
  on public.qna_event_program_items(event_key)
  where is_current = true;

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
  set is_current = (id = p_program_item_id)
  where event_key = v_event_key
    and is_current is distinct from (id = p_program_item_id);

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

create or replace function public.clear_current_event_program_item(
  p_event_key text
)
returns void
language plpgsql
security invoker
set search_path = public
as $program_clear$
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'Event key is required' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.qna_rooms where event_key = p_event_key
  ) and not exists (
    select 1 from public.qna_event_program_items where event_key = p_event_key
  ) then
    raise exception 'Event not found' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_event_key));

  perform id
  from public.qna_event_program_items
  where event_key = p_event_key
  order by id
  for update;

  perform id
  from public.qna_rooms
  where event_key = p_event_key
  order by id
  for update;

  update public.qna_event_program_items
  set is_current = false
  where event_key = p_event_key
    and is_current = true;

  update public.qna_rooms
  set is_current_session = false,
      is_questions_open = false
  where event_key = p_event_key
    and (is_current_session = true or is_questions_open = true);
end;
$program_clear$;

revoke execute on function public.clear_current_event_program_item(text)
from public, anon;
grant execute on function public.clear_current_event_program_item(text)
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
  set is_current = (
    kind = 'session'
    and room_id = p_room_id
  )
  where event_key = v_event_key
    and is_current is distinct from (
      kind = 'session'
      and room_id = p_room_id
    );

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
