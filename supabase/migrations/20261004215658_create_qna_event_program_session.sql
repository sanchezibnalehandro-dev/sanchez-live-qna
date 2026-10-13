create or replace function public.create_qna_event_program_session(
  p_event_key text,
  p_mode text
)
returns table(
  room_id bigint,
  room_slug text,
  program_item_id bigint,
  title text,
  mode text,
  session_order integer,
  starts_at timestamptz,
  duration_minutes integer,
  is_current_session boolean,
  is_questions_open boolean
)
language plpgsql
security definer
set search_path = ''
as $create_session$
declare
  v_room_id bigint;
  v_room_slug text;
  v_program_item_id bigint;
  v_title text;
  v_session_order integer;
  v_starts_at timestamptz;
  v_duration_minutes integer := 30;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'Event key is required' using errcode = '22023';
  end if;

  if p_mode not in ('speaker', 'panel') then
    raise exception 'Session mode must be speaker or panel' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_event_key));

  if not exists (
    select 1
    from public.qna_rooms room
    where room.event_key = p_event_key
  ) then
    raise exception 'Event not found' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.qna_event_program_items item
    where item.event_key = p_event_key
  ) then
    raise exception 'Program v2 is not initialized for this event' using errcode = '22023';
  end if;

  select coalesce(max(item.session_order), 0) + 10
  into v_session_order
  from public.qna_event_program_items item
  where item.event_key = p_event_key;

  select item.starts_at + pg_catalog.make_interval(mins => item.duration_minutes)
  into v_starts_at
  from public.qna_event_program_items item
  where item.event_key = p_event_key
  order by item.session_order desc, item.id desc
  limit 1;

  v_title := case p_mode
    when 'panel' then 'Новая панель'
    else 'Новое выступление'
  end;

  v_room_id := pg_catalog.nextval(pg_catalog.pg_get_serial_sequence('public.qna_rooms', 'id'));
  v_room_slug := 'qna-session-' || v_room_id::text;

  insert into public.qna_rooms (
    id, slug, title, mode, event_key, session_order, starts_at, duration_minutes,
    is_current_session, is_questions_open, moderation_enabled
  )
  values (
    v_room_id, v_room_slug, v_title, p_mode, p_event_key, v_session_order, v_starts_at, v_duration_minutes,
    false, false, false
  );

  insert into public.qna_event_program_items (
    event_key, room_id, kind, title, session_order, starts_at, duration_minutes
  )
  values (
    p_event_key, v_room_id, 'session', null, v_session_order, v_starts_at, v_duration_minutes
  )
  returning id into v_program_item_id;

  return query
  select
    v_room_id,
    v_room_slug,
    v_program_item_id,
    v_title,
    p_mode,
    v_session_order,
    v_starts_at,
    v_duration_minutes,
    false,
    false;
end;
$create_session$;

revoke execute on function public.create_qna_event_program_session(text, text)
from public, anon;
grant execute on function public.create_qna_event_program_session(text, text)
to authenticated;
