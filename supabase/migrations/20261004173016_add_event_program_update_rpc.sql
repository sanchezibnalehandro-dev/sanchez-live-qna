create or replace function public.update_qna_event_program(
  p_event_key text,
  p_items jsonb
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_requested integer;
  v_distinct_ids integer;
  v_distinct_orders integer;
  v_existing integer;
  v_event_total integer;
begin
  if p_event_key is null or btrim(p_event_key) = '' then
    raise exception 'Event key is required' using errcode = '22023';
  end if;

  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'Program payload must be an array' using errcode = '22023';
  end if;

  select count(*), count(distinct id), count(distinct session_order)
  into v_requested, v_distinct_ids, v_distinct_orders
  from jsonb_to_recordset(p_items)
    as x(id bigint, session_order integer, title text, starts_at timestamptz, duration_minutes integer);

  if v_requested = 0
     or v_requested <> v_distinct_ids
     or v_requested <> v_distinct_orders then
    raise exception 'Program must contain unique room ids and order values' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items)
      as x(id bigint, session_order integer, title text, starts_at timestamptz, duration_minutes integer)
    where x.id is null
       or x.session_order is null
       or x.session_order < 1
       or x.title is null
       or btrim(x.title) = ''
       or (x.duration_minutes is not null and x.duration_minutes <= 0)
  ) then
    raise exception 'Program item is invalid' using errcode = '22023';
  end if;

  select count(*)
  into v_event_total
  from public.qna_rooms
  where event_key = p_event_key;

  select count(*)
  into v_existing
  from public.qna_rooms room
  join jsonb_to_recordset(p_items)
    as x(id bigint, session_order integer, title text, starts_at timestamptz, duration_minutes integer)
    on x.id = room.id
  where room.event_key = p_event_key;

  if v_event_total = 0
     or v_existing <> v_event_total
     or v_requested <> v_event_total then
    raise exception 'Program must contain every event room exactly once' using errcode = '22023';
  end if;

  perform 1
  from public.qna_rooms
  where event_key = p_event_key
  order by id
  for update;

  update public.qna_rooms room
  set session_order = item.session_order,
      title = btrim(item.title),
      starts_at = item.starts_at,
      duration_minutes = item.duration_minutes,
      updated_at = now()
  from jsonb_to_recordset(p_items)
    as item(id bigint, session_order integer, title text, starts_at timestamptz, duration_minutes integer)
  where room.id = item.id
    and room.event_key = p_event_key;
end;
$$;

revoke execute on function public.update_qna_event_program(text, jsonb)
from public, anon;

grant execute on function public.update_qna_event_program(text, jsonb)
to authenticated;
